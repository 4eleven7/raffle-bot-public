import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.theweeklywin.co.uk";

export class WeeklyWinAdapter implements SiteAdapter {
  readonly siteName = "weeklywin";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const homeResponse = await fetch(`${BASE_URL}/`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
      signal,
    });
    if (!homeResponse.ok) {
      throw new Error(`[The Weekly Win] Failed to fetch homepage: ${homeResponse.status}`);
    }

    const homeHtml = await homeResponse.text();
    const home = cheerio.load(homeHtml);
    const paths = Array.from(new Set(
      home('a[href^="/competitions/"]')
        .map((_index, element) => String(home(element).attr("href") ?? ""))
        .get()
        .filter(Boolean),
    ));
    const competitions: RawCompetition[] = [];

    for (const path of paths) {
      const response = await fetch(`${BASE_URL}${path}`, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
        signal,
      });
      if (!response.ok) continue;

      const competition = parseWeeklyWinCompetition(
        await response.text(),
        `${BASE_URL}${path}`,
        new Date(),
        homeHtml,
      );
      if (competition) competitions.push(competition);
    }

    return competitions;
  }
}

export function parseWeeklyWinCompetition(
  html: string,
  url: string,
  scrapedAt = new Date(),
  contextHtml = html,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const contextText = cheerio.load(contextHtml)("body").text().replace(/\s+/g, " ").trim();
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const sourceId = url.match(/\/competitions\/([^/?#]+)\/?$/)?.[1] ?? "";
  const price = parseAmount(text.match(/Price\s+per\s+ticket\s*£\s*([\d,.]+)/i)?.[1]);
  const ticketScope = $("span")
    .filter((_index, element) => $(element).text().trim().toLowerCase() === "tickets remaining")
    .first()
    .parent()
    .text()
    .replace(/\s+/g, " ");
  const ticketMatch = (ticketScope || text).match(
    /Tickets\s+remaining\s*([\d,]+)\s*\/\s*([\d,]+)/i,
  );
  const ticketsRemaining = parseAmount(ticketMatch?.[1]);
  const maxTickets = parseAmount(ticketMatch?.[2]);
  const countdown = text.match(
    /Draw\s+closes\s+in:\s*([\d,]+)\s*Days\s*([\d,]+)\s*Hours\s*([\d,]+)\s*Mins?\s*([\d,]+)\s*Secs?/i,
  );
  const maxEntries = parseAmount(text.match(/Max\s+([\d,]+)\s+per\s+order/i)?.[1]);
  const rrp = parseAmount((`${text} ${contextText}`).match(/\bRRP\s*£\s*([\d,.]+)\+?/i)?.[1]);
  const drawDate = countdown
    ? new Date(
        scrapedAt.getTime() +
          (
            parseAmount(countdown[1]) * 86_400 +
            parseAmount(countdown[2]) * 3_600 +
            parseAmount(countdown[3]) * 60 +
            parseAmount(countdown[4])
          ) * 1_000,
      ).toISOString()
    : null;

  if (
    !sourceId ||
    !name ||
    price <= 0 ||
    maxTickets <= 0 ||
    ticketsRemaining < 0 ||
    ticketsRemaining > maxTickets ||
    !drawDate ||
    ticketsRemaining === maxTickets
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: "weeklywin",
    url,
    name,
    entryPrice: price,
    ticketsSold: maxTickets - ticketsRemaining,
    maxTickets,
    maxEntriesPerUser: maxEntries > 0 ? maxEntries : 100,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : "fallback",
    cashAlternative: null,
    estimatedPrizeValue: rrp > 0 ? Math.round(rrp * 0.85) : null,
    valuationSource: rrp > 0 ? "site_estimate" : null,
    valuationConfidence: rrp > 0 ? "medium" : null,
    valuationNotes: rrp > 0 ? "Conservative estimate from the site's stated RRP" : null,
    drawDate,
    isAutoDraw: false,
    categories: ["luxury"],
    scrapedAt: scrapedAt.toISOString(),
  };
}

function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  const amount = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}
