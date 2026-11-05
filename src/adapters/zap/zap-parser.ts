import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawCompetition } from "../../types.js";
import type { ZapSiteConfig } from "./zap-site-config.js";

/** Parse a competitions listing page HTML into RawCompetition[] */
export function parsePage(html: string, config: ZapSiteConfig): RawCompetition[] {
  const $ = cheerio.load(html);
  const competitions: RawCompetition[] = [];
  const now = new Date().toISOString();
  const drawDates = extractDrawDates(html);

  $("li.product, div.product").each((_i, el) => {
    try {
      const $el = $(el);
      const comp = parseProductCard($, $el, drawDates, now, config);
      if (comp) competitions.push(comp);
    } catch {
      // Skip unparseable cards
    }
  });

  return competitions.map(stripPaidFreeEntryCategory);
}

function stripPaidFreeEntryCategory(competition: RawCompetition): RawCompetition {
  if (competition.entryPrice <= 0) return competition;
  return {
    ...competition,
    categories: competition.categories.filter(
      (category) => !/^free(?:[-_\s](?:entry|draw|raffle|ticket)s?)?$/i.test(category.trim()),
    ),
  };
}

function parseProductCard(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  drawDates: Map<string, string>,
  now: string,
  config: ZapSiteConfig,
): RawCompetition | null {
  // Source ID from post-XXXXX class
  const classes = $el.attr("class") || "";
  const postMatch = classes.match(/post-(\d+)/);
  const sourceId = postMatch?.[1] ?? "";
  if (!sourceId) return null;

  // Competition URL
  const href = $el.find("a").first().attr("href") || "";
  const url = href ? new URL(href, config.baseUrl).toString() : "";

  // Name
  const name =
    $el.find("h2").first().text().trim() ||
    $el.find(".woocommerce-loop-product__title").text().trim();

  // Entry price — Strategy 1: standard WooCommerce price element
  let entryPrice = 0;
  const salePriceText = $el.find(".price ins .woocommerce-Price-amount").first().text();
  const priceText = salePriceText || $el.find(".price > .woocommerce-Price-amount").first().text();
  const priceMatch = priceText.match(/([\d,.]+)/);
  if (priceMatch) {
    entryPrice = parseFloat(priceMatch[1].replace(",", ""));
  }
  // Strategy 2: plain text "Xp Per Entry" or "£X Per Entry" (e.g. Redline)
  if (entryPrice === 0) {
    const plainPrice = $el.find(".price").first().text().trim();
    const penceMatch = plainPrice.match(/(\d+)p\s*(?:Per\s*Entry)?/i);
    const poundMatch = plainPrice.match(/£([\d.]+)\s*(?:Per\s*Entry)?/i);
    if (penceMatch) entryPrice = parseInt(penceMatch[1], 10) / 100;
    else if (poundMatch) entryPrice = parseFloat(poundMatch[1]);
  }

  // Tickets sold / max — Strategy 1: zapc-refresh spans (standard Zap)
  let soldText = $el.find(`[class*="zapc-refresh-sold"]`).text().trim();
  let maxText = $el.find(`[class*="zapc-refresh-max"]`).text().trim();

  // Strategy 2: Progress bar "X / Y" text
  if (!soldText || !maxText) {
    const progressText = $el
      .find(".zap-competitions-progress, .zap-competitions-progress-loop")
      .text()
      .trim();
    const slashMatch = progressText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    if (slashMatch) {
      soldText = soldText || slashMatch[1];
      maxText = maxText || slashMatch[2];
    }
  }

  // Strategy 3: aria-valuenow / aria-valuemax on progress bar
  if (!soldText || !maxText) {
    const bar = $el.find(".progress-bar, [role='progressbar']").first();
    const ariaNow = bar.attr("aria-valuenow");
    const ariaMax = bar.attr("aria-valuemax");
    if (ariaNow) soldText = soldText || ariaNow;
    if (ariaMax) maxText = maxText || ariaMax;
  }

  // Strategy 4: Lottery Toolkit progress counts used by D and D In It To Win It.
  if (!soldText || !maxText) {
    const lotteryProgress = $el.find(".lty-progress-count-loop").first();
    const lotterySold = lotteryProgress
      .find(".lty-progress-bar-notice")
      .text()
      .match(/([\d,]+)/)?.[1];
    const lotteryMax = lotteryProgress.find(".lty-progress-bar-end").text().trim();
    if (lotterySold) soldText = soldText || lotterySold;
    if (lotteryMax) maxText = maxText || lotteryMax;
  }

  // Strategy 5: "X% Sold" text in zapc-product-progress-bar-wrap (e.g. Urban Draw)
  // Only percentage available — actual numbers need detail-page enrichment
  let soldPercentage: number | null = null;
  if (!soldText || !maxText) {
    const pctText = $el.find(".zapc-product-progress-bar-wrap").text().trim();
    const pctMatch = pctText.match(/([\d.]+)%\s*Sold/i);
    if (pctMatch) {
      soldPercentage = parseFloat(pctMatch[1]);
    }
  }

  // Strategy 6: Finley Design cards: "0 Tickets Sold: 90 467 19%"
  if (!soldText || !maxText) {
    const cardText = $el.text().replace(/\s+/g, " ");
    const finleyMatch = cardText.match(
      /\b(?:\d+\s+)?Tickets?\s+Sold:\s*([\d,]+)\s+([\d,]+)/i,
    );
    if (finleyMatch) {
      soldText = finleyMatch[1];
      maxText = finleyMatch[2];
    }
  }

  const ticketsSold = soldText ? parseInt(soldText.replace(/,/g, ""), 10) : 0;
  const maxTickets = maxText ? parseInt(maxText.replace(/,/g, ""), 10) : 0;

  // Cash alternative — Strategy 1: .zapc-cash-alt with nested price element
  let cashAltEl = $el.find(".zapc-cash-alt .woocommerce-Price-amount").text();
  let cashAltMatch = cashAltEl.match(/([\d,]+(?:\.\d{2})?)/);

  // Strategy 2: .cash-alt class (used on listing cards on some Zap sites)
  if (!cashAltMatch) {
    cashAltEl = $el.find(".cash-alt .woocommerce-Price-amount").text();
    cashAltMatch = cashAltEl.match(/([\d,]+(?:\.\d{2})?)/);
  }

  // Strategy 3: Plain text "Cash Alternative: £X" or "Cash Alt £X"
  if (!cashAltMatch) {
    const cardText = $el.text();
    const plainMatch = cardText.match(
      /Cash\s*(?:Alternative|Alt)[:\s]*£?([\d,]+(?:\.\d{2})?)/i,
    ) ?? cardText.match(
      /£\s*([\d,]+(?:\.\d{2})?)\s*Cash\s*(?:Alternative|Alt)\b/i,
    );
    if (plainMatch) cashAltMatch = plainMatch;
  }

  let cashAlternative = cashAltMatch
    ? parseFloat(cashAltMatch[1].replace(/,/g, ""))
    : null;
  if (cashAlternative === null) {
    cashAlternative = extractCashPrizeFromTitle(name);
  }

  // Draw date — try ISO from script, then banner CSS class
  let drawDate = drawDates.get(sourceId) || null;
  if (!drawDate) {
    const bannerClasses = $el.find(".zapc-date-banner").attr("class") || "";
    const daysMatch = bannerClasses.match(/zap-draw-days-(\d+)/);
    if (daysMatch) {
      const daysUntil = parseInt(daysMatch[1], 10);
      const drawDay = new Date();
      drawDay.setDate(drawDay.getDate() + daysUntil);
      drawDay.setHours(21, 55, 0, 0);
      drawDate = drawDay.toISOString();
    }
  }
  if (!drawDate) {
    drawDate = extractFinleyCloseDate($el.text());
  }
  if (!drawDate) {
    drawDate = extractCardDrawDate($el);
  }

  // Auto-draw detection
  const isAutoDraw =
    $el.find(".auto-draw-banner").length > 0 ||
    $el.find(".zapc-banner").text().toLowerCase().includes("auto") ||
    $el.text().toLowerCase().includes("automated draw") ||
    $el.text().toLowerCase().includes("auto draw");

  // Max entries per user
  const maxInput = $el.find("input.qty").attr("max");
  const maxEntriesPerUser = maxInput ? parseInt(maxInput, 10) : 100;
  const maxEntriesPerUserSource = maxInput ? "site" : "fallback";

  // Categories
  const categories: string[] = [];
  const catMatch = classes.match(/product_cat-([^\s]+)/g);
  if (catMatch) {
    for (const c of catMatch) {
      const cat = c.replace("product_cat-", "");
      if (cat !== "all") categories.push(cat.replace(/-/g, " "));
    }
  }

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser,
    maxEntriesPerUserSource,
    cashAlternative,
    drawDate,
    isAutoDraw,
    categories,
    scrapedAt: now,
  };
}

