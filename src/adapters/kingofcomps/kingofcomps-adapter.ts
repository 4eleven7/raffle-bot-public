import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://kingofcomps.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class KingOfCompsAdapter implements SiteAdapter {
  readonly siteName = "kingofcomps";

  async fetchAll(): Promise<RawCompetition[]> {
    const homeHtml = await fetchPage("/");
    const $ = cheerio.load(homeHtml);
    const links = Array.from(
      new Set(
        $('a[href*="/competition/"]')
          .map((_i, element) => absoluteUrl($(element).attr("href") ?? ""))
          .get()
          .filter((url) => url.startsWith(`${BASE_URL}/competition/`)),
      ),
    );
    const competitions: RawCompetition[] = [];

    for (const url of links) {
      try {
        const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (!response.ok) continue;
        const competition = parseKingOfCompsCompetition(await response.text(), url);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parseKingOfCompsCompetition(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const sourceId = url.match(/\/competition\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText($("h1").first().text());
  const entryPrice = parseAmount(text.match(/£\s*([\d,.]+)\s*Per\s+Ticket/i)?.[1]);
  const ticketMatch = text.match(
    /([\d,]+)\s*TICKETS\s*REMAINING\s*([\d,]+)\s*\/\s*([\d,]+)/i,
  );
  const ticketsSold = parseAmount(ticketMatch?.[2]);
  const maxTickets = parseAmount(ticketMatch?.[3]);
  const countdownSeconds = Number(
    html.match(/remaining:\s*([\d.]+)/i)?.[1] ?? "",
  );
  const drawDate = Number.isFinite(countdownSeconds) && countdownSeconds > 0
    ? new Date(Date.now() + countdownSeconds * 1000).toISOString()
    : null;
  const cashAlternative = extractCashAlternative(`${name} ${text}`);

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: "kingofcomps",
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative,
    drawDate,
    isAutoDraw: /instant|instantly/i.test(name),
    categories: cashAlternative !== null ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  };
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/£\s*([\d,.]+)\s*END\s*PRIZE/i);
  const value = parseAmount(match?.[1]);
  return value > 0 ? value : null;
}

function parseAmount(value: string | undefined): number {
  const parsed = Number.parseFloat((value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function absoluteUrl(href: string): string {
  return href.startsWith("http") ? href : `${BASE_URL}${href.startsWith("/") ? href : `/${href}`}`;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function fetchPage(path: string): Promise<string> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`King of Comps returned ${response.status}`);
  return response.text();
}
