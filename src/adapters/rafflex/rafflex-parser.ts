import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawCompetition } from "../../types.js";
import type { RafflexSiteConfig } from "./rafflex-site-config.js";

const COMPETITION_LINK_SELECTOR = 'a[href*="/competition"]';
const COMPETITION_PATH_PATTERN = /\/competitions?\/([a-z0-9-]+)/i;

/** Parse a Rafflex homepage HTML into RawCompetition[] */
export function parsePage(
  html: string,
  config: RafflexSiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const competitions: RawCompetition[] = [];
  const now = new Date().toISOString();

  // Rafflex cards are anchor links to /competition/[slug]
  $(COMPETITION_LINK_SELECTOR).each((_i, el) => {
    try {
      const $el = $(el);
      const comp = parseCard($, $el, config, now);
      if (comp) competitions.push(comp);
    } catch {
      // Skip unparseable cards
    }
  });

  return deduplicateByUrl(competitions);
}

function parseCard(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  config: RafflexSiteConfig,
  now: string,
): RawCompetition | null {
  const href = $el.attr("href") || "";
  if (!COMPETITION_PATH_PATTERN.test(href)) return null;

  // URL and source ID (slug)
  const slugMatch = href.match(COMPETITION_PATH_PATTERN);
  const sourceId = slugMatch?.[1] ?? "";
  if (!sourceId) return null;
  const url = href.startsWith("http")
    ? href
    : `${config.baseUrl}${href}`;

  // Full card text for parsing
  const text = $el.text();

  // Name — heading, first significant text line, or de-slugified sourceId
  const heading = $el.find("h3, h2, h4").first().text().trim();
  const name =
    (heading && heading.length > 5 ? heading : null) ||
    extractName(text) ||
    sourceId.replace(/-/g, " ");

  // Tickets: look for pattern like "11997/30860" or "58270 / 249999"
  const ticketMatch = text.match(/([\d,]+)\s*\/\s*([\d,]+)/);
  const ticketsSold = ticketMatch
    ? parseInt(ticketMatch[1].replace(/,/g, ""), 10)
    : 0;
  const maxTickets = ticketMatch
    ? parseInt(ticketMatch[2].replace(/,/g, ""), 10)
    : 0;

  // Entry price: prefer explicit price labels before generic £ amounts in titles.
  let entryPrice = 0;
  const exactPriceNodes = $el
    .find("*")
    .map((_i, node) => $(node).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((value) => /^£\s*[\d.]+$/.test(value) || /^\d+p$/i.test(value) || /^Free$/i.test(value));
  const exactPrice = exactPriceNodes.at(-1);
  const isExplicitFreeEntry = exactPrice !== undefined && (
    /^Free$/i.test(exactPrice) ||
    (/^\d+p$/i.test(exactPrice) && parseInt(exactPrice, 10) === 0) ||
    (/^£\s*[\d.]+$/.test(exactPrice) && parseFloat(exactPrice.replace(/[^\d.]/g, "")) === 0)
  );
  if (exactPrice) {
    if (/^Free$/i.test(exactPrice)) {
      entryPrice = 0;
    } else if (/^\d+p$/i.test(exactPrice)) {
      entryPrice = parseInt(exactPrice, 10) / 100;
    } else {
      entryPrice = parseFloat(exactPrice.replace(/[^\d.]/g, ""));
    }
  }
  const explicitPoundMatch = text.match(
    /(?:Entry\s*Price|Price|Entry)\s*£([\d.]+)|£([\d.]+)\s*(?:per|a)\s*(?:ticket|entry)/i,
  );
  const explicitPenceMatch = text.match(
    /(?:Entry\s*Price|Price|Entry)\s*(\d+)p|(\d+)p\s*(?:per|a)\s*(?:ticket|entry)/i,
  );
  if (exactPrice) {
    // Keep exact price-node detection, including explicit Free/0p, as the
    // highest-confidence signal. A zero price must not fall through to a prize
    // amount in the following title (for example "Per Entry £100 voucher").
  } else if (explicitPoundMatch) {
    entryPrice = parseFloat(explicitPoundMatch[1] ?? explicitPoundMatch[2]);
  } else if (explicitPenceMatch) {
    entryPrice = parseInt(explicitPenceMatch[1] ?? explicitPenceMatch[2], 10) / 100;
  }

  // Cash alternative: "Cash Alt: £35,000" or "OR £12,000 CASH" or "£35,000"
  let cashAlternative: number | null = null;
  const cashAltMatch = text.match(
    /Cash\s*Alt[:\s]*£([\d,.]+)/i,
  );
  const orCashMatch = text.match(
    /OR\s*£([\d,.]+)\s*CASH/i,
  );
  const psCashMatch = text.match(
    /\bps([\d,.]+)\s*(?:cash|end\s*prize|prize)\b/i,
  );
  const orPsMatch = text.match(
    /\bor\s+ps([\d,.]+)\b/i,
  );
  if (cashAltMatch) {
    cashAlternative = parseCashAmount(cashAltMatch[1]);
  } else if (orCashMatch) {
    cashAlternative = parseCashAmount(orCashMatch[1]);
  } else if (psCashMatch) {
    cashAlternative = parseCashAmount(psCashMatch[1]);
  } else if (orPsMatch) {
    cashAlternative = parseCashAmount(orPsMatch[1]);
  }
  if (config.siteName === "clutchcomps") {
    cashAlternative = extractClutchMainPrize(name);
  }

  // Draw date: "Tomorrow 10:00pm", "Sat Apr 4th 10:00pm", etc.
  const drawDate = parseDrawDate(text);

  // Auto-draw detection
  const textLower = text.toLowerCase();
  const isAutoDraw =
    textLower.includes("auto draw") || textLower.includes("auto drawn");

  // Skip free entries and "all tickets win" type cards
  if (entryPrice === 0 && !text.toLowerCase().includes("free")) {
    // Might be a non-competition link
    if (!ticketMatch) return null;
  }

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name: name || sourceId,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100, // Default; detail page needed for actual value
    maxEntriesPerUserSource: "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw,
    categories: isExplicitFreeEntry ? ["free"] : [],
    scrapedAt: now,
  };
}

