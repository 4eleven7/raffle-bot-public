import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "endurotickets";
const DISPLAY_NAME = "Enduro Tickets";
const BASE_URL = "https://endurotickets.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

interface RaffleRecord {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  ticket_price?: unknown;
  total_tickets?: unknown;
  tickets_sold?: unknown;
  draw_date?: unknown;
  status?: unknown;
  category?: unknown;
  prize_value?: unknown;
}

export class EnduroTicketsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const homepage = await fetchText(`${BASE_URL}/`, signal);
    const scriptUrl = extractScriptUrl(homepage);
    const bundle = await fetchText(scriptUrl, signal);
    const supabaseUrl = bundle.match(/https:\/\/[-a-z0-9]+\.supabase\.co/)?.[0];
    const anonKey = bundle.match(
      /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    )?.[0];
    if (!supabaseUrl || !anonKey) {
      throw new Error(`[${DISPLAY_NAME}] Supabase client configuration not found`);
    }

    const apiUrl = new URL("/rest/v1/raffles", supabaseUrl);
    apiUrl.searchParams.set("select", "*");
    apiUrl.searchParams.set("status", "eq.active");
    apiUrl.searchParams.set("order", "draw_date.asc");
    const response = await fetch(apiUrl, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
      signal,
    });
    if (!response.ok) throw new Error(`[${DISPLAY_NAME}] Raffles API: HTTP ${response.status}`);
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];
    return payload
      .map((row) => parseRaffle(row as RaffleRecord))
      .filter((row): row is RawCompetition => row !== null);
  }
}

export function parseRaffle(
  record: RaffleRecord,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const id = String(record.id ?? "").trim();
  const slug = String(record.slug ?? id).trim();
  const name = String(record.title ?? "").trim();
  const status = String(record.status ?? "").toLowerCase();
  const entryPrice = number(record.ticket_price);
  const maxTickets = integer(record.total_tickets);
  const ticketsSold = integer(record.tickets_sold);
  const drawDate = isoDate(record.draw_date);
  if (
    !id ||
    !slug ||
    !name ||
    status !== "active" ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold >= maxTickets ||
    !drawDate
  ) {
    return null;
  }

  const cashAlternative = number(record.prize_value) || cashFromTitle(name);
  return {
    sourceId: id,
    siteName: SITE_NAME,
    url: `${BASE_URL}/raffle/${slug}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    estimatedPrizeValue: cashAlternative > 0 ? cashAlternative : null,
    valuationSource: cashAlternative > 0 ? "cash" : null,
    valuationConfidence: cashAlternative > 0 ? "high" : null,
    valuationNotes: cashAlternative > 0 ? "Current Enduro Tickets prize value" : null,
    drawDate,
    isAutoDraw: false,
    categories: String(record.category ?? "").trim()
      ? [String(record.category).trim().toLowerCase()]
      : ["motorsport"],
    scrapedAt,
  };
}

function extractScriptUrl(html: string): string {
  const match = html.match(/(?:src|href)="([^"]+\.js[^\"]*)"/);
  if (!match) throw new Error(`[${DISPLAY_NAME}] main JavaScript asset not found`);
  return new URL(match[1]!, BASE_URL).toString();
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/javascript",
      "User-Agent": USER_AGENT,
    },
    signal,
  });
  if (!response.ok) throw new Error(`[${DISPLAY_NAME}] ${url}: HTTP ${response.status}`);
  return response.text();
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown): number {
  const parsed = number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cashFromTitle(title: string): number {
  const match = title.match(/(?:cash\s*)£\s*([\d,]+(?:\.\d{1,2})?)|£\s*([\d,]+(?:\.\d{1,2})?)\s*cash/i);
  if (!match) return 0;
  const value = Number((match[1] ?? match[2]).replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}
