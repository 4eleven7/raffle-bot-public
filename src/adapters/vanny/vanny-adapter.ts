import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "vannycampers";
const BASE_URL = "https://vannycampers.co.uk";
const SITEMAP_URL = `${BASE_URL}/sitemap.xml`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface VannyCampersAdapterOptions {
  now?: () => Date;
}

interface ProductJsonLd {
  "@type"?: string;
  name?: string;
  description?: string;
  url?: string;
  offers?: {
    price?: string | number;
  };
}

export class VannyCampersAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  constructor(private readonly options: VannyCampersAdapterOptions = {}) {}

  async fetchAll(): Promise<RawCompetition[]> {
    const scrapedAt = (this.options.now?.() ?? new Date()).toISOString();
    const sitemap = await this.fetchText(SITEMAP_URL);
    const competitionUrls = extractCompetitionUrls(sitemap);

    const competitions = await Promise.all(
      competitionUrls.map(async (url) => parseCompetitionPage(await this.fetchText(url), url, scrapedAt)),
    );

    return competitions.filter((competition): competition is RawCompetition => competition !== null);
  }

  private async fetchText(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`[VannyCampers] Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  }
}

function extractCompetitionUrls(sitemapXml: string): string[] {
  const matches = sitemapXml.match(/https:\/\/vannycampers\.co\.uk\/(?:rounds|auto)\/[^<\s"]+\/competitions\/[^<\s"]+/g) ?? [];
  return [...new Set(matches)];
}

function parseCompetitionPage(html: string, fallbackUrl: string, scrapedAt: string): RawCompetition | null {
  const $ = cheerio.load(html);
  const decodedHtml = html.replaceAll('\\"', '"');
  const product = findProductJsonLd($);
  if (!product?.name || !product.url) return null;

  const sourceId = product.url.split("/").filter(Boolean).at(-1)?.trim();
  if (!sourceId) return null;

  const entryPrice = positiveNumber(product.offers?.price);
  const quantityAvailable = extractRequiredInteger(decodedHtml, /"quantityAvailable",(\d+)/);
  const maxTickets = extractMaxTickets(decodedHtml);
  const drawDate = extractRequiredString(decodedHtml, /"competitionEndTime","([^"]+)"/);
  if (entryPrice === null || quantityAvailable === null || maxTickets === null || !drawDate) {
    return null;
  }

  const ticketsSold = maxTickets - quantityAvailable;
  if (ticketsSold < 0) return null;

  const name = product.name.trim();
  const description = product.description?.trim() ?? "";
  const valueFromText = extractCurrencyValue(`${name} ${description}`);
  const isSiteCredit = /site credit/i.test(`${name} ${description}`);
  const isCashPrize =
    /\bcash\b/i.test(`${name} ${description}`) ||
    (/\bprize draw ticket\b/i.test(name) && !isSiteCredit);
  const explicitProductEstimate = !isCashPrize && !isSiteCredit
    ? valueFromText
    : null;
  const categories = buildCategories(name, description);

  return {
    sourceId,
    siteName: SITE_NAME,
    url: product.url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxTickets,
    cashAlternative: isCashPrize ? valueFromText : null,
    ...(isSiteCredit && valueFromText !== null
      ? {
          estimatedPrizeValue: valueFromText,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "high" as const,
          valuationNotes: "Explicit site credit value in product title/description",
        }
      : {}),
    ...(explicitProductEstimate !== null
      ? {
          estimatedPrizeValue: explicitProductEstimate,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "high" as const,
          valuationNotes: "Explicit product value in operator description",
        }
      : {}),
    drawDate: normalizeDate(drawDate),
    isAutoDraw: fallbackUrl.includes("/auto/"),
    categories,
    scrapedAt,
  };
}

function findProductJsonLd($: cheerio.CheerioAPI): ProductJsonLd | null {
  const scripts = $('script[type="application/ld+json"]')
    .map((_, element) => $(element).text())
    .get();

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script) as ProductJsonLd | ProductJsonLd[];
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      const product = candidates.find((candidate) => candidate?.["@type"] === "Product");
      if (product) return product;
    } catch {
      continue;
    }
  }

  return null;
}

function extractRequiredInteger(html: string, pattern: RegExp): number | null {
  const match = html.match(pattern);
  if (!match) return null;
  return positiveInteger(match[1]);
}

function extractRequiredString(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractCurrencyValue(value: string): number | null {
  const withoutTicketPrice = value.replace(/\bfrom\s+£\s*[0-9][0-9,]*(?:\.[0-9]+)?/i, "");
  const match = withoutTicketPrice.match(/£\s*([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!match) return null;
  return positiveNumber(match[1].replaceAll(",", ""));
}

function extractMaxTickets(html: string): number | null {
  const sectionMatch = html.match(/maxTicketsAvailable",[\s\S]{0,12000}?"isLoggedIn"/);
  if (!sectionMatch) return null;

  const valueMatches = [...sectionMatch[0].matchAll(/"(\d+)"/g)];
  const value = valueMatches.at(-1)?.[1];
  return positiveInteger(value);
}

function buildCategories(name: string, description: string): string[] {
  const haystack = `${name} ${description}`.toLowerCase();
  const categories = [
    haystack.includes("cash") ? "cash" : null,
    haystack.includes("camper") ? "campervan" : null,
    haystack.includes("site credit") ? "site-credit" : null,
    haystack.includes("roof tent") ? "roof-tent" : null,
    haystack.includes("gopro") ? "camera" : null,
    haystack.includes("renogy") || haystack.includes("solar") ? "solar" : null,
    haystack.includes("fleece") ? "clothing" : null,
    haystack.includes("national trust") ? "membership" : null,
  ];

  return categories.filter((category, index, all): category is string => category !== null && all.indexOf(category) === index);
}

function normalizeDate(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveNumber(value: string | number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: string | number | null | undefined): number | null {
  const parsed = positiveNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}
