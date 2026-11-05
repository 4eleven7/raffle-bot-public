import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { requireSiteKey } from "../site-keys.js";

const SITE_NAME = "quidsincomps";
const DISPLAY_NAME = "Quids In Comps";
const BASE_URL = "https://quidsincomps.com";
const SUPABASE_URL = "https://ffudtcthkoptzfgynajv.supabase.co";
const SELECT =
  "id,title,ticket_price,sale_price,ticket_price_type,tickets_sold,max_tickets,end_date,draw_date,description,status,deleted_at";

interface QuidsInCompsRecord {
  id?: unknown;
  title?: unknown;
  ticket_price?: unknown;
  sale_price?: unknown;
  ticket_price_type?: unknown;
  tickets_sold?: unknown;
  max_tickets?: unknown;
  end_date?: unknown;
  draw_date?: unknown;
  description?: unknown;
  status?: unknown;
  deleted_at?: unknown;
}

export class QuidsInCompsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const anonKey = requireSiteKey("QUIDSINCOMPS_SUPABASE_ANON_KEY");
    const now = new Date();
    const url = new URL("/rest/v1/competitions_public", SUPABASE_URL);
    url.searchParams.set("select", SELECT);
    url.searchParams.set("status", "eq.active");
    url.searchParams.set("deleted_at", "is.null");
    url.searchParams.set("end_date", `gt.${now.toISOString()}`);
    url.searchParams.set("order", "end_date.asc");
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
      .map((value) => toCompetition(value as QuidsInCompsRecord, scrapedAt, now))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

export function toCompetition(
  record: QuidsInCompsRecord,
  scrapedAt = new Date().toISOString(),
  now = new Date(),
): RawCompetition | null {
  const sourceId = stringValue(record.id);
  const name = cleanText(record.title);
  const status = stringValue(record.status).toLowerCase();
  const basePrice = positiveNumber(record.ticket_price);
  const salePrice = positiveNumber(record.sale_price);
  const entryPrice =
    stringValue(record.ticket_price_type).toLowerCase() === "sale" &&
    salePrice !== null &&
    basePrice !== null &&
    salePrice < basePrice
      ? salePrice
      : basePrice;
  const ticketsSold = nonNegativeInteger(record.tickets_sold);
  const maxTickets = positiveInteger(record.max_tickets);
  const drawDate = parseDate(record.draw_date) ?? parseDate(record.end_date);
  const text = cleanText(`${name} ${stringValue(record.description)}`);

  if (
    !sourceId ||
    !name ||
    status !== "active" ||
    (record.deleted_at !== null && record.deleted_at !== undefined) ||
    entryPrice === null ||
    entryPrice <= 0 ||
    ticketsSold === null ||
    maxTickets === null ||
    ticketsSold >= maxTickets ||
    drawDate === null ||
    new Date(drawDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const cashAlternative = extractCashAlternative(text);
  const categories = [
    cashAlternative !== null || /\bcash\b/i.test(text) ? "cash" : null,
    /\b(?:instant|scratchcard|mini[ -]?game|reveal)\b/i.test(text)
      ? "instant-win"
      : null,
  ].filter((category): category is string => category !== null);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competition/${encodeURIComponent(sourceId)}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: /\b(?:instant|scratchcard|mini[ -]?game|reveal)\b/i.test(text),
    categories,
    scrapedAt,
  };
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/\bcash\s+alt(?:ernative)?\b\s*£\s*([\d,.]+)/i) ??
    text.match(/\bor\s+£\s*([\d,.]+)\s*(?:cash|tax[-\s]*free)\b/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDate(value: unknown): string | null {
  const text = stringValue(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
  return parsed === null ? null : Math.floor(parsed);
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}
