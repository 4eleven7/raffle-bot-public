import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://competition-cacars.dotnetcloud.co.uk";
const SITE_NAME = "cacars";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class CaCarsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(BASE_URL, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(`[CA Cars] Failed to fetch ${BASE_URL}: ${response.status}`);
    }

    const competition = parseCaCarsPage(await response.text(), BASE_URL);
    return competition ? [competition] : [];
  }
}

export function parseCaCarsPage(html: string, url: string): RawCompetition | null {
  const $ = cheerio.load(html);
  const name = cleanText($("h1").first().text());
  const table = readTable($);
  const prize = table.get("prize");
  const ends = table.get("competition ends");
  const totalTickets = parseInteger(table.get("total tickets"));
  const entryPrice = parseMoney(table.get("ticket price"));
  const maxEntriesPerUser = parseInteger(table.get("max. tickets per entry")) ?? 0;
  const ticketsSold = parseInteger($("progress").first().attr("value")) ?? parseSoldText($);
  const drawDate = parseUkDateTime(ends);

  if (
    !name ||
    !prize ||
    entryPrice === null ||
    ticketsSold === null ||
    totalTickets === null ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId: "40th-birthday-raffle",
    siteName: SITE_NAME,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets: totalTickets,
    maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative: null,
    estimatedPrizeValue: 20800,
    valuationSource: "manual_estimate",
    valuationConfidence: "medium",
    valuationNotes: "Near-new Hyundai i20 UK market reference; dual-control value not added",
    drawDate,
    isAutoDraw: false,
    categories: ["car"],
    scrapedAt: new Date().toISOString(),
  };
}

function readTable($: cheerio.CheerioAPI): Map<string, string> {
  const values = new Map<string, string>();
  $("table tr").each((_index, row) => {
    const key = cleanText($(row).find("th").first().text()).toLowerCase();
    const value = cleanText($(row).find("td").first().text());
    if (key && value) values.set(key, value);
  });
  return values;
}

function parseSoldText($: cheerio.CheerioAPI): number | null {
  const match = cleanText($("body").text()).match(/\b([\d,]+)\s+sold\b/i);
  return parseInteger(match?.[1]);
}

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/£?\s*([\d,.]+)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUkDateTime(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = DateTime.fromFormat(value.trim(), "dd/MM/yyyy HH:mm:ss", {
    zone: "Europe/London",
  });
  return parsed.isValid ? parsed.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
