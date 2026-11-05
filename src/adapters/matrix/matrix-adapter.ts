import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { fetchRenderedHtml } from "../browser/browser-pool.js";

const SITE_NAME = "matrix";
const BASE_URL = "https://matrixcompetitions.co.uk";
const COMPETITION_PATH = "/competition/";
const EXTRA_COMPETITION_PATHS = [
  "/competition/spa-break-for-2-mripm2l2",
  "/competition/win-1000-cash-mpv7gfgw",
];
export class MatrixAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;
  readonly scanCost = "browser" as const;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const urls = [
      ...new Set([
        ...extractCompetitionUrls(
          await fetchRenderedHtml(BASE_URL, 'a[href^="/competition/"]', signal),
        ),
        ...EXTRA_COMPETITION_PATHS.map((path) => new URL(path, BASE_URL).toString()),
      ]),
    ];
    const scrapedAt = new Date().toISOString();
    const competitions = await Promise.all(
      urls.map(async (url) => {
        try {
          return parseMatrixCompetition(
            await fetchRenderedHtml(url, "h1", signal),
            url,
            scrapedAt,
          );
        } catch {
          return null;
        }
      }),
    );
    return competitions.filter(isCompetition);
  }
}

export function parseMatrixCompetition(
  html: string,
  url: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || $("title").text().trim();
  const text = visibleText($);
  const ticketMatch = text.match(
    /(\d[\d,]*)\s*\/\s*(\d[\d,]*?)(?=\s*\d+(?:\.\d+)?%\s*sold)/i,
  );
  const priceMatch = text.match(/£\s*([\d.]+)\s*PER\s+ENTRY/i) ??
    text.match(/(\d+)p\s+PER\s+ENTRY/i);
  const maxEntriesMatch = text.match(/Max\s+Per\s+Person\s*:\s*([\d,]+)/i);
  const prizeValueMatch = text.match(/Prize\s+Value\s*:\s*£\s*([\d,]+)/i);
  const cashAlternativeMatch = text.match(/Cash\s+Alternative\s*:?\s*£\s*([\d,]+)/i);
  const drawDateMatch = text.match(
    /Draw\s+scheduled\s+for\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  const drawDate = parseDrawDate(drawDateMatch);

  if (!name || !ticketMatch || !priceMatch || !drawDate) return null;
  const ticketsSold = parseInteger(ticketMatch[1]);
  const maxTickets = parseInteger(ticketMatch[2]);
  const entryPrice = priceMatch[2]
    ? Number(priceMatch[2]) / 100
    : Number(priceMatch[1]);
  if (maxTickets <= 0 || ticketsSold < 0 || ticketsSold > maxTickets || !Number.isFinite(entryPrice)) {
    return null;
  }

  const sourceId = lastPathSegment(url);
  if (!sourceId) return null;
  const prizeValue = parseInteger(prizeValueMatch?.[1]);
  const cashAlternative = parseInteger(cashAlternativeMatch?.[1]);
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
    cashAlternative: cashAlternative || null,
    ...(cashAlternative > 0
      ? {}
      : prizeValue > 0
        ? {
            estimatedPrizeValue: prizeValue,
            valuationSource: "site_estimate" as const,
            valuationConfidence: "medium" as const,
            valuationNotes: "Matrix Competitions public prize value",
          }
        : {}),
    drawDate,
    isAutoDraw: false,
    categories: ["competition"],
    scrapedAt,
  };
}

function parseDrawDate(match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  let hour = Number(match[4]);
  if (match[6].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[6].toUpperCase() === "AM" && hour === 12) hour = 0;
  return DateTime.fromFormat(
    `${match[1]} ${match[2]} ${match[3]} ${hour}:${match[5]}`,
    "d LLLL yyyy H:mm",
    { zone: "Europe/London" },
  )
    .toUTC()
    .toISO();
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
