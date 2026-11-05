import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "flatout";
const BASE_URL = "https://flatoutcompetitions.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

interface FlatOutAdapterOptions {
  now?: () => Date;
}

interface EventJsonLd {
  "@type"?: string;
  name?: string;
  description?: string;
  url?: string;
  endDate?: string;
  offers?: {
    price?: string | number;
  };
}

export class FlatOutAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  constructor(private readonly options: FlatOutAdapterOptions = {}) {}

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const now = this.options.now?.() ?? new Date();
    const listingHtml = await fetchText(BASE_URL, signal);
    const urls = parseFlatOutListingLinks(listingHtml);
    const pages = await Promise.all(
      urls.map(async (url) => {
        try {
          return parseFlatOutCompetition(await fetchText(url, signal), url, now);
        } catch {
          signal?.throwIfAborted();
          return null;
        }
      }),
    );

    return pages.filter((competition): competition is RawCompetition => competition !== null);
  }
}

export function parseFlatOutListingLinks(html: string): string[] {
  const $ = cheerio.load(html);
  return [...new Set(
    $("a[href*='/competitions/']")
      .map((_index, element) => new URL($(element).attr("href") ?? "", BASE_URL).toString())
      .get()
      .filter((url) => url.startsWith(`${BASE_URL}/competitions/`)),
  )];
}

export function parseFlatOutCompetition(
  html: string,
  fallbackUrl: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const event = findEventJsonLd($);
  const url = event?.url ?? fallbackUrl;
  const sourceId = url.match(/\/competitions\/([^/?#]+)/)?.[1] ?? "";
  const name = event?.name?.trim() || $("h1").first().text().trim();
  const description = event?.description?.trim() ?? "";
  const entryPrice = positiveNumber(event?.offers?.price);
  const endDate = normalizeDate(event?.endDate);
  const ticketCounts = parseTicketCounts($);

  if (
    !sourceId ||
    !name ||
    entryPrice === null ||
    endDate === null ||
    new Date(endDate).getTime() <= now.getTime() ||
    ticketCounts === null ||
    ticketCounts.sold >= ticketCounts.total
  ) {
    return null;
  }

  const prizeText = `${name} ${description} ${$("main").text()}`.replace(/\s+/g, " ");
  const prizeValue = parsePrizeValue(prizeText);

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold: ticketCounts.sold,
    maxTickets: ticketCounts.total,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    estimatedPrizeValue: prizeValue,
    valuationSource: prizeValue !== null ? "site_estimate" : null,
    valuationConfidence: prizeValue !== null ? "high" : null,
    valuationNotes: prizeValue !== null
      ? "Flat-Out detail page states the prize cap or retail value."
      : null,
    drawDate: endDate,
    isAutoDraw: false,
    categories: ["automotive"],
    scrapedAt: now.toISOString(),
  };
}

function findEventJsonLd($: cheerio.CheerioAPI): EventJsonLd | null {
  for (const script of $("script[type='application/ld+json']").map((_index, element) => $(element).text()).get()) {
    try {
      const parsed = JSON.parse(script) as EventJsonLd | EventJsonLd[];
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const event = candidates.find((candidate) => candidate?.["@type"] === "Event");
      if (event) return event;
    } catch {
      continue;
    }
  }
  return null;
}

function parseTicketCounts($: cheerio.CheerioAPI): { sold: number; total: number } | null {
  const text = $("main").text().replace(/\s+/g, " ");
  const ariaLabel = $("[aria-label*='tickets sold']").first().attr("aria-label") ?? "";
  const match = `${ariaLabel} ${text}`.match(/([\d,]+)\s+of\s+([\d,]+)\s+(?:tickets?\s+)?sold/i);
  if (!match) return null;

  const sold = integerValue(match[1]);
  const total = integerValue(match[2]);
  return total > 0 && sold >= 0 && sold <= total ? { sold, total } : null;
}

function parsePrizeValue(text: string): number | null {
  const match = text.match(/(?:worth\s+up\s+to|up\s+to|capped\s+at|RRP)\s*£\s*([\d,]+(?:\.\d{1,2})?)/i)
    ?? text.match(/£\s*([\d,]+(?:\.\d{1,2})?)\s*(?:RRP|retail)/i);
  return positiveNumber(match?.[1]?.replaceAll(",", ""));
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveNumber(value: string | number | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function integerValue(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").replaceAll(",", ""), 10);
  return Number.isFinite(parsed) ? parsed : -1;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    signal: requestSignal,
  });
  if (!response.ok) throw new Error(`[Flat-Out] Failed to fetch ${url}: ${response.status}`);
  return response.text();
}
