import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawCompetition } from "../../types.js";
import type { ShopifySiteConfig } from "./shopify-site-config.js";

export interface ShopifyProductLink {
  url: string;
  drawDate: string | null;
}

/** Parse a Shopify collection page into RawCompetition[] */
export function parsePage(
  html: string,
  config: ShopifySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const competitions: RawCompetition[] = [];
  const now = new Date().toISOString();

  // Select by data attribute — the Quick Add button has all data
  $("[data-total-tickets]").each((_i, el) => {
    try {
      const $btn = $(el);
      const $card = $btn.closest(
        ".grid-product-card, .product-card, [class*='grid-product']",
      );
      const comp = parseCard($, $btn, $card.length ? $card : $btn.parent(), config, now);
      if (comp) competitions.push(comp);
    } catch {
      // Skip unparseable cards
    }
  });

  return deduplicateById(competitions);
}

/** Find product links whose parent card publishes an exact draw timestamp. */
export function parseProductLinks(
  html: string,
  config: ShopifySiteConfig,
): ShopifyProductLink[] {
  const $ = cheerio.load(html);
  const links: ShopifyProductLink[] = [];
  const baseUrl = new URL(config.baseUrl);

  $("[data-countdown][data-end-at]").each((_i, el) => {
    const $card = $(el).closest(
      ".competition-card, article, .card-wrapper, .product-card",
    );
    const rawUrl = $card.find("a[href*='/products/']").first().attr("href");
    if (!rawUrl) return;

    const url = new URL(rawUrl, config.baseUrl);
    if (url.hostname !== baseUrl.hostname) return;

    const drawDate = parseDate($(el).attr("data-end-at"));
    if (!drawDate) return;
    links.push({ url: url.toString(), drawDate });
  });

  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

/** Parse a Shopify product detail page with an exact ticket counter. */
export function parseProductPage(
  html: string,
  config: ShopifySiteConfig,
  url: string,
  fallbackDrawDate: string | null = null,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const productId = $("input[name='product-id']").first().attr("value") ?? "";
  const name =
    $(".product__title").first().text().trim() ||
    $(".product__description h1").first().text().trim() ||
    $("h1").first().text().trim();
  const description = $(".product__description").first().text().replace(/\s+/g, " ").trim();

  let counterText = "";
  $("[id*='cs-counter']").each((_i, el) => {
    if (counterText) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (/\d[\d,]*\s*\/\s*\d[\d,]*\s*(?:tickets?|entries?)/i.test(text)) {
      counterText = text;
    }
  });

  const counterMatch = counterText.match(
    /(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*(?:tickets?|entries?)/i,
  );
  const ticketsSold = parseNumber(counterMatch?.[1]);
  const maxTickets = parseNumber(counterMatch?.[2]);
  const priceMeta = $("meta[property='product:price:amount']").attr("content");
  const priceText =
    $(".price-item--regular").first().text() ||
    $(".price-item--sale").first().text() ||
    $(".price-item").first().text();
  const entryPrice = parsePrice(priceMeta, priceText);
  const drawDate =
    fallbackDrawDate ??
    parseDate(
      $("[data-draw-date]").first().attr("data-draw-date") ??
        $("[data-end-at]").first().attr("data-end-at"),
    );
  const cashAlternative = parseNumber(
    description.match(/(?:or|cash alternative)\s+£\s*([\d,]+)\s*cash?/i)?.[1],
  );
  const valueMatch = description.match(/\bworth\s+(?:over\s+)?£\s*([\d,]+)/i);
  const estimatedPrizeValue = parseNumber(valueMatch?.[1]);

  if (
    !productId ||
    !name ||
    !counterMatch ||
    maxTickets <= 0 ||
    ticketsSold > maxTickets ||
    entryPrice <= 0 ||
    !drawDate
  ) {
    return null;
  }

  return {
    sourceId: productId,
    siteName: config.siteName,
    url,
    name: name.substring(0, 120),
    prizeDescription: description.substring(0, 2000),
    prizeEvidence: description.substring(0, 2000),
    entryPrice,
    ticketsSold,
    maxTickets,
    inventorySource: "exact",
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    estimatedPrizeValue: estimatedPrizeValue > 0 ? estimatedPrizeValue : null,
    valuationSource: estimatedPrizeValue > 0 ? "site_estimate" : null,
    valuationConfidence: estimatedPrizeValue > 0 ? "high" : null,
    valuationNotes:
      estimatedPrizeValue > 0
        ? "Operator product detail states the prize is worth over the parsed amount."
        : null,
    drawDate,
    isAutoDraw: true,
    categories: ["shopify"],
    scrapedAt: new Date().toISOString(),
  };
}

function parseCard(
  $: cheerio.CheerioAPI,
  $btn: cheerio.Cheerio<AnyNode>,
  $card: cheerio.Cheerio<AnyNode>,
  config: ShopifySiteConfig,
  now: string,
): RawCompetition | null {
  // Data attributes on the Quick Add button
  const productId = $btn.attr("data-product-id") || "";
  const totalTickets = parseInt($btn.attr("data-total-tickets") || "0", 10);
  const currentStock = parseInt($btn.attr("data-current-stock") || "0", 10);
  const priceInPence = parseInt($btn.attr("data-product-price") || "0", 10);
  const drawDateStr = $btn.attr("data-draw-date") || null;
  const parsedMaxPerPerson = parseInt($btn.attr("data-max-per-person") ?? "", 10);
  const hasSiteCap = Number.isFinite(parsedMaxPerPerson) && parsedMaxPerPerson > 0;
  const maxPerPerson = hasSiteCap ? parsedMaxPerPerson : 100;

  if (!productId || totalTickets === 0) return null;

  const ticketsSold = totalTickets - currentStock;
  const entryPrice = priceInPence / 100;

  // Name — prefer data attribute, fallback to card text
  const name =
    $btn.attr("data-product-title") ||
    $card.find("h3, h2, .grid-product-card__title").first().text().trim() ||
    "Unknown";

  // URL — prefer data attribute
  const rawUrl =
    $btn.attr("data-product-url") ||
    $card.find("a[href*='/products/']").first().attr("href") ||
    "";
  const url = rawUrl.startsWith("http")
    ? rawUrl
    : `${config.baseUrl}${rawUrl}`;

  // Cash alternative — look for "Cash Alt" or "OR £X" in card text
  const cardText = $card.text();
  let cashAlternative: number | null = null;
  const cashAltMatch = cardText.match(
    /Cash\s*(?:Alternative|Alt)[:\s]*£([\d,]+)/i,
  );
  const orCashMatch = cardText.match(/OR\s*£([\d,]+)\s*CASH/i);
  if (cashAltMatch) {
    cashAlternative = parseFloat(cashAltMatch[1].replace(/,/g, ""));
  } else if (orCashMatch) {
    cashAlternative = parseFloat(orCashMatch[1].replace(/,/g, ""));
  }

  // If no cash alt found, try to extract from product title for cash prizes
  if (!cashAlternative) {
    const cashPrizeMatch = name.match(/£([\d,]+)\s*(?:Cash|Tax Free)/i);
    if (cashPrizeMatch) {
      cashAlternative = parseFloat(cashPrizeMatch[1].replace(/,/g, ""));
    }
  }

  // Auto-draw — Giveaway Guys guarantees all draws
  const isAutoDraw = true;

  return {
    sourceId: productId,
    siteName: config.siteName,
    url,
    name: name.substring(0, 120),
    entryPrice,
    ticketsSold,
    maxTickets: totalTickets,
    maxEntriesPerUser: maxPerPerson,
    maxEntriesPerUserSource: hasSiteCap ? "site" : "fallback",
    cashAlternative,
    drawDate: drawDateStr,
    isAutoDraw,
    categories: [],
    scrapedAt: now,
  };
}

function deduplicateById(comps: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return comps.filter((c) => {
    if (seen.has(c.sourceId)) return false;
    seen.add(c.sourceId);
    return true;
  });
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parsePrice(value: string | undefined, fallbackText: string): number {
  if (value) {
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }

  const match = fallbackText.match(/£\s*([\d,]+(?:\.\d{1,2})?)/i);
  return match ? parseNumber(match[1]) : 0;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
