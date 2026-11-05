import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "pmcompetitions";
const BASE_URL = "https://pmcompetitions.co.uk";
const API_URL = `${BASE_URL}/api/competitions?status=active&page=1`;

type ApiCompetition = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  status?: unknown;
  ticket_price?: unknown;
  total_tickets?: unknown;
  tickets_sold?: unknown;
  draw_date?: unknown;
  description?: unknown;
  prize_value?: unknown;
  cash_alternative?: unknown;
  is_instant_win?: unknown;
  max_tickets_per_order?: unknown;
};

export class PMCompetitionsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(API_URL, {
      headers: {
        Accept: "application/json",
        "User-Agent": "raffle-bot/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`PM Competitions API failed: ${response.status}`);
    }

    const payload = (await response.json()) as { data?: unknown };
    if (!Array.isArray(payload.data)) return [];

    return payload.data
      .map((value) => parsePMCompetition(value))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

export function parsePMCompetition(value: unknown): RawCompetition | null {
  if (!value || typeof value !== "object") return null;
  const item = value as ApiCompetition;
  const id = stringValue(item.id);
  const slug = stringValue(item.slug);
  const name = stringValue(item.name);
  const status = stringValue(item.status).toLowerCase();
  const entryPrice = numberValue(item.ticket_price);
  const maxTickets = numberValue(item.total_tickets);
  const ticketsSold = numberValue(item.tickets_sold);
  const drawDate = parseDate(item.draw_date);
  if (
    !id ||
    !slug ||
    !name ||
    status !== "active" ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null ||
    new Date(drawDate).getTime() <= Date.now()
  ) {
    return null;
  }

  const description = stringValue(item.description);
  const cashAlternative =
    numberValue(item.cash_alternative) ||
    extractCashAlternative(`${name} ${description}`);
  const prizeValue = numberValue(item.prize_value);
  const maxEntriesPerUser = numberValue(item.max_tickets_per_order);

  return {
    sourceId: slug,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competitions/${slug}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    estimatedPrizeValue:
      cashAlternative > 0 ? null : prizeValue > 0 ? prizeValue : null,
    valuationSource: cashAlternative > 0 ? "cash" : prizeValue > 0 ? "site_estimate" : null,
    valuationConfidence: cashAlternative > 0 ? "high" : prizeValue > 0 ? "medium" : null,
    valuationNotes:
      cashAlternative > 0
        ? "Explicit cash prize or cash alternative"
        : prizeValue > 0
          ? "PM Competitions API prize value"
          : null,
    drawDate,
    isAutoDraw: item.is_instant_win === true,
    categories: cashAlternative > 0 ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  };
}

function extractCashAlternative(text: string): number {
  const match =
    text.match(/(?:or|cash\s+alternative|cash)\s*[:=]?\s*£\s*([\d,.]+)/i) ||
    text.match(/£\s*([\d,.]+)\s*(?:cash|tax[-\s]*free)/i);
  if (!match) return 0;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function parseDate(value: unknown): string | null {
  const date = new Date(stringValue(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
