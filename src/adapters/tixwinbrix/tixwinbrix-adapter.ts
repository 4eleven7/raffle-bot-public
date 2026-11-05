import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "tixwinbrix";
const BASE_URL = "https://tixwinbrix.co.uk";
const DETAIL_IDS = [19, 20, 21, 22];
const MANUAL_PRIZE_VALUES: Record<string, number> = {
  "19": 90,
  "21": 120,
};
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class TixWinBrixAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const competitions: RawCompetition[] = [];
    for (const id of DETAIL_IDS) {
      const url = `${BASE_URL}/competitions.html?id=${id}`;
      try {
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) continue;
        const competition = parseTixWinBrixDetail(await response.text(), url);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parseTixWinBrixDetail(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const bodyText = cleanText($("body").text());
  const sourceId = new URL(url).searchParams.get("id") ?? "";
  const sold = parseNumber($(".entries_sold").first().text());
  const total = parseNumber($(".max_entries").first().text());
  const entryPrice = parseMoney($(".draw_price").first().text());
  const maxEntriesPerUser = parseNumber($(".max_per_entry").first().text()) || 100;
  const drawDate = parseClosingDate(bodyText);
  const prizeSection = $(".prize_details").first().next(".content");
  const prizeText = cleanText(
    prizeSection.length > 0
      ? prizeSection.text()
      : $(".information_container.content").first().text(),
  );
  const prizeMatch = prizeText.match(/Main Prize\s+(.+?)(?:\s*INSTANT WINS|$)/i);
  const fallbackName = cleanText($(".product_description").first().text()) || "";
  const name = cleanText(prizeMatch?.[1] ?? fallbackName.replace(/\s+plus\s+instant wins?$/i, ""));
  const estimatedPrizeValue = MANUAL_PRIZE_VALUES[sourceId] ?? null;

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    sold < 0 ||
    total <= 0 ||
    sold >= total ||
    drawDate === null ||
    new Date(drawDate).getTime() <= Date.now()
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold: sold,
    maxTickets: total,
    maxEntriesPerUser,
    maxEntriesPerUserSource: "site",
    cashAlternative: extractCashAlternative(`${name} ${bodyText}`),
    estimatedPrizeValue,
    valuationSource: estimatedPrizeValue === null ? null : "manual_estimate",
    valuationConfidence: estimatedPrizeValue === null ? null : "medium",
    valuationNotes: estimatedPrizeValue === null
      ? null
      : "Manual estimate from the matching official LEGO UK product price",
    drawDate,
    isAutoDraw: false,
    categories: /instant wins?/i.test(bodyText) ? ["instant wins"] : [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseClosingDate(text: string): string | null {
  const match = text.match(
    /closing date of this competition is (\d{1,2})-(\d{1,2})-(\d{2,4})/i,
  );
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = DateTime.fromObject(
    { year, month, day, hour: 23, minute: 59, second: 59 },
    { zone: "Europe/London" },
  );
  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function parseNumber(text: string): number {
  const match = text.match(/[\d,]+/);
  const value = Number((match?.[0] ?? "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function parseMoney(text: string): number {
  const match = text.match(/£\s*([\d,.]+)/);
  const value = Number((match?.[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/£\s*([\d,.]+)\s*(?:cash|cash alternative)/i);
  const value = Number((match?.[1] ?? "").replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
