import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { extractNextFlightText, extractNextJsonArray } from "../next-rsc.js";

const SITE_NAME = "oddsup";
const BASE_URL = "https://www.oddsup.co.uk";
const LISTING_URL = `${BASE_URL}/competitions`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export interface OddsUpCompetitionRecord {
  id?: unknown;
  title?: unknown;
  category?: unknown;
  prize_value?: unknown;
  ticket_price?: unknown;
  total_tickets?: unknown;
  tickets_sold?: unknown;
  status?: unknown;
  max_tickets_per_user?: unknown;
  max_entries_per_user?: unknown;
  is_free_entry?: unknown;
  draw_date?: unknown;
  scheduled_draw_at?: unknown;
  ends_at?: unknown;
}

export class OddsUpAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const response = await fetch(LISTING_URL, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`[Odds Up] Failed to fetch competitions: ${response.status}`);
    }

    return parseOddsUpHtml(await response.text());
  }
}

export function parseOddsUpHtml(
  html: string,
  now = new Date(),
): RawCompetition[] {
  const payload = extractNextFlightText(html);
  const records = extractNextJsonArray<OddsUpCompetitionRecord>(payload, "competitions");
  const scrapedAt = now.toISOString();

  return records
    .map((record) => parseOddsUpCompetition(record, scrapedAt, now))
    .filter((record): record is RawCompetition => record !== null);
}

function parseOddsUpCompetition(
  record: OddsUpCompetitionRecord,
  scrapedAt: string,
  now: Date,
): RawCompetition | null {
  const id = stringValue(record.id);
  const name = stringValue(record.title);
  const status = stringValue(record.status).toLowerCase();
  const entryPrice = parsePounds(record.ticket_price);
  const ticketsSold = nonNegativeInteger(record.tickets_sold);
  const maxTickets = nonNegativeInteger(record.total_tickets);
  const drawDate =
    parseDate(record.draw_date) ??
    parseDate(record.scheduled_draw_at) ??
    parseDate(record.ends_at);
  const prizeValue = parsePounds(record.prize_value);

  if (
    !id ||
    !name ||
    status !== "active" ||
    entryPrice === null ||
    maxTickets <= 0 ||
    ticketsSold > maxTickets ||
    prizeValue === null ||
    prizeValue <= 0 ||
    !drawDate ||
    new Date(drawDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const category = stringValue(record.category).toLowerCase();
  const isCash = category === "cash" || /\bcash\b/i.test(name);
  const cashAlternative = isCash ? prizeValue : null;
  const siteLimit =
    nonNegativeInteger(record.max_tickets_per_user) ||
    nonNegativeInteger(record.max_entries_per_user);
  const categories = category ? [category] : [];
  if (record.is_free_entry === true) categories.push("free");

  return {
    sourceId: id,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competitions/${id}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    inventorySource: "exact",
    maxEntriesPerUser: siteLimit > 0 ? siteLimit : 1,
    maxEntriesPerUserSource: siteLimit > 0 ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: prizeValue,
    valuationSource: cashAlternative !== null ? "cash" : "site_estimate",
    valuationConfidence: "high",
    valuationNotes: cashAlternative !== null
      ? "Odds Up exposes the cash prize value."
      : "Odds Up exposes the prize value.",
    drawDate,
    isAutoDraw: true,
    categories,
    scrapedAt,
  };
}

function parsePounds(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/£?\s*([0-9]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
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
