import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import {
  createContext,
  createStealthPage,
} from "../browser/browser-pool.js";

const SITE_NAME = "hotdraw";
const BASE_URL = "https://www.hotdraw.co.uk";
const REQUESTED_URL = `${BASE_URL}/prizes/NcbewQ6wOdpXkjB3fa8I`;
const MAX_DETAIL_PAGES = 50;
const REQUESTED_PRIZE_VALUE = 189.99;

export class HotDrawAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;
  readonly scanCost = "browser" as const;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const context = await createContext(signal);
    const page = await createStealthPage(context, signal);
    const urls = new Set([REQUESTED_URL]);
    const competitions: RawCompetition[] = [];

    try {
      try {
        signal?.throwIfAborted();
        await page.goto(`${BASE_URL}/prizes`, {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await page
          .waitForFunction(
            () => document.querySelectorAll("a[href*='/prizes/']").length > 0,
            undefined,
            { timeout: 10_000 },
          )
          .catch(() => undefined);
        const links = await page.locator("a").evaluateAll((elements) =>
          elements
            .map((element) => (element as HTMLAnchorElement).href)
            .filter((href) => href.startsWith(`${BASE_URL}/prizes/`)),
        );
        for (const url of links) urls.add(url);
      } catch {
        signal?.throwIfAborted();
      }

      for (const url of Array.from(urls).slice(0, MAX_DETAIL_PAGES)) {
        signal?.throwIfAborted();
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          });
          await page
            .waitForFunction(
              () => /Tickets Remaining:\s*[1-9]\d*\s*\/\s*\d+/i.test(document.body.innerText),
              undefined,
              { timeout: 8_000 },
            )
            .catch(() => undefined);
          const html = await page.content();
          const competition = parseHotDrawDetail(html, url);
          if (competition) competitions.push(competition);
        } catch {
          signal?.throwIfAborted();
        }
      }

      return competitions;
    } finally {
      await context.close().catch(() => undefined);
    }
  }
}

export function parseHotDrawDetail(
  html: string,
  url: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const detailText = cleanText($(".page-description").first().text());
  const sourceId = url.match(/\/prizes\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText($("h1").first().text());
  const inventory = text.match(
    /Tickets\s+Remaining:\s*([\d,]+)\s*\/\s*([\d,]+)/i,
  );
  const price = text.match(/£\s*([\d,.]+)\s*(?:Per\s+Entry|each)\b/i);
  const maxEntries = text.match(
    /Max\s+Tickets\s+Per\s+User:\s*([\d,]+)/i,
  );
  const countdown = text.match(
    /\b(\d+)\s*D\s*(\d+)\s*H\s*(\d+)\s*M\s*(\d+)\s*S\b/i,
  );
  const drawDate = parseCountdownDate(countdown, scrapedAt);

  if (!sourceId || !name || !inventory || !price || !drawDate) return null;

  const ticketsRemaining = parseNumber(inventory[1]);
  const maxTickets = parseNumber(inventory[2]);
  const entryPrice = parseNumber(price[1]);
  if (
    maxTickets <= 0 ||
    ticketsRemaining <= 0 ||
    ticketsRemaining > maxTickets ||
    entryPrice <= 0
  ) {
    return null;
  }

  const cashAlternative = parseCashAlternative(detailText);
  const manualPrizeValue =
    sourceId === "NcbewQ6wOdpXkjB3fa8I" ? REQUESTED_PRIZE_VALUE : null;
  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold: maxTickets - ticketsRemaining,
    maxTickets,
    inventorySource: "exact",
    maxEntriesPerUser: parseNumber(maxEntries?.[1]) || 100,
    maxEntriesPerUserSource: maxEntries ? "site" : "fallback",
    cashAlternative,
    ...(cashAlternative !== null
      ? {
          estimatedPrizeValue: cashAlternative,
          valuationSource: "cash" as const,
          valuationConfidence: "high" as const,
          valuationNotes: "HotDraw public prize description cash alternative",
        }
      : manualPrizeValue !== null
        ? {
            estimatedPrizeValue: manualPrizeValue,
            valuationSource: "manual_estimate" as const,
            valuationConfidence: "high" as const,
            valuationNotes: "Current Screwfix listing for the exact DCK2060M2T-SFGB kit",
          }
        : {}),
    drawDate,
    isAutoDraw: /\bauto\s*draw\b/i.test(name),
    categories: [],
    scrapedAt,
  };
}

function parseCountdownDate(
  match: RegExpMatchArray | null,
  scrapedAt: string,
): string | null {
  if (!match) return null;
  const durationMs =
    (((parseNumber(match[1]) * 24 + parseNumber(match[2])) * 60 +
      parseNumber(match[3])) *
      60 +
      parseNumber(match[4])) *
    1000;
  const observedAt = Date.parse(scrapedAt);
  if (!Number.isFinite(observedAt) || durationMs <= 0) return null;
  return new Date(observedAt + durationMs).toISOString();
}

function parseCashAlternative(text: string): number | null {
  const match = text.match(/£\s*([\d,.]+)\s*Cash\s+Alternative\b/i);
  if (!match) return null;
  const value = parseNumber(match[1]);
  return value > 0 ? value : null;
}

function parseNumber(value: string | undefined): number {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
