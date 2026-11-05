import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "stormdjs";
const DISPLAY_NAME = "Storm DJs Giveaways";
const BASE_URL = "https://www.storm-djs.com/giveaways";
const UK_ZONE = "Europe/London";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export class StormDjsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const timeoutSignal = AbortSignal.timeout(15_000);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    const response = await fetch(BASE_URL, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      signal: requestSignal,
    });
    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Giveaway page failed: ${response.status}`);
    }

    return parseStormDjsGiveaway(await response.text(), new Date());
  }
}

export function parseStormDjsGiveaway(
  html: string,
  now = new Date(),
): RawCompetition[] {
  const $ = cheerio.load(html);
  const body = $("body").length > 0
    ? $("body").clone()
    : $.root().children().clone();
  body.find("script, style, noscript").remove();
  const normalizedMarkup = (body.html() ?? "").replace(/>\s*</g, "> <");
  const text = cheerio.load(normalizedMarkup).text().replace(/\s+/g, " ").trim();
  const competitionNumber = text.match(/\bCompetition\s*#\s*(\d+)\b/i)?.[1] ?? "";
  const closeDate = parseCloseDate(text);
  const ticketCounts = text.match(
    /\b([\d,]+)\s+of\s+([\d,]+)\s+max\s+entrants\b/i,
  );
  const ticketsSold = parseInteger(ticketCounts?.[1]);
  const maxTickets = parseInteger(ticketCounts?.[2]);
  const entryPrice = parseMoney(
    text.match(/\bBronze\s+£\s*([\d,.]+)\s*1\s+entry\b/i)?.[1],
  );
  const name = parseHeading($);
  const cashAlternative = parseMoney(
    text.match(/\bor\s+£\s*([\d,.]+)\s+tax[- ]free\s+cash\b/i)?.[1] ??
      text.match(/\bWin\s+£\s*([\d,.]+)\s+Cash\b/i)?.[1],
  );
  const estimatedPrizeValue = parseMoney(
    text.match(/\b(?:retail\s+value|worth)\s+£\s*([\d,.]+)/i)?.[1],
  );

  if (
    !/\bEntries\s+open\b/i.test(text) ||
    !competitionNumber ||
    !name ||
    entryPrice === null ||
    ticketsSold === null ||
    maxTickets === null ||
    ticketsSold < 0 ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    closeDate === null ||
    new Date(closeDate).getTime() <= now.getTime()
  ) {
    return [];
  }

  return [{
    sourceId: `${SITE_NAME}-${competitionNumber}`,
    siteName: SITE_NAME,
    url: BASE_URL,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative,
    estimatedPrizeValue,
    valuationSource: estimatedPrizeValue !== null ? "site_estimate" : null,
    valuationConfidence: estimatedPrizeValue !== null ? "high" : null,
    valuationNotes: estimatedPrizeValue !== null
      ? "Storm DJs states the retail value on the giveaway page."
      : null,
    drawDate: closeDate,
    isAutoDraw: false,
    categories: ["music", "dj"],
    scrapedAt: now.toISOString(),
  }];
}

function parseHeading($: cheerio.CheerioAPI): string {
  const heading = $("h1").first();
  const parts = heading.find("span, strong").map((_index, element) => $(element).text()).get();
  return (parts.length > 0 ? parts.join(" ") : heading.text())
    .replace(/\s+/g, " ")
    .trim();
}

function parseCloseDate(text: string): string | null {
  const match = text.match(/\bEnds\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i);
  if (!match) return null;
  const date = DateTime.fromObject({
    year: Number(match[3]),
    month: Number(match[2]),
    day: Number(match[1]),
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 0,
  }, { zone: UK_ZONE });
  return date.isValid ? date.toUTC().toISO() : null;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.replaceAll(",", ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
