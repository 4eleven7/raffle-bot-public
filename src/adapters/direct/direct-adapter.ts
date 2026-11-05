import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { parseHighlandVaultDetail } from "./highland-vault.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FETCH_TIMEOUT_MS = 15_000;

interface DirectDetailSiteConfig {
  siteName: string;
  displayName: string;
  baseUrl: string;
  listPath: string;
  linkSelector: string;
  linkPattern: RegExp;
  parseDetail: (html: string, url: string, now: Date) => RawCompetition | null;
}

export const DIRECT_DETAIL_SITES: DirectDetailSiteConfig[] = [
  {
    siteName: "highlandvault",
    displayName: "Highland Vault",
    baseUrl: "https://highlandvault.com",
    listPath: "/fantastic-competitions/",
    linkSelector: '.hv-draw-card.is-raid .hv-draw-card__title a',
    linkPattern: /\/product\/[^/]+\/?$/,
    parseDetail: parseHighlandVaultDetail,
  },
  {
    siteName: "legioncomps",
    displayName: "Legion Comps",
    baseUrl: "https://www.legioncomps.co.uk",
    listPath: "/",
    linkSelector: 'a[href*="/competition/"]',
    linkPattern: /\/competition\/[^/]+\/?$/,
    parseDetail: parseLegionDetail,
  },
  {
    siteName: "jackpotzcompetitions",
    displayName: "Jackpotz Competitions",
    baseUrl: "https://jackpotzcompetitions.com",
    listPath: "/shop/live/",
    linkSelector: 'a[href*="/shop/"]',
    linkPattern: /\/shop\/[^/]+\/[^/]+\/?$/,
    parseDetail: parseJackpotzDetail,
  },
  {
    siteName: "justonemoreticket",
    displayName: "Just One More Ticket",
    baseUrl: "https://justonemoreticket.co.uk",
    listPath: "/",
    linkSelector: 'a[href*="/competitions/"]',
    linkPattern: /\/competitions\/[^/]+\/?$/,
    parseDetail: parseJustOneMoreTicketDetail,
  },
  {
    siteName: "premiumwatchclub",
    displayName: "Premium Watch Club",
    baseUrl: "https://premiumwatchclub.com",
    listPath: "/",
    linkSelector: 'a[href*="/competitions/"]',
    linkPattern: /\/competitions\/(?:weekly|monthly|special)\/?$/,
    parseDetail: parsePremiumWatchClubDetail,
  },
];

export class DirectDetailAdapter implements SiteAdapter {
  readonly siteName: string;

  constructor(private readonly config: DirectDetailSiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listHtml = await fetchHtml(
      new URL(this.config.listPath, this.config.baseUrl).toString(),
      signal,
    );
    const links = discoverLinks(listHtml, this.config);
    const results: RawCompetition[] = [];

    for (const url of links) {
      signal?.throwIfAborted();
      try {
        const html = await fetchHtml(url, signal);
        const competition = this.config.parseDetail(html, url, new Date());
        if (competition) results.push(competition);
      } catch {
        signal?.throwIfAborted();
      }
    }

    return deduplicate(results);
  }
}

export class CrownEagleAdapter implements SiteAdapter {
  readonly siteName = "cecompetitions";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const html = await fetchHtml(
      "https://www.cecompetitions.co.uk/competition-home",
      signal,
    );
    const $ = cheerio.load(html);
    const now = new Date();
    const competitions: RawCompetition[] = [];

