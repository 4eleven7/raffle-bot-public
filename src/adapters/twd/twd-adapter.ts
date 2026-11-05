import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://twdcompetitions.com";
const LIST_PATH = "/product-category/competitions/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class TwdAdapter implements SiteAdapter {
  readonly siteName = "twd";

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await fetchHtml(`${BASE_URL}${LIST_PATH}`);
    const $ = cheerio.load(html);
    const links = $("li.product a.woocommerce-LoopProduct-link[href]")
      .map((_i, el) => $(el).attr("href") ?? "")
      .get()
      .filter(Boolean);
    const uniqueLinks = [...new Set(links)];

    const competitions: RawCompetition[] = [];
    for (const url of uniqueLinks) {
      const comp = await this.fetchDetail(url).catch(() => null);
      if (comp) competitions.push(comp);
    }

    return competitions;
  }

  private async fetchDetail(url: string): Promise<RawCompetition | null> {
    const html = await fetchHtml(url);
    const $ = cheerio.load(html);
    $("script, style").remove();
    const text = cleanText($("body").text());

    if (/Competition Closed|Lottery has finished/i.test(text)) return null;

    const title =
      $("h1.product_title").first().text().trim() ||
      $("h1").first().text().trim();
    if (!title) return null;

    const sourceId =
      $("button[name='add-to-cart']").attr("value") ||
      url.match(/\/product\/([^/]+)/)?.[1] ||
      slugify(title);

    const price = parseCurrentPrice($, text);
    const progress = parseProgress(text);
    const productText = extractPrimaryProductText(text, title);
    const maxEntriesPerUser = extractMaxEntries(productText);

    return {
      sourceId,
      siteName: this.siteName,
      url,
      name: title,
      entryPrice: price,
      ticketsSold: progress.sold,
      maxTickets: progress.max,
      maxEntriesPerUser: maxEntriesPerUser ?? 100,
      maxEntriesPerUserSource: maxEntriesPerUser === null ? "fallback" : "site",
      cashAlternative: extractCashAlternative(`${title} ${productText}`),
      drawDate: extractDrawDate(html, text),
      isAutoDraw: /auto draw|instant win/i.test(text),
      categories: [],
      scrapedAt: new Date().toISOString(),
    };
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`[TWD Competitions] Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function parseCurrentPrice($: cheerio.CheerioAPI, text: string): number {
  const current = $("ins .woocommerce-Price-amount, p.price ins .amount").first().text();
  const regular = $("p.price .woocommerce-Price-amount, .summary .price .amount").last().text();
  const match = (current || regular || text).match(/£\s*([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

function parseProgress(text: string): { sold: number; max: number } {
  const progress = text.match(/\bSOLD:\s*([\d,]+)\s+LEFT:\s*([\d,]+)/i);
  const sold = parseNumber(progress?.[1] ?? text.match(/\bSOLD:\s*([\d,]+)/i)?.[1]);
  const left = parseNumber(progress?.[2] ?? text.match(/\bLEFT:\s*([\d,]+)/i)?.[1]);
  return {
    sold,
    max: sold + left,
  };
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/£\s*([\d,]+)\s*cash\s*alt(?:ernative)?/i) ||
    text.match(/£\s*([\d,]+)\s*cash alternative/i) ||
    text.match(/or\s+(?:the\s+)?£\s*([\d,]+)\s*(?:cash|tax free cash|cash alt(?:ernative)?)/i) ||
    text.match(/winner takes[^.]{0,120}?or\s+(?:the\s+)?£\s*([\d,]+)\s*cash/i) ||
    text.match(/£\s*([\d,]+)\s+(?!credit\b)[^£]{0,20}\bend draw/i);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

function extractMaxEntries(text: string): number | null {
  const match = text.match(/capped at\s+([\d,]+)\s+entries/i);
  return match ? parseNumber(match[1]) : null;
}

function extractDrawDate(html: string, text: string): string | null {
  const epoch = html.match(/data-time=["'](\d{10,13})["']/i);
  if (epoch) {
    const raw = Number(epoch[1]);
    const millis = raw > 9_999_999_999 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }

  const match = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\b[^.]{0,80}?\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (!match) return null;

  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const month = months[match[2].toLowerCase()];
  if (month === undefined) return null;

  const d = new Date();
  d.setMonth(month, parseInt(match[1], 10));
  let hours = parseInt(match[3], 10);
  if (match[5].toLowerCase() === "pm" && hours < 12) hours += 12;
  if (match[5].toLowerCase() === "am" && hours === 12) hours = 0;
  d.setHours(hours, parseInt(match[4] ?? "0", 10), 0, 0);
  if (d.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString();
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractPrimaryProductText(text: string, title: string): string {
  const start = text.indexOf(title);
  if (start < 0) return text;

  let end = text.length;
  for (const marker of [
    "Frequently Asked Questions",
    "Related products",
    "Related Products",
    "You may also like",
    "Recently Viewed",
  ]) {
    const markerIndex = text.indexOf(marker, start + title.length);
    if (markerIndex > start && markerIndex < end) end = markerIndex;
  }

  return text.slice(start, end);
}

function parseNumber(value: string | undefined): number {
  return value ? parseInt(value.replace(/,/g, ""), 10) || 0 : 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
