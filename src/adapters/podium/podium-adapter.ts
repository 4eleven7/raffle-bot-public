import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "podiumprize";
const BASE_URL = "https://podiumprize.co.uk";
const COMPETITION_PATHS = ["/competitions/ninja-instant-wins"];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface PodiumPrizeAdapterOptions {
  competitionPaths?: string[];
  now?: () => Date;
}

interface PodiumPage {
  props?: {
    competitions?: PodiumCompetition[];
  };
}

interface PodiumCompetition {
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
  max_tickets?: number | string | null;
  max_tickets_per_order?: number | string | null;
  available_tickets?: number | string | null;
  sold?: number | string | null;
  sold_live?: number | string | null;
  draw?: string | null;
  end?: string | null;
  auto_draw?: boolean | null;
  categories?: {
    data?: Array<{ name?: string | null }>;
  } | null;
  game_type_name?: string | null;
}

export class PodiumPrizeAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;
  private readonly competitionPaths: string[];

  constructor(private readonly options: PodiumPrizeAdapterOptions = {}) {
    this.competitionPaths = options.competitionPaths ?? COMPETITION_PATHS;
  }

  async fetchAll(): Promise<RawCompetition[]> {
    const scrapedAt = (this.options.now?.() ?? new Date()).toISOString();
    const competitions = await Promise.all(
      this.competitionPaths.map(async (path) =>
        parsePodiumCompetitions(await this.fetchText(new URL(path, BASE_URL).toString()), scrapedAt),
      ),
    );

    return dedupeBySourceId(competitions.flat());
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`[Podium Prize] Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  }
}

function parsePodiumCompetitions(html: string, scrapedAt: string): RawCompetition[] {
  const $ = cheerio.load(html);
  const dataPage = $("#app").attr("data-page");
  if (!dataPage) return [];

  let page: PodiumPage;
  try {
    page = JSON.parse(dataPage) as PodiumPage;
  } catch {
    return [];
  }

  const competitions = page.props?.competitions;
  if (!Array.isArray(competitions)) return [];

  return competitions
    .map((competition) => mapCompetition(competition, scrapedAt))
    .filter((competition): competition is RawCompetition => competition !== null);
}

function mapCompetition(comp: PodiumCompetition, scrapedAt: string): RawCompetition | null {
  const sourceId = String(comp.slug ?? comp.id ?? "").trim();
  const name = String(comp.name ?? "").trim();
  if (!sourceId || !name) return null;
  if (String(comp.status ?? "").toLowerCase() !== "active") return null;

  const maxTickets =
    positiveInteger(comp.total_tickets) ??
    positiveInteger(sumNumbers(comp.sold_live ?? comp.sold, comp.available_tickets)) ??
    positiveInteger(comp.max_tickets);
  if (!maxTickets) return null;

  const price = finiteNumber(comp.price);
  const salePrice = finiteNumber(comp.sale_price);
  const entryPrice = salePrice > 0 && salePrice < price ? salePrice : price;
  const prizeValue = positiveNumber(comp.end_prize_value);
  const cashAlternative = extractCashAlternative(comp, prizeValue);
  const explicitMaxEntriesPerUser = positiveInteger(comp.max_tickets_per_order);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competitions/${sourceId}`,
    name,
    entryPrice,
    ticketsSold: finiteNumber(comp.sold_live ?? comp.sold),
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
          valuationNotes: "Podium Prize public end_prize_value",
        }
      : {}),
    drawDate: normalizeDate(comp.draw ?? comp.end),
    isAutoDraw: comp.auto_draw === true,
    categories: buildCategories(comp),
    scrapedAt,
  };
}

function extractCashAlternative(
  comp: PodiumCompetition,
  prizeValue: number | null,
): number | null {
  const cashAlt = positiveNumber(comp.cash_alt);
  if (cashAlt !== null) return cashAlt;

  const prizeType = String(comp.main_prize_type ?? "").toLowerCase();
  if (prizeValue !== null && prizeType.includes("cash")) return prizeValue;
  return null;
}

function buildCategories(comp: PodiumCompetition): string[] {
  const categoryNames = comp.categories?.data?.map((category) => category.name) ?? [];
  return [...categoryNames, comp.game_type_name]
    .map((category) => String(category ?? "").trim().toLowerCase())
    .filter((category, index, categories) =>
      category.length > 0 && categories.indexOf(category) === index,
    );
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dedupeBySourceId(competitions: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return competitions.filter((competition) => {
    const key = `${competition.siteName}:${competition.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
