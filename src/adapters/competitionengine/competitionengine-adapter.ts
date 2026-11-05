import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { CompetitionEngineSiteConfig } from "./competitionengine-site-config.js";

interface CompetitionEnginePage {
  props?: {
    competitions?: CompetitionEngineCompetition[] | CompetitionEngineCollection<CompetitionEngineCompetition>;
    featuredCompetitions?: CompetitionEngineCollection<CompetitionEngineCompetition>;
  };
}

interface CompetitionEngineCollection<T> {
  data?: T[];
}

interface CompetitionEngineCategory {
  name?: string | null;
}

interface CompetitionEngineCompetition {
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
  remaining_tickets?: number | string | null;
  sold?: number | string | null;
  sold_live?: number | string | null;
  max_tickets?: number | string | null;
  max_tickets_per_order?: number | string | null;
  draw?: string | null;
  end?: string | null;
  auto_draw?: boolean | null;
  instant_wins?: boolean | null;
  has_instant_wins?: boolean | null;
  categories?: CompetitionEngineCollection<CompetitionEngineCategory> | CompetitionEngineCategory[] | null;
  game_type_name?: string | null;
}

export class CompetitionEngineAdapter implements SiteAdapter {
  readonly siteName: string;

  constructor(private readonly config: CompetitionEngineSiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await fetchText(this.config);
    const competitions = parseCompetitions(html);
    const scrapedAt = new Date().toISOString();

    return competitions
      .map((competition) => mapCompetition(this.config, competition, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

function parseCompetitions(html: string): CompetitionEngineCompetition[] {
  const $ = cheerio.load(html);
  const dataPage = $("#app").attr("data-page");
  if (!dataPage) return [];

  try {
    const page = JSON.parse(dataPage) as CompetitionEnginePage;
    const directCompetitions = normalizeCompetitionList(page.props?.competitions);
    if (directCompetitions.length > 0) return directCompetitions;
    return normalizeCompetitionList(page.props?.featuredCompetitions);
  } catch {
    return [];
  }
}

function normalizeCompetitionList(
  value:
    | CompetitionEngineCompetition[]
    | CompetitionEngineCollection<CompetitionEngineCompetition>
    | undefined,
): CompetitionEngineCompetition[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
}

function mapCompetition(
  config: CompetitionEngineSiteConfig,
  comp: CompetitionEngineCompetition,
  scrapedAt: string,
): RawCompetition | null {
  const sourceId = String(comp.slug ?? comp.id ?? "").trim();
  const name = String(comp.name ?? "").trim();
  const status = String(comp.status ?? "").trim().toLowerCase();
  if (!sourceId || !name || status !== "active") return null;

  const maxTickets =
    positiveInteger(comp.total_tickets) ??
    positiveInteger(sumNumbers(comp.sold_live ?? comp.sold, comp.remaining_tickets ?? comp.available_tickets)) ??
    null;
  if (!maxTickets || maxTickets <= 0) return null;

  const ticketsSold = finiteNumber(comp.sold_live ?? comp.sold);
  if (ticketsSold >= maxTickets) return null;

  const price = finiteNumber(comp.price);
  const salePrice = finiteNumber(comp.sale_price);
  const entryPrice = salePrice > 0 && salePrice < price ? salePrice : price;
  if (entryPrice <= 0 && !/\bfree\b/i.test(name)) return null;

  const prizeValue = positiveNumber(comp.end_prize_value);
  const cashAlternative = extractCashAlternative(comp, prizeValue);
  const drawDate = normalizeDate(comp.draw ?? comp.end);
  if (!drawDate) return null;
  const categories = buildCategories(comp);
  if (entryPrice === 0 && /\bfree\b/i.test(name) && !categories.includes("free")) {
    categories.push("free");
  }

  return {
    sourceId,
    siteName: config.siteName,
    url: `${config.baseUrl}/competitions/${sourceId}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser:
      positiveInteger(comp.max_tickets_per_order) ?? positiveInteger(comp.max_tickets) ?? 100,
    maxEntriesPerUserSource:
      positiveInteger(comp.max_tickets_per_order) !== null || positiveInteger(comp.max_tickets) !== null
        ? "site"
        : "fallback",
    cashAlternative,
    ...(prizeValue !== null && cashAlternative === null
      ? {
          estimatedPrizeValue: prizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: `${config.displayName} public end_prize_value`,
        }
      : {}),
    drawDate,
    isAutoDraw: comp.auto_draw === true,
    categories,
    scrapedAt,
  };
}

function extractCashAlternative(
  comp: CompetitionEngineCompetition,
  prizeValue: number | null,
): number | null {
  const cashAlt = positiveNumber(comp.cash_alt);
  if (cashAlt !== null) return cashAlt;

  const prizeType = String(comp.main_prize_type ?? "").toLowerCase();
  if (prizeValue !== null && prizeType.includes("cash")) return prizeValue;
  return null;
}

function buildCategories(comp: CompetitionEngineCompetition): string[] {
  const categoryNames = Array.isArray(comp.categories)
    ? comp.categories.map((category) => category.name)
    : comp.categories?.data?.map((category) => category.name) ?? [];
  const gameType =
    comp.game_type_name?.trim().toLowerCase() === "scratchy" &&
    (comp.instant_wins === false || comp.has_instant_wins === false)
      ? null
      : comp.game_type_name;

  return [...categoryNames, gameType]
    .map((category) => String(category ?? "").trim().toLowerCase())
    .filter((category, index, categories) =>
      category.length > 0 && categories.indexOf(category) === index,
    );
}

async function fetchText(config: CompetitionEngineSiteConfig): Promise<string> {
  const url = new URL(config.listPath, config.baseUrl).toString();
  const response = await fetch(url, {
    headers: {
      "User-Agent": config.userAgent,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`[${config.displayName}] Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
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
