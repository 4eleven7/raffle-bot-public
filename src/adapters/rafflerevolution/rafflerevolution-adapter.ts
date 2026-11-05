import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "rafflerevolution";
const DISPLAY_NAME = "Raffle Revolution";
const BASE_URL = "https://rafflerevolution.com";
const LIST_PATH = "/competitions";
const UK_ZONE = "Europe/London";

export class RaffleRevolutionAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const listHtml = await fetchPage(LIST_PATH);
    const links = parseCompetitionLinks(listHtml);
    const competitions: RawCompetition[] = [];

    for (const link of links) {
      try {
        const detailHtml = await fetchPage(link);
        const competition = parseRaffleRevolutionDetail(detailHtml, link);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

function parseCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: string[] = [];

  $('a[href*="/competitions/"]').each((_i, el) => {
    const href = absoluteUrl($(el).attr("href") ?? "");
    if (!href.startsWith(`${BASE_URL}/competitions/`)) return;
    if (href.replace(/\/$/, "") === `${BASE_URL}/competitions`) return;
    if (seen.has(href)) return;
    seen.add(href);
    links.push(href);
  });

  return links.slice(0, 40);
}

export function parseRaffleRevolutionDetail(html: string, href: string): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const sourceId = slugFromUrl(href);
  const name =
    cleanText($(".rr-product-title").first().text()) ||
    cleanText($("h1").first().text()) ||
    cleanText($('meta[property="og:title"]').attr("content") ?? "") ||
    sourceId?.replace(/-/g, " ") ||
    "";

  const soldMax = text.match(/([\d,]+)\s*\/\s*([\d,]+)\s*SOLD/i);
  const maxTickets =
    soldMax
      ? parseNumber(soldMax[2])
      : parseNumber($("[data-max-qty]").first().attr("data-max-qty"));
  const ticketsSold = soldMax ? parseNumber(soldMax[1]) : 0;
  const entryPrice =
    parseMoney($("[data-price]").first().attr("data-price")) ||
    parseMoney(cleanText($(".rr-price-main").first().text())) ||
    parseMoney(text.match(/\bEntry\s+(\d+p|£\s*[\d.]+)/i)?.[1]);
  const drawDate =
    parseDrawDate($("[data-end]").first().attr("data-end")) ??
    parseDrawDate(text.match(/\bLive Draw\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]);

  if (
    !sourceId ||
    !name ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    entryPrice <= 0 ||
    drawDate === null
  ) {
    return null;
  }

  const cashAlternative = extractCashAlternative(`${name} ${text}`);
  const maxEntriesPerUser = parseNumber(
    text.match(/\bMax\s+([\d,]+)\s+tickets\s+per\s+player/i)?.[1],
  );

  return {
    sourceId,
    siteName: SITE_NAME,
    url: href,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: /instant|auto\s*draw/i.test(text),
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

async function fetchPage(pathOrUrl: string): Promise<string> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!response.ok) {
    throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, BASE_URL).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function slugFromUrl(value: string): string | null {
  return value.match(/\/competitions\/([^/?#]+)/)?.[1] ?? null;
}

function parseDrawDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const sql = DateTime.fromSQL(value.trim(), { zone: UK_ZONE });
  if (sql.isValid) return sql.toUTC().toISO({ suppressMilliseconds: false });

  const dayMonthYear = DateTime.fromFormat(value.trim(), "dd/MM/yyyy", { zone: UK_ZONE });
  if (dayMonthYear.isValid) {
    return dayMonthYear.set({ hour: 20 }).toUTC().toISO({ suppressMilliseconds: false });
  }

  return null;
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/(?:Win\s+)?£\s*([\d,.]+)\s*(k)?\s+(?:tax[-\s]*)?cash\b/i) ||
    text.match(/\bor\s+£\s*([\d,.]+)\s*(k)?\b/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseMoney(value: string | null | undefined): number {
  if (!value) return 0;
  const pence = value.match(/(\d+)\s*p\b/i);
  if (pence) return Number.parseInt(pence[1], 10) / 100;

  const pound = value.match(/£?\s*([\d.]+)/);
  return pound ? Number.parseFloat(pound[1]) : 0;
}

function parseNumber(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
