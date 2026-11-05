import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.centralcompetitions.co.uk";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

interface CentralCompetition {
  name?: unknown;
  maxTickets?: unknown;
  price?: unknown;
  remaining?: unknown;
  drawDateISO?: unknown;
  endDateISO?: unknown;
  desc?: unknown;
  cashAlternativeAmount?: unknown;
  prizeValue?: unknown;
}

export class CentralCompetitionsAdapter implements SiteAdapter {
  readonly siteName = "centralcompetitions";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/competitions/get-competitions`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`[Central Competitions] Failed to fetch competitions: ${response.status}`);
    }

    const data = await response.json() as { competitions?: CentralCompetition[] };
    return (data.competitions ?? [])
      .map((competition) => parseCentralCompetition(competition))
      .filter((row): row is RawCompetition => row !== null);
  }
}

export function parseCentralCompetition(
  competition: CentralCompetition,
): RawCompetition | null {
  const name = cleanText(String(competition.name ?? ""));
  const maxTickets = numberFromUnknown(competition.maxTickets);
  const remaining = numberFromUnknown(competition.remaining);
  const entryPrice = numberFromUnknown(competition.price);
  const drawDate =
    isoFromUnknown(competition.drawDateISO) ?? isoFromUnknown(competition.endDateISO);
  if (!name || maxTickets <= 0 || remaining < 0 || remaining > maxTickets || entryPrice <= 0 || drawDate === null) {
    return null;
  }

  return {
    sourceId: slugify(name),
    siteName: "centralcompetitions",
    url: `${BASE_URL}/${slugify(name)}.html`,
    name,
    entryPrice,
    ticketsSold: maxTickets - remaining,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative:
      numberFromUnknown(competition.cashAlternativeAmount) ||
      cashFromTitle(name) ||
      cashFromHtml(String(competition.desc ?? "")),
    estimatedPrizeValue: numberFromUnknown(competition.prizeValue) || null,
    valuationSource: numberFromUnknown(competition.prizeValue) > 0 ? "site_estimate" : null,
    valuationConfidence: numberFromUnknown(competition.prizeValue) > 0 ? "medium" : null,
    drawDate,
    isAutoDraw: /\binstant wins?\b/i.test(`${name} ${competition.desc ?? ""}`),
    categories: /\bcash\b|£/.test(name.toLowerCase()) ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  };
}

function cashFromHtml(html: string): number | null {
  const text = cleanText(cheerio.load(html).text());
  return cashFromTitle(text);
}

function cashFromTitle(text: string): number | null {
  const match = text.match(/£\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2] ? value * 1000 : value;
}

function isoFromUnknown(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = parseFloat(value.replace(/[£,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[£$,]/g, "").replace(/&/g, "and").replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-");
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
