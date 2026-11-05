import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "brickitcomps";
const BASE_URL = "https://brickitcomps.co.uk";
const DISPLAY_NAME = "Brickit Competitions";

export class BrickitCompsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listHtml = await fetchPage(`${BASE_URL}/`, signal);
    const competitions: RawCompetition[] = [];
    const now = new Date();

    for (const url of parseCompetitionLinks(listHtml)) {
      try {
        const competition = parseBrickitDetail(
          await fetchPage(url, signal),
          url,
          now,
        );
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parseBrickitDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());
  const sourceId = url.match(/\/prizes\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText(
    $("h1").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      sourceId.replace(/-/g, " "),
  );
  const entryPrice = parseMoney($(".comp-price").first().text()) ||
    parseMoney(bodyText.match(/(?:Only|Sale!\s*-)?\s*£\s*[\d,.]+/)?.[0]);
  const soldMax = bodyText.match(/\(\s*([\d,]+)\s*\/\s*([\d,]+)\s*\)/i);
  const ticketsSold = parseNumber(soldMax?.[1]);
  const maxTickets = parseNumber(soldMax?.[2]);
  const drawDate = parseDrawDate(
    $("[data-draw-time]").first().attr("data-draw-time"),
  );
  const maxEntriesPerUser = parseNumber(
    bodyText.match(/(?:max|maximum)\s+(?:of\s+)?([\d,]+)\s+(?:tickets|entries)\s+per\s+(?:person|user)/i)?.[1],
  );

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    ticketsSold < 0 ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null ||
    new Date(drawDate).getTime() <= now.getTime() ||
    /\b(?:instant|vip|bundle)\b/i.test(name)
  ) {
    return null;
  }

  const manualEstimate = estimatePrize(name, sourceId);
  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative: null,
    estimatedPrizeValue: manualEstimate?.value ?? null,
    valuationSource: manualEstimate ? "manual_estimate" : null,
    valuationConfidence: manualEstimate ? "medium" : null,
    valuationNotes: manualEstimate?.notes ?? null,
    drawDate,
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href*='/prizes/']").each((_index, element) => {
    const href = absoluteUrl($(element).attr("href") ?? "");
    if (href.startsWith(`${BASE_URL}/prizes/`)) links.add(href);
  });
  return [...links].slice(0, 30);
}

function parseDrawDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = DateTime.fromISO(value, { setZone: true });
  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function estimatePrize(
  name: string,
  sourceId: string,
): { value: number; notes: string } | null {
  if (/910046/.test(sourceId) || /merchant\s+boat/i.test(name)) {
    return {
      value: 160,
      notes: "Conservative manual estimate for LEGO BrickLink Merchant Boat 910046",
    };
  }
  if (/76956/.test(sourceId) || /t\.?\s*rex\s+breakout/i.test(name)) {
    return {
      value: 70,
      notes: "Conservative manual estimate for LEGO T. rex Breakout 76956",
    };
  }
  if (/76934/.test(sourceId)) {
    return {
      value: 70,
      notes: "Conservative manual estimate for LEGO Ferrari F40 76934",
    };
  }
  if (/40860/.test(sourceId)) {
    return {
      value: 45,
      notes: "Conservative manual estimate for LEGO Toy Story BrickHeadz 40860",
    };
  }
  if (/10300/.test(sourceId)) {
    return {
      value: 140,
      notes: "Conservative manual estimate for LEGO Back to the Future Time Machine 10300",
    };
  }
  return null;
}

async function fetchPage(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
      "User-Agent": "raffle-bot/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function absoluteUrl(value: string): string {
  try {
    return new URL(value, BASE_URL).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function parseMoney(value: string | undefined): number {
  const match = value?.match(/£\s*([\d,.]+)/);
  const parsed = Number((match?.[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value: string | undefined): number {
  const parsed = Number((value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
