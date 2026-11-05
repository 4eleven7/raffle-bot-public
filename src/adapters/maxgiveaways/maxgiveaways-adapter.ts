import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "maxgiveaways";
const DISPLAY_NAME = "Max Giveaways";
const BASE_URL = "https://maxgiveaways.co.uk";
const API_URL = `${BASE_URL}/api/competitions`;
const UK_ZONE = "Europe/London";

interface MaxGiveawaysCategory {
  name?: string | null;
}

interface MaxGiveawaysCompetition {
  id?: string | number;
  title?: string | null;
  slug?: string | null;
  status?: string | null;
  is_giveaway?: string | number | null;
  has_instant_prizes?: boolean | null;
  ticket_price?: string | number | null;
  max_entries?: string | number | null;
  ticket_limit_per_user?: string | number | null;
  end_date?: string | null;
  has_cash_alternative?: string | number | boolean | null;
  cash_alternative_amount?: string | number | null;
  main_prize_cost?: string | number | null;
  tickets_sold?: number | null;
  category?: MaxGiveawaysCategory | null;
}

interface MaxGiveawaysPage {
  competitions?: MaxGiveawaysCompetition[];
  pagination?: {
    current_page?: number;
    total_pages?: number;
    has_next_page?: boolean;
  };
}

interface MaxGiveawaysResponse {
  success?: boolean;
  data?: MaxGiveawaysPage;
}

export class MaxGiveawaysAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const scrapedAt = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    let page = 1;

    while (true) {
      const payload = await this.fetchPage(page);
      const rows = payload.competitions ?? [];

      for (const row of rows) {
        const competition = toCompetition(row, scrapedAt);
        if (competition) competitions.push(competition);
      }

      const pagination = payload.pagination;
      if (!pagination?.has_next_page || page >= (pagination.total_pages ?? page)) {
        break;
      }
      page += 1;
    }

    return competitions;
  }

  private async fetchPage(page: number): Promise<MaxGiveawaysPage> {
    const url = new URL(API_URL);
    url.searchParams.set("status", "active");
    url.searchParams.set("sort", "end_date_asc");
    url.searchParams.set("limit", "50");
    url.searchParams.set("page", String(page));

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${url}: ${response.status}`);
    }

    const payload = (await response.json()) as MaxGiveawaysResponse;
    if (!payload.success || !payload.data) {
      throw new Error(`[${DISPLAY_NAME}] Invalid API response`);
    }

    return payload.data;
  }
}

export function toCompetition(
  row: MaxGiveawaysCompetition,
  scrapedAt: string,
): RawCompetition | null {
  if (row.status !== "active") return null;
  if (isTruthyFlag(row.is_giveaway) || row.has_instant_prizes) return null;

  const sourceId = String(row.slug ?? row.id ?? "").trim();
  const name = String(row.title ?? "").trim();
  const entryPrice = numberFromUnknown(row.ticket_price);
  const maxTickets = integerFromUnknown(row.max_entries);
  const ticketsSold = integerFromUnknown(row.tickets_sold);
  const drawDate = parseSqlDate(row.end_date);

  if (!sourceId || !name || entryPrice <= 0 || maxTickets <= 0 || drawDate === null) {
    return null;
  }

  const cashAlternative = isTruthyFlag(row.has_cash_alternative)
    ? numberOrNull(row.cash_alternative_amount)
    : null;
  const estimatedPrizeValue = numberOrNull(row.main_prize_cost);
  const categoryName = row.category?.name?.trim().toLowerCase();
  const maxEntriesPerUser = integerFromUnknown(row.ticket_limit_per_user);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competition-detail.php?competition=${encodeURIComponent(sourceId)}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue,
    valuationSource: estimatedPrizeValue !== null ? "site_estimate" : null,
    valuationConfidence: estimatedPrizeValue !== null ? "high" : null,
    valuationNotes:
      estimatedPrizeValue !== null ? "Max Giveaways public API main_prize_cost." : null,
    drawDate,
    isAutoDraw: false,
    categories: categoryName ? [categoryName] : [],
    scrapedAt,
  };
}

function parseSqlDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = DateTime.fromSQL(value, { zone: UK_ZONE });
  return parsed.isValid ? parsed.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function integerFromUnknown(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function numberFromUnknown(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
