import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "jambala";
const BASE_URL = "https://www.jambala.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class JambalaAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const collectionUrl = `${BASE_URL}/collections/live-competitions?limit=250`;
    const collectionHtml = await fetchText(collectionUrl);
    const competitions: RawCompetition[] = [];

    for (const url of parseJambalaCollection(collectionHtml)) {
      try {
        const detail = await fetchText(url);
        const competition = parseJambalaDetail(detail, url);
        if (competition) competitions.push(competition);
      } catch {
        // A single unavailable product must not hide the other live draws.
      }
    }

    return competitions;
  }
}

export function parseJambalaCollection(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();

  $(".product-item").each((_index, element) => {
    const card = $(element);
    const text = cleanText(card.text());
    if (/\b(?:closed|coming soon)\b/i.test(text) || /instant wins?/i.test(text)) {
      return;
    }

    const href = card.find("a[href*='/products/']").first().attr("href");
    if (href) urls.add(new URL(href, BASE_URL).toString());
  });

  return Array.from(urls);
}

export function parseJambalaDetail(html: string, url: string): RawCompetition | null {
  const $ = cheerio.load(html);
  const product = $("product-page").first();
  const root = product.length ? product : $("body");
  const text = cleanText(root.text());
  const name = cleanText(root.find("h1").first().text());
  const entryPrice = parseMoney(root.find(".product-price--original").first().text()) ??
    parseMoney(text.match(/Tickets at:\s*£\s*[\d,.]+/i)?.[0]);
  const prizeValue = parseMoney(root.find(".price_val").first().text());
  const soldMatch = text.match(/Sold:\s*\d+%\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const ticketsSold = parseInteger(soldMatch?.[1]);
  const maxTickets = parseInteger(soldMatch?.[2]) ?? parseInteger(
    text.match(/1 in\s*([\d,]+)\s*Chance/i)?.[1],
  );
  const drawDate = parseClosingDate(text);
  const maxEntriesPerUser = parseMaxEntries(text);
  const sourceId = productSlug(url);

  if (
    !sourceId ||
    !name ||
    /\b(?:closed|coming soon)\b/i.test(text) ||
    entryPrice === null ||
    entryPrice <= 0 ||
    ticketsSold === null ||
    ticketsSold < 0 ||
    maxTickets === null ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  const cashAlternative = /cash prize/i.test(name) ? prizeValue :
    parseMoney(text.match(/Cash Alternative\s*[:\-]?\s*£\s*[\d,.]+/i)?.[0]);
  const isCash = /cash/i.test(name);

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name: name.substring(0, 120),
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntriesPerUser === 100 ? "fallback" : "site",
    cashAlternative,
    estimatedPrizeValue: isCash ? prizeValue : null,
    valuationSource: isCash && prizeValue !== null ? "cash" : null,
    valuationConfidence: isCash && prizeValue !== null ? "high" : null,
    valuationNotes: isCash && prizeValue !== null ? "Operator-stated cash prize" : null,
    drawDate,
    isAutoDraw: /automated draw/i.test(text),
    categories: isCash ? ["cash"] : ["prize draw"],
    scrapedAt: new Date().toISOString(),
  };
}

function fetchText(url: string): Promise<string> {
  return fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Jambala fetch failed: ${response.status}`);
    return response.text();
  });
}

function parseClosingDate(text: string): string | null {
  const match = text.match(
    /Closing on\s+(\d{1,2})\s+([A-Za-z]+)\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i,
  );
  if (!match) return null;

  const now = DateTime.now().setZone("Europe/London");
  const month = parseMonth(match[2]);
  if (month === null) return null;

  let date = DateTime.fromObject(
    {
      year: now.year,
      month,
      day: Number(match[1]),
      hour: to24Hour(Number(match[3]), match[5]),
      minute: Number(match[4]),
    },
    { zone: "Europe/London" },
  );
  if (!date.isValid) return null;
  if (date <= now) date = date.plus({ years: 1 });
  return date.toUTC().toISO({ suppressMilliseconds: false });
}

function parseMaxEntries(text: string): number {
  const match = text.match(/(?:maximum|max)\s+(\d+)\s+tickets?\s+per\s+(?:person|user)/i);
  return match ? Number(match[1]) : 100;
}

function parseMonth(value: string): number | null {
  const abbreviated = DateTime.fromFormat(value, "LLL", { locale: "en-GB" });
  if (abbreviated.isValid) return abbreviated.month;
  const full = DateTime.fromFormat(value, "LLLL", { locale: "en-GB" });
  return full.isValid ? full.month : null;
}

function to24Hour(hour: number, meridiem: string): number {
  const normalized = meridiem.toLowerCase();
  if (normalized === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function productSlug(url: string): string {
  const match = new URL(url).pathname.match(/\/products\/([^/]+)/i);
  return match?.[1] ?? "";
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/£\s*([\d,.]+)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
