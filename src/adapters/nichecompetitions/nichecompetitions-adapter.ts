import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.nichecompetitions.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export class NicheCompetitionsAdapter implements SiteAdapter {
  readonly siteName = "nichecompetitions";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listingHtml = await fetchText(`${BASE_URL}/competitions`, signal);
    const $ = cheerio.load(listingHtml);
    const detailUrls = Array.from(
      new Set(
        $("a[href]")
          .map((_, element) => $(element).attr("href"))
          .get()
          .map((href) => new URL(href, BASE_URL).toString())
          .filter((url) => {
            const parsed = new URL(url);
            return (
              parsed.origin === BASE_URL &&
              parsed.pathname.startsWith("/competitions/") &&
              parsed.pathname !== "/competitions/"
            );
          }),
      ),
    );

    const competitions: RawCompetition[] = [];
    for (const url of detailUrls) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await fetchText(url, signal);
        const competition = parseNicheCompetitionDetail(detailHtml, url);
        if (competition) competitions.push(competition);
      } catch {
        signal?.throwIfAborted();
      }
    }
    return competitions;
  }
}

export function parseNicheCompetitionDetail(
  html: string,
  url: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const product = findJsonLd($, "Product");
  if (!product) return null;

  const name = cleanText(String(product.name ?? ""));
  const offer = asRecord(product.offers);
  const entryPrice = numberFromUnknown(offer?.price);
  const priceValidUntil = cleanText(String(offer?.priceValidUntil ?? ""));
  if (!name || entryPrice <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(priceValidUntil)) {
    return null;
  }

  const rscText = html.replace(/\\"/g, '"');
  const maxTickets = numericProperty(rscText, "maxTickets");
  const ticketsRemaining = numericProperty(rscText, "ticketsRemaining");
  if (
    maxTickets <= 0 ||
    ticketsRemaining < 0 ||
    ticketsRemaining > maxTickets
  ) {
    return null;
  }

  const pageText = cleanText($("body").text());
  const cashAlternative = extractCashAlternative(pageText);
  const prizeValue = extractPrizeValue(product);
  const drawDate = parseDrawDate(priceValidUntil, pageText);
  if (!drawDate) return null;

  const maxEntriesPerUserMatch = pageText.match(
    /maximum\s+([\d,]+)\s+entries?\s+per\s+person/i,
  );
  const maxEntriesPerUser = maxEntriesPerUserMatch
    ? Number(maxEntriesPerUserMatch[1].replace(/,/g, ""))
    : 100;
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? name;
  const value = prizeValue ?? cashAlternative;

  return {
    sourceId: slug,
    siteName: "nichecompetitions",
    url,
    name,
    entryPrice,
    ticketsSold: maxTickets - ticketsRemaining,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser > 0 ? maxEntriesPerUser : 100,
    maxEntriesPerUserSource: maxEntriesPerUserMatch ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: value,
    valuationSource:
      prizeValue !== null
        ? "site_estimate"
        : cashAlternative !== null
          ? "cash"
          : null,
    valuationConfidence: value !== null ? "high" : null,
    drawDate,
    isAutoDraw: false,
    categories: /cash/i.test(`${name} ${pageText}`) ? ["cash"] : [],
    scrapedAt,
  };
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`[Niche Competitions] ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function findJsonLd(
  $: cheerio.CheerioAPI,
  type: string,
): Record<string, unknown> | null {
  for (const element of $("script[type='application/ld+json']").toArray()) {
    try {
      const parsed = JSON.parse($(element).text()) as unknown;
      const candidates = Array.isArray(parsed)
        ? parsed
        : [parsed, ...(asRecord(parsed)?.["@graph"] as unknown[] ?? [])];
      const match = candidates.find(
        (candidate) => asRecord(candidate)?.["@type"] === type,
      );
      if (match) return match as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

function numericProperty(text: string, key: string): number {
  const match = text.match(new RegExp(`"${key}":(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : 0;
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/cash\s+alternative\s*£\s*([\d,]+(?:\.\d{1,2})?)/i) ??
    text.match(/choose\s+£\s*([\d,]+(?:\.\d{1,2})?)\s+tax-free\s+cash/i);
  return match ? money(match[1]) : null;
}

function extractPrizeValue(product: Record<string, unknown>): number | null {
  const properties = Array.isArray(product.additionalProperty)
    ? product.additionalProperty
    : [product.additionalProperty];
  for (const property of properties) {
    const record = asRecord(property);
    if (String(record?.name ?? "").toLowerCase() !== "prize value") continue;
    const value = numberFromUnknown(record?.value);
    if (value > 0) return value;
  }
  return null;
}

function parseDrawDate(date: string, text: string): string | null {
  const timeMatch = text.match(/closes?[^.]{0,100}?\b(?:at|,)\s*(\d{1,2}):(\d{2})/i);
  const dateTime = DateTime.fromISO(date, { zone: "Europe/London" });
  if (!dateTime.isValid) return null;
  const withTime = timeMatch
    ? dateTime.set({ hour: Number(timeMatch[1]), minute: Number(timeMatch[2]) })
    : dateTime;
  return withTime.toUTC().toISO();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/[£,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: string): number | null {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
