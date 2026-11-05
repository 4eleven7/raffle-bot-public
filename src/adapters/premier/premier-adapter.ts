import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://premierprizecompetitions.co.uk";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface PremierCredentials {
  supabaseUrl: string;
  anonKey: string;
}

interface PremierCompetition {
  id?: string;
  title?: string;
  slug?: string | null;
  prize_value?: number | string | null;
  ticket_price?: number | string | null;
  sale_price?: number | string | null;
  is_on_sale?: boolean | null;
  total_tickets?: number | string | null;
  tickets_sold?: number | string | null;
  status?: string | null;
  category?: string | null;
  is_instant_win?: boolean | null;
  draw_date?: string | null;
  end_date?: string | null;
  max_tickets_per_user?: number | string | null;
  admin_only?: boolean | null;
  is_competition_game?: boolean | null;
  type?: string | null;
  format?: string | null;
  draw_mode?: string | null;
}

export class PremierPrizeAdapter implements SiteAdapter {
  readonly siteName = "premierprize";
  private credentials?: Promise<PremierCredentials>;

  async fetchAll(): Promise<RawCompetition[]> {
    const credentials = await this.getCredentials();
    const response = await fetch(this.buildCompetitionsUrl(credentials.supabaseUrl), {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        apikey: credentials.anonKey,
        Authorization: `Bearer ${credentials.anonKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`[Premier Prize] Failed to fetch competitions: ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const now = new Date().toISOString();
    return data
      .map((comp) => this.mapCompetition(comp, now))
      .filter((comp): comp is RawCompetition => comp !== null);
  }

  private async getCredentials(): Promise<PremierCredentials> {
    this.credentials ??= this.fetchCredentials();
    return this.credentials;
  }

  private async fetchCredentials(): Promise<PremierCredentials> {
    const html = await this.fetchText(`${BASE_URL}/`);
    const assetPath = extractMainAssetPath(html);
    if (!assetPath) {
      throw new Error("[Premier Prize] Could not find main JS asset");
    }

    const js = await this.fetchText(new URL(assetPath, BASE_URL).toString());
    const supabaseUrl = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
    const anonKey = js.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/)?.[0];
    if (!supabaseUrl || !anonKey) {
      throw new Error("[Premier Prize] Could not discover Supabase credentials");
    }

    return { supabaseUrl, anonKey };
  }

  private buildCompetitionsUrl(supabaseUrl: string): string {
    const url = new URL("/rest/v1/competitions", supabaseUrl);
    url.searchParams.set(
      "select",
      [
        "id",
        "title",
        "slug",
        "prize_value",
        "ticket_price",
        "sale_price",
        "is_on_sale",
        "total_tickets",
        "tickets_sold",
        "status",
        "category",
        "is_instant_win",
        "draw_date",
        "end_date",
        "max_tickets_per_user",
        "admin_only",
        "is_competition_game",
        "type",
        "format",
        "draw_mode",
      ].join(","),
    );
    url.searchParams.set("status", "in.(live,ending_soon)");
    url.searchParams.set("admin_only", "eq.false");
    url.searchParams.set("is_competition_game", "eq.false");
    url.searchParams.set("order", "draw_date.asc.nullslast");
    return url.toString();
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
      throw new Error(`[Premier Prize] Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  }

  private mapCompetition(
    comp: PremierCompetition,
    now: string,
  ): RawCompetition | null {
    if (!comp.id || !comp.title) return null;
    if (comp.admin_only || comp.is_competition_game) return null;
    if (!["live", "ending_soon"].includes(String(comp.status ?? ""))) return null;

    const entryPrice = currentTicketPrice(comp);
    const prizeValue = finiteNumber(comp.prize_value);
    const isCash = isCashCompetition(comp, prizeValue);
    const categories = buildCategories(comp);
    const maxEntriesPerUser = positiveInteger(comp.max_tickets_per_user);

    return {
      sourceId: comp.id,
      siteName: this.siteName,
      url: `${BASE_URL}/competitions/${comp.id}`,
      name: comp.title,
      entryPrice,
      ticketsSold: finiteNumber(comp.tickets_sold),
      maxTickets: finiteNumber(comp.total_tickets),
      maxEntriesPerUser: maxEntriesPerUser ?? 100,
      maxEntriesPerUserSource: maxEntriesPerUser === null ? "fallback" : "site",
      cashAlternative: isCash ? prizeValue : null,
      ...(prizeValue > 0 && !isCash
        ? {
            estimatedPrizeValue: prizeValue,
            valuationSource: "site_estimate" as const,
            valuationConfidence: "medium" as const,
            valuationNotes: "Premier Prize public prize_value",
          }
        : {}),
      drawDate: comp.draw_date ?? comp.end_date ?? null,
      isAutoDraw: comp.is_instant_win === true || comp.draw_mode === "automatic",
      categories,
      scrapedAt: now,
    };
  }
}

function extractMainAssetPath(html: string): string | null {
  const scripts = Array.from(
    html.matchAll(/<script[^>]+src=["']([^"']*\/assets\/index-[^"']+\.js)["']/gi),
    (match) => match[1],
  );
  return scripts.at(-1) ?? null;
}

function currentTicketPrice(comp: PremierCompetition): number {
  const price = finiteNumber(comp.ticket_price);
  const salePrice = finiteNumber(comp.sale_price);
  if (comp.is_on_sale === true && salePrice > 0 && salePrice < price) {
    return salePrice;
  }
  return price;
}

function isCashCompetition(comp: PremierCompetition, prizeValue: number): boolean {
  if (prizeValue <= 0 || comp.is_instant_win === true) return false;
  const category = String(comp.category ?? "").toLowerCase();
  return category.includes("cash") && /(?:^|\s)£\s*[\d,]+(?:\.\d{1,2})?\s*cash\b/i.test(comp.title ?? "");
}

function buildCategories(comp: PremierCompetition): string[] {
  return [
    comp.category,
    comp.is_instant_win ? "instant-win" : null,
    comp.type,
    comp.format,
  ]
    .map((category) => String(category ?? "").trim().toLowerCase())
    .filter((category, index, categories) => category.length > 0 && categories.indexOf(category) === index);
}

function finiteNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value: number | string | null | undefined): number | null {
  const parsed = Math.floor(finiteNumber(value));
  return parsed > 0 ? parsed : null;
}
