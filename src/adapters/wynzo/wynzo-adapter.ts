import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://wynzo.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export interface WynzoCompetitionRecord {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  category?: unknown;
  ticket_price_pence?: unknown;
  cash_alternative_pence?: unknown;
  total_tickets?: unknown;
  tickets_sold?: unknown;
  max_tickets_per_user?: unknown;
  status?: unknown;
  draw_at?: unknown;
  instant_win_count?: unknown;
  is_featured?: unknown;
}

export class WynzoAdapter implements SiteAdapter {
  readonly siteName = "wynzo";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const homepage = await fetchText(`${BASE_URL}/`, signal);
    const scriptUrl = extractScriptUrl(homepage);
    const bundle = await fetchText(scriptUrl, signal);
    const supabaseUrl = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
    const anonKey = bundle.match(
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    )?.[0];
    if (!supabaseUrl || !anonKey) {
      throw new Error("[Wynzo] Supabase client configuration not found");
    }

    const response = await fetch(
      `${supabaseUrl}/rest/v1/competitions?select=*&status=in.(pending,live)&order=display_order.asc`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Accept: "application/json",
        },
        signal,
      },
    );
    if (!response.ok) {
      throw new Error(`[Wynzo] Competitions API: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];

    const scrapedAt = new Date().toISOString();
    return payload
      .map((row) => parseWynzoCompetition(row as WynzoCompetitionRecord, scrapedAt))
      .filter((row): row is RawCompetition => row !== null);
  }
}

export function parseWynzoCompetition(
  record: WynzoCompetitionRecord,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const status = String(record.status ?? "").toLowerCase();
  const name = String(record.title ?? "").trim();
  const id = String(record.id ?? "").trim();
  const slug = String(record.slug ?? id).trim();
  const entryPrice = pence(record.ticket_price_pence);
  const maxTickets = integer(record.total_tickets);
  const ticketsSold = integer(record.tickets_sold);
  const drawDate = isoDate(record.draw_at);
  if (
    !["pending", "live"].includes(status) ||
    !name ||
    !id ||
    !slug ||
    entryPrice === null ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    !drawDate ||
    new Date(drawDate).getTime() <= Date.now()
  ) {
    return null;
  }

  const cashAlternative =
    pounds(record.cash_alternative_pence) ?? cashFromTitle(name);
  const siteLimit = integer(record.max_tickets_per_user);
  const categories = String(record.category ?? "").trim();
  const instantWinCount = integer(record.instant_win_count);

  return {
    sourceId: id,
    siteName: "wynzo",
    url: `${BASE_URL}/competition/${slug}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: siteLimit > 0 ? siteLimit : 100,
    maxEntriesPerUserSource: siteLimit > 0 ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: cashAlternative,
    valuationSource: cashAlternative !== null ? "cash" : null,
    valuationConfidence: cashAlternative !== null ? "high" : null,
    drawDate,
    isAutoDraw: instantWinCount > 0,
    categories: categories ? [categories.toLowerCase()] : [],
    scrapedAt,
  };
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/javascript" },
    signal,
  });
  if (!response.ok) throw new Error(`[Wynzo] ${url}: HTTP ${response.status}`);
  return response.text();
}

function extractScriptUrl(homepage: string): string {
  const matches = [...homepage.matchAll(/(?:src|href)=["']([^"']+\.js[^"']*)["']/g)];
  const asset = matches
    .map((match) => match[1])
    .find((path) => path.includes("/assets/") && !path.includes("flock"));
  if (!asset) throw new Error("[Wynzo] main JavaScript asset not found");
  return new URL(asset, BASE_URL).toString();
}

function pence(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number / 100 : null;
}

function pounds(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function integer(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cashFromTitle(title: string): number | null {
  const match = title.match(
    /£\s*([\d,]+(?:\.\d{1,2})?)\s*(?:tax[- ]free\s*)?cash\b/i,
  );
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}