    $(".competition-live-card").each((_index, element) => {
      const $card = $(element);
      const url = new URL($card.attr("href") ?? "", "https://www.cecompetitions.co.uk").toString();
      const sourceId = $card.attr("data-competition-id") ?? "";
      const name = $card.find("h2").first().text().replace(/\s+/g, " ").trim();
      const entryPrice = parseMoney(
        $card.find(".text-2xl")
          .filter((_index, element) => {
            const next = $(element).next();
            return next.find(".text-2xl").length === 0 && /per\s+entry/i.test(next.text());
          })
          .first()
          .text(),
      );
      const ticketsSold = parseInteger($card.find("[data-live-tickets-sold]").first().text());
      const maxTickets = parseInteger($card.find("[data-live-max-tickets]").first().text());
      const drawDate = parseDate($card.attr("data-closes-at"));
      if (
        !sourceId ||
        !name ||
        !url.includes("/competition-home/") ||
        entryPrice < 0 ||
        maxTickets <= 0 ||
        ticketsSold < 0 ||
        ticketsSold >= maxTickets ||
        drawDate === null ||
        drawDate.getTime() <= now.getTime()
      ) {
        return;
      }

      competitions.push({
        sourceId,
        siteName: this.siteName,
        url,
        name,
        entryPrice,
        ticketsSold,
        maxTickets,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: parseCash(name),
        drawDate: drawDate.toISOString(),
        isAutoDraw: false,
        categories: ["cash"],
        scrapedAt: now.toISOString(),
      });
    });

    return competitions;
  }
}

export class SixForGoldAdapter implements SiteAdapter {
  readonly siteName = "sixforgold";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const homeHtml = await fetchHtml("https://6forgold.co.uk/", signal);
    const $ = cheerio.load(homeHtml);
    const cards = new Map<string, { url: string; ticketsSold: number; maxTickets: number; entryPrice: number }>();

    $('a[class*="ai-competition-card-"][href*="/products/"]').each((_index, element) => {
      const $card = $(element);
      const url = new URL($card.attr("href") ?? "", "https://6forgold.co.uk").toString();
      const ticketMatch = $card.text().replace(/\s+/g, " ").match(/([\d,]+)\s*\/\s*([\d,]+)\s+tickets\s+sold/i);
      if (!ticketMatch) return;
      cards.set(url, {
        url,
        ticketsSold: parseInteger(ticketMatch[1]),
        maxTickets: parseInteger(ticketMatch[2]),
        entryPrice: parseMoney(
          $card.find('[class*="ai-competition-card__price-"]').first().text(),
        ),
      });
    });

    const results: RawCompetition[] = [];
    for (const card of cards.values()) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await fetchHtml(card.url, signal);
        const competition = parseSixForGoldDetail(detailHtml, card, new Date());
        if (competition) results.push(competition);
      } catch {
        signal?.throwIfAborted();
      }
    }

    return deduplicate(results);
  }
}

export function parseLegionDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = bodyText($);
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const ticketMatch = text.match(/TICKETS\s+SOLD\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const entryPrice = parseMoney(text.match(/£\s*[\d,.]+\s*PER\s+TICKET/i)?.[0] ?? "");
  const drawDate = parseDate(
    $("meta[property=\"article:expiration_time\"]").attr("content") ??
      text.match(/ENDS\s*([\d]{1,2}\s+[A-Za-z]{3,9}\s+\d{4},?\s+\d{1,2}:\d{2})/i)?.[1],
  );
  const prizeValue = parseMoney(text.match(/RRP\s*£\s*[\d,.]+/i)?.[0] ?? "");
  if (!ticketMatch || !name || entryPrice <= 0 || drawDate === null) return null;

  return usableCompetition({
    sourceId: slugFromPath(url, "/competition/"),
    siteName: "legioncomps",
    url,
    name,
    entryPrice,
    ticketsSold: parseInteger(ticketMatch[1]),
    maxTickets: parseInteger(ticketMatch[2]),
    maxEntriesPerUser: parseInteger(text.match(/Max\s+([\d,]+)\s+per\s+person/i)?.[1]) || 100,
    maxEntriesPerUserSource: "site",
    cashAlternative: parseCash(text),
    estimatedPrizeValue: prizeValue > 0 ? prizeValue : null,
    valuationSource: prizeValue > 0 ? "site_estimate" : null,
    valuationConfidence: prizeValue > 0 ? "medium" : null,
    valuationNotes: prizeValue > 0 ? "Legion Comps detail page RRP." : null,
    drawDate: drawDate.toISOString(),
    isAutoDraw: /instant\s+win/i.test(text),
    categories: ["warhammer"],
    scrapedAt: now.toISOString(),
  }, now);
}

