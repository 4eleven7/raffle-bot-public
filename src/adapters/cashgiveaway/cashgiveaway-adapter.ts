import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.cashgiveaway.co.uk";
const API_URL = `${BASE_URL}/api/competitions`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface CashGiveawayCompetition {
  id?: string;
  title?: string;
  title_en?: string | null;
  description?: string | null;
  description_en?: string | null;
  ticketPrice?: number | string | null;
  discountPrice?: number | string | null;
  discountTickets?: number | string | null;
  totalTickets?: number | string | null;
  soldTickets?: number | string | null;
  maxTicketsPerPerson?: number | string | null;
  drawDate?: string | null;
  endDate?: string | null;
  isFreeCompetition?: boolean | null;
  status?: string | null;
  category?: string | null;
}

interface CashGiveawayResponse {
  success?: boolean;
  data?: CashGiveawayCompetition[];
}

export class CashGiveawayAdapter implements SiteAdapter {
  readonly siteName = "cashgiveaway";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(API_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[Cash Giveaway] Failed to fetch competitions: ${response.status}`);
    }

    const payload = await response.json() as CashGiveawayResponse;
    if (!payload.success || !Array.isArray(payload.data)) return [];

    const now = new Date().toISOString();
    return payload.data
      .map((competition) => mapCompetition(competition, now))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

function mapCompetition(
  competition: CashGiveawayCompetition,
  scrapedAt: string,
): RawCompetition | null {
  if (!competition.id) return null;

  const name = cleanText(competition.title_en ?? competition.title ?? "");
  if (!name) return null;
  if (competition.status && !["active", "live"].includes(competition.status.toLowerCase())) {
    return null;
  }

  const maxTickets = finiteNumber(competition.totalTickets);
  const ticketsSold = finiteNumber(competition.soldTickets);
  const drawDate = competition.drawDate ?? competition.endDate ?? null;
  if (maxTickets <= 0 || ticketsSold < 0 || !drawDate) return null;

  const standardPrice = finiteNumber(competition.ticketPrice);
  const discountPrice = finiteNumber(competition.discountPrice);
  const discountTickets = finiteNumber(competition.discountTickets);
  const entryPrice =
    discountPrice > 0 && discountTickets > 0 && ticketsSold < discountTickets
      ? discountPrice
      : standardPrice;
  if (entryPrice <= 0 && competition.isFreeCompetition !== true) return null;

  const text = cleanText([
    competition.title_en,
    competition.title,
    competition.description_en,
    competition.description,
  ].filter(Boolean).join(" "));
  const cashAlternative = extractCashAlternative(text);
  const maxEntriesPerUser = positiveInteger(competition.maxTicketsPerPerson);

  return {
    sourceId: competition.id,
    siteName: "cashgiveaway",
    url: `${BASE_URL}/competition/${competition.id}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser ?? 100,
    maxEntriesPerUserSource: maxEntriesPerUser === null ? "fallback" : "site",
    cashAlternative,
    drawDate,
    isAutoDraw: false,
    categories: buildCategories(competition),
    scrapedAt,
  };
}

function buildCategories(competition: CashGiveawayCompetition): string[] {
  return [
    competition.category,
    competition.isFreeCompetition ? "free" : null,
  ]
    .map((category) => cleanText(String(category ?? "")).toLowerCase())
    .filter((category, index, categories) => category.length > 0 && categories.indexOf(category) === index);
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/\bCASH\s+ALTERNATIVE\s+£\s*([\d,.]+)\s*(k)?/i) ??
    text.match(/\bALTERNATIVA\s+CASH\s+£\s*([\d,.]+)\s*(k)?/i) ??
    text.match(/\bor\s+cash\s+alternative\s+£\s*([\d,.]+)\s*(k)?/i) ??
    text.match(/\bor\s+£\s*([\d,.]+)\s*(k)?\s*(?:cash|tax[\s-]*free)/i) ??
    text.match(/£\s*([\d,.]+)\s*(k)?\s*(?:cash|tax[\s-]*free)/i);
  if (!match) return null;

  const value = finiteNumber(match[1].replace(/,/g, ""));
  if (value <= 0) return null;
  return match[2] ? value * 1000 : value;
}

function finiteNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value: number | string | null | undefined): number | null {
  const parsed = Math.floor(finiteNumber(value));
  return parsed > 0 ? parsed : null;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
