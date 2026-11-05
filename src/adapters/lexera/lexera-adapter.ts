import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { extractNextFlightText, extractNextJsonArray } from "../next-rsc.js";

const SITE_NAME = "lexera";
const BASE_URL = "https://www.lexera.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export interface LexeraCompetitionRecord {
  slug?: unknown;
  title?: unknown;
  category?: unknown;
  prizeValue?: unknown;
  entryPrice?: unknown;
  totalTickets?: unknown;
  soldTickets?: unknown;
  status?: unknown;
  drawDate?: unknown;
  maxEntriesPerUser?: unknown;
  cashAlternativeEnabled?: unknown;
  cashAlternativeValuePence?: unknown;
  freeEntryAvailable?: unknown;
}

export class LexeraAdapter implements SiteAdapter {
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
      throw new Error(`[Lexera] Failed to fetch homepage: ${response.status}`);
    }

    return parseLexeraHtml(await response.text());
  }
}

export function parseLexeraHtml(
  html: string,
  now = new Date(),
): RawCompetition[] {
  const payload = extractNextFlightText(html);
  const records = extractNextJsonArray<LexeraCompetitionRecord>(payload, "competitions");
  const scrapedAt = now.toISOString();

  return records
    .map((record) => parseLexeraCompetition(record, scrapedAt, now))
    .filter((record): record is RawCompetition => record !== null);
}

function parseLexeraCompetition(
  record: LexeraCompetitionRecord,
  scrapedAt: string,
  now: Date,
): RawCompetition | null {
  const slug = stringValue(record.slug);
  const name = stringValue(record.title);
  const status = stringValue(record.status).toLowerCase();
  const entryPrice = parsePounds(record.entryPrice);
  const ticketsSold = nonNegativeInteger(record.soldTickets);
  const maxTickets = nonNegativeInteger(record.totalTickets);
  const drawDate = parseDate(record.drawDate);
  if (
    !slug ||
    !name ||
    status !== "live" ||
    entryPrice === null ||
    maxTickets <= 0 ||
    ticketsSold > maxTickets ||
    !drawDate ||
    new Date(drawDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const cashAlternative = parseCashAlternative(record);
  const prizeValue = parsePounds(record.prizeValue);
  const category = stringValue(record.category).toLowerCase();
  const siteLimit = nonNegativeInteger(record.maxEntriesPerUser);
  const categories = category ? [category] : [];
  if (entryPrice === 0 && record.freeEntryAvailable === true) categories.push("free");

  return {
    sourceId: slug,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competitions/${slug}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: siteLimit > 0 ? siteLimit : 100,
    maxEntriesPerUserSource: siteLimit > 0 ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: prizeValue ?? cashAlternative,
    valuationSource: cashAlternative !== null ? "cash" : prizeValue !== null ? "site_estimate" : null,
    valuationConfidence: cashAlternative !== null || prizeValue !== null ? "high" : null,
    valuationNotes: cashAlternative !== null
      ? "Lexera exposes an explicit cash alternative."
      : prizeValue !== null
        ? "Lexera exposes an explicit prize value."
        : null,
    drawDate,
    isAutoDraw: false,
    categories,
    scrapedAt,
  };
}

function parseCashAlternative(record: LexeraCompetitionRecord): number | null {
  if (record.cashAlternativeEnabled !== true) return null;
  const pence = nonNegativeInteger(record.cashAlternativeValuePence);
  return pence > 0 ? pence / 100 : null;
}

function parsePounds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = value.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function nonNegativeInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
