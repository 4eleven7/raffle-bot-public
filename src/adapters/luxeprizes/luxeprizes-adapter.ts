import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.luxeprizes.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class LuxePrizesAdapter implements SiteAdapter {
  readonly siteName = "luxeprizes";

  async fetchAll(): Promise<RawCompetition[]> {
    const indexHtml = await fetchPage("/competitions");
    const $ = cheerio.load(indexHtml);
    const urls = new Set(
      $("a[href^='/game/']")
        .map((_index, element) => absoluteUrl($(element).attr("href") ?? ""))
        .get()
        .filter((url) => /^https:\/\/www\.luxeprizes\.co\.uk\/game\/\d+$/.test(url)),
    );
    const competitions: RawCompetition[] = [];
    for (const url of urls) {
      try {
        const competition = parseLuxeCompetition(await fetchUrl(url), url);
        if (competition) competitions.push(competition);
      } catch {
        // One stale or removed game must not hide the other live draws.
      }
    }
    return competitions;
  }
}

export function parseLuxeCompetition(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());
  const sourceId = url.match(/\/game\/(\d+)/)?.[1] ?? "";
  const name = cleanText($("h1").first().text());
  const drawType = cleanText(
    $(".game-type-explainer strong").first().text() ||
      $(".game-chip--red").first().text(),
  );
  if (!sourceId || !name || !/^live draw$/i.test(drawType)) {
    return null;
  }

  const price = parsePrice(html, $(".game-price-line").first().text());
  const progressText = cleanText($(".game-progress-head").first().text());
  const oddsText = cleanText($(".odds-section--draw").first().text());
  const soldMatch = progressText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
  const ticketsSold = parseAmount(
    soldMatch?.[1] ?? oddsText.match(/Tickets\s+sold\s*([\d,]+)/i)?.[1],
  );
  const totalTickets =
    soldMatch?.[2] ??
    oddsText.match(/Total\s+tickets\s*([\d,]+)/i)?.[1] ??
    bodyText.match(/\bONLY\s+([\d,]+)\s+tickets?\s+available\b/i)?.[1] ??
    bodyText.match(
      /\btotal\s+amount\s+of\s+tickets(?:\s+for\s+this\s+competition)?\s+is\s+([\d,]+)/i,
    )?.[1];
  const maxTickets = parseAmount(totalTickets);
  const drawDate = parseDate($(".game-countdown-strip[data-end]").first().attr("data-end"));
  const maxEntriesMatch = bodyText.match(/Max\s+([\d,]+)\s+tickets?\s+per\s+person/i);
  const maxEntriesPerUser = parseAmount(maxEntriesMatch?.[1]);
  const cashAlternative = parseAmountOrNull(
    bodyText.match(/\bOR\s+£\s*([\d,.]+)\s+CASH\b/i)?.[1],
  );
  const prizeValue = parsePrizeValue(bodyText);

  if (
    price <= 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    !drawDate ||
    new Date(drawDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: "luxeprizes",
    url,
    name,
    entryPrice: price,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser > 0 ? maxEntriesPerUser : 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: cashAlternative ?? prizeValue,
    valuationSource: cashAlternative !== null ? "cash" : prizeValue !== null ? "site_estimate" : null,
    valuationConfidence: cashAlternative !== null ? "high" : prizeValue !== null ? "medium" : null,
    valuationNotes: prizeValue !== null ? "LuxePrizes public competition description." : null,
    drawDate,
    isAutoDraw: false,
    categories: ["live draw"],
    scrapedAt: now.toISOString(),
  };
}

function parsePrice(html: string, priceText: string): number {
  const scriptMatch = html.match(/\bconst\s+price\s*=\s*([\d.]+)/i);
  if (scriptMatch) {
    const value = Number(scriptMatch[1]);
    if (Number.isFinite(value)) return value;
  }
  const penceMatch = priceText.match(/(\d+)p/i);
  if (penceMatch) return Number(penceMatch[1]) / 100;
  return parseAmount(priceText.match(/£\s*([\d,.]+)/)?.[1]);
}

function parsePrizeValue(text: string): number | null {
  const match =
    text.match(/\b(?:win|worth|prize|easiest)\s+£\s*([\d,.]+)/i) ??
    text.match(/£\s*([\d,.]+)\s+(?:cash|prize)\b/i);
  return parseAmountOrNull(match?.[1]);
}

function parseAmount(value: string | undefined): number {
  const parsed = Number.parseFloat((value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseAmountOrNull(value: string | undefined): number | null {
  const parsed = parseAmount(value);
  return parsed > 0 ? parsed : null;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function absoluteUrl(href: string): string {
  return new URL(href, BASE_URL).toString();
}

async function fetchPage(path: string): Promise<string> {
  return fetchUrl(`${BASE_URL}${path}`);
}

async function fetchUrl(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`LuxePrizes returned ${response.status}`);
  return response.text();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
