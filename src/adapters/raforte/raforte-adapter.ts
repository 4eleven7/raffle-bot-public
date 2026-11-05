import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://raforte.com";
const SITE_NAME = "raforte";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class RaforteAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const homeHtml = await fetchPage(`${BASE_URL}/`);
    const competitions: RawCompetition[] = [];

    for (const url of extractLiveRaffleUrls(homeHtml)) {
      try {
        const detailHtml = await fetchPage(url);
        const competition = parseRaforteCompetition(
          detailHtml,
          url,
          new Date().toISOString(),
        );
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parseRaforteCompetition(
  detailHtml: string,
  url: string,
  scrapedAt: string,
): RawCompetition | null {
  const $ = cheerio.load(detailHtml);
  const bodyText = cleanText($("body").text());
  const name = cleanText($("h1.product_title").first().text()) || cleanText($("h1").first().text());
  const sourceId = url.match(/\/raffle\/([^/?#]+)/i)?.[1] ?? "";
  const entryPrice = parseAmount(
    $(".single-product--meta .price ins .amount").first().text() ||
      $(".single-product--meta .price .amount").first().text(),
  );

  const stockText = cleanText($(".single-product--meta .stock").first().text());
  const stockMatch = stockText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
  const remaining = parseAmount(stockMatch?.[1]);
  const maxTickets = parseAmount(stockMatch?.[2]);
  const ticketsSold = maxTickets - remaining;
  const drawDate = parseRaforteExpiry(bodyText);
  const prizeValue = parseAmount(
    bodyText.match(/\bworth\s+around\s+£\s*([\d,.]+)/i)?.[1],
  );

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    remaining < 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    ...(prizeValue > 0
      ? {
          estimatedPrizeValue: prizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: `Raforte detail page states the prize is worth around £${prizeValue.toLocaleString("en-GB")}.`,
        }
      : {}),
    drawDate,
    isAutoDraw: false,
    categories: ["watch", "luxury"],
    scrapedAt,
  };
}

function extractLiveRaffleUrls(homeHtml: string): string[] {
  const $ = cheerio.load(homeHtml);
  const urls = $("a[href*='/raffle/']")
    .filter((_index, element) => !/raffle\s+closed/i.test(cleanText($(element).text())))
    .map((_index, element) => absoluteUrl($(element).attr("href") ?? ""))
    .get()
    .filter((url) => url.startsWith(`${BASE_URL}/raffle/`));

  return [...new Set(urls)];
}

function parseRaforteExpiry(text: string): string | null {
  const match = text.match(
    /Raffle\s+expiry\s+date:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+at\s+(\d{1,2}:\d{2})hrs/i,
  );
  if (!match) return null;

  const date = DateTime.fromFormat(
    `${match[1]} at ${match[2]}hrs`,
    "d/M/yyyy 'at' H:mm'hrs'",
    { zone: "Europe/London" },
  );
  return date.isValid ? date.toUTC().toISO() : null;
}

function fetchPage(url: string): Promise<string> {
  return fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Raforte returned ${response.status}`);
    return response.text();
  });
}

function parseAmount(value: string | undefined): number {
  const parsed = Number.parseFloat((value ?? "").replace(/[£$€]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http")) return href;
  return `${BASE_URL}${href.startsWith("/") ? href : `/${href}`}`;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
