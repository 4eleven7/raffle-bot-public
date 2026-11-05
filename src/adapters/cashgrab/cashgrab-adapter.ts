import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { requireSiteKey } from "../site-keys.js";

const SITE_NAME = "cashgrabcompetitions";
const DISPLAY_NAME = "Cash Grab Competitions";
const BASE_URL = "https://cashgrabcompetitions.co.uk";
const SUPABASE_URL = "https://vbjnjtoovxejsdpqrrbs.supabase.co";
const SELECT = [
  "id",
  "slug",
  "title",
  "description",
  "ticket_price",
  "sale_price",
  "max_entries",
  "entries_sold",
  "max_entries_per_user",
  "draw_date",
  "category",
  "status",
  "is_free",
  "cash_alternative_enabled",
  "cash_alternative_value",
].join(",");

interface CashGrabCompetitionRecord {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  ticket_price?: unknown;
  sale_price?: unknown;
  max_entries?: unknown;
  entries_sold?: unknown;
  max_entries_per_user?: unknown;
  draw_date?: unknown;
  category?: unknown;
  status?: unknown;
  is_free?: unknown;
  cash_alternative_enabled?: unknown;
  cash_alternative_value?: unknown;
}

export class CashGrabAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const anonKey = requireSiteKey("CASHGRAB_SUPABASE_ANON_KEY");
    const now = new Date();
    const url = new URL("/rest/v1/competitions_public", SUPABASE_URL);
    url.searchParams.set("select", SELECT);
    url.searchParams.set("status", "eq.active");
    url.searchParams.set("draw_date", `gt.${now.toISOString()}`);
    url.searchParams.set("order", "draw_date.asc");
    url.searchParams.set("limit", "100");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "User-Agent": "Mozilla/5.0",
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Public API failed: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error(`[${DISPLAY_NAME}] Invalid public API response`);
    }

    const scrapedAt = now.toISOString();
    return payload
      .map((value) => toCompetition(value as CashGrabCompetitionRecord, now, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

export function toCompetition(
  record: CashGrabCompetitionRecord,
  now = new Date(),
  scrapedAt = now.toISOString(),
): RawCompetition | null {
  const sourceId = stringValue(record.id) || stringValue(record.slug);
  const slug = stringValue(record.slug) || sourceId;
  const name = cleanText(record.title);
  const description = cleanText(record.description);
  const text = `${name} ${description}`.trim();
  const status = stringValue(record.status).toLowerCase();
  const basePrice = positiveNumber(record.ticket_price);
  const salePrice = positiveNumber(record.sale_price);
  const entryPrice = salePrice !== null && basePrice !== null && salePrice < basePrice
    ? salePrice
    : basePrice;
  const ticketsSold = nonNegativeInteger(record.entries_sold);
  const maxTickets = positiveInteger(record.max_entries);
  const drawDate = parseDate(record.draw_date);
  const cashAlternative = record.cash_alternative_enabled === true
    ? positiveNumber(record.cash_alternative_value)
    : extractCashAmount(text);
  const maxEntriesPerUser = positiveInteger(record.max_entries_per_user);
  const mixedInstantDraw = /\binstant\s+wins?\b/i.test(text);

  if (
    !sourceId ||
    !slug ||
    !name ||
    status !== "active" ||
    record.is_free === true ||
    mixedInstantDraw ||
    entryPrice === null ||
    entryPrice <= 0 ||
    ticketsSold === null ||
    maxTickets === null ||
    ticketsSold < 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null ||
    new Date(drawDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const category = stringValue(record.category);
  const categories = [...new Set([
    category || null,
    cashAlternative !== null ? "cash" : null,
  ].filter((value): value is string => value !== null))];

  return {
    sourceId,
    siteName: SITE_NAME,
    url: new URL(`/competition/${encodeURIComponent(slug)}`, BASE_URL).toString(),
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    inventorySource: "exact",
    maxEntriesPerUser: maxEntriesPerUser ?? 100,
    maxEntriesPerUserSource: maxEntriesPerUser !== null ? "site" : "fallback",
    cashAlternative,
    ...(cashAlternative !== null
      ? {
          estimatedPrizeValue: cashAlternative,
          valuationSource: "cash" as const,
          valuationConfidence: "high" as const,
          valuationNotes: "Cash Grab public competition record states the cash prize or alternative",
        }
      : {}),
    drawDate,
    isAutoDraw: false,
    categories,
    scrapedAt,
  };
}

function extractCashAmount(text: string): number | null {
  const match = text.match(/£\s*([\d,.]+)\s*(k|m)?[^.\n]{0,60}\bcash\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multiplier = match[2]?.toLowerCase() === "m"
    ? 1_000_000
    : match[2]
      ? 1_000
      : 1;
  return amount * multiplier;
}

function parseDate(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ");
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
