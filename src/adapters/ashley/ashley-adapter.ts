import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "ashleyautomotive";
const BASE_URL = "https://www.ashleyautomotivecomps.co.uk";
const RAFFLE_PATH = "/raffles/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class AshleyAutomotiveAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listHtml = await fetchText(BASE_URL, signal);
    const urls = extractRaffleUrls(listHtml);
    const scrapedAt = new Date().toISOString();
    const competitions = await Promise.all(
      urls.map(async (url) => {
        try {
          return parseAshleyRaffle(await fetchText(url, signal), url, scrapedAt);
        } catch {
          return null;
        }
      }),
    );

    return competitions.filter(isCompetition);
  }
}

export function parseAshleyRaffle(
  html: string,
  url: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const name = $("h1").first().text().trim() || $("title").text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const ticketMatch = text.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/);
  const priceMatch = text.match(/£\s*([\d.]+)\s*\/?\s*ticket/i);
  const maxEntriesMatch = text.match(/Max\s+([\d,]+)\s+tickets?\s+per\s+person/i);
  const drawDate = futureIsoDates(html)[0] ?? null;

  if (!name || !ticketMatch || !priceMatch || !drawDate) return null;

  const ticketsSold = parseInteger(ticketMatch[1]);
  const maxTickets = parseInteger(ticketMatch[2]);
  const entryPrice = Number(priceMatch[1]);
  if (ticketsSold < 0 || maxTickets <= 0 || ticketsSold > maxTickets || !Number.isFinite(entryPrice)) {
    return null;
  }

  const sourceId = lastPathSegment(url);
  if (!sourceId) return null;
  const maxEntriesPerUser = parseInteger(maxEntriesMatch?.[1]) || 100;
  const prizeEstimate = estimatePrize(name);

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
    ...(prizeEstimate
      ? {
          estimatedPrizeValue: prizeEstimate,
          valuationSource: "manual_estimate" as const,
          valuationConfidence: "low" as const,
          valuationNotes: "Conservative manual estimate for an operator-listed vehicle or bike prize",
        }
      : {}),
    drawDate,
    isAutoDraw: false,
    categories: ["automotive"],
    scrapedAt,
  };
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
  if (!response.ok) throw new Error(`[Ashley Automotive] ${url}: ${response.status}`);
  return response.text();
}

function extractRaffleUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = $("a[href]")
    .map((_index, element) => {
      try {
        const url = new URL($(element).attr("href") ?? "", BASE_URL);
        return url.origin === new URL(BASE_URL).origin && url.pathname.startsWith(RAFFLE_PATH)
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

function futureIsoDates(html: string): string[] {
  return [...html.matchAll(/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g)]
    .map((match) => new Date(match[0]))
    .filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > Date.now())
    .sort((a, b) => a.getTime() - b.getTime())
    .map((date) => date.toISOString());
}

function lastPathSegment(url: string): string {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
}

function parseInteger(value: string | undefined): number {
  return Number.parseInt((value ?? "").replace(/,/g, ""), 10) || 0;
}

function estimatePrize(name: string): number | null {
  if (/ford\s+f100/i.test(name)) return 15_000;
  if (/harley\s+davidson/i.test(name)) return 7_000;
  if (/synch\s+super\s+monkey/i.test(name)) return 3_000;
  return null;
}

function isCompetition(value: RawCompetition | null): value is RawCompetition {
  return value !== null;
}
