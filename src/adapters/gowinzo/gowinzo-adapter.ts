import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "gowinzo";
const BASE_URL = "https://gowinzo.uk";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface GoWinzoAdapterOptions {
  now?: () => Date;
}

interface GoWinzoCredentials {
  supabaseUrl: string;
  anonKey: string;
}

interface GoWinzoCompetition {
  id?: string;
  title?: string | null;
  description?: string | null;
  short_description?: string | null;
  prize_value?: number | string | null;
  ticket_price?: number | string | null;
  max_entries?: number | string | null;
  current_entries?: number | string | null;
  category?: string | null;
  end_date?: string | null;
  status?: string | null;
  instant_wins_enabled?: boolean | null;
  instant_wins_only?: boolean | null;
  instant_win_prize_type?: string | null;
  random_ticket_allocation?: boolean | null;
  flash_sale_active?: boolean | null;
  flash_sale_discount_percent?: number | string | null;
  flash_sale_duration_minutes?: number | string | null;
  flash_sale_started_at?: string | null;
}

export class GoWinzoAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;
  private credentials?: Promise<GoWinzoCredentials>;

  constructor(private readonly options: GoWinzoAdapterOptions = {}) {}

  async fetchAll(): Promise<RawCompetition[]> {
    const nowDate = this.options.now?.() ?? new Date();
    const now = nowDate.toISOString();
    const credentials = await this.getCredentials();
    const response = await fetch(
      buildPublicCompetitionsUrl(credentials.supabaseUrl, now),
      {
        headers: {
          "User-Agent": UA,
          Accept: "application/json",
          apikey: credentials.anonKey,
          Authorization: `Bearer ${credentials.anonKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`[GoWinzo] Failed to fetch competitions: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    return data
      .map((competition) => this.mapCompetition(competition, nowDate, now))
      .filter((competition): competition is RawCompetition => competition !== null);
  }

  private async getCredentials(): Promise<GoWinzoCredentials> {
    this.credentials ??= this.fetchCredentials();
    return this.credentials;
  }

  private async fetchCredentials(): Promise<GoWinzoCredentials> {
    const html = await this.fetchText(`${BASE_URL}/`);
    const assetPath = extractMainAssetPath(html);
    if (!assetPath) {
      throw new Error("[GoWinzo] Could not find main JS asset");
    }

    const js = await this.fetchText(new URL(assetPath, BASE_URL).toString());
    const supabaseUrl = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
    const anonKey = js.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/)?.[0];
    if (!supabaseUrl || !anonKey) {
      throw new Error("[GoWinzo] Could not discover Supabase credentials");
    }

    return { supabaseUrl, anonKey };
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/javascript,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`[GoWinzo] Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  }

  private mapCompetition(
    comp: GoWinzoCompetition,
    nowDate: Date,
    scrapedAt: string,
  ): RawCompetition | null {
    if (!comp.id || !comp.title) return null;
    if (String(comp.status ?? "") !== "active") return null;
    if (comp.instant_wins_only === true) return null;

    const maxTickets = finiteNumber(comp.max_entries);
    if (maxTickets <= 0) return null;

    const prizeValue = finiteNumber(comp.prize_value);
    const cashAlternative = extractGoWinzoCashAlternative(comp, prizeValue);
    const categories = buildCategories(comp);
    const entryPrice = currentTicketPrice(comp, nowDate);

    return {
      sourceId: comp.id,
      siteName: SITE_NAME,
      url: `${BASE_URL}/competitions/${comp.id}`,
      name: comp.title,
      entryPrice,
      ticketsSold: finiteNumber(comp.current_entries),
      maxTickets,
      maxEntriesPerUser: 100,
      cashAlternative,
      ...(prizeValue > 0 && cashAlternative === null
        ? {
            estimatedPrizeValue: prizeValue,
            valuationSource: "site_estimate" as const,
            valuationConfidence: "medium" as const,
            valuationNotes: "GoWinzo public prize_value",
          }
        : {}),
      drawDate: comp.end_date ?? null,
      isAutoDraw: false,
      categories,
      scrapedAt,
    };
  }
}

function buildPublicCompetitionsUrl(supabaseUrl: string, now: string): string {
  const url = new URL("/rest/v1/rpc/get_public_competitions", supabaseUrl);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("end_date", `gt.${now}`);
  url.searchParams.set("order", "end_date.asc");
  return url.toString();
}

function extractMainAssetPath(html: string): string | null {
  const scripts = Array.from(
    html.matchAll(/<script[^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/gi),
    (match) => match[1],
  );
  return scripts.at(-1) ?? null;
}

function currentTicketPrice(comp: GoWinzoCompetition, now: Date): number {
  const price = finiteNumber(comp.ticket_price);
  if (
    comp.flash_sale_active !== true ||
    !comp.flash_sale_started_at ||
    finiteNumber(comp.flash_sale_duration_minutes) <= 0 ||
    finiteNumber(comp.flash_sale_discount_percent) <= 0
  ) {
    return price;
  }

  const startedAt = new Date(comp.flash_sale_started_at);
  const endsAt = new Date(
    startedAt.getTime() + finiteNumber(comp.flash_sale_duration_minutes) * 60 * 1000,
  );
  if (
    Number.isNaN(startedAt.getTime()) ||
    now.getTime() < startedAt.getTime() ||
    now.getTime() >= endsAt.getTime()
  ) {
    return price;
  }

  const discount = Math.min(100, Math.max(0, finiteNumber(comp.flash_sale_discount_percent)));
  return Math.round(price * (1 - discount / 100) * 100) / 100;
}

function extractGoWinzoCashAlternative(
  comp: GoWinzoCompetition,
  prizeValue: number,
): number | null {
  const text = [
    comp.title,
    comp.short_description,
    comp.description,
  ].filter(Boolean).join(" ");
  const explicit =
    text.match(/Cash\s+Alternative[:\s-]*(?:of\s*)?£\s*([\d,.]+)\s*(k)?/i) ||
    text.match(/\bor\s+(?:take\s+)?£\s*([\d,.]+)\s*(k)?\s*cash\b/i) ||
    text.match(/£\s*([\d,.]+)\s*(k)?\s*cash\s+alternative\b/i);
  if (explicit) return parseCashAmount(explicit[1], explicit[2]);

  const category = String(comp.category ?? "").toLowerCase();
  if (category.includes("cash") && prizeValue > 0) return prizeValue;

  const titleCash = text.match(/£\s*([\d,.]+)\s*(k)?\s*cash\b/i);
  return titleCash ? parseCashAmount(titleCash[1], titleCash[2]) : null;
}

function buildCategories(comp: GoWinzoCompetition): string[] {
  return [
    comp.category,
    comp.instant_wins_enabled ? "instant-wins" : null,
    comp.instant_win_prize_type,
    comp.random_ticket_allocation ? "random-ticket-allocation" : null,
  ]
    .map((category) => String(category ?? "").trim().toLowerCase().replace(/_/g, "-"))
    .filter((category, index, categories) =>
      category.length > 0 && categories.indexOf(category) === index,
    );
}

function parseCashAmount(value: string, suffix?: string): number {
  const amount = parseFloat(value.replace(/,/g, ""));
  return suffix ? amount * 1000 : amount;
}

function finiteNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
