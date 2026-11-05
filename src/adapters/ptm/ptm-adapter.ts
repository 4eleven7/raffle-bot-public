import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "ptmprizes";
const BASE_URL = "https://ptmprizes.co.uk";
const API_BASE_URL = "https://api.ptmprizes.co.uk";
const MAX_PAGES = 8;
const MAX_COMPETITIONS = 40;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface PtmCompetitionsResponse {
  data?: PtmCompetition[];
  total_pages?: number;
}

interface PtmCompetition {
  id?: number;
  title?: string | null;
  url?: string | null;
  price?: number | string | null;
  ticket_sold?: number | string | null;
  ticket_maximum?: number | string | null;
  purchase_qty_maximum?: number | string | null;
  end_date?: number | string | null;
  draw_date?: number | string | null;
  has_ended?: boolean | null;
  is_sold_out?: boolean | null;
  auto_draw?: boolean | null;
}

export class PtmAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const scrapedAt = new Date().toISOString();
    const nowSeconds = Date.now() / 1000;
    const competitions: RawCompetition[] = [];

    for (let page = 1; page <= MAX_PAGES && competitions.length < MAX_COMPETITIONS; page++) {
      const response = await this.fetchCompetitionsPage(page);
      for (const competition of response.data ?? []) {
        const mapped = this.mapCompetition(competition, scrapedAt, nowSeconds);
        if (mapped) competitions.push(mapped);
      }

      const totalPages = Number(response.total_pages ?? 0);
      if (totalPages > 0 && page >= totalPages) break;
    }

    return competitions;
  }

  private async fetchCompetitionsPage(page: number): Promise<PtmCompetitionsResponse> {
    const url = new URL("/competitions", API_BASE_URL);
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[PTM Prizes] Failed to fetch ${url}: ${response.status}`);
    }

    return (await response.json()) as PtmCompetitionsResponse;
  }

  private mapCompetition(
    competition: PtmCompetition,
    scrapedAt: string,
    nowSeconds: number,
  ): RawCompetition | null {
    const id = finiteNumber(competition.id);
    const name = String(competition.title ?? "").trim();
    const slug = String(competition.url ?? "").trim();
    const entryPrice = finiteNumber(competition.price);
    const ticketsSold = finiteNumber(competition.ticket_sold);
    const maxTickets = finiteNumber(competition.ticket_maximum);
    const closeSeconds =
      finiteNumber(competition.draw_date) || finiteNumber(competition.end_date);

    if (!id || !name || !slug || entryPrice < 0 || maxTickets <= 0 || closeSeconds <= nowSeconds) {
      return null;
    }
    if (competition.has_ended === true || competition.is_sold_out === true) return null;
    if (ticketsSold >= maxTickets) return null;

    const cashAlternative = extractCashAlternative(name);
    const maxEntriesPerUser = positiveInteger(competition.purchase_qty_maximum);

    return {
      sourceId: String(id),
      siteName: SITE_NAME,
      url: `${BASE_URL}/${slug}.htm`,
      name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: maxEntriesPerUser ?? 100,
      maxEntriesPerUserSource: maxEntriesPerUser === null ? "fallback" : "site",
      cashAlternative,
      drawDate: new Date(closeSeconds * 1000).toISOString(),
      isAutoDraw: competition.auto_draw === true,
      categories: buildCategories(name, cashAlternative),
      scrapedAt,
    };
  }
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/\bor\s*£\s*([\d,.]+)\s*(k)?\b/i);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2] ? value * 1000 : value;
}

function buildCategories(name: string, cashAlternative: number | null): string[] {
  const categories = ["api"];
  const lower = name.toLowerCase();
  if (/\bvan|transit|crafter|camper\b/.test(lower)) categories.push("vehicle");
  if (/\btool|milwaukee|dewalt|makita\b/.test(lower)) categories.push("tools");
  if (cashAlternative !== null || /\bcash\b/.test(lower)) categories.push("cash");
  if (/\binstant wins?\b/.test(lower)) categories.push("instant-win");
  return categories;
}

function finiteNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value: number | string | null | undefined): number | null {
  const parsed = Math.floor(finiteNumber(value));
  return parsed > 0 ? parsed : null;
}
