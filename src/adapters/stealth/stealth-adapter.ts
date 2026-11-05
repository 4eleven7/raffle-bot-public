import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";

const SITE_NAME = "stealthcompetitions";
const DISPLAY_NAME = "Stealth Competitions";
const BASE_URL = "https://stealthcompetitions.co.uk";
const MAX_COMPETITIONS = 40;
const DETAIL_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 15_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class StealthAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await fetchPage(BASE_URL);
    const links = parseCompetitionLinks(html);
    const competitions = await mapWithConcurrency(
      links.slice(0, MAX_COMPETITIONS),
      DETAIL_CONCURRENCY,
      async (url) => {
        try {
          const detailHtml = await fetchPage(url);
          return parseCompetitionDetail(detailHtml, url);
        } catch {
          return null;
        }
      },
    );

    return competitions.filter((competition): competition is RawCompetition => competition !== null);
  }
}

function parseCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: string[] = [];

  $('a[href*="/competition/"]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    const url = toAbsoluteUrl(href);
    if (!url.startsWith(`${BASE_URL}/competition/`)) return;
    if (seen.has(url)) return;
    seen.add(url);
    links.push(url);
  });

  return links;
}

function parseCompetitionDetail(html: string, url: string): RawCompetition | null {
  const $ = cheerio.load(html);
  const metaDescription = cleanText(
    $('meta[name="description"]').attr("content") ??
      $('meta[property="og:description"]').attr("content") ??
      "",
  );
  const competitionDescription = cleanText($(".wysiwyg").last().text());
  $("script, style").remove();
  const text = cleanText($("body").text());
  const name = cleanText($("h1").first().text());
  if (!name) return null;
  const primaryText = extractPrimaryCompetitionText(text, name);
  if (/competition finished|this draw has now ended|this competition has now closed/i.test(text)) {
    return null;
  }

  const entryPrice = extractEntryPrice(primaryText);
  const advertisedMaxTickets = parseNumber(primaryText.match(/\bMax:\s*([\d,]+)/i)?.[1]);
  const soldMatch = primaryText.match(/\bTickets?\s+Sold:\s*([\d,]+)/i);
  const compactInventory = Array.from(
    primaryText.matchAll(/\b([\d,]+)\s*\/\s*([\d,.]+)\s*(k)?\b/gi),
  )
    .map((match) => ({
      sold: parseNumber(match[1]),
      max: parseNumber(match[2]) * (match[3] ? 1_000 : 1),
    }))
    .find((inventory) => inventory.max === advertisedMaxTickets);
  const exactTicketsSold = soldMatch
    ? parseNumber(soldMatch[1])
    : compactInventory?.sold ?? 0;
  const hasExactInventory =
    (soldMatch !== null || compactInventory !== undefined) &&
    advertisedMaxTickets > 0 &&
    exactTicketsSold >= 0 &&
    exactTicketsSold <= advertisedMaxTickets;
  const maxEntriesPerUserMatch = primaryText.match(/\bUser Max:\s*([\d,]+)/i);
  const maxEntriesPerUser = parseNumber(maxEntriesPerUserMatch?.[1]) || 100;
  const drawDate = extractDrawDate(primaryText);
  const fallbackCashText = primaryText.split(/\bInstant Wins\b/i)[0] ?? primaryText;
  const authoritativeCashText = cleanText(`${metaDescription} ${competitionDescription}`);
  const cashAlternative = extractCashAlternative(
    `${name} ${authoritativeCashText || fallbackCashText}`,
  );

  if (entryPrice <= 0 || advertisedMaxTickets <= 0 || drawDate === null) {
    return null;
  }

  if (hasExactInventory && exactTicketsSold >= advertisedMaxTickets) return null;

  return {
    sourceId: url.split("/competition/")[1]?.replace(/\/$/, "") ?? name.toLowerCase().replace(/\s+/g, "-"),
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold: hasExactInventory ? exactTicketsSold : 0,
    maxTickets: hasExactInventory ? advertisedMaxTickets : 0,
    maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntriesPerUserMatch ? "site" : "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: /auto draw/i.test(name) || /auto draw/i.test(primaryText),
    categories: buildCategories(name, primaryText, cashAlternative),
    scrapedAt: new Date().toISOString(),
  };
}

