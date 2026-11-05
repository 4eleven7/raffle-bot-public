import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.tommyfrenchcompetitions.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

export class TommyFrenchAdapter implements SiteAdapter {
  readonly siteName = "tommyfrench";

  async fetchAll(): Promise<RawCompetition[]> {
    const listHtml = await fetchHtml(`${BASE_URL}/`);
    const links = parseRaffleLinks(listHtml).slice(0, 24);
    const rows: RawCompetition[] = [];

    for (const url of links) {
      try {
        const html = await fetchHtml(url);
        const row = parseTommyFrenchDetail(html, url);
        if (row) rows.push(row);
      } catch {
        continue;
      }
    }

    return dedupBySourceId(rows);
  }
}

export function parseTommyFrenchDetail(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  if (/\bRAFFLE NOW DRAWN\b|\bEntries Closed\b/i.test(text)) return null;

  const sourceId =
    $("#jsDataRafflePage").attr("data-id") ??
    $("#jsData").attr("data-id") ??
    url.match(/\/raffle\/(\d+)/)?.[1] ??
    "";
  const name = cleanText($("h1").first().text());
  if (!sourceId || !name) return null;

  const entryPrice =
    parseMoney($("#jsDataRafflePage").attr("data-price")) ||
    parseMoney($("#jsData").attr("data-saleprice")) ||
    parseMoney($("#jsData").attr("data-price")) ||
    parseDetailPrice(text);
  const soldMax = text.match(/([\d,]+)\s*\/\s*([\d,]+)\s+Tickets\s+Sold/i);
  const ticketsSold = parseInteger(soldMax?.[1]);
  const maxTickets = parseInteger(soldMax?.[2]);
  const drawDate =
    parseDrawDate(text) ??
    parseIsoDrawDate($("#raffle-draw-date").attr("data-draw-date"));
  const cashAlternative = parseMainPrize(text) ?? parseCashFromTitle(name);
  const operatorCap = parseInteger(
    text.match(/Maximum tickets per customer:\s*([\d,]+)/i)?.[1],
  );

  if (
    entryPrice <= 0 ||
    ticketsSold < 0 ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: "tommyfrench",
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: operatorCap || 100,
    maxEntriesPerUserSource: operatorCap > 0 ? "site" : "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: /\bAUTO DRAW\b/i.test(text),
    categories: inferCategories(name, cleanText($("#howitworks-popup").text())),
    scrapedAt: new Date().toISOString(),
  };
}

function parseRaffleLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $('a[href*="/raffle/"]').each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/\/raffle\/\d+\/?/);
    if (match) links.add(new URL(match[0], BASE_URL).toString());
  });
  return Array.from(links);
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });
  if (!response.ok) {
    throw new Error(`[Tommy French] Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function parseDrawDate(text: string): string | null {
  const match = text.match(/\b(?:ENTRY CLOSES|AUTO DRAW)\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:st|nd|rd|th)?\s*\|\s*(\d{1,2}):(\d{2})/i);
  if (!match) return null;
  const month = DateTime.fromFormat(match[1], "LLL", { zone: "Europe/London" }).month;
  if (!month) return null;
  const now = DateTime.now().setZone("Europe/London");
  let date = DateTime.fromObject(
    {
      year: now.year,
      month,
      day: Number(match[2]),
      hour: Number(match[3]),
      minute: Number(match[4]),
    },
    { zone: "Europe/London" },
  );
  if (date.isValid && date < now.minus({ days: 1 })) {
    date = date.plus({ years: 1 });
  }
  return date.isValid ? date.toUTC().toISO() : null;
}

function parseIsoDrawDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = DateTime.fromISO(value, { setZone: true });
  return date.isValid ? date.toUTC().toISO() : null;
}

function parseMainPrize(text: string): number | null {
  const match =
    text.match(/\bMain Prize\s+£\s*([\d,]+)\b/i) ??
    text.match(/\bWin\s+£\s*([\d,]+)\s*(?:Tax[-\s]*Free\s*)?Cash\b/i);
  const value = parseInteger(match?.[1]);
  return value > 0 ? value : null;
}

function parseCashFromTitle(name: string): number | null {
  const match = name.match(/£\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2] ? value * 1000 : value;
}

function parseDetailPrice(text: string): number {
  const saleMatch = text.match(/£\s*[\d,.]+\s+£\s*([\d,.]+)\s+price per ticket/i);
  if (saleMatch) return parseMoney(saleMatch[1]);
  const match = text.match(/£\s*([\d,.]+)\s+price per ticket/i);
  return parseMoney(match?.[1]);
}

function parseMoney(value: string | undefined): number {
  const parsed = parseFloat(String(value ?? "").replace(/[£,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: string | undefined): number {
  const parsed = parseInt(String(value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferCategories(name: string, text: string): string[] {
  const categories: string[] = [];
  if (/\bcash\b|£/.test(name.toLowerCase())) categories.push("cash");
  if (/\bInstant Wins?\b|\bInstant Prize Pool\b/i.test(text)) {
    categories.push("instant-win");
  }
  return categories;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function dedupBySourceId(rows: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.sourceId)) return false;
    seen.add(row.sourceId);
    return true;
  });
}
