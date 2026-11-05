import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { extractNextFlightText, extractNextJsonArray } from "../next-rsc.js";

const SITE_NAME = "royalwin";
const BASE_URL = "https://royalwin.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export interface RoyalWinDrawRecord {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  estimatedValue?: unknown;
  ticketPrice?: unknown;
  currency?: unknown;
  totalTickets?: unknown;
  soldTickets?: unknown;
  maxTicketsPerUser?: unknown;
  drawDate?: unknown;
  endDate?: unknown;
  status?: unknown;
}

export class RoyalWinAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`[Royal Win] Failed to fetch homepage: ${response.status}`);
    }

    return parseRoyalWinHtml(await response.text());
  }
}

export function parseRoyalWinHtml(
  html: string,
  now = new Date(),
): RawCompetition[] {
  const payload = extractNextFlightText(html);
  const records = extractNextJsonArray<RoyalWinDrawRecord>(payload, "initialDraws");
  const scrapedAt = now.toISOString();

  return records
    .map((record) => parseRoyalWinDraw(record, scrapedAt, now))
    .filter((record): record is RawCompetition => record !== null);
}

function parseRoyalWinDraw(
  record: RoyalWinDrawRecord,
  scrapedAt: string,
  now: Date,
): RawCompetition | null {
  const id = stringValue(record.id);
  const name = stringValue(record.title);
  const currency = stringValue(record.currency).toUpperCase();
  const status = stringValue(record.status).toLowerCase();
  const entryPrice = finiteNonNegative(record.ticketPrice);
  const ticketsSold = nonNegativeInteger(record.soldTickets);
  const maxTickets = nonNegativeInteger(record.totalTickets);
  const drawDate = parseDate(record.drawDate) ?? parseDate(record.endDate);
  if (
    !id ||
    !name ||
    currency !== "GBP" ||
    status !== "active" ||
    entryPrice === null ||
    maxTickets <= 0 ||
    ticketsSold > maxTickets ||
    !drawDate ||
    new Date(drawDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const siteLimit = nonNegativeInteger(record.maxTicketsPerUser);
  const prizeValue = finiteNonNegative(record.estimatedValue);
  const category = stringValue(record.category).toLowerCase();

  return {
    sourceId: id,
    siteName: SITE_NAME,
    url: `${BASE_URL}/draws/${id}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: siteLimit > 0 ? siteLimit : 100,
    maxEntriesPerUserSource: siteLimit > 0 ? "site" : "fallback",
    cashAlternative: null,
    estimatedPrizeValue: prizeValue,
    valuationSource: prizeValue !== null ? "site_estimate" : null,
    valuationConfidence: prizeValue !== null ? "high" : null,
    valuationNotes: prizeValue !== null ? "Royal Win exposes an estimated prize value." : null,
    drawDate,
    isAutoDraw: false,
    categories: category ? [category] : [],
    scrapedAt,
  };
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finiteNonNegative(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function nonNegativeInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
