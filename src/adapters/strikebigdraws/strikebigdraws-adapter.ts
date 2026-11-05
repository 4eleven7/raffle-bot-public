import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { fetchRenderedHtml } from "../browser/browser-pool.js";

const SITE_NAME = "strikebigdraws";
const BASE_URL = "https://strikebigdraws.com";
const UK_ZONE = "Europe/London";
const FALLBACK_PATHS = [
  "/competition/ascended-heroes-etb-low-odds-1-auto-draw",
  "/competition/ascended-heroes-poster-box-low-odds-1-auto-draw",
  "/competition/ascended-heroes-ex-box-low-odds-1-auto-draw",
  "/competition/etb-bonanza-2-instant-win-auto-draw",
  "/competition/prismatic-evolutions-collection-1-instant-win-auto-draw",
  "/competition/ascended-heros-mega-bonanza-2-instant-win-auto-draw",
];

export class StrikeBigDrawsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;
  readonly scanCost = "browser";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const links = await this.fetchCompetitionLinks(signal);
    const competitions: RawCompetition[] = [];

    for (const url of links) {
      signal?.throwIfAborted();
      try {
        const html = await fetchRenderedHtml(url, "body", signal);
        const competition = parseStrikeBigDrawDetail(html, url);
        if (competition) competitions.push(competition);
      } catch {
        signal?.throwIfAborted();
        continue;
      }
    }

    return competitions;
  }

  private async fetchCompetitionLinks(signal?: AbortSignal): Promise<string[]> {
    const links = new Set(FALLBACK_PATHS.map((path) => `${BASE_URL}${path}`));

    try {
      const html = await fetchRenderedHtml(BASE_URL, 'a[href*="/competition/"]', signal);
      const $ = cheerio.load(html);
      $('a[href*="/competition/"]').each((_i, el) => {
        const href = absoluteUrl($(el).attr("href") ?? "");
        if (href.startsWith(`${BASE_URL}/competition/`)) links.add(href);
      });
    } catch {
      signal?.throwIfAborted();
      // Fallback paths still give useful direct detail coverage.
    }

    return Array.from(links).slice(0, 30);
  }
}

export function parseStrikeBigDrawDetail(html: string, url: string): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  if (/Sorry,\s+you\s+have\s+been\s+blocked|Cloudflare/i.test(text)) return null;

  const sourceId = url.match(/\/competition\/([^/?#]+)/)?.[1];
  const name =
    cleanText($("h1").first().text()) ||
    cleanText($("title").first().text()).replace(/\s*\|\s*.+$/, "") ||
    sourceId?.replace(/-/g, " ") ||
    "";
  const soldMax =
    text.match(/\bSold\s+([\d,]+)\s*\/\s*([\d,]+)/i) ||
    text.match(/\b([\d,]+)\s*\/\s*([\d,]+)\s+Online\b/i);
  const entryPrice =
    parseMoney(text.match(/£\s*([\d.]+)\s*per\s+entry/i)?.[0]) ||
    parseMoney(text.match(/\bON\s+SALE!\s*£\s*[\d.]+\s*£\s*([\d.]+)/i)?.[1]);
  const drawDate = parseDrawDate(text);

  if (!sourceId || !name || !soldMax || entryPrice <= 0 || drawDate === null) {
    return null;
  }

  const ticketsSold = parseNumber(soldMax[1]);
  const maxTickets = parseNumber(soldMax[2]);
  if (maxTickets <= 0 || ticketsSold >= maxTickets) return null;
  const maxEntriesPerUser = parseNumber(
    text.match(/\bMax\s+([\d,]+)\s+per\s+user/i)?.[1],
  );

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative: extractCashAlternative(text),
    drawDate,
    isAutoDraw: /auto\s*draw|instant/i.test(text),
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /\b(?:Draw\s+On\s+)?(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{1,2}):(\d{2})(am|pm)\b/i,
  );
  if (!match) return null;

  const month = DateTime.fromFormat(match[1], "LLL", { zone: UK_ZONE }).month;
  if (!month) return null;

  let hour = Number.parseInt(match[3], 10);
  const meridiem = match[5].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  let date = DateTime.fromObject(
    {
      year: DateTime.now().setZone(UK_ZONE).year,
      month,
      day: Number.parseInt(match[2], 10),
      hour,
      minute: Number.parseInt(match[4], 10),
    },
    { zone: UK_ZONE },
  );
  if (date.toMillis() < Date.now() - 24 * 60 * 60 * 1000) {
    date = date.plus({ years: 1 });
  }

  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return "";
  }
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/\bCash\s+Alt:\s*£\s*([\d,.]+)/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseMoney(value: string | null | undefined): number {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value: string | null | undefined): number {
  const parsed = Number.parseInt(String(value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
