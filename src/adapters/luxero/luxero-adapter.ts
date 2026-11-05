import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "luxero";
const BASE_URL = "https://www.luxero.win";
const COMPETITION_PATH = "/en/competitions/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class LuxeroAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const urls = extractCompetitionUrls(await fetchText(`${BASE_URL}/en/competitions`, signal));
    const scrapedAt = new Date().toISOString();
    const competitions = await Promise.all(
      urls.map(async (url) => {
        try {
          return parseLuxeroCompetition(await fetchText(url, signal), url, scrapedAt);
        } catch {
          return null;
        }
      }),
    );
    return competitions.filter(isCompetition);
  }
}

export function parseLuxeroCompetition(
  html: string,
  url: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || $("title").text().trim();
  const text = visibleText($);
  const ticketMatch = text.match(/Tickets\s+sold\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const priceMatch = text.match(/£\s*([\d.]+)\s*\/\s*Ticket/i);
  const drawDateMatch = text.match(
    /Draw\s+on\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})/i,
  );
  const maxEntriesMatch = text.match(/Up\s+to\s+([\d,]+)\s+tickets\s+per\s+person/i);
  const cashAlternativeMatch = text.match(/£\s*([\d,]+)\s*Cash\s+Alternative/i);
  const drawDate = parseDrawDate(drawDateMatch);

  if (!name || !ticketMatch || !priceMatch || !drawDate) return null;
  const ticketsSold = parseInteger(ticketMatch[1]);
  const maxTickets = parseInteger(ticketMatch[2]);
  const entryPrice = Number(priceMatch[1]);
  if (maxTickets <= 0 || ticketsSold < 0 || ticketsSold > maxTickets || !Number.isFinite(entryPrice)) {
    return null;
  }

  const sourceId = lastPathSegment(url);
  if (!sourceId) return null;
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
    drawDate,
    isAutoDraw: false,
    categories: ["luxury"],
    scrapedAt,
  };
}

function parseDrawDate(match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  return DateTime.fromFormat(
    `${match[1]} ${match[2]} ${match[3]} ${match[4]}:${match[5]}`,
    "d LLLL yyyy H:mm",
    { zone: "Europe/London" },
  )
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
  if (!response.ok) throw new Error(`[Luxero] ${url}: ${response.status}`);
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
