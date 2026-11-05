import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "winwink";
const DISPLAY_NAME = "WinWink";
const BASE_URL = "https://winwink.co.uk";
const UK_ZONE = "Europe/London";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class WinWinkAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const listHtml = await this.fetchUrl(BASE_URL);
    const urls = parseCompetitionLinks(listHtml);
    const competitions: RawCompetition[] = [];

    for (const url of urls.slice(0, 40)) {
      try {
        const detailHtml = await this.fetchUrl(url);
        const competition = parseWinWinkDetail(detailHtml, url, new Date().toISOString());
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return dedupe(competitions).filter((competition) => (
      competition.maxTickets <= 0 ||
      competition.ticketsSold < competition.maxTickets
    ));
  }

  private async fetchUrl(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  }
}

export function parseCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  const seen = new Set<string>();

  $('a[href*="/competitions/"]').each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const absolute = absoluteUrl(href);
    const slug = sourceIdFromUrl(absolute);
    if (!slug || seen.has(slug)) return;
    if (slug === "competitions") return;
    seen.add(slug);
    links.push(absolute);
  });

  return links;
}

export function parseWinWinkDetail(
  html: string,
  url: string,
  scrapedAt: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  if (/\bSales\s+closed\b/i.test(text)) return null;

  const sourceId = sourceIdFromUrl(url);
  const name = parseName($, text);
  const progress = parseSalesProgress(text);
  const entryPrice = parseEntryPrice(text);
  const drawDate = parseDrawDate(text);
  const maxEntriesPerUser = parseMaxEntriesPerUser(text);
  const prizeValue = parsePrizeValue(text);
  const category = parseCategory($);

  if (
    !sourceId ||
    !name ||
    progress === null ||
    entryPrice <= 0 ||
    drawDate === null ||
    prizeValue === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: SITE_NAME,
    url: absoluteUrl(url),
    name,
    entryPrice,
    ticketsSold: progress.sold,
    maxTickets: progress.total,
    maxEntriesPerUser: maxEntriesPerUser.value,
    maxEntriesPerUserSource: maxEntriesPerUser.source,
    cashAlternative: isCashCompetition(name, category) ? prizeValue : null,
    estimatedPrizeValue: isCashCompetition(name, category) ? null : prizeValue,
    valuationSource: isCashCompetition(name, category) ? "cash" : "site_estimate",
    valuationConfidence: "high",
    valuationNotes: "WinWink detail page prize value.",
    drawDate,
    isAutoDraw: /\binstant wins?\b/i.test(text),
    categories: category ? [category] : [],
    scrapedAt,
  };
}

function parseName($: cheerio.CheerioAPI, text: string): string {
  const heading =
    cleanText($("h1").first().text()) ||
    cleanText($('meta[property="og:title"]').attr("content") ?? "") ||
    "";
  if (heading && !/^WinWink\b/i.test(heading)) return heading;

  const marker = text.match(/\b(?:Featured|Cash Games|Pok[eé]mon|Gaming|Warhammer)\s+(.+?)\s+(?:Competition ends|Draws\s+[A-Za-z])/i);
  return cleanText(marker?.[1] ?? "");
}

function parseSalesProgress(text: string): { sold: number; total: number } | null {
  const match = text.match(/\bSales progress\s+([\d,]+)\s*\/\s*([\d,]+)\s*\(/i);
  if (!match) return null;

  const sold = parseInteger(match[1]);
  const total = parseInteger(match[2]);
  if (sold === null || total === null || total <= 0 || sold < 0) return null;
  return { sold, total };
}

function parseEntryPrice(text: string): number {
  const match = text.match(/\bTicket price\s+£\s*([\d,.]+)/i);
  if (!match) return 0;

  const price = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(price) ? price : 0;
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /\bDraws\s+[A-Za-z]+,\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)\b/i,
  );
  if (!match) return null;

  const parsed = DateTime.fromFormat(
    `${match[1]} ${match[2]} ${match[3]} ${match[4]}:${match[5]} ${match[6].toUpperCase()}`,
    "LLLL d yyyy h:mm a",
    { zone: UK_ZONE },
  );

  return parsed.isValid ? parsed.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function parseMaxEntriesPerUser(text: string): {
  value: number;
  source: "site" | "fallback";
} {
  const match = text.match(/\bMaximum\s+([\d,]+)\s+tickets?\s+per\s+person\b/i);
  const parsed = parseInteger(match?.[1] ?? "");
  return parsed !== null && parsed > 0
    ? { value: parsed, source: "site" }
    : { value: 100, source: "fallback" };
}

function parsePrizeValue(text: string): number | null {
  const match = text.match(/\bPrize value\s+£\s*([\d,.]+)/i);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseCategory($: cheerio.CheerioAPI): string | null {
  const crumbs = $("body")
    .text()
    .split("›")
    .map((part) => cleanText(part).toLowerCase())
    .filter(Boolean);
  const category = crumbs.find((part) => !["competitions"].includes(part) && part.length < 40);
  return category ?? null;
}

function isCashCompetition(name: string, category: string | null): boolean {
  return (
    category === "cash games" ||
    /^£\s*[\d,.]+\s*(?:k\s*)?(?:cash|tax[\s-]*free)/i.test(name) ||
    /\b(?:cash|tax[\s-]*free)\s+£\s*[\d,.]+/i.test(name)
  );
}

function sourceIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(absoluteUrl(url));
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] !== "competitions") return null;
    return parts[1] ? decodeURIComponent(parts[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `${BASE_URL}${href}`;
  return `${BASE_URL}/${href}`;
}

function parseInteger(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(competitions: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return competitions.filter((competition) => {
    if (seen.has(competition.sourceId)) return false;
    seen.add(competition.sourceId);
    return true;
  });
}
