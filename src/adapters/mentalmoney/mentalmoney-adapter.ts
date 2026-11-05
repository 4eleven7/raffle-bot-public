import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "mentalmoney";
const BASE_URL = "https://www.mentalmoney.com";
const DISPLAY_NAME = "Mental Money";

export class MentalMoneyAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listHtml = await fetchPage(`${BASE_URL}/competitions`, signal);
    const competitions: RawCompetition[] = [];
    const now = new Date();

    for (const url of parseCompetitionLinks(listHtml)) {
      try {
        const competition = parseMentalMoneyDetail(
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

export function parseMentalMoneyDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());
  const sourceId = url.match(/\/competitions\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText(
    $("h1").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      sourceId.replace(/-/g, " "),
  );
  const entryPrice = parseMoney($(".price").first().text()) ||
    parseMoney(bodyText.match(/£\s*[\d,.]+\s+per\s+ticket/i)?.[0]);
  const soldMax = bodyText.match(/Tickets\s+sold:\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const ticketsSold = parseNumber(soldMax?.[1]);
  const maxTickets = parseNumber(soldMax?.[2]);
  const drawDate = parseClosingDate(bodyText);
  const maxEntriesPerUser = parseNumber(
    bodyText.match(/Max\s+([\d,]+)\s+per\s+person/i)?.[1],
  );

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    ticketsSold < 0 ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null ||
    new Date(drawDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const manualEstimate = estimatePrize(name);
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
  $("a[href*='/competitions/']").each((_index, element) => {
    const href = absoluteUrl($(element).attr("href") ?? "");
    if (href.startsWith(`${BASE_URL}/competitions/`)) links.add(href);
  });
  return [...links].slice(0, 20);
}

function parseClosingDate(text: string): string | null {
  const match = text.match(
    /closing\s+date\s+for\s+this\s+competition\s+is\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  );
  if (!match) return null;

  const date = DateTime.fromObject(
    {
      year: Number(match[3]),
      month: Number(match[2]),
      day: Number(match[1]),
      hour: 23,
      minute: 59,
      second: 59,
    },
    { zone: "Europe/London" },
  );
  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function estimatePrize(name: string): { value: number; notes: string } | null {
  if (/harley[ -]davidson\s+fxdr/i.test(name)) {
    return {
      value: 10_000,
      notes: "Conservative UK used-market estimate for Harley-Davidson FXDR",
    };
  }
  if (/scirocco\s+r\s*line/i.test(name)) {
    return {
      value: 10_000,
      notes: "Conservative UK used-market estimate for Volkswagen Scirocco R Line",
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
