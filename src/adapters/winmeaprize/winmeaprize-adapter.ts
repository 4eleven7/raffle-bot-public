import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "winmeaprize";
const BASE_URL = "https://winmeaprize.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class WinMeAPrizeAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const listingHtml = await fetchPage("/");
    const competitions: RawCompetition[] = [];

    for (const url of parseCompetitionLinks(listingHtml)) {
      try {
        const competition = parseWinMeAPrizeCompetition(await fetchPage(url), url);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parseWinMeAPrizeCompetition(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const sourceId = url.match(/\/Competitions\/[^/]+\/(\d+)(?:[/?#]|$)/i)?.[1] ?? "";
  const name = cleanText(
    $(".item.name h3").first().text() ||
      $(".item.name").first().text() ||
      $("h1").first().text() ||
      $("title").first().text(),
  );
  const soldMatch = text.match(
    /Tickets\s+Sold\s+so\s+far\s*:\s*([\d,]+)\s+from\s+([\d,]+)\s+available/i,
  );
  const ticketsSold = parseNumber(soldMatch?.[1]);
  const maxTickets = parseNumber(soldMatch?.[2]);
  const entryPrice = parseMoney(
    $(".item.tktprc, .tktprc, [class*='tktprc'], .cost").first().text() ||
      text.match(/Tickets\s+only\s+([^.!?]+)/i)?.[1],
  );
  const drawDate = parseDrawDate(text);

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    ticketsSold < 0 ||
    maxTickets <= 0 ||
    ticketsSold > maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  const $currentCompetition = $("#question").first();
  const currentCashText = $currentCompetition.length > 0
    ? $currentCompetition.find(".item.cshalt, .cshalt, .item.r-name, .item.r-desc").text()
    : [
        $(".item.cshalt, .cshalt").first().text(),
        $(".item.r-name").first().text(),
        $(".item.r-desc").first().text(),
      ].join(" ");
  const cashAlternative = extractCashAlternative(`${name} ${currentCashText}`);

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative,
    drawDate,
    isAutoDraw: /guaranteed\s+winner|instant\s+win|auto\s*draw/i.test(text),
    categories: cashAlternative !== null ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $('a[href*="/Competitions/"]').each((_index, element) => {
    const href = $(element).attr("href");
    if (!href || !/\/Competitions\/[^/]+\/\d+(?:[/?#]|$)/i.test(href)) return;

    try {
      const url = new URL(href, BASE_URL).toString().replace(/\/$/, "");
      if (url.startsWith(`${BASE_URL}/Competitions/`)) links.add(url);
    } catch {
      return;
    }
  });

  return Array.from(links).slice(0, 30);
}

async function fetchPage(pathOrUrl: string): Promise<string> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE_URL}${pathOrUrl}`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`WinMeAPrize fetch failed for ${url}: ${response.status}`);
  return response.text();
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /(?:on\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  );
  if (!match) return null;

  const now = DateTime.now().setZone("Europe/London");
  let date = DateTime.fromFormat(
    `${match[1]} ${match[2]} ${now.year} ${match[3]}:${match[4] ?? "00"} ${match[5]}`,
    "d LLLL yyyy h:mm a",
    { zone: "Europe/London" },
  );
  if (!date.isValid) return null;
  if (date < now.minus({ hours: 24 })) date = date.plus({ years: 1 });
  return date.toUTC().toISO({ suppressMilliseconds: false });
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(
    /£\s*([\d,.]+)\s*(k)?\s*(?:tax[\s-]*free\s+)?cash(?:\s+alt(?:ernative)?)?/i,
  );
  if (!match) return null;

  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value * (match[2] ? 1000 : 1) : null;
}

function parseMoney(value: string | undefined): number {
  if (!value) return 0;
  const pence = value.match(/(\d+)\s*p\b/i);
  if (pence) return Number.parseInt(pence[1], 10) / 100;

  const pounds = value.match(/£\s*([\d,.]+)/);
  if (!pounds) return 0;
  const parsed = Number.parseFloat(pounds[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNumber(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
