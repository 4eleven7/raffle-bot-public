import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://aurumcomps.uk";

interface AurumCompetition {
  id?: number | string;
  title?: string;
  description?: string;
  category?: string;
  price?: number;
  totalTickets?: number;
  ticketsSold?: number;
  endDate?: string;
  isActive?: boolean;
  type?: string;
  maxTicketsPerPerson?: number | null;
}

export class AurumCompetitionsAdapter implements SiteAdapter {
  readonly siteName = "aurumcomps";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/api/competitions`, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    if (!response.ok) {
      throw new Error(`[Aurum Competitions UK] Failed to fetch competitions: ${response.status}`);
    }

    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) return [];

    const scrapedAt = new Date().toISOString();
    return payload
      .map((value) => mapCompetition(value as AurumCompetition, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

function mapCompetition(
  competition: AurumCompetition,
  scrapedAt: string,
): RawCompetition | null {
  const sourceId = String(competition.id ?? "").trim();
  const name = String(competition.title ?? "").trim();
  const pricePence = finiteNumber(competition.price);
  const maxTickets = positiveInteger(competition.totalTickets);
  const ticketsSold = finiteNumber(competition.ticketsSold);
  const drawDate = normalizeDate(competition.endDate);
  if (
    !sourceId ||
    !name ||
    pricePence < 0 ||
    !maxTickets ||
    ticketsSold < 0 ||
    ticketsSold >= maxTickets ||
    !drawDate ||
    competition.isActive === false
  ) {
    return null;
  }

  const entryPrice = pricePence / 100;
  const estimate = estimateBullionPrize(name);
  const categories = [String(competition.category ?? "").trim().toLowerCase()]
    .filter(Boolean);
  if (competition.type === "instant_win") categories.push("instant-win");

  return {
    sourceId,
    siteName: "aurumcomps",
    url: `${BASE_URL}/competition/${sourceId}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: positiveInteger(competition.maxTicketsPerPerson) ?? 100,
    maxEntriesPerUserSource: positiveInteger(competition.maxTicketsPerPerson) !== null
      ? "site"
      : "fallback",
    cashAlternative: null,
    estimatedPrizeValue: estimate?.value ?? null,
    valuationSource: estimate ? "manual_estimate" : null,
    valuationConfidence: estimate ? "medium" : null,
    valuationNotes: estimate?.notes ?? null,
    drawDate,
    isAutoDraw: competition.type === "instant_win",
    categories: [...new Set(categories)],
    scrapedAt,
  };
}

function estimateBullionPrize(name: string): { value: number; notes: string } | null {
  const normalized = name.toLowerCase();
  if (/^2\.5\s*g\b.*gold/.test(normalized)) {
    return {
      value: 309,
      notes: "Manual retail estimate for a 2.5g PAMP gold bar; refresh as bullion prices move.",
    };
  }
  if (/^5\s*g\b.*gold/.test(normalized)) {
    return {
      value: 560,
      notes: "Manual retail estimate for a 5g PAMP gold bar; refresh as bullion prices move.",
    };
  }
  if (/^1\s*g\b.*gold/.test(normalized)) {
    return {
      value: 126,
      notes: "Manual retail estimate for a 1g gold bar; refresh as bullion prices move.",
    };
  }
  return null;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finiteNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function positiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}
