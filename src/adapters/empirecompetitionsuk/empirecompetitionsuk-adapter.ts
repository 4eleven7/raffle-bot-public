import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "empirecompetitionsuk";
const BASE_URL = "https://empirecompetitionsuk.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

interface EmpireRecord {
  id: string;
  slug: string;
  title: string;
  ticketPrice: number;
  totalTickets: number;
  ticketsSold: number;
  ticketsRemaining: number;
  drawDate: string | null;
  endDate: string | null;
  status: string;
  prizeValue: number;
  category: string;
}

export class EmpireCompetitionsUkAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: requestSignal(signal),
    });

    if (!response.ok) {
      throw new Error(`[Empire Competitions UK] Failed to fetch homepage: ${response.status}`);
    }

    return parseEmpireCompetitions(await response.text());
  }
}

export function parseEmpireCompetitions(
  html: string,
  now = new Date(),
): RawCompetition[] {
  const scrapedAt = now.toISOString();
  return extractRecords(html)
    .map((record) => mapRecord(record, scrapedAt, now))
    .filter((competition): competition is RawCompetition => competition !== null);
}

function extractRecords(html: string): EmpireRecord[] {
  const starts = Array.from(html.matchAll(/\{id:"[^"]+",slug:"[^"]+"/g))
    .map((match) => match.index ?? -1)
    .filter((index) => index >= 0);

  return starts
    .map((start, index) => parseRecord(html.slice(start, starts[index + 1] ?? html.length)))
    .filter((record): record is EmpireRecord => record !== null);
}

function parseRecord(chunk: string): EmpireRecord | null {
  const id = stringField(chunk, "id");
  const slug = stringField(chunk, "slug");
  const title = stringField(chunk, "title");
  const status = stringField(chunk, "status");
  const category = stringField(chunk, "category") ?? "";
  const ticketPrice = numberField(chunk, "ticket_price");
  const totalTickets = numberField(chunk, "total_tickets");
  const ticketsSold = numberField(chunk, "tickets_sold");
  const ticketsRemaining = numberField(chunk, "tickets_remaining");
  const prizeValue = parseMoney(stringField(chunk, "prize_value"));

  if (
    !id ||
    !slug ||
    !title ||
    !status ||
    ticketPrice === null ||
    totalTickets === null ||
    ticketsSold === null ||
    ticketsRemaining === null ||
    prizeValue === null
  ) {
    return null;
  }

  return {
    id,
    slug,
    title,
    ticketPrice,
    totalTickets,
    ticketsSold,
    ticketsRemaining,
    drawDate: stringField(chunk, "draw_date"),
    endDate: stringField(chunk, "end_date"),
    status,
    prizeValue,
    category,
  };
}

function mapRecord(
  record: EmpireRecord,
  scrapedAt: string,
  now: Date,
): RawCompetition | null {
  const endDate = parseDate(record.endDate) ?? parseDate(record.drawDate);
  if (
    record.status.toLowerCase() !== "live" ||
    record.ticketPrice <= 0 ||
    !Number.isInteger(record.totalTickets) ||
    !Number.isInteger(record.ticketsSold) ||
    !Number.isInteger(record.ticketsRemaining) ||
    record.totalTickets <= 0 ||
    record.ticketsSold < 0 ||
    record.ticketsSold >= record.totalTickets ||
    record.ticketsRemaining !== record.totalTickets - record.ticketsSold ||
    record.prizeValue <= 0 ||
    endDate === null ||
    new Date(endDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const isCashPrize = /\bcash\b/i.test(record.title) || record.category.toLowerCase() === "cash";

  return {
    sourceId: record.id,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competitions/${record.slug}`,
    name: record.title,
    entryPrice: record.ticketPrice,
    ticketsSold: record.ticketsSold,
    maxTickets: record.totalTickets,
    inventorySource: "exact",
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: isCashPrize ? record.prizeValue : null,
    estimatedPrizeValue: isCashPrize ? null : record.prizeValue,
    valuationSource: isCashPrize ? "cash" : "site_estimate",
    valuationConfidence: "high",
    valuationNotes: "Empire Competitions UK public prize value.",
    drawDate: endDate,
    isAutoDraw: false,
    categories: record.category ? [record.category.toLowerCase()] : [],
    scrapedAt,
  };
}

function stringField(chunk: string, field: string): string | null {
  const match = chunk.match(new RegExp(`${field}:"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return null;

  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1] ?? null;
  }
}

function numberField(chunk: string, field: string): number | null {
  const match = chunk.match(new RegExp(`${field}:(-?\\d+(?:\\.\\d+)?)(?:,|})`));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function parseMoney(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(15_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
