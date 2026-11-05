import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://alphacomps.uk";
const COMPETITION_PATHS = [
  "/go/rangerover/",
  "/go/graded-grails-2/",
] as const;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class AlphaAdapter implements SiteAdapter {
  readonly siteName = "alpha";

  async fetchAll(): Promise<RawCompetition[]> {
    const competitions: RawCompetition[] = [];

    for (const path of COMPETITION_PATHS) {
      try {
        const response = await fetch(`${BASE_URL}${path}`, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
          },
        });
        if (!response.ok) continue;

        const competition = parseAlphaCompetition(
          await response.text(),
          `${BASE_URL}${path}`,
        );
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parseAlphaCompetition(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($.root().text());
  const name = cleanText(
    $(".gradientheading").first().text() || $("h1").first().text(),
  );
  const sourceId = url.match(/\/go\/([^/]+)\/?$/)?.[1] ?? "";
  const entryPrice = parsePrice(
    $("h2").filter((_i, el) => /per\s+ticket/i.test($(el).text())).first().text(),
  );
  const ticketsSold = parseInteger(text.match(/tickets\s+sold:\s*([\d,]+)/i)?.[1]);
  const maxTickets = parseInteger(
    text.match(/maximum\s+amount\s+of\s+tickets\s+is\s*([\d,]+)/i)?.[1],
  );
  const drawDate = parseDrawDate(text);
  if (!sourceId || !name || entryPrice <= 0 || ticketsSold < 0 || maxTickets <= 0) {
    return null;
  }
  if (ticketsSold > maxTickets || drawDate === null) return null;

  const cashAlternative = extractCashAlternative(text);
  return {
    sourceId,
    siteName: "alpha",
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative,
    drawDate,
    isAutoDraw: /\binstant\s+win\b/i.test(name),
    categories: cashAlternative !== null ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /This\s+Competition\s+ends\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:am|pm))/i,
  );
  if (!match) return null;

  const date = DateTime.fromFormat(`${match[1]} ${match[2]}`, "LLLL d, yyyy h:mm a", {
    zone: "Europe/London",
  });
  return date.isValid ? date.toUTC().toISO() : null;
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(
    /£\s*([\d,.]+)\s*(k)?\s*cash\s+alternative/i,
  );
  if (!match) return null;

  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;
  return match[2] ? value * 1000 : value;
}

function parsePrice(text: string): number {
  const match = text.match(/£\s*([\d,.]+)/);
  if (!match) return 0;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function parseInteger(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
