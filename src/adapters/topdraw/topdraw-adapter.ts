import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "topdraw";
const DISPLAY_NAME = "TopDraw";
const BASE_URL = "https://topdrawcompetitions.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export class TopDrawAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const homepage = await fetchText(`${BASE_URL}/`, signal);
    const urls = parseCompetitionUrls(homepage);
    const competitions: RawCompetition[] = [];
    for (const url of urls) {
      signal?.throwIfAborted();
      try {
        const competition = parseTopDrawDetail(await fetchText(url, signal), url);
        if (competition) competitions.push(competition);
      } catch {
        signal?.throwIfAborted();
      }
    }
    return competitions;
  }
}

export function parseTopDrawDetail(
  html: string,
  url: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const source = html.replaceAll('\\"', '"');
  const start = source.indexOf('"competition":{"id"');
  if (start < 0) return null;
  const end = source.indexOf(',"tiers":', start);
  const block = source.slice(start, end > start ? end : source.length);

  const sourceId = readString(block, "id");
  const name = readString(block, "title");
  const status = readString(block, "status").toLowerCase();
  const entryPrice = readNumber(block, "ticket_price");
  const cashAlternativeValue = readNullableNumber(block, "cash_alternative");
  const cashAlternative = cashAlternativeValue && cashAlternativeValue > 0
    ? cashAlternativeValue
    : null;
  const prizeValue = readNullableNumber(block, "prize_value");
  const maxTickets = readNumber(block, "max_entries");
  const ticketsSold = readNumber(block, "current_entries");
  const maxEntriesPerUser = readNumber(block, "per_user_entry_limit");
  const drawDate = readDate(block, "draw_at");
  if (
    !sourceId ||
    !name ||
    status !== "live" ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold >= maxTickets ||
    !drawDate
  ) {
    return null;
  }

  const category = readString(block, "category");
  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser > 0 ? maxEntriesPerUser : 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: prizeValue,
    valuationSource: cashAlternative !== null
      ? "cash"
      : prizeValue !== null
        ? "site_estimate"
        : null,
    valuationConfidence: prizeValue !== null ? "medium" : null,
    valuationNotes: prizeValue !== null ? "TopDraw current prize value" : null,
    drawDate,
    isAutoDraw: /\bauto\b/i.test(readString(block, "draw_method")),
    categories: category ? [category.toLowerCase()] : [],
    scrapedAt,
  };
}

function parseCompetitionUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const urls: string[] = [];
  $('a[href*="/competitions/"]').each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const url = new URL(href, BASE_URL).toString().replace(/\/$/, "");
    if (url === `${BASE_URL}/competitions` || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  });
  return urls;
}

function readString(block: string, key: string): string {
  const match = block.match(new RegExp(`"${key}":"([^"\\\\]*)"`));
  return match?.[1]?.trim() ?? "";
}

function readNumber(block: string, key: string): number {
  const value = readNullableNumber(block, key);
  return value ?? 0;
}

function readNullableNumber(block: string, key: string): number | null {
  const match = block.match(new RegExp(`"${key}":(null|-?\\d+(?:\\.\\d+)?)`));
  if (!match || match[1] === "null") return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function readDate(block: string, key: string): string | null {
  const value = readString(block, key);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.8",
      "User-Agent": USER_AGENT,
    },
    signal,
  });
  if (!response.ok) throw new Error(`[${DISPLAY_NAME}] ${url}: HTTP ${response.status}`);
  return response.text();
}
