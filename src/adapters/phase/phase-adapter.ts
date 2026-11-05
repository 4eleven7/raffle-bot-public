import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { requireSiteKey } from "../site-keys.js";

const SITE_NAME = "phase";
const DISPLAY_NAME = "Phase Competitions";
const BASE_URL = "https://phasecompetitions.co.uk";
const SUPABASE_URL = "https://dvtxysmxdtjvhmvpnxay.supabase.co";

interface PhaseCompetition {
  id?: string | null;
  title?: string | null;
  slug?: string | null;
  status?: string | null;
  ticket_price?: string | number | null;
  sale_price?: string | number | null;
  tickets_sold?: string | number | null;
  total_tickets?: string | number | null;
  max_per_user?: string | number | null;
  close_date?: string | null;
  scheduled_live_at?: string | null;
  prize_value?: string | number | null;
  auto_draw?: boolean | null;
  category?: string | null;
}

export class PhaseAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const anonKey = requireSiteKey("PHASE_SUPABASE_ANON_KEY");
    const url = new URL("/rest/v1/competitions", SUPABASE_URL);
    url.searchParams.set(
      "select",
      "id,title,slug,status,ticket_price,sale_price,tickets_sold,total_tickets,max_per_user,close_date,scheduled_live_at,prize_value,auto_draw,category",
    );
    url.searchParams.set("status", "eq.live");
    url.searchParams.set("order", "close_date.asc");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch competitions: ${response.status}`);
    }

    const payload = (await response.json()) as PhaseCompetition[];
    const scrapedAt = new Date().toISOString();
    return payload
      .map((competition) => mapCompetition(competition, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

function mapCompetition(
  competition: PhaseCompetition,
  scrapedAt: string,
): RawCompetition | null {
  const sourceId = String(competition.slug ?? competition.id ?? "").trim();
  const name = String(competition.title ?? "").trim();
  const status = String(competition.status ?? "").trim().toLowerCase();
  const maxTickets = integerFromUnknown(competition.total_tickets);
  const ticketsSold = integerFromUnknown(competition.tickets_sold);
  const entryPrice =
    positiveNumber(competition.sale_price) ?? positiveNumber(competition.ticket_price) ?? 0;
  const drawDate = parseIsoDate(competition.close_date ?? competition.scheduled_live_at);

  if (
    !sourceId ||
    !name ||
    status !== "live" ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  const prizeValue = positiveNumber(competition.prize_value);
  const cashAlternative = prizeValue !== null && /\bcash\b/i.test(name) ? prizeValue : null;
  const estimatedPrizeValue = cashAlternative === null ? prizeValue : null;
  const category = competition.category?.trim().toLowerCase();
  const maxEntriesPerUser = integerFromUnknown(competition.max_per_user);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competition/${sourceId}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue,
    valuationSource: estimatedPrizeValue !== null ? "site_estimate" : null,
    valuationConfidence: estimatedPrizeValue !== null ? "medium" : null,
    valuationNotes:
      estimatedPrizeValue !== null ? "Phase public Supabase prize_value" : null,
    drawDate,
    isAutoDraw: competition.auto_draw === true,
    categories: category ? [category] : [],
    scrapedAt,
  };
}

function parseIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = DateTime.fromISO(value, { zone: "Europe/London" });
  return parsed.isValid ? parsed.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function integerFromUnknown(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
