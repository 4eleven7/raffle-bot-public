import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { requireSiteKey } from "../site-keys.js";

const SITE_NAME = "techdrop";
const BASE_URL = "https://tech-drop.com";
const SUPABASE_URL = "https://zkmsnobxmgsbfdrsrkts.supabase.co";

interface TechDropTicketPool {
  assigned_count?: number | null;
  total_tickets?: number | null;
}

interface TechDropDrop {
  id?: string;
  name?: string | null;
  value?: number | null;
  ticket_price?: number | null;
  ticket_limit?: number | null;
  draw_date?: string | null;
  closing_date?: string | null;
  raffle_type?: string | null;
  max_tickets?: number | null;
  ticket_pools?: TechDropTicketPool | TechDropTicketPool[] | null;
}

export class TechDropAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const anonKey = requireSiteKey("TECHDROP_SUPABASE_ANON_KEY");
    const now = new Date().toISOString();
    const url = new URL(`${SUPABASE_URL}/rest/v1/drops`);
    url.searchParams.set(
      "select",
      "*,ticket_pools!drop_id(assigned_count,total_tickets)",
    );
    url.searchParams.set("raffle_type", "in.(hero,normal,free)");
    url.searchParams.set("is_active", "eq.true");
    url.searchParams.set("is_manually_closed", "eq.false");
    url.searchParams.set("closing_date", `gte.${now}`);
    url.searchParams.set("order", "display_order.asc");

    const response = await fetch(url, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[Tech Drop] Failed to fetch ${url}: ${response.status}`);
    }

    const drops = (await response.json()) as TechDropDrop[];
    return drops.map((drop) => this.toCompetition(drop, now)).filter(isCompetition);
  }

  private toCompetition(drop: TechDropDrop, scrapedAt: string): RawCompetition | null {
    if (!drop.id || !drop.name) return null;

    const ticketPool = Array.isArray(drop.ticket_pools)
      ? drop.ticket_pools[0]
      : drop.ticket_pools;
    const maxTickets = numberFromUnknown(ticketPool?.total_tickets) || numberFromUnknown(drop.max_tickets);
    const ticketsSold = numberFromUnknown(ticketPool?.assigned_count);
    const entryPrice = numberFromUnknown(drop.ticket_price);
    const operatorValue = numberFromUnknown(drop.value);
    const isCashPrize = /\bcash\b/i.test(drop.name);
    const siteMaxEntriesPerUser = numberFromUnknown(drop.ticket_limit);
    if (maxTickets <= 0) return null;

    return {
      sourceId: drop.id,
      siteName: SITE_NAME,
      url: `${BASE_URL}/enter/${encodeURIComponent(drop.id)}`,
      name: drop.name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: siteMaxEntriesPerUser || 100,
      maxEntriesPerUserSource: siteMaxEntriesPerUser > 0 ? "site" : "fallback",
      cashAlternative: isCashPrize && operatorValue > 0 ? operatorValue : null,
      ...(!isCashPrize && operatorValue > 0
        ? {
            estimatedPrizeValue: operatorValue,
            valuationSource: "site_estimate" as const,
            valuationConfidence: "medium" as const,
            valuationNotes: "Operator supplied prize value",
          }
        : {}),
      drawDate: drop.closing_date ?? drop.draw_date ?? null,
      isAutoDraw: false,
      categories: [String(drop.raffle_type ?? "raffle")],
      scrapedAt,
    };
  }
}

function numberFromUnknown(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isCompetition(value: RawCompetition | null): value is RawCompetition {
  return value !== null;
}
