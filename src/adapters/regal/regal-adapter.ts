import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "regalcompetitions";
const DISPLAY_NAME = "Regal Competitions";
const BASE_URL = "https://www.regalcompetitions.com";
const LIST_PATH = "/competition.php";
const UK_ZONE = "Europe/London";

export class RegalCompetitionsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}${LIST_PATH}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${LIST_PATH}: ${response.status}`);
    }

    const html = await response.text();
    return parseRegalCompetitions(html, new Date().toISOString());
  }
}

export function parseRegalCompetitions(
  html: string,
  scrapedAt: string,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const competitions: RawCompetition[] = [];

  $(".tickets.dark").each((_index, element) => {
    const card = $(element);
    const href = card.find("a[href]").first().attr("href")?.trim() ?? "";
    const absoluteUrl = toAbsoluteUrl(href);
    const sourceId = sourceIdFromUrl(absoluteUrl);
    const name = cleanText(card.find(".productName").first().text());
    const price = parsePrice(card.find(".ticketPrize").first().text());
    const remaining = parseNumber(card.find(".draw-info .col-xs-6").first().text());
    const maxTickets = parseNumber(card.find(".draw-info .col-xs-6").last().text());
    const drawDate = parseDrawDate(card.find(".drawday p").first().text(), scrapedAt);

    if (!absoluteUrl || !sourceId || !name || price <= 0 || maxTickets <= 0 || drawDate === null) {
      return;
    }

    const ticketsSold = Math.max(0, maxTickets - remaining);

    competitions.push({
      sourceId,
      siteName: SITE_NAME,
      url: absoluteUrl,
      name,
      entryPrice: price,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      cashAlternative: extractCashAlternative(name),
      drawDate,
      isAutoDraw: false,
      categories: [],
      scrapedAt,
    });
  });

  return competitions;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return `${BASE_URL}/${href.replace(/^\/+/, "")}`;
}

function sourceIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop();
    return slug ? decodeURIComponent(slug).toLowerCase() : null;
  } catch {
    return null;
  }
}

function parsePrice(text: string): number {
  const match = text.match(/£\s*([\d.]+)/i);
  return match ? Number(match[1]) : 0;
}

function parseNumber(text: string): number {
  const match = text.match(/([\d,]+)/);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function parseDrawDate(text: string, scrapedAt: string): string | null {
  const clean = cleanText(text);
  const now = DateTime.fromISO(scrapedAt, { zone: "utc" }).setZone(UK_ZONE);
  if (!now.isValid) return null;

  if (/^Draw Tomorrow$/i.test(clean)) {
    return now
      .plus({ days: 1 })
      .startOf("day")
      .plus({ hours: 12 })
      .toUTC()
      .toISO({ suppressMilliseconds: false });
  }

  const match = clean.match(/^Draw\s+[A-Za-z]{3}\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})$/i);
  if (!match) return null;

  const month = DateTime.fromFormat(match[2], "LLL", { zone: UK_ZONE });
  if (!month.isValid) return null;

  let date = DateTime.fromObject(
    {
      year: now.year,
      month: month.month,
      day: Number(match[1]),
      hour: 12,
      minute: 0,
    },
    { zone: UK_ZONE },
  );

  if (!date.isValid) return null;
  if (date < now.minus({ days: 2 })) {
    date = date.plus({ years: 1 });
  }

  return date.toUTC().toISO({ suppressMilliseconds: false });
}

function extractCashAlternative(name: string): number | null {
  const explicit =
    name.match(/(?:^|OR\s+)£\s*([\d,]+(?:\.\d+)?)\s*CASH/i) ??
    name.match(/£\s*([\d,]+(?:\.\d+)?)\s*CASH\s+OR/i);
  if (!explicit) return null;

  const value = Number(explicit[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}