export function parseJackpotzDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = bodyText($);
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const path = new URL(url).pathname;
  let priceText = "";
  $("a[href]").each((_index, element) => {
    if (priceText) return;
    const href = $(element).attr("href") ?? "";
    try {
      if (new URL(href, url).pathname === path) {
        priceText = $(element).find(".woocommerce-Price-amount").first().text();
      }
    } catch {
      // Ignore malformed recommendation links.
    }
  });
  const entryPrice = parseMoney(priceText) || parsePence(text.match(/Tickets\s+are\s+only\s+(\d+)p/i)?.[1]);
  const ticketsSold = parseInteger(text.match(/Tickets\s+sold:\s*([\d,]+)/i)?.[1]);
  const maxTickets = parseInteger(text.match(/limited\s+to\s+([\d,]+)\s+tickets/i)?.[1]);
  const drawDate = parseDate(text.match(/Competition\s+ends:\s*([^\n]+?\d{4}\s+\d{1,2}:\d{2}\s*[ap]m)/i)?.[1]);
  const endPrize = parseMoney(text.match(/£\s*[\d,.]+\s+end\s+(?:draw|prize)/i)?.[0] ?? "");
  if (!name || entryPrice <= 0 || maxTickets <= 0 || drawDate === null) return null;

  return usableCompetition({
    sourceId: slugFromPath(url, "/shop/"),
    siteName: "jackpotzcompetitions",
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    estimatedPrizeValue: endPrize > 0 ? endPrize : null,
    valuationSource: endPrize > 0 ? "site_estimate" : null,
    valuationConfidence: endPrize > 0 ? "medium" : null,
    valuationNotes: endPrize > 0 ? "Jackpotz detail page end prize." : null,
    drawDate: drawDate.toISOString(),
    isAutoDraw: true,
    categories: ["instant-win"],
    scrapedAt: now.toISOString(),
  }, now);
}

export function parseJustOneMoreTicketDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = bodyText($);
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const entryPrice = parseMoney($(".price, .woocommerce-Price-amount").first().text()) || parseMoney(text.match(/\n£\s*[\d,.]+\n/)?.[0] ?? "");
  const ticketsSold = parseInteger(text.match(/Tickets\s+sold:\s*([\d,]+)/i)?.[1]);
  const maxTickets = parseInteger(text.match(/limited\s+to\s+([\d,]+)\s+tickets/i)?.[1]);
  const drawDate = parseDate(text.match(/Competition\s+ends:\s*([^\n]+?\d{4}\s+\d{1,2}:\d{2}\s*[ap]m)/i)?.[1]);
  if (!name || entryPrice <= 0 || maxTickets <= 0 || drawDate === null) return null;

  return usableCompetition({
    sourceId: slugFromPath(url, "/competitions/"),
    siteName: "justonemoreticket",
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    drawDate: drawDate.toISOString(),
    isAutoDraw: /instant\s+win/i.test(text),
    categories: ["instant-win"],
    scrapedAt: now.toISOString(),
  }, now);
}

