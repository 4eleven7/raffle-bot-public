import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.grailwatchclub.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class GrailWatchAdapter implements SiteAdapter {
  readonly siteName = "grailwatch";

  async fetchAll(): Promise<RawCompetition[]> {
    const homeHtml = await fetchPage("/");
    const detailUrls = extractProductUrls(homeHtml);
    const competitions: RawCompetition[] = [];

    for (const url of detailUrls) {
      try {
        const detailHtml = await fetchPage(url);
        const competition = parseGrailWatchCompetition(detailHtml, homeHtml, url);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parseGrailWatchCompetition(
  detailHtml: string,
  homeHtml: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(detailHtml);
  const text = cleanText($("body").text());
  const sourceId = url.match(/\/product\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText($("h1").first().text()) || cleanText($("title").first().text()).replace(/\s+-\s+Grail Watch Club$/i, "");
  const entryPrice = parseAmount(text.match(/\b1\s+Ticket\s+£\s*([\d,.]+)/i)?.[1]);
  const maxTickets = parseAmount(text.match(/Odds:\s*1\s*:\s*([\d,]+)/i)?.[1]);
  const remaining = parseAmount(
    text.match(/\b(?:only\s+)?have\s+([\d,]+)\s+tickets?\s+remaining/i)?.[1],
  );
  const ticketsSold = maxTickets - remaining;
  const drawDate = parseDate(homeHtml);
  const cashAlternative = parseAmount(
    `${name} ${text}`.match(/£\s*([\d,.]+)\s+(?:tax[- ]free\s+)?cash\b/i)?.[1],
  );

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    remaining < 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    !drawDate
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: "grailwatch",
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 50,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    drawDate,
    isAutoDraw: false,
    categories: ["watch", ...(cashAlternative > 0 ? ["cash"] : [])],
    scrapedAt: new Date().toISOString(),
  };
}

function extractProductUrls(html: string): string[] {
  const $ = cheerio.load(html);
  const urls = $("a[href*='/product/']")
    .map((_index, element) => absoluteUrl($(element).attr("href") ?? "").replace(/\/+$/, "/"))
    .get()
    .filter((url) => url.startsWith(`${BASE_URL}/product/`));
  return [...new Set(urls)];
}

function parseDate(html: string): string | null {
  const countdown = html.match(
    /\bcountDownTarget\s*=\s*["'](\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})["']/i,
  );
  if (countdown) {
    const date = DateTime.fromFormat(countdown[1], "yyyy-MM-dd HH:mm:ss", {
      zone: "Europe/London",
    });
    if (date.isValid) return date.toUTC().toISO({ suppressMilliseconds: false });
  }

  const match = cleanText(cheerio.load(html)("body").text()).match(
    /\b(?:Live\s+draw|Live\s+Draw)\s+(?:on\s+Instagram\s*[–-]\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
  );
  if (!match) return null;

  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseAmount(value: string | undefined): number {
  const parsed = Number.parseFloat((value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http")) return href;
  return `${BASE_URL}${href.startsWith("/") ? href : `/${href}`}`;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function fetchPage(pathOrUrl: string): Promise<string> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`Grail Watch Club returned ${response.status}`);
  return response.text();
}