function extractName(text: string): string {
  // Take the first line that looks like a title (not a number or price)
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 5 &&
        !l.match(/^\d/) &&
        !l.startsWith("£") &&
        !l.includes("per ticket") &&
        !l.includes("Sold") &&
        !l.includes("ENTER"),
    );
  return lines[0]?.substring(0, 100) ?? "";
}

function parseDrawDate(text: string): string | null {
  // "Tomorrow 10:00pm" or "Tomorrow 8:00am"
  const tomorrowMatch = text.match(
    /Tomorrow\s+(\d{1,2}):(\d{2})(am|pm)/i,
  );
  if (tomorrowMatch) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    let hours = parseInt(tomorrowMatch[1], 10);
    if (tomorrowMatch[3].toLowerCase() === "pm" && hours < 12) hours += 12;
    if (tomorrowMatch[3].toLowerCase() === "am" && hours === 12) hours = 0;
    d.setHours(hours, parseInt(tomorrowMatch[2], 10), 0, 0);
    return d.toISOString();
  }

  // "Sat Apr 4th 10:00pm" or "Mon Jun 1st 8:00pm"
  const absMatch = text.match(
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{1,2}):(\d{2})(am|pm)/i,
  );
  if (absMatch) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[absMatch[1].toLowerCase().substring(0, 3)];
    if (month !== undefined) {
      const day = parseInt(absMatch[2], 10);
      let hours = parseInt(absMatch[3], 10);
      const mins = parseInt(absMatch[4], 10);
      if (absMatch[5].toLowerCase() === "pm" && hours < 12) hours += 12;
      if (absMatch[5].toLowerCase() === "am" && hours === 12) hours = 0;
      const d = new Date();
      d.setMonth(month, day);
      d.setHours(hours, mins, 0, 0);
      // If the date is in the past, it's next year
      if (d.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
        d.setFullYear(d.getFullYear() + 1);
      }
      return d.toISOString();
    }
  }

  // "Today 10:00pm"
  const todayMatch = text.match(
    /Today\s+(\d{1,2}):(\d{2})(am|pm)/i,
  );
  if (todayMatch) {
    const d = new Date();
    let hours = parseInt(todayMatch[1], 10);
    if (todayMatch[3].toLowerCase() === "pm" && hours < 12) hours += 12;
    if (todayMatch[3].toLowerCase() === "am" && hours === 12) hours = 0;
    d.setHours(hours, parseInt(todayMatch[2], 10), 0, 0);
    return d.toISOString();
  }

  return null;
}

function parseCashAmount(value: string): number | null {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractClutchMainPrize(name: string): number | null {
  const match = name.match(
    /(?:£|\bps)\s*([\d,.]+)\s*(?:cash|end\s+draw|end\s+prize)\b/i,
  );
  return match ? parseCashAmount(match[1]) : null;
}

/** Deduplicate competitions that appear multiple times on the page */
function deduplicateByUrl(comps: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return comps.filter((c) => {
    if (seen.has(c.sourceId)) return false;
    seen.add(c.sourceId);
    return true;
  });
}