export function parsePremiumWatchClubDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = bodyText($);
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const entryPrice = parseMoney(text.match(/Entry\s+Price\s*From\s*£\s*[\d,.]+/i)?.[0] ?? "");
  const total = parseInteger(text.match(/Total\s+Entries\s*([\d,]+)\s*max/i)?.[1]);
  const remaining = parseInteger(text.match(/Entries\s+Remaining\s*([\d,]+)\s*left/i)?.[1]);
  const drawDate = parseDate(text.match(/Draw\s+Date\s*([^\n]+?UTC)/i)?.[1]);
  const cashAlternative = parseMoney(text.match(/Cash\s+Alternative\s*£\s*[\d,.]+/i)?.[0] ?? "");
  if (!name || entryPrice <= 0 || total <= 0 || remaining < 0 || drawDate === null) return null;

  return usableCompetition({
    sourceId: slugFromPath(url, "/competitions/"),
    siteName: "premiumwatchclub",
    url,
    name,
    entryPrice,
    ticketsSold: total - remaining,
    maxTickets: total,
    maxEntriesPerUser: parseInteger(text.match(/Maximum\s+([\d,]+)\s+tickets\s+per\s+person/i)?.[1]) || 100,
    maxEntriesPerUserSource: "site",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    drawDate: drawDate.toISOString(),
    isAutoDraw: false,
    categories: ["watches"],
    scrapedAt: now.toISOString(),
  }, now);
}

function parseSixForGoldDetail(
  html: string,
  card: { url: string; ticketsSold: number; maxTickets: number; entryPrice: number },
  now: Date,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = bodyText($);
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const detailPrice = parseMoney(text.match(/Ticket\s+Price:\s*£\s*[\d,.]+/i)?.[0] ?? "");
  const drawDate = parseDate(text.match(/Draw\s+Date:\s*([^\n]+?\d{4})/i)?.[1]);
  if (!name || card.maxTickets <= 0 || drawDate === null) return null;

  return usableCompetition({
    sourceId: slugFromPath(card.url, "/products/"),
    siteName: "sixforgold",
    url: card.url,
    name,
    entryPrice: detailPrice || card.entryPrice,
    ticketsSold: card.ticketsSold,
    maxTickets: card.maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    drawDate: drawDate.toISOString(),
    isAutoDraw: /when\s+all\s+tickets\s+are\s+sold/i.test(text),
    categories: ["shopify"],
    scrapedAt: now.toISOString(),
  }, now);
}

function discoverLinks(html: string, config: DirectDetailSiteConfig): string[] {
  const $ = cheerio.load(html);
  const base = new URL(config.baseUrl);
  const links = new Set<string>();
  $(config.linkSelector).each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    try {
      const url = new URL(href, config.baseUrl);
      if (url.origin === base.origin && config.linkPattern.test(url.pathname)) {
        links.add(url.toString());
      }
    } catch {
      // Ignore malformed or external links.
    }
  });
  return [...links];
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    signal: requestSignal,
  });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

function bodyText($: cheerio.CheerioAPI): string {
  return $("body").text().replace(/\s+/g, " ").trim();
}

function usableCompetition(competition: RawCompetition, now: Date): RawCompetition | null {
  const draw = new Date(competition.drawDate ?? "");
  if (
    !Number.isFinite(draw.getTime()) ||
    draw.getTime() <= now.getTime() ||
    competition.maxTickets <= 0 ||
    competition.ticketsSold < 0 ||
    competition.ticketsSold >= competition.maxTickets ||
    competition.entryPrice < 0
  ) {
    return null;
  }
  return competition;
}

function deduplicate(competitions: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return competitions.filter((competition) => {
    if (seen.has(competition.url)) return false;
    seen.add(competition.url);
    return true;
  });
}

function slugFromPath(url: string, marker: string): string {
  return new URL(url).pathname.split(marker)[1]?.replace(/\/$/, "") ?? url;
}

function parseInteger(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMoney(value: string): number {
  const match = value.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

function parsePence(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed / 100 : 0;
}

function parseCash(value: string): number | null {
  const match =
    value.match(/cash\s+(?:alternative|prize|draw)\D{0,20}£\s*([\d,]+)/i) ??
    value.match(/£\s*([\d,]+)\s+cash(?:\s+(?:alternative|prize|draw))?/i);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const normalized = value
    .replace(/(\d)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+UTC\b/i, " UTC")
    .trim();
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}
