import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "golfgeargiveaways";
const DISPLAY_NAME = "Golf Gear Giveaways";
const BASE_URL = "https://golfgeargiveaways.co.uk";
const LIST_PATH = "/competitions/all-competitions/";
const UK_ZONE = "Europe/London";

export class GolfGearGiveawaysAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}${LIST_PATH}`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch competitions: ${response.status}`);
    }

    return parseCompetitions(await response.text());
  }
}

function parseCompetitions(html: string): RawCompetition[] {
  const $ = cheerio.load(html);
  const competitions: RawCompetition[] = [];
  const seen = new Set<string>();
  const scrapedAt = new Date().toISOString();

  $("li.product").each((_i, el) => {
    const card = $(el);
    const href = absoluteUrl(card.find('a[href*="/competition/"]').first().attr("href") ?? "");
    const sourceId = slugFromUrl(href);
    if (!sourceId || seen.has(sourceId)) return;

    const name =
      cleanText(card.find("[data-product-title]").first().attr("data-product-title") ?? "") ||
      cleanText(card.find("h2, h3").first().text()) ||
      cleanText(card.find("img[alt]").first().attr("alt") ?? "") ||
      sourceId.replace(/-/g, " ");
    const text = cleanText(card.text());
    const soldMax = text.match(/([\d.]+)%\s*SOLD\s*\(([\d,]+)\s*\/\s*([\d,]+)\)/i);
    const entryPrice =
      parseMoneyFromHtml(card.find("[data-product-price]").first().attr("data-product-price")) ||
      parseMoney(text);
    const drawDate = parseSqlDate(
      card.find(".vhs-countdown-timer").first().attr("data-end-date-time"),
    );

    if (!name || !soldMax || entryPrice <= 0 || drawDate === null) return;

    const ticketsSold = parseNumber(soldMax[2]);
    const maxTickets = parseNumber(soldMax[3]);
    if (maxTickets <= 0 || ticketsSold >= maxTickets) return;

    seen.add(sourceId);
    competitions.push({
      sourceId,
      siteName: SITE_NAME,
      url: href,
      name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      cashAlternative: extractCashAlternative(name),
      drawDate,
      isAutoDraw: /auto\s*draw|instant/i.test(name),
      categories: [],
      scrapedAt,
    });
  });

  return competitions;
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return "";
  }
}

function slugFromUrl(value: string): string | null {
  return value.match(/\/competition\/([^/?#]+)/)?.[1] ?? null;
}

function parseSqlDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = DateTime.fromSQL(value.trim(), { zone: UK_ZONE });
  return parsed.isValid ? parsed.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function parseMoneyFromHtml(value: string | null | undefined): number {
  if (!value) return 0;
  return parseMoney(cheerio.load(value).text());
}

function parseMoney(value: string): number {
  const match = value.match(/£\s*([\d.]+)/);
  return match ? Number.parseFloat(match[1]) : 0;
}

function extractCashAlternative(value: string): number | null {
  const match = value.match(/£\s*([\d,.]+)\s*(k)?\s+(?:tax[-\s]*)?cash\b/i);
  if (!match) return null;
  const amount = Number.parseFloat(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseNumber(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
