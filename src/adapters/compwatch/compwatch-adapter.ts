import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { CompWatchSiteConfig } from "./compwatch-site-config.js";

const COMPWATCH_BASE_URL = "https://compwatch.co.uk";
const UK_ZONE = "Europe/London";

export class CompWatchAdapter implements SiteAdapter {
  readonly siteName: string;
  readonly scanCost = "heavy";

  constructor(private readonly config: CompWatchSiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(): Promise<RawCompetition[]> {
    const listHtml = await this.fetchPath(`/sites/${this.config.slug}`);
    const detailPaths = parseCompWatchListLinks(listHtml, this.config);
    const competitions: RawCompetition[] = [];

    for (const detailPath of detailPaths) {
      try {
        await delay(this.config.fetchDelayMs);
        const detailHtml = await this.fetchPath(detailPath);
        const competition = parseCompWatchDetail(
          detailHtml,
          this.config,
          absoluteCompWatchUrl(detailPath),
        );
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions.filter((competition) => (
      competition.maxTickets <= 0 ||
      competition.ticketsSold < competition.maxTickets
    ));
  }

  private async fetchPath(path: string): Promise<string> {
    const url = absoluteCompWatchUrl(path);
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.config.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`[${this.config.displayName}] Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  }
}

export function parseCompWatchListLinks(
  html: string,
  config: Pick<CompWatchSiteConfig, "slug">,
): string[] {
  const $ = cheerio.load(html);
  const paths: string[] = [];
  const seen = new Set<string>();
  const prefix = `/sites/${config.slug}/`;

  $(`a[href^="${prefix}"]`).each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const path = href.split("#")[0]?.split("?")[0] ?? "";
    if (!path.startsWith(prefix)) return;
    if (path === prefix || path.endsWith("/badge")) return;
    if (seen.has(path)) return;

    seen.add(path);
    paths.push(path);
  });

  return paths;
}

export function parseCompWatchDetail(
  html: string,
  config: Pick<CompWatchSiteConfig, "siteName" | "displayName">,
  detailUrl: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const mainText = cleanText($("main").text() || $("body").text());
  const name = cleanText($("h1").first().text()) || parseTitleName($("title").text());
  const sourceId = parseSourceId(detailUrl);
  const entryPrice = parseEntryPrice(mainText);
  const ticketCounts = parseTicketCounts(mainText);
  const drawDate = parseDrawDate(mainText);
  const maxEntriesPerUser = parseMaxEntriesPerUser(mainText);

  if (
    !name ||
    !sourceId ||
    entryPrice === null ||
    ticketCounts === null ||
    drawDate === null
  ) {
    return null;
  }

  const enterPath = $("a")
    .toArray()
    .map((element) => $(element).attr("href") ?? "")
    .find((href) => href.startsWith("/go/"));
  const categories = parseCategories($);
  if (entryPrice === 0 && !categories.some((category) => category === "free")) {
    categories.push("free");
  }
  const prizeText = mainText.split(/\bTicket Price\b/i)[0] ?? mainText;
  const scrapedAt = new Date().toISOString();

  return {
    sourceId,
    siteName: config.siteName,
    url: enterPath ? absoluteCompWatchUrl(enterPath) : detailUrl,
    name,
    entryPrice,
    ticketsSold: ticketCounts.sold,
    maxTickets: ticketCounts.total,
    maxEntriesPerUser: maxEntriesPerUser ?? 100,
    maxEntriesPerUserSource: maxEntriesPerUser === null ? "fallback" : "site",
    cashAlternative: extractCashAlternative(`${name} ${prizeText}`, categories),
    drawDate,
    isAutoDraw: /\bauto(?:mated)?\s+draw\b/i.test(mainText),
    categories,
    scrapedAt,
  };
}

function parseTitleName(title: string): string {
  return cleanText(title.split(" — ")[0] ?? "");
}

function parseSourceId(url: string): string | null {
  const parsed = url.match(/\/sites\/[^/]+\/([^-/?#]+)/);
  if (parsed) return parsed[1];

  const go = url.match(/\/go\/([^/?#]+)/);
  return go?.[1] ?? null;
}

function parseEntryPrice(text: string): number | null {
  const freeMatch = text.match(/\bTicket Price\s+FREE\b/i);
  if (freeMatch) return 0;

  const priceMatch = text.match(/\bTicket Price\s+£\s*([\d,.]+)/i);
  if (priceMatch) {
    const price = Number(priceMatch[1].replace(/,/g, ""));
    return Number.isFinite(price) ? price : null;
  }

  const penceMatch = text.match(/\bTicket Price\s+(\d+(?:\.\d+)?)\s*p\b/i);
  const fallbackPenceMatch =
    penceMatch ??
    text.match(/\b(?:only|just|for\s+just)\s+(\d+(?:\.\d+)?)\s*p\b/i) ??
    text.match(/\b(\d+(?:\.\d+)?)\s*p\s+(?:a|per)\s+(?:go|ticket|entry)\b/i);
  if (!fallbackPenceMatch) {
    return /\b(?:complete\s+free|free\s+(?:bundle|competition|raffle))\b/i.test(text)
      ? 0
      : null;
  }

  const pence = Number(fallbackPenceMatch[1]);
  return Number.isFinite(pence) ? pence / 100 : null;
}

function parseTicketCounts(text: string): { sold: number; total: number } | null {
  const match = text.match(/\bTickets Sold\s+([\d,]+)\s*\/\s*([\d,]+)/i);
  if (!match) return null;

  const sold = Number(match[1].replace(/,/g, ""));
  const total = Number(match[2].replace(/,/g, ""));
  if (!Number.isFinite(sold) || !Number.isFinite(total) || total <= 0 || sold < 0) {
    return null;
  }

  return { sold, total };
}

function parseMaxEntriesPerUser(text: string): number | null {
  const match =
    text.match(/\bMax(?:imum)?\s+(?:Tickets?|Entries)\s+Per\s+(?:User|Customer|Person)\s+([\d,]+)/i) ??
    text.match(/\bMax(?:imum)?\s+Per\s+(?:User|Customer|Person)\s+([\d,]+)/i) ??
    text.match(/\b([\d,]+)\s+(?:tickets?|entries)\s+per\s+(?:user|customer|person)\b/i);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /\bCloses\s+[A-Za-z]{3}\s+(\d{1,2})\s+([A-Za-z]{3})\s*,?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
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

  const now = DateTime.now().setZone(UK_ZONE);
  let date = DateTime.fromObject(
    {
      year: now.year,
      month,
      day: Number(dayText),
      hour,
      minute,
    },
    { zone: UK_ZONE },
  );

  if (!date.isValid) return null;
  if (date < now.minus({ hours: 24 })) {
    date = date.plus({ years: 1 });
  }

  return date.toUTC().toISO({ suppressMilliseconds: false });
}

function parseCategories($: cheerio.CheerioAPI): string[] {
  const categories = new Set<string>();

  $("main").find('a[href^="/competitions/"]').each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const text = cleanText($(element).text());
    if (href === "/competitions" || !text || text === "Competitions") return;
    categories.add(text.toLowerCase());
    return false;
  });

  return Array.from(categories);
}

function extractCashAlternative(text: string, categories: string[]): number | null {
  const cashCategory = categories.some((category) => category.includes("cash"));
  const cashText = /\b(?:cash|tax-free|bank transfer|wonga)\b/i.test(text);

  const explicitAlternative =
    text.match(/\b(?:or|take|cash\s+alternative|cash\s+alt(?:ernative)?|cash\s+option)\s*£\s*([\d,.]+)\s*(k)?\s*(?:cash|tax-free|alternative|alt(?:ernative)?|option)?\b/i) ||
    text.match(/£\s*([\d,.]+)\s*(k)?\s*(?:cash\s+alternative|cash\s+alt(?:ernative)?|cash\s+option)\b/i);
  if (explicitAlternative) return parsedCashAmount(explicitAlternative[1], explicitAlternative[2]);

  if (!cashCategory && !cashText) return null;

  const cashAmount =
    text.match(/£\s*([\d,.]+)\s*(k)?\s*(?:tax[\s-]*free\s*)?cash\b/i) ||
    text.match(/\b(?:cash|tax[\s-]*free)\D{0,30}£\s*([\d,.]+)\s*(k)?/i) ||
    (cashCategory ? text.match(/£\s*([\d,.]+)\s*(k)?/i) : null);
  if (!cashAmount) return null;

  return parsedCashAmount(cashAmount[1], cashAmount[2]);
}

function parsedCashAmount(valueText: string, suffix?: string): number | null {
  const value = Number(valueText.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  const amount = suffix ? value * 1000 : value;
  return amount >= 25 ? amount : null;
}

function monthNumber(value: string): number | null {
  const months: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  return months[value.slice(0, 3).toLowerCase()] ?? null;
}

function absoluteCompWatchUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${COMPWATCH_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
