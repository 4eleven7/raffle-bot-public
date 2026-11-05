import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://prizle.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class PrizleAdapter implements SiteAdapter {
  readonly siteName = "prizle";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/competitions`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) throw new Error(`Prizle returned ${response.status}`);

    const $ = cheerio.load(await response.text());
    const links = Array.from(
      new Set(
        $('a[href*="/competitions/"]')
          .map((_i, element) => absoluteUrl($(element).attr("href") ?? ""))
          .get()
          .filter((url) => url.startsWith(`${BASE_URL}/competitions/`)),
      ),
    );
    const competitions: RawCompetition[] = [];

    for (const url of links) {
      try {
        const detail = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
        if (!detail.ok) continue;
        const competition = parsePrizleCompetition(await detail.text(), url);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

export function parsePrizleCompetition(
  html: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const sourceId = url.match(/\/competitions\/([^/?#]+)/)?.[1] ?? "";
  const name = cleanText($(".comp-detail__hero-title, h1").first().text());
  const entryPrice = parseAmount(
    text.match(/£\s*([\d,.]+)\s*\/\s*ticket/i)?.[1],
  );
  const ticketMatch = text.match(
    /([\d,]+)\s*\/\s*([\d,]+)\s*Tickets?\s*sold/i,
  );
  const ticketsSold = parseAmount(ticketMatch?.[1]);
  const maxTickets = parseAmount(ticketMatch?.[2]);
  const drawEpoch = Number(
    html.match(/competitionCountdown\((\d{10,13})\)/i)?.[1] ?? "",
  );
  const drawDate = Number.isFinite(drawEpoch) && drawEpoch > 0
    ? new Date(drawEpoch > 9_999_999_999 ? drawEpoch : drawEpoch * 1000).toISOString()
    : null;
  const cashAlternative = extractCashAlternative(text);
  const maxEntriesPerUser = parseAmount(
    html.match(/"max_per_user"\s*:\s*(\d+)/)?.[1],
  );

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
    siteName: "prizle",
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: /instant|spin|ace/i.test(name),
    categories: cashAlternative !== null ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  };
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/take\s+£\s*([\d,.]+)\s*cash/i) ??
    text.match(/£\s*([\d,.]+)\s*cash\s+alternative/i);
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
