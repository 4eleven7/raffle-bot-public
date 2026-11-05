import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "bullpen";
const DISPLAY_NAME = "Bullpen Competitions";
const BASE_URL = "https://bullpencompetitions.com";
const API_URL = `${BASE_URL}/api/comps`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface BullpenCompetition {
  id?: string;
  name?: string;
  price?: number | string | null;
  salePrice?: number | string | null;
  soldCount?: number | string | null;
  totalTickets?: number | string | null;
  closeAt?: number | string | null;
  drawAt?: number | string | null;
  cashAlt?: number | string | null;
  prizeValue?: number | string | null;
  maxPerUser?: number | string | null;
  status?: string | null;
  hidden?: boolean | null;
  isWeeklyFree?: boolean | null;
  drawType?: string | null;
  category?: string | null;
  categories?: string[] | null;
  description?: string | null;
}

interface BullpenResponse {
  comps?: BullpenCompetition[];
}

export class BullpenAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(API_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${API_URL}: ${response.status}`);
    }

    const payload = await response.json() as BullpenResponse;
    const scrapedAt = new Date().toISOString();
    return (payload.comps ?? [])
      .map((competition) => mapCompetition(competition, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

function mapCompetition(
  competition: BullpenCompetition,
  scrapedAt: string,
): RawCompetition | null {
  const sourceId = cleanText(competition.id ?? "");
  const name = cleanText(competition.name ?? "");
  if (!sourceId || !name) return null;
  if (competition.status && competition.status.toLowerCase() !== "open") return null;
  if (competition.hidden === true || competition.isWeeklyFree === true) return null;

  const entryPrice = positiveNumber(competition.salePrice) ?? positiveNumber(competition.price);
  const ticketsSold = nonNegativeNumber(competition.soldCount);
  const maxTickets = positiveNumber(competition.totalTickets);
  const drawDate = unixSecondsToIso(competition.closeAt) ?? unixSecondsToIso(competition.drawAt);
  if (entryPrice === null || maxTickets === null || ticketsSold === null || ticketsSold >= maxTickets || drawDate === null) {
    return null;
  }

  const cashAlternative =
    parseMoney(competition.cashAlt) ??
    extractCashAlternative(competition.description ?? "");
  const prizeValue = positiveNumber(competition.prizeValue);
  const categories = [
    ...(competition.categories ?? []),
    competition.category ?? "",
    competition.drawType ?? "",
  ]
    .map((category) => cleanText(category).toLowerCase())
    .filter((category, index, all) => category && all.indexOf(category) === index);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/comp?id=${encodeURIComponent(sourceId)}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    drawUsesFullTicketRange: true,
    maxEntriesPerUser: positiveInteger(competition.maxPerUser) ?? 100,
    maxEntriesPerUserSource: positiveInteger(competition.maxPerUser) !== null ? "site" : "fallback",
    cashAlternative,
    ...(cashAlternative === null && prizeValue !== null
      ? {
          estimatedPrizeValue: prizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: "Bullpen public competitions API prize value.",
        }
      : {}),
    drawDate,
    isAutoDraw: competition.drawType?.toLowerCase() === "auto",
    categories,
    scrapedAt,
  };
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/cash\s+alternative\s+of\s+£\s*([\d,.]+)\s*/i) ??
    text.match(/cash\s+alternative\s*[:\-]?\s*£\s*([\d,.]+)/i);
  return match ? parseMoney(match[1]) : null;
}

function parseMoney(value: number | string | null | undefined): number | null {
  const text = String(value ?? "").replace(/,/g, "");
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveNumber(value: number | string | null | undefined): number | null {
  const number = parseMoney(value);
  return number !== null && number > 0 ? number : null;
}

function nonNegativeNumber(value: number | string | null | undefined): number | null {
  const number = parseMoney(value);
  if (number !== null) return number;
  return String(value ?? "").trim() === "0" ? 0 : null;
}

function positiveInteger(value: number | string | null | undefined): number | null {
  const number = positiveNumber(value);
  return number === null ? null : Math.floor(number);
}

function unixSecondsToIso(value: number | string | null | undefined): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
