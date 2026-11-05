import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { Click12WinSiteConfig } from "./click12win-site-config.js";

interface Click12WinResponse {
  success?: boolean;
  data?: Click12WinCompetition[];
}

interface Click12WinCompetition {
  id?: string | number | null;
  title?: string | null;
  displayTitle?: string | null;
  slug?: string | null;
  status?: string | null;
  pricePerTicket?: string | number | null;
  pricing?: {
    currentPrice?: string | number | null;
  } | null;
  endDate?: string | null;
  maxTickets?: string | number | null;
  ticketsSold?: string | number | null;
  maxTicketsPerUser?: string | number | null;
  maxTicketsPerOrder?: string | number | null;
  cashAlternative?: string | number | null;
  mainPrizeCost?: string | number | null;
  category?: string | null;
}

export class Click12WinAdapter implements SiteAdapter {
  readonly siteName: string;

  constructor(private readonly config: Click12WinSiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(`${this.config.apiBaseUrl}/competitions`, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.config.userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(
        `[${this.config.displayName}] Failed to fetch competitions: ${response.status}`,
      );
    }

    const payload = (await response.json()) as Click12WinResponse;
    if (!payload.success || !Array.isArray(payload.data)) {
      throw new Error(`[${this.config.displayName}] Invalid API response`);
    }

    const scrapedAt = new Date().toISOString();
    return payload.data
      .map((competition) => mapCompetition(this.config, competition, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

function mapCompetition(
  config: Click12WinSiteConfig,
  competition: Click12WinCompetition,
  scrapedAt: string,
): RawCompetition | null {
  if (String(competition.status ?? "").toUpperCase() !== "ACTIVE") return null;

  const sourceId = String(competition.slug ?? competition.id ?? "").trim();
  const name = String(competition.displayTitle ?? competition.title ?? "").trim();
  const maxTickets = integerFromUnknown(competition.maxTickets);
  const ticketsSold = integerFromUnknown(competition.ticketsSold);
  const entryPrice =
    numberFromUnknown(competition.pricing?.currentPrice) ||
    numberFromUnknown(competition.pricePerTicket);
  const drawDate = parseDate(competition.endDate);

  if (
    !sourceId ||
    !name ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null ||
    (entryPrice <= 0 && !/\bfree\b/i.test(name))
  ) {
    return null;
  }

  const cashAlternative = positiveNumberOrNull(competition.cashAlternative);
  const estimatedPrizeValue =
    cashAlternative === null ? positiveNumberOrNull(competition.mainPrizeCost) : null;
  const category = competition.category?.trim().toLowerCase();
  const maxEntriesPerUser =
    integerFromUnknown(competition.maxTicketsPerUser) ||
    integerFromUnknown(competition.maxTicketsPerOrder);

  return {
    sourceId,
    siteName: config.siteName,
    url: `${config.baseUrl}/competitions/${sourceId}`,
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
      estimatedPrizeValue !== null ? `${config.displayName} public API mainPrizeCost` : null,
    drawDate,
    isAutoDraw: false,
    categories: category ? [category] : [],
    scrapedAt,
  };
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function integerFromUnknown(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function numberFromUnknown(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumberOrNull(value: unknown): number | null {
  const parsed = numberFromUnknown(value);
  return parsed > 0 ? parsed : null;
}
