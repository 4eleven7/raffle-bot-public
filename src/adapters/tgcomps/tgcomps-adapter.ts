import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import * as cheerio from "cheerio";

const SITE_NAME = "tgcomps";
const BASE_URL = "https://tgcomps.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export interface TGCompsPackRecord {
  id?: unknown;
  code?: unknown;
  pack_name?: unknown;
  pack_value?: unknown;
  ticket_price?: unknown;
  total_entry_limit?: unknown;
  paid_entries?: unknown;
  free_entries?: unknown;
  status?: unknown;
  draw_date?: unknown;
  cash_prize_cap?: unknown;
  max_paid_per_user?: unknown;
  category?: unknown;
  alt_prize_description?: unknown;
  min_sellout?: unknown;
  reserve_not_met?: unknown;
  shopify_link?: unknown;
}

export class TGCompsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const homepage = await fetchText(`${BASE_URL}/`, signal);
    const scriptUrl = extractScriptUrl(homepage);
    const bundle = await fetchText(scriptUrl, signal);
    const supabaseUrl = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
    const anonKey = bundle.match(
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    )?.[0];
    if (!supabaseUrl || !anonKey) {
      throw new Error("[TGComps] Supabase client configuration not found");
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/raffle_packs?select=*&status=eq.active&order=draw_date.asc`,
      {
        headers: {
          Accept: "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`[TGComps] Raffle packs API: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];

    const scrapedAt = new Date().toISOString();
    const rows: RawCompetition[] = [];
    for (const record of payload) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const row = parseTGCompsPack(record, scrapedAt);
      if (!row) continue;
      if (typeof record.shopify_link === "string") {
        try {
          const productUrl = new URL(record.shopify_link);
          if (productUrl.protocol === "https:" && productUrl.hostname.endsWith(".myshopify.com") && /^\/products\/[\w-]+$/.test(productUrl.pathname)) {
            const productHtml = await fetchText(productUrl.toString(), signal);
            const $ = cheerio.load(productHtml);
            row.prizeDescription = $(".product__description, .product-description").first().text().replace(/\s+/g, " ").trim().slice(0, 6000);
          }
        } catch { signal?.throwIfAborted(); }
      }
      rows.push(row);
    }
    return rows;
  }
}

export function parseTGCompsPack(
  record: TGCompsPackRecord,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const sourceId = String(record.code ?? record.id ?? "").trim();
  const name = String(record.pack_name ?? "").trim();
  const status = String(record.status ?? "").trim().toLowerCase();
  const entryPrice = positiveNumber(record.ticket_price);
  const maxTickets = nonNegativeInteger(record.total_entry_limit);
  const paidEntries = nonNegativeInteger(record.paid_entries);
  const freeEntries = nonNegativeInteger(record.free_entries);
  if (paidEntries === null || freeEntries === null || maxTickets === null) return null;
  const ticketsSold = paidEntries + freeEntries;
  const drawDate = isoDate(record.draw_date);
  const prizeValue = positiveNumber(record.pack_value);
  const cashAlternative = positiveNumber(record.cash_prize_cap);
  const maxPaidPerUser = positiveInteger(record.max_paid_per_user);

  if (
    !sourceId ||
    !name ||
    status !== "active" ||
    entryPrice === null ||
    maxTickets <= 0 ||
    ticketsSold > maxTickets ||
    !drawDate ||
    new Date(drawDate).getTime() <= Date.now() ||
    prizeValue === null
  ) {
    return null;
  }

  const category = String(record.category ?? "").trim().toLowerCase();
  const terms = typeof record.alt_prize_description === "string" ? record.alt_prize_description.trim() : "";
  const conditional = positiveNumber(record.min_sellout) !== null || record.reserve_not_met === true || /reserve|revenue|sellout|sales/i.test(terms);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/raffle/${sourceId.toLowerCase()}`,
    name,
    prizeEvidence: `Public raffle_packs API: pack_value GBP ${prizeValue}; cash_prize_cap GBP ${cashAlternative ?? "not stated"}. ${terms}`,
    prizePayout: conditional ? { kind: "conditional", terms: terms || "Prize depends on the operator sales reserve" } : { kind: "fixed" },
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxPaidPerUser ?? 99,
    maxEntriesPerUserSource: maxPaidPerUser !== null ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: prizeValue,
    valuationSource: cashAlternative !== null ? "cash" : "site_estimate",
    valuationConfidence: "high",
    valuationNotes:
      cashAlternative !== null
        ? "TGComps public cash prize cap; reserve-miss payout may scale with sales."
        : "TGComps public pack value.",
    drawDate,
    isAutoDraw: false,
    categories: category ? [category] : [],
    scrapedAt,
  };
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/javascript" },
    signal,
  });
  if (!response.ok) throw new Error(`[TGComps] ${url}: HTTP ${response.status}`);
  return response.text();
}

function extractScriptUrl(homepage: string): string {
  const matches = [...homepage.matchAll(/(?:src|href)=["']([^"']+\.js[^"']*)["']/g)];
  const asset = matches.map((match) => match[1]).find((path) => path.includes("/assets/"));
  if (!asset) throw new Error("[TGComps] main JavaScript asset not found");
  return new URL(asset, BASE_URL).toString();
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