async function fetchPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

function toAbsoluteUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href.replace(/\/$/, "");
  return `${BASE_URL}${href.startsWith("/") ? "" : "/"}${href}`.replace(/\/$/, "");
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPrimaryCompetitionText(text: string, name: string): string {
  const start = text.indexOf(name);
  if (start < 0) return text;

  let end = text.length;
  for (const marker of [
    "Where is the live draw?",
    "Make sure to follow our Facebook page",
    "Terms and Conditions",
    "Terms of Service",
    "Privacy Policy",
  ]) {
    const markerIndex = text.indexOf(marker, start + name.length);
    if (markerIndex > start && markerIndex < end) end = markerIndex;
  }

  return text.slice(start, end);
}

function extractEntryPrice(text: string): number {
  const pounds = text.match(/£\s*([\d,.]+)\s*Per Ticket/i);
  if (pounds) return parseFloat(pounds[1].replace(/,/g, ""));

  const pence = text.match(/(\d+)p\s*Per Ticket/i);
  return pence ? parseInt(pence[1], 10) / 100 : 0;
}

function extractCashAlternative(text: string): number | null {
  const explicit =
    text.match(/Cash\s*Alternative\s*(?::|-|–)?\s*£\s*([\d,.]+)\s*(k)?/i) ||
    text.match(/£\s*([\d,.]+)\s*(k)?\s*Cash\s+Lump\s+Sum/i) ||
    text.match(/End\s+Prize\s+(?:of\s+)?£\s*([\d,.]+)\s*(k)?/i) ||
    text.match(/£\s*([\d,.]+)\s*(k)?\s*(?:Cash\s*-\s*)?End\s+Prize/i) ||
    text.match(/\b(\d+)\s*x\s*£\s*([\d,.]+)\s*cash\s*main winners?\s*end prize/i) ||
    text.match(/£\s*([\d,.]+)\s*(k)?\s*cash\b/i);
  if (!explicit) return null;

  if (/\bx\s*£/i.test(explicit[0])) {
    const winners = parseNumber(explicit[1]);
    const perWinner = parseNumber(explicit[2]);
    return winners > 0 && perWinner > 0 ? winners * perWinner : null;
  }

  const amount = parseNumber(explicit[1]) * (explicit[2] ? 1_000 : 1);
  return amount > 0 ? amount : null;
}

function extractDrawDate(text: string): string | null {
  const match = text.match(
    /DRAW ON\s+[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{1,2})(?::(\d{2}))?(am|pm)/i,
  );
  if (!match) return null;

  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const month = months[match[1].toLowerCase()];
  if (month === undefined) return null;

  let hour = parseInt(match[3], 10);
  if (match[5].toLowerCase() === "pm" && hour < 12) hour += 12;
  if (match[5].toLowerCase() === "am" && hour === 12) hour = 0;

  const now = new Date();
  let date = new Date(
    now.getFullYear(),
    month,
    parseInt(match[2], 10),
    hour,
    parseInt(match[4] ?? "0", 10),
    0,
    0,
  );
  if (date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    date = new Date(
      now.getFullYear() + 1,
      month,
      parseInt(match[2], 10),
      hour,
      parseInt(match[4] ?? "0", 10),
      0,
      0,
    );
  }
  return date.toISOString();
}

function buildCategories(name: string, text: string, cashAlternative: number | null): string[] {
  const categories: string[] = [];
  const haystack = `${name} ${text}`.toLowerCase();
  if (cashAlternative !== null || /\bcash\b/.test(haystack)) categories.push("cash");
  if (/instant wins?|end prize/.test(haystack)) categories.push("instant-win");
  if (/\bshark|ninja|bbq|slushi|air fryer|creami\b/.test(haystack)) categories.push("home");
  if (/\b(?:van|camper|audi|vw|polo|gti|transit|crafter)\b/.test(haystack)) {
    categories.push("vehicle");
  }
  return categories;
}

function parseNumber(value: string | undefined): number {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
