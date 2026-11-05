import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "bullioncomps";
const BASE_URL = "https://mintgold.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class BullionCompsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const collectionUrl = `${BASE_URL}/collections/current-competitions?limit=250`;
    const collectionHtml = await fetchText(collectionUrl);
    const competitions: RawCompetition[] = [];

    for (const url of parseBullionCompsCollection(collectionHtml)) {
      try {
        const detail = await fetchText(url);
        const competition = parseBullionCompsDetail(detail, url);
        if (competition) competitions.push(competition);
      } catch {
        // Ignore a product that disappears while the current collection is read.
      }
    }

    return competitions;
  }
}

export function parseBullionCompsCollection(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = new Set<string>();

  $("a[href*='/products/']").each((_index, element) => {
    const href = $(element).attr("href");
    if (href) urls.add(new URL(href.split("?")[0], BASE_URL).toString());
  });

  return Array.from(urls);
}

export function parseBullionCompsDetail(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());
  const progressText = cleanText($(".competition-progress-wrapper").first().text());
  const name = cleanText($("h1").first().text());
  const entryPrice = parseMoney(
    bodyText.match(/£\s*[\d,.]+\s+per\s+ticket/i)?.[0],
  );
  const ticketsSold = parseLabeledInteger(progressText, /([\d,]+)\s*Tickets Sold/i);
  const ticketsRemaining = parseLabeledInteger(
    progressText,
    /([\d,]+)\s*Tickets Remaining/i,
  );
  const maxTickets = parseLabeledInteger(progressText, /([\d,]+)\s*Total Tickets/i);
  const drawDate = parseClosingDate(bodyText);
  const cashAlternative = parseMoney(
    bodyText.match(/£\s*[\d,.]+\s+(?:tax free\s+)?cash alternative/i)?.[0],
  );
  const sourceId = productSlug(url);

  if (
    !sourceId ||
    !name ||
    entryPrice === null ||
    entryPrice <= 0 ||
    ticketsSold === null ||
    ticketsRemaining === null ||
    maxTickets === null ||
    ticketsSold < 0 ||
    ticketsRemaining < 0 ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    ticketsSold + ticketsRemaining !== maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name: name.substring(0, 120),
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: parseMaxEntries(bodyText),
    maxEntriesPerUserSource: /(?:maximum|max)\s+\d+\s+tickets?\s+per\s+(?:person|user)/i.test(bodyText)
      ? "site"
      : "fallback",
    cashAlternative,
    estimatedPrizeValue: cashAlternative,
    valuationSource: cashAlternative === null ? null : "cash",
    valuationConfidence: cashAlternative === null ? null : "high",
    valuationNotes: cashAlternative === null ? null : "Operator-stated cash alternative",
    drawDate,
    isAutoDraw: /\b(?:auto(?:mated)?|live) draw\b/i.test(bodyText),
    categories: /rolex|watch/i.test(name) ? ["watch"] : ["bullion"],
    scrapedAt: new Date().toISOString(),
  };
}

function fetchText(url: string): Promise<string> {
  return fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Bullion Comps fetch failed: ${response.status}`);
    return response.text();
  });
}

function parseClosingDate(text: string): string | null {
  const match = text.match(
    /\bends?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\b/i,
  );
  if (!match) return null;

  const now = DateTime.now().setZone("Europe/London");
  const month = parseMonth(match[2]);
  if (month === null) return null;
  const time = text.match(/\bDrawn(?:\s+LIVE)?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  let date = DateTime.fromObject(
    {
      year: now.year,
      month,
      day: Number(match[1]),
      hour: time ? to24Hour(Number(time[1]), time[3]) : 22,
      minute: time?.[2] ? Number(time[2]) : 0,
    },
    { zone: "Europe/London" },
  );
  if (!date.isValid) return null;
  if (date <= now) date = date.plus({ years: 1 });
  return date.toUTC().toISO({ suppressMilliseconds: false });
}

function parseMonth(value: string): number | null {
  const abbreviated = DateTime.fromFormat(value, "LLL", { locale: "en-GB" });
  if (abbreviated.isValid) return abbreviated.month;
  const full = DateTime.fromFormat(value, "LLLL", { locale: "en-GB" });
  return full.isValid ? full.month : null;
}

function to24Hour(hour: number, meridiem: string): number {
  const normalized = meridiem.toLowerCase();
  if (normalized === "am") return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function parseLabeledInteger(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  return match ? parseInteger(match[1]) : null;
}

function parseMaxEntries(text: string): number {
  const match = text.match(/(?:maximum|max)\s+(\d+)\s+tickets?\s+per\s+(?:person|user)/i);
  return match ? Number(match[1]) : 100;
}

function productSlug(url: string): string {
  const match = new URL(url).pathname.match(/\/products\/([^/]+)/i);
  return match?.[1] ?? "";
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/£\s*([\d,.]+)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
