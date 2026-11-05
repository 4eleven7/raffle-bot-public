import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "winnerstreak";
const DISPLAY_NAME = "The Winner Streak";
const BASE_URL = "https://www.thewinnerstreak.com";
const API_URL = `${BASE_URL}/api/raffles`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface WinnerStreakCategory {
  name?: string | null;
}

interface WinnerStreakImage {
  url?: string | null;
}

interface WinnerStreakCompetition {
  id?: string | number | null;
  image?: WinnerStreakImage | null;
  title?: string | null;
  slug?: string | null;
  description?: string | null;
  numberOfTickets?: string | number | null;
  maxTicketsPerUser?: string | number | null;
  defaultTicketQuantity?: string | number | null;
  cashAlternative?: string | number | null;
  startDate?: string | null;
  endDate?: string | null;
  drawDate?: string | null;
  price?: string | number | null;
  ticketsSold?: string | number | null;
  instantWinsCount?: string | number | null;
  status?: string | null;
  autoDraw?: boolean | null;
  showEntries?: string | null;
  prizeValue?: string | number | null;
  categories?: WinnerStreakCategory[] | null;
}

interface WinnerStreakPage {
  data?: WinnerStreakCompetition[];
  meta?: {
    current_page?: number | null;
    last_page?: number | null;
  } | null;
}

export class WinnerStreakAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const scrapedAt = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    let page = 1;

    while (true) {
      const payload = await fetchPage(page);
      const rows = payload.data ?? [];
      for (const row of rows) {
        const competition = toCompetition(row, scrapedAt);
        if (competition) competitions.push(competition);
      }

      const lastPage = positiveInteger(payload.meta?.last_page) ?? page;
      if (rows.length === 0 || page >= lastPage) break;
      page += 1;
    }

    return competitions;
  }
}

export function toCompetition(
  row: WinnerStreakCompetition,
  scrapedAt: string,
): RawCompetition | null {
  const sourceId = cleanText(String(row.slug ?? row.id ?? ""));
  const name = cleanText(row.title ?? "");
  const status = cleanText(row.status ?? "").toLowerCase();
  if (!sourceId || !name || status !== "live") return null;

  const entryPrice = penceToPounds(row.price) ?? 0;
  if (entryPrice <= 0 && !/\bfree\b/i.test(name)) return null;

  const maxTickets = positiveInteger(row.numberOfTickets);
  const ticketsSold = integerFromUnknown(row.ticketsSold);
  const drawDate = normalizeDate(row.drawDate ?? row.endDate);
  if (!maxTickets || ticketsSold < 0 || ticketsSold >= maxTickets || drawDate === null) {
    return null;
  }

  const cashAlternative = penceToPounds(row.cashAlternative);
  const prizeValue = penceToPounds(row.prizeValue);
  const hasSiteEstimate = prizeValue !== null && cashAlternative === null;
  const maxEntriesPerUser = positiveInteger(row.maxTicketsPerUser);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/raffles/${encodeURIComponent(sourceId)}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser ?? 100,
    maxEntriesPerUserSource: maxEntriesPerUser === null ? "fallback" : "site",
    cashAlternative,
    ...(hasSiteEstimate
      ? {
          estimatedPrizeValue: prizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: `${DISPLAY_NAME} public API prizeValue.`,
        }
      : {}),
    drawDate,
    isAutoDraw: row.autoDraw === true,
    categories: buildCategories(row, entryPrice),
    scrapedAt,
  };
}

async function fetchPage(page: number): Promise<WinnerStreakPage> {
  const url = new URL(API_URL);
  url.searchParams.set("status", "live");
  url.searchParams.set("perPage", "25");
  url.searchParams.set("orderBy", "end_date");
  url.searchParams.set("page", String(page));

  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${url}: ${response.status}`);
  }

  const payload = (await response.json()) as WinnerStreakPage;
  if (!Array.isArray(payload.data)) {
    throw new Error(`[${DISPLAY_NAME}] Invalid API response`);
  }

  return payload;
}

function buildCategories(row: WinnerStreakCompetition, entryPrice: number): string[] {
  const categoryNames = row.categories?.map((category) => category.name) ?? [];
  return [
    ...categoryNames,
    positiveInteger(row.instantWinsCount) ? "instant wins" : null,
    entryPrice === 0 ? "free" : null,
  ]
    .map((category) => cleanText(String(category ?? "")).toLowerCase())
    .filter((category, index, categories) =>
      category.length > 0 && categories.indexOf(category) === index,
    );
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function penceToPounds(value: string | number | null | undefined): number | null {
  const pence = positiveNumber(value);
  return pence === null ? null : pence / 100;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}

function positiveNumber(value: unknown): number | null {
  const parsed = numberFromUnknown(value);
  return parsed > 0 ? parsed : null;
}

function integerFromUnknown(value: unknown): number {
  const parsed = numberFromUnknown(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function numberFromUnknown(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
