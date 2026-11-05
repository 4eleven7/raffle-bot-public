import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { requireSiteKey } from "../site-keys.js";

const SITE_NAME = "vaultnine";
const DISPLAY_NAME = "VaultNine Competitions";
const BASE_URL = "https://vaultninecompetitions.co.uk";
const SUPABASE_URL = "https://ljxgflavyooynamjrzzt.supabase.co";
const SELECT = [
  "id",
  "title",
  "slug",
  "ticket_price",
  "sale_price",
  "max_entries",
  "entries_sold",
  "draw_date",
  "status",
  "is_free",
  "competition_type",
  "is_instant_win",
  "max_entries_per_user",
  "cash_alternative_value",
  "cash_alternative_enabled",
  "draws_on_sellout",
].join(",");

interface VaultNineCompetitionRecord {
  id?: unknown;
  title?: unknown;
  slug?: unknown;
  ticket_price?: unknown;
  sale_price?: unknown;
  max_entries?: unknown;
  entries_sold?: unknown;
  draw_date?: unknown;
  status?: unknown;
  is_free?: unknown;
  competition_type?: unknown;
  is_instant_win?: unknown;
  max_entries_per_user?: unknown;
  cash_alternative_value?: unknown;
  cash_alternative_enabled?: unknown;
  draws_on_sellout?: unknown;
}

export class VaultNineAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const anonKey = requireSiteKey("VAULTNINE_SUPABASE_ANON_KEY");
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
      .map((value) => toCompetition(value as VaultNineCompetitionRecord, now, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

export function toCompetition(
  record: VaultNineCompetitionRecord,
  now = new Date(),
  scrapedAt = now.toISOString(),
): RawCompetition | null {
  const sourceId = stringValue(record.id) || stringValue(record.slug);
  const slug = stringValue(record.slug) || sourceId;
  const name = cleanText(record.title);
  const status = stringValue(record.status).toLowerCase();
  const competitionType = stringValue(record.competition_type).toLowerCase();
  const basePrice = positiveNumber(record.ticket_price);
  const salePrice = positiveNumber(record.sale_price);
  const entryPrice =
    salePrice !== null && basePrice !== null && salePrice < basePrice
      ? salePrice
      : basePrice;
  const ticketsSold = nonNegativeInteger(record.entries_sold);
  const maxTickets = positiveInteger(record.max_entries);
  const drawDate = parseDate(record.draw_date);
  const cashAlternative =
    record.cash_alternative_enabled === true
      ? positiveNumber(record.cash_alternative_value)
      : null;
  const instantWin = record.is_instant_win === true || /\binstant\b/i.test(competitionType);

  if (
    !sourceId ||
    !name ||
    status !== "active" ||
    record.is_free === true ||
    instantWin ||
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

  const maxEntriesPerUser = positiveInteger(record.max_entries_per_user);
  const categories = [
    competitionType || null,
    cashAlternative !== null ? "cash" : null,
  ].filter((category): category is string => category !== null);

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
          valuationSource: "cash" as const,
          valuationConfidence: "high" as const,
          valuationNotes: "VaultNine public API explicit cash alternative",
        }
      : {}),
    drawDate,
    isAutoDraw: record.draws_on_sellout === true,
    categories,
    scrapedAt,
  };
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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