function extractCashPrizeFromTitle(name: string): number | null {
  const explicitCash = /\b(?:in\s+your\s+bank|cash|wonga|bank\s+transfer)\b/i.test(name);
  const cashOnlyTitle = /^£\s*[\d,.]+\s*k?\s*(?:mini\s+draw|draw)?$/i.test(name.trim());
  if (!explicitCash && !cashOnlyTitle) return null;

  const match = name.match(/£\s*([\d,.]+)\s*(k)?\s*(?:cash|wonga|bank\s+transfer|in\s+your\s+bank)\b/i) ??
    name.match(/\b(?:cash|wonga|bank\s+transfer|in\s+your\s+bank)(?:\s+alternative)?\s*:?\s*£\s*([\d,.]+)\s*(k)?/i) ??
    name.match(/£\s*([\d,.]+)\s*(k)?/i);
  if (!match) return null;

  const amount = parseFloat(match[1].replace(/,/g, ""));
  if (Number.isNaN(amount)) return null;
  return match[2] ? amount * 1000 : amount;
}

function extractFinleyCloseDate(text: string): string | null {
  const match = text.match(
    /Closes\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i,
  );
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const year = parseInt(match[3], 10);
  let hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const meridiem = match[6]?.toLowerCase();

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(year, month, day, hour, minute, 0, 0).toISOString();
}

