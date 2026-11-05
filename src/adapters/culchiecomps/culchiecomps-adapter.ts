import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "culchiecomps";
const BASE_URL = "https://culchiecomps.com";
const DISPLAY_NAME = "Culchie Comps";

export class CulchieCompsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listHtml = await fetchPage(`${BASE_URL}/index.php/`, signal);
    const competitions: RawCompetition[] = [];
    const now = new Date();

    for (const url of parseCompetitionLinks(listHtml)) {
      try {
        const competition = parseCulchieDetail(
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

export function parseCulchieDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());
  const sourceId = url.match(/\/competition\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText(
    $("h1").first().text() ||
      $("meta[property='og:title']").attr("content") ||
      sourceId.replace(/-/g, " "),
  );
  const entryPrice = parseMoney($(".comp-price").first().text()) ||
    parseMoney(bodyText.match(/Ticket\s+Price:\s*£\s*[\d,.]+/i)?.[0]);
  const soldMax = bodyText.match(
    /([\d,]+)\s*\/\s*([\d,]+)\s+Tickets\s+Sold/i,
  );
  const ticketsSold = parseNumber(soldMax?.[1]);
  const maxTickets = parseNumber(soldMax?.[2]);
  const drawDate = parseDrawDate(bodyText);
  const maxEntriesPerUser = parseNumber(
    bodyText.match(
      /Maximum\s+\d+\s+Entries?\s+per\s+(?:person|user)\s*:\s*([\d,]+)/i,
    )?.[1],
  );
  const cashAlternative = parseCashPrize(name);

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

  const manualEstimate = cashAlternative === null ? estimatePrize(name) : null;
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
    cashAlternative,
    estimatedPrizeValue: manualEstimate?.value ?? null,
    valuationSource: cashAlternative !== null
      ? "cash"
      : manualEstimate
        ? "manual_estimate"
        : null,
    valuationConfidence: cashAlternative !== null
      ? "high"
      : manualEstimate
        ? "medium"
        : null,
    valuationNotes: cashAlternative !== null
      ? "Explicit cash prize in current competition title"
      : manualEstimate?.notes ?? null,
    drawDate,
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();
  $("a[href*='/competition/']").each((_index, element) => {
    const href = absoluteUrl($(element).attr("href") ?? "");
    if (href.startsWith(`${BASE_URL}/competition/`)) links.add(href);
  });
  return [...links].slice(0, 20);
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /(?:Live\s+Draw|Draw)\s*:\s*(?:[A-Za-z]+\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*@\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  );
  if (!match) return null;

  const year = Number(match[3] ?? new Date().getFullYear());
  const minute = match[5] ?? "00";
  const date = DateTime.fromFormat(
    `${match[1]} ${match[2]} ${year} ${match[4]}:${minute} ${match[6]}`,
    "d LLLL yyyy h:mm a",
    { zone: "Europe/London", locale: "en-GB" },
  );
  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function parseCashPrize(name: string): number | null {
  if (!/\bcash\b/i.test(name)) return null;
  const value = parseMoney(name);
  return value > 0 ? value : null;
}

function estimatePrize(name: string): { value: number; notes: string } | null {
  if (/hilux/i.test(name)) {
    return {
      value: 12_000,
      notes: "Conservative UK used-market estimate for Toyota Hilux prize",
    };
  }
  if (/massey\s+ferguson\s+6290/i.test(name)) {
    return {
      value: 15_000,
      notes: "Conservative used-market estimate for Massey Ferguson 6290 prize",
    };
  }
  if (/new\s+holland\s+tm150/i.test(name)) {
    return {
      value: 15_000,
      notes: "Conservative used-market estimate for New Holland TM150 prize",
    };
  }
  if (/john\s+deere\s+2650/i.test(name)) {
    return {
      value: 12_000,
      notes: "Conservative used-market estimate for John Deere 2650 prize",
    };
  }
  if (/iphone\s+17\s+pro\s+max/i.test(name)) {
    return {
      value: 800,
      notes: "Conservative retail estimate for iPhone 17 Pro Max prize",
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
