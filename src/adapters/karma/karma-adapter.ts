import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "karmacompetitions";
const DISPLAY_NAME = "Karma Competitions";
const BASE_URL = "https://karmacompetitions.co.uk";
const LIST_PATH = "/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface KarmaPage {
  props?: {
    competitions?: KarmaCollection<KarmaCompetition>;
  };
}

interface KarmaCollection<T> {
  data?: T[];
}

interface KarmaCategory {
  name?: string | null;
}

interface KarmaCompetition {
  id?: number | string | null;
  name?: string | null;
  slug?: string | null;
  status?: string | null;
  price?: number | string | null;
  sale_price?: number | string | null;
  cash_alt?: number | string | null;
  is_cash_alt?: boolean | null;
  main_prize_type?: string | null;
  end_prize_value?: number | string | null;
  total_tickets?: number | string | null;
  available_tickets?: number | string | null;
  sold?: number | string | null;
  sold_live?: number | string | null;
  max_tickets?: number | string | null;
  max_tickets_per_order?: number | string | null;
  draw?: string | null;
  end?: string | null;
  auto_draw?: boolean | null;
  categories?: KarmaCollection<KarmaCategory> | KarmaCategory[] | null;
  game_type_name?: string | null;
}

export class KarmaAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await fetchText(new URL(LIST_PATH, BASE_URL).toString());
    const competitions = parseCompetitions(html);
    const scrapedAt = new Date().toISOString();

    return competitions
      .map((competition) => mapCompetition(competition, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

function parseCompetitions(html: string): KarmaCompetition[] {
  const $ = cheerio.load(html);
  const dataPage = $("#app").attr("data-page");
  if (!dataPage) return [];

  try {
    const page = JSON.parse(dataPage) as KarmaPage;
    return Array.isArray(page.props?.competitions?.data) ? page.props.competitions.data : [];
  } catch {
    return [];
  }
}

function mapCompetition(comp: KarmaCompetition, scrapedAt: string): RawCompetition | null {
  const sourceId = String(comp.slug ?? comp.id ?? "").trim();
  const name = String(comp.name ?? "").trim();
  const status = String(comp.status ?? "").trim().toLowerCase();
  if (!sourceId || !name || status !== "active") return null;

  const maxTickets =
    positiveInteger(comp.total_tickets) ??
    positiveInteger(sumNumbers(comp.sold_live ?? comp.sold, comp.available_tickets)) ??
    null;
  if (!maxTickets || maxTickets <= 0) return null;

  const ticketsSold = finiteNumber(comp.sold_live ?? comp.sold);
  if (ticketsSold >= maxTickets) return null;

  const price = finiteNumber(comp.price);
  const salePrice = finiteNumber(comp.sale_price);
  const entryPrice = salePrice > 0 && salePrice < price ? salePrice : price;
  if (entryPrice <= 0) return null;

  const prizeValue = positiveNumber(comp.end_prize_value);
  const cashAlternative = extractCashAlternative(comp, prizeValue);
  const drawDate = normalizeDate(comp.draw ?? comp.end);
  if (!drawDate) return null;
  const explicitMaxEntriesPerUser = positiveInteger(comp.max_tickets_per_order);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competitions/${sourceId}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser:
      explicitMaxEntriesPerUser ?? positiveInteger(comp.max_tickets) ?? 100,
    maxEntriesPerUserSource: explicitMaxEntriesPerUser === null ? "fallback" : "site",
    cashAlternative,
    ...(prizeValue !== null && cashAlternative === null
      ? {
          estimatedPrizeValue: prizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: "Karma Competitions public end_prize_value",
        }
      : {}),
    drawDate,
    isAutoDraw: comp.auto_draw === true,
    categories: buildCategories(comp),
    scrapedAt,
  };
}

function extractCashAlternative(
  comp: KarmaCompetition,
  prizeValue: number | null,
): number | null {
  const cashAlt = positiveNumber(comp.cash_alt);
  if (cashAlt !== null) return cashAlt;

  const prizeType = String(comp.main_prize_type ?? "").toLowerCase();
  if (prizeValue !== null && prizeType.includes("cash")) return prizeValue;
  return null;
}

function buildCategories(comp: KarmaCompetition): string[] {
  const categoryNames = Array.isArray(comp.categories)
    ? comp.categories.map((category) => category.name)
    : comp.categories?.data?.map((category) => category.name) ?? [];

  return [...categoryNames, comp.game_type_name]
    .map((category) => String(category ?? "").trim().toLowerCase())
    .filter((category, index, categories) =>
      category.length > 0 && categories.indexOf(category) === index,
    );
}

function fetchText(url: string): Promise<string> {
  return fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${url}: ${response.status}`);
    }
    return response.text();
  });
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value.trim().replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sumNumbers(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
): number | null {
  const first = numericValue(a);
  const second = numericValue(b);
  if (first === null || second === null) return null;
  return first + second;
}

function positiveNumber(value: number | string | null | undefined): number | null {
  const parsed = numericValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function positiveInteger(value: number | string | null | undefined): number | null {
  const parsed = positiveNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}

function finiteNumber(value: number | string | null | undefined): number {
  return numericValue(value) ?? 0;
}

function numericValue(value: number | string | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}
