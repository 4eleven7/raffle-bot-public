import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "diamonddraws";
const BASE_URL = "https://diamonddraws.com";
const COMPETITION_PATH = "/competitions/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class DiamondDrawsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listHtml = await fetchText(`${BASE_URL}${COMPETITION_PATH}`, signal);
    const urls = extractCompetitionUrls(listHtml);
    const scrapedAt = new Date().toISOString();
    const competitions = await Promise.all(
      urls.map(async (url) => {
        try {
          return parseDiamondDraw(await fetchText(url, signal), url, scrapedAt);
        } catch {
          return null;
        }
      }),
    );
    return competitions.filter(isCompetition);
  }
}

export function parseDiamondDraw(
  html: string,
  url: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || $("title").text().trim();
  const text = visibleText($);
  const ticketMatch = text.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*(?:ONLINE|%\s*SOLD)/i);
  const priceMatch = text.match(/£\s*([\d.]+)\s*per\s+ticket/i);
  const endTimeMatch = text.match(
    /ENDS\s+\d{1,2}\s+[A-Za-z]+\s*[•·-]?\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  const drawDate = parseDrawDate(html, endTimeMatch);
  const maxEntriesMatch = text.match(/MAX\s+([\d,]+)\s+TICKETS?\s+PER\s+PLAYER/i);
  const prizeValueMatch = text.match(
    /(?:instant|cash)\s+(?:win|wins|prizes?)[\s\S]{0,100}?up\s+to\s*£\s*(\d{1,3}(?:,\d{3})*)/i,
  ) ?? text.match(/top\s+prize\s*£\s*(\d{1,3}(?:,\d{3})*)/i);

  if (!name || !ticketMatch || !priceMatch || !drawDate) return null;
  const ticketsSold = parseInteger(ticketMatch[1]);
  const maxTickets = parseInteger(ticketMatch[2]);
  const entryPrice = Number(priceMatch[1]);
  if (maxTickets <= 0 || ticketsSold < 0 || ticketsSold > maxTickets || !Number.isFinite(entryPrice)) {
    return null;
  }

  const sourceId = lastPathSegment(url);
  if (!sourceId) return null;
  const prizeValue = parseInteger(prizeValueMatch?.[1]);
  const maxEntriesPerUser = parseInteger(maxEntriesMatch?.[1]) || 100;

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntriesMatch ? "site" : "fallback",
    cashAlternative: null,
    ...(prizeValue > 0
      ? {
          estimatedPrizeValue: prizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: "Diamond Draws public instant-win headline value",
        }
      : {}),
    drawDate,
    isAutoDraw: false,
    categories: entryPrice === 0 ? ["free"] : [],
    scrapedAt,
  };
}

function parseDrawDate(
  html: string,
  endTimeMatch: RegExpMatchArray | null,
): string | null {
  if (!endTimeMatch) return null;
  const date = [...html.matchAll(/20\d{2}-\d{2}-\d{2}/g)]
    .map((match) => match[0])
    .find((value) => DateTime.fromISO(value, { zone: "Europe/London" }).endOf("day") > DateTime.now());
  if (!date) return null;

  let hour = Number(endTimeMatch[1]);
  if (endTimeMatch[3].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (endTimeMatch[3].toUpperCase() === "AM" && hour === 12) hour = 0;
  return DateTime.fromISO(date, { zone: "Europe/London" })
    .set({ hour, minute: Number(endTimeMatch[2]), second: 0, millisecond: 0 })
    .toUTC()
    .toISO();
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: requestSignal,
  });
  if (!response.ok) throw new Error(`[Diamond Draws] ${url}: ${response.status}`);
  return response.text();
}

function extractCompetitionUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const origin = new URL(BASE_URL).origin;
  const urls = $("a[href]")
    .map((_index, element) => {
      try {
        const url = new URL($(element).attr("href") ?? "", BASE_URL);
        return url.origin === origin && url.pathname.startsWith(COMPETITION_PATH) &&
          url.pathname !== COMPETITION_PATH
          ? url.toString()
          : null;
      } catch {
        return null;
      }
    })
    .get()
    .filter((url): url is string => url !== null);
  return [...new Set(urls)];
}

function lastPathSegment(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
}

function parseInteger(value: string | undefined): number {
  return Number.parseInt((value ?? "").replace(/,/g, ""), 10) || 0;
}

function visibleText($: cheerio.CheerioAPI): string {
  return ($("body").html() ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCompetition(value: RawCompetition | null): value is RawCompetition {
  return value !== null;
}
