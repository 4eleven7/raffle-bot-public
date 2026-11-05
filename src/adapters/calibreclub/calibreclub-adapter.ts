import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "thecalibreclub";
const BASE_URL = "https://thecalibreclub.com";
const CATEGORY_PATH = "/product-category/lounge/";
const EXTRA_DETAIL_PATHS = ["/competition/lounge-midnight-money/"];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class CalibreClubAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const listing = await fetchHtml(`${BASE_URL}${CATEGORY_PATH}`);
    const urls = new Set([
      ...parseCompetitionLinks(listing),
      ...EXTRA_DETAIL_PATHS.map((path) => `${BASE_URL}${path}`),
    ]);
    const competitions: RawCompetition[] = [];

    for (const url of urls) {
      try {
        const competition = parseCalibreClubDetail(await fetchHtml(url), url);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return dedupBySourceId(competitions);
  }
}

export function parseCalibreClubDetail(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const $summary = $(".summary.entry-summary, .summary").first();
  const summaryText = cleanText($summary.text());
  const sourceId = url.match(/\/competition\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText($("h1.product_title, h1").first().text());
  if (/\bfree daily reveal\b|\bone gift per member\b/i.test(summaryText)) return null;

  const entryPrice = parseMoney($summary.find(".price, .ticket-total").first().text());
  const ticketCounts = parseTicketCounts(text);
  const drawDate = parseDrawDate(text);
  const siteMaxEntriesPerUser =
    parseNumber(summaryText.match(/Max\s+([\d,]+)\s+tickets?\s+per\s+(?:person|user)/i)?.[1]) ||
    parseNumber(summaryText.match(/User Ticket Limit\s+([\d,]+)/i)?.[1]);
  const cashMatch = summaryText.match(
    /(?:top prize|cash alternative|cash)(?:\s+is)?\s*£\s*([\d,.]+)/i,
  );
  const cashAlternative = parseNumber(cashMatch?.[1]);
  const isInstantWinBoard =
    /\bThis competition will have\s+[\d,]+\s+winners\b/i.test(summaryText) &&
    /\b(?:swipe|scratch)\s+to\s+reveal\b/i.test(summaryText);

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    ticketCounts === null ||
    drawDate === null ||
    new Date(drawDate).getTime() <= Date.now() ||
    ticketCounts.sold >= ticketCounts.total
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold: ticketCounts.sold,
    maxTickets: ticketCounts.total,
    maxEntriesPerUser: siteMaxEntriesPerUser || 100,
    maxEntriesPerUserSource: siteMaxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    drawDate,
    isAutoDraw: isInstantWinBoard,
    categories: [
      ...(cashAlternative > 0 ? ["cash"] : []),
      ...(isInstantWinBoard ? ["instant-win"] : []),
    ],
    scrapedAt: new Date().toISOString(),
  };
}

function parseCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  return Array.from(
    new Set(
      $("a[href*='/competition/']")
        .map((_index, element) => absoluteUrl($(element).attr("href") ?? ""))
        .get()
        .filter((url) => url.startsWith(`${BASE_URL}/competition/`)),
    ),
  );
}

function parseTicketCounts(text: string): { sold: number; total: number } | null {
  const match = text.match(/Tickets sold:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  if (!match) return null;

  const sold = parseNumber(match[1]);
  const total = parseNumber(match[2]);
  return total > 0 && sold >= 0 && sold <= total ? { sold, total } : null;
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /Competition Ends\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  );
  if (!match) return null;

  let hour = Number(match[4]);
  const meridiem = match[6].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const date = DateTime.fromObject(
    {
      year: Number(match[3]),
      month: DateTime.fromFormat(match[2], "LLLL", { zone: "Europe/London" }).month,
      day: Number(match[1]),
      hour,
      minute: Number(match[5] ?? "0"),
    },
    { zone: "Europe/London" },
  );
  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function parseNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMoney(value: string | undefined): number {
  const match = value?.match(/£\s*([\d,.]+)/);
  const parsed = Number((match?.[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function absoluteUrl(href: string): string {
  return new URL(href, BASE_URL).toString();
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`[TheCalibreClub] Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

function dedupBySourceId(rows: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.sourceId)) return false;
    seen.add(row.sourceId);
    return true;
  });
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
