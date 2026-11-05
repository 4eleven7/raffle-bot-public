import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { requireSiteKey } from "../site-keys.js";

const BASE_URL = "https://www.inittowinitcompetitions.co.uk";
const SUPABASE_URL = "https://ttmkgiiuwfxpkpizyqjs.supabase.co";

interface InItToWinItCompetition {
  id: string;
  title: string;
  slug: string;
  ticket_price: number | null;
  total_tickets: number | null;
  max_tickets_per_customer: number | null;
  end_date: string | null;
  prize_value: number | null;
  cash_alternative: number | null;
  draw_type: string | null;
  vip_only: boolean | null;
  app_only: boolean | null;
  status: string;
}

export class InItToWinItAdapter implements SiteAdapter {
  readonly siteName = "inittowinitcompetitions";

  async fetchAll(): Promise<RawCompetition[]> {
    const competitions = await this.fetchCompetitions();
    const now = new Date().toISOString();

    const soldCounts = await mapWithConcurrency(competitions, 6, async (competition) => ({
      id: competition.id,
      sold: await this.fetchSoldTicketCount(competition.id),
    }));
    const soldById = new Map(soldCounts.map((entry) => [entry.id, entry.sold]));

    return competitions.map((competition) => {
      const maxEntriesPerUser = finiteNumber(competition.max_tickets_per_customer);
      return {
        sourceId: competition.id,
        siteName: this.siteName,
        url: `${BASE_URL}/competitions/${competition.slug}`,
        name: competition.title.trim(),
        entryPrice: finiteNumber(competition.ticket_price),
        ticketsSold: soldById.get(competition.id) ?? 0,
        maxTickets: finiteNumber(competition.total_tickets),
        maxEntriesPerUser: maxEntriesPerUser > 0 ? maxEntriesPerUser : 100,
        maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
        cashAlternative: finiteNullableNumber(competition.cash_alternative),
        estimatedPrizeValue: finiteNullableNumber(competition.prize_value),
        valuationSource: competition.prize_value ? "site_estimate" : null,
        valuationConfidence: competition.prize_value ? "high" : null,
        valuationNotes: competition.prize_value ? "Site exposes explicit prize value." : null,
        drawDate: competition.end_date,
        isAutoDraw: competition.draw_type === "auto",
        categories: [],
        scrapedAt: now,
      };
    });
  }

  private async fetchCompetitions(): Promise<InItToWinItCompetition[]> {
    const params = new URLSearchParams({
      select: [
        "id",
        "title",
        "slug",
        "ticket_price",
        "total_tickets",
        "max_tickets_per_customer",
        "end_date",
        "prize_value",
        "cash_alternative",
        "draw_type",
        "vip_only",
        "app_only",
        "status",
      ].join(","),
      status: "eq.live",
      order: "created_at.desc",
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/competitions?${params.toString()}`, {
      headers: supabaseHeaders(),
    });
    if (!response.ok) {
      throw new Error(
        `[In It To Win It] Failed to fetch competitions: ${response.status}`,
      );
    }

    const competitions = await response.json() as InItToWinItCompetition[];
    return competitions.filter((competition) =>
      competition.status === "live" &&
      !competition.vip_only &&
      !competition.app_only &&
      finiteNumber(competition.ticket_price) > 0 &&
      finiteNumber(competition.total_tickets) > 0 &&
      typeof competition.slug === "string" &&
      competition.slug.length > 0,
    );
  }

  private async fetchSoldTicketCount(competitionId: string): Promise<number> {
    const params = new URLSearchParams({
      competition_id: `eq.${competitionId}`,
      status: "eq.sold",
      select: "id",
    });

    const response = await fetch(`${SUPABASE_URL}/rest/v1/tickets?${params.toString()}`, {
      headers: {
        ...supabaseHeaders(),
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    if (!response.ok) {
      throw new Error(
        `[In It To Win It] Failed to count sold tickets for ${competitionId}: ${response.status}`,
      );
    }

    return parseExactCount(response.headers.get("content-range"));
  }
}

function supabaseHeaders(): HeadersInit {
  const anonKey = requireSiteKey("INITTOWINIT_SUPABASE_ANON_KEY");
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  };
}

export function parseExactCount(contentRange: string | null): number {
  if (!contentRange) return 0;
  const count = contentRange.split("/")[1];
  return finiteNumber(count);
}

function finiteNumber(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function finiteNullableNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number > 0 ? number : null;
}