function extractCardDrawDate($el: cheerio.Cheerio<AnyNode>): string | null {
  const attrValue =
    attrFromSelfOrChild($el, "data-end-date") ??
    attrFromSelfOrChild($el, "data-enddate") ??
    attrFromSelfOrChild($el, "data-time");
  if (attrValue) {
    const parsed = parseDateAttribute(attrValue);
    if (parsed) return parsed;
  }

  const cardText = $el.text().replace(/\s+/g, " ");
  return parseEndsText(cardText);
}

function attrFromSelfOrChild(
  $el: cheerio.Cheerio<AnyNode>,
  attr: string,
): string | undefined {
  return $el.attr(attr) ?? $el.find(`[${attr}]`).first().attr(attr);
}

function parseDateAttribute(value: string): string | null {
  const numeric = Number(value);
  if (!Number.isNaN(numeric) && numeric > 0) {
    const millis = numeric > 9_999_999_999 ? numeric : numeric * 1000;
    return new Date(millis).toISOString();
  }

  const match = value.match(
    /(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
    0,
  ).toISOString();
}

function parseEndsText(text: string): string | null {
  const match = text.match(
    /\bENDS?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!match) return null;

  const [, dayText, monthText, hourText, minuteText, meridiemText] = match;
  const month = monthNumber(monthText);
  if (month === null) return null;

  let hour = Number(hourText);
  const minute = Number(minuteText ?? "0");
  const meridiem = meridiemText?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const now = new Date();
  let date = new Date(now.getFullYear(), month, Number(dayText), hour, minute, 0, 0);
  if (date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    date = new Date(now.getFullYear() + 1, month, Number(dayText), hour, minute, 0, 0);
  }
  return date.toISOString();
}

function monthNumber(value: string): number | null {
  const key = value.slice(0, 3).toLowerCase();
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  return months[key] ?? null;
}

/** Extract draw dates from inline JavaScript countdown scripts */
function extractDrawDates(html: string): Map<string, string> {
  const dates = new Map<string, string>();
  const scriptBlocks = html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || [];

  for (const block of scriptBlocks) {
    const idMatch = block.match(/competition-countdown-(\d+)/);
    const dateMatch = block.match(/DateTime\.fromISO\("([^"]+)"/);
    if (idMatch && dateMatch) {
      const parsed = new Date(dateMatch[1]);
      if (!Number.isNaN(parsed.getTime())) {
        dates.set(idMatch[1], parsed.toISOString());
      }
    }
  }

  return dates;
}

/** Enrich a competition from its Zap detail page HTML.
 *  Extracts sold/max from zapc-refresh spans and ticket requirements. */
export function enrichFromDetailPage(
  comp: RawCompetition,
  html: string,
  config?: ZapSiteConfig,
): void {
  const $ = cheerio.load(html);
  const detailText = $("body").text().replace(/\s+/g, " ");

  // Sold count: <span class="zapc-refresh-sold-XXXXX">424</span>
  const zapCounts = extractZapRefreshCounts($, comp.sourceId);
  if (zapCounts) {
    comp.ticketsSold = parseInt(zapCounts.soldText.replace(/,/g, ""), 10);
    comp.maxTickets = parseInt(zapCounts.maxText.replace(/,/g, ""), 10);
  }
  if (comp.ticketsSold === 0 && comp.maxTickets === 0) {
    const progress = $(`.zapc-refresh-progress-${comp.sourceId}`).first();
    const ticketsSold = Number.parseInt(
      (progress.attr("aria-valuenow") ?? "").replace(/,/g, ""),
      10,
    );
    const maxTickets = Number.parseInt(
      (progress.attr("aria-valuemax") ?? "").replace(/,/g, ""),
      10,
    );
    if (
      Number.isFinite(ticketsSold) &&
      Number.isFinite(maxTickets) &&
      ticketsSold >= 0 &&
      maxTickets > 0 &&
      ticketsSold <= maxTickets
    ) {
      comp.ticketsSold = ticketsSold;
      comp.maxTickets = maxTickets;
    }
  }
  if (comp.ticketsSold === 0 && comp.maxTickets === 0) {
    const vhsSold =
      detailText.match(/TICKETS\s*SOLD:\s*\d+%\s*\(\s*([\d,]+)\s*\/\s*([\d,]+)\s*\)/i) ||
      detailText.match(/\(\s*([\d,]+)\s*\/\s*([\d,]+)\s*\)/);
    if (vhsSold) {
      comp.ticketsSold = parseInt(vhsSold[1].replace(/,/g, ""), 10);
      comp.maxTickets = parseInt(vhsSold[2].replace(/,/g, ""), 10);
    }
  }
  if (config?.siteName === "guitarmarketplace" && comp.ticketsSold === 0 && comp.maxTickets === 0) {
    const availableTickets = detailText.match(/\b([\d,]+)\s+tickets?\s+available\b/i);
    if (availableTickets) {
      const maxTickets = parseInt(availableTickets[1].replace(/,/g, ""), 10);
      if (Number.isFinite(maxTickets) && maxTickets > 0) {
        comp.maxTickets = maxTickets;
      }
    }
  }
  // "Maximum X tickets per person" — in .requirement-answer div
  const reqText = $(".requirement-answer").text().trim();
  const maxPerUserMatch = reqText.match(
    /Maximum\s+([\d,]+)\s+tickets?\s+per\s+person/i,
  );
  if (maxPerUserMatch) {
    comp.maxEntriesPerUser = parseInt(
      maxPerUserMatch[1].replace(/,/g, ""),
      10,
    );
    comp.maxEntriesPerUserSource = "site";
  }
  if (
    comp.maxEntriesPerUser <= 0 ||
    (!maxPerUserMatch && comp.maxEntriesPerUser === 100)
  ) {
    const detailMaxPerUserMatch = detailText.match(
      /Maximum\s+([\d,]+)\s+tickets?\s+per\s+person/i,
    ) ?? detailText.match(
      /MAX\s+PER\s+PERSON\s+([\d,]+)/i,
    ) ?? detailText.match(
      /(?:max(?:imum)?|limit)\s+(?:tickets?\s+)?(?:per\s+)?(?:person|user|customer)[:\s-]+([\d,]+)/i,
    ) ?? detailText.match(
      /(?:ticket\s+)?limit[:\s-]+([\d,]+)\s+(?:per\s+)?(?:person|user|customer)\b/i,
    ) ?? detailText.match(
      /([\d,]+)\s+tickets?\s+per\s+(?:person|user|customer)\b/i,
    ) ?? detailText.match(
      /([\d,]+)\s+Max\s+per\s+(?:person|user|customer)\b/i,
    ) ?? detailText.match(
      /\b(?:may|can)\s+enter\s+(?:(?:the|this)\s+)?competition\s+up\s+to\s+([\d,]+)\s+times?\b/i,
    );
    if (detailMaxPerUserMatch) {
      comp.maxEntriesPerUser = parseInt(
        detailMaxPerUserMatch[1].replace(/,/g, ""),
        10,
      );
      comp.maxEntriesPerUserSource = "site";
    }
  }

  // Price fallback: "Xp Per Entry" or "£X Per Entry" from detail page
  if (comp.entryPrice === 0) {
    const currentPriceText = $(".summary .price ins .woocommerce-Price-amount, .price ins .woocommerce-Price-amount").first().text().trim();
    const priceText = currentPriceText || $(".summary .price, .price").first().text().trim();
    const penceMatch = priceText.match(/(\d+)p\s*(?:Per\s*Entry)?/i);
    const poundMatch = priceText.match(/£([\d.]+)\s*(?:Per\s*Entry)?/i);
    if (penceMatch) comp.entryPrice = parseInt(penceMatch[1], 10) / 100;
    else if (poundMatch) comp.entryPrice = parseFloat(poundMatch[1]);
  }
  if (comp.entryPrice === 0) {
    const vhsPrice = detailText.match(/£\s*([\d.]+)\s*PER\s*ENTRY/i);
    if (vhsPrice) comp.entryPrice = parseFloat(vhsPrice[1]);
  }

  if (comp.cashAlternative === null) {
    comp.cashAlternative = extractMainDrawCashPrize($, comp.sourceId);
  }

  if (comp.estimatedPrizeValue == null && config?.detailPrizeValuePattern) {
    const prizeValueMatch = detailText.match(config.detailPrizeValuePattern);
    const prizeValue = Number.parseFloat((prizeValueMatch?.[1] ?? "").replace(/,/g, ""));
    if (Number.isFinite(prizeValue) && prizeValue > 0) {
      comp.estimatedPrizeValue = prizeValue;
      comp.valuationSource = "site_estimate";
      comp.valuationConfidence = "medium";
      comp.valuationNotes = `${config.displayName} public detail-page prize value.`;
    }
  }

  const visibleDrawDate = parseVisibleDrawDate(detailText);
  if (visibleDrawDate) {
    comp.drawDate = visibleDrawDate;
  } else if (!comp.drawDate) {
    comp.drawDate = extractDetailDrawDate(html, detailText);
  }
}

export function isClosedCompetitionDetailPage(
  html: string,
  sourceId: string,
): boolean {
  const $ = cheerio.load(html);
  const $product = $(`#product-${sourceId}`).first();
  if ($product.length === 0) return false;

  return /\b(?:competition-closed|competition-finished)\b/i.test(
    $product.attr("class") ?? "",
  );
}

function extractZapRefreshCounts(
  $: cheerio.CheerioAPI,
  sourceId: string,
): { soldText: string; maxText: string } | null {
  if (sourceId) {
    const soldText = textForClassToken($, `zapc-refresh-sold-${sourceId}`);
    const maxText = textForClassToken($, `zapc-refresh-max-${sourceId}`);
    return soldText && maxText ? { soldText, maxText } : null;
  }

  const soldText = $(`[class*="zapc-refresh-sold"]`).first().text().trim();
  const maxText = $(`[class*="zapc-refresh-max"]`).first().text().trim();
  return soldText && maxText ? { soldText, maxText } : null;
}

function textForClassToken($: cheerio.CheerioAPI, token: string): string {
  let text = "";
  $(`[class*="${token}"]`).each((_i, el) => {
    const classes = ($(el).attr("class") ?? "").split(/\s+/);
    if (classes.includes(token)) {
      text = $(el).text().trim();
      return false;
    }
  });
  return text;
}

function extractMainDrawCashPrize(
  $: cheerio.CheerioAPI,
  sourceId: string,
): number | null {
  const explicitCashAltText = extractScopedCashAlternativeText($, sourceId);
  const productDescription = extractProductDescriptionText($);
  const text = `${explicitCashAltText} ${productDescription ?? ""}`.replace(/\s+/g, " ");
  return (
    cashAmountFromMatch(text.match(/Cash\s*(?:Alternative|Alt)[:\s]*£?\s*([\d,.]+)\s*(k)?/i)) ??
    cashAmountFromMatch(text.match(/£\s*([\d,.]+)\s*(k)?\s+(?:main\s+prize\s+)?cash\s+alt\b/i)) ??
    cashAmountFromMatch(text.match(/\b\d+\s*x\s*£\s*([\d,.]+)\s*(k)?\s*cash\s+main\s+winner\b/i)) ??
    cashAmountFromMatch(text.match(/\b\d+\s*x\s*£\s*([\d,.]+)\s*(k)?\s*main\s+prize\s+winner\b/i)) ??
    cashAmountFromMatch(text.match(/\bmain\s+(?:drawer\s+)?winner\b.{0,160}?\bwin\s+£\s*([\d,.]+)\s*(k)?\s*cash\b/i)) ??
    cashAmountFromMatch(text.match(/\bone\s+ticket\b.{0,120}?\bend\b.{0,120}?\bwin\s+a?\s*£\s*([\d,.]+)\s*(k)?\s*cash\b/i))
  );
}

function extractScopedCashAlternativeText(
  $: cheerio.CheerioAPI,
  sourceId: string,
): string {
  const selector = ".zapc-cash-alt, .cash-alt";
  const productSelector = `#product-${sourceId}, .product.post-${sourceId}`;
  const hasCurrentProduct = sourceId.length > 0 && $(productSelector).length > 0;
  if (!hasCurrentProduct) return $(selector).text();

  return $(selector)
    .filter((_i, el) => $(el).closest(".product").is(productSelector))
    .text();
}

function extractProductDescriptionText($: cheerio.CheerioAPI): string | null {
  const directDescription = [
    $("#tab-description").text(),
    $(".woocommerce-Tabs-panel--description").text(),
    $(".woocommerce-product-details__short-description").text(),
  ].find((text) => text.trim().length > 0);
  if (directDescription) return directDescription;

  const productSchema = $('script[type="application/ld+json"]')
    .map((_i, el) => $(el).text())
    .get()
    .find((text) => text.includes('"@type":"Product"') || text.includes('"@type": "Product"'));
  if (!productSchema) return null;

  try {
    const parsed = JSON.parse(productSchema) as { description?: unknown };
    return typeof parsed.description === "string" ? parsed.description : null;
  } catch {
    return null;
  }
}

function cashAmountFromMatch(match: RegExpMatchArray | null): number | null {
  if (!match) return null;
  const parsed = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return match[2] ? parsed * 1000 : parsed;
}

function extractDetailDrawDate(html: string, text = html): string | null {
  const visibleDrawDate = parseVisibleDrawDate(text);
  if (visibleDrawDate) return visibleDrawDate;

  const vhsEnd = html.match(/data-end-date-time=["'](\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?["']/i);
  if (vhsEnd) {
    const [, date, hour, minute, second] = vhsEnd;
    const [year, month, day] = date.split("-").map(Number);
    return new Date(
      year,
      month - 1,
      day,
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second ?? "0", 10),
      0,
    ).toISOString();
  }

  const iso = html.match(/DateTime\.fromISO\("([^"]+)"/)?.[1];
  if (iso) return new Date(iso).toISOString();

  const dataTime = html.match(/data-time=["'](\d{10,13})["']/i)?.[1];
  if (dataTime) {
    const raw = Number(dataTime);
    const millis = raw > 9_999_999_999 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }

  const dateTimeString = html.match(
    /data-time=["'](\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?["']/i,
  );
  if (dateTimeString) {
    const [, year, month, day, hour, minute, second] = dateTimeString;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? "0"),
      0,
    ).toISOString();
  }

  return null;
}

function parseVisibleDrawDate(text: string): string | null {
  const match = text.match(
    /(?:LIVE\s+)?DRAW(?:\s+DATE)?\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*@\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!match) return null;

  const [, day, month, rawYear, hour, minute, meridiem] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  let parsedHour = Number(hour);
  const parsedMinute = Number(minute ?? "0");
  const lowerMeridiem = meridiem?.toLowerCase();
  if (lowerMeridiem === "pm" && parsedHour < 12) parsedHour += 12;
  if (lowerMeridiem === "am" && parsedHour === 12) parsedHour = 0;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    parsedHour,
    parsedMinute,
    0,
    0,
  ).toISOString();
}

/** Extract total page count from "Showing X-Y of Z results" */
export function extractTotalPages(
  html: string,
  config: ZapSiteConfig,
): number {
  const $ = cheerio.load(html);
  const resultText = $(".woocommerce-result-count").text();
  const rangeMatch = resultText.match(
    /Showing\s+[\d,]+\s*[–-]\s*([\d,]+)\s+of\s+([\d,]+)\s+results/i,
  );
  if (rangeMatch) {
    const shownThrough = parseInt(rangeMatch[1].replace(/,/g, ""), 10);
    const total = parseInt(rangeMatch[2].replace(/,/g, ""), 10);
    if (shownThrough > 0 && total > 0) {
      return Math.ceil(total / shownThrough);
    }
  }

  const totalMatch = resultText.match(/of\s+(\d+)\s+results/);
  if (totalMatch) {
    const total = parseInt(totalMatch[1], 10);
    return Math.ceil(total / config.itemsPerPage);
  }
  // Fallback: check pagination links
  const pages = $(".page-numbers li a, a.page-numbers")
    .map((_i, el) => {
      const num = parseInt($(el).text(), 10);
      return isNaN(num) ? 0 : num;
    })
    .get();
  return pages.length > 0 ? Math.max(...pages) : 1;
}
