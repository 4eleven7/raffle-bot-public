import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { fetchRenderedHtml } from "../browser/browser-pool.js";

const BASE_URL = "https://winthemoment.co.uk";
const LIST_PATH = "/competitions";

type RenderedPageFetcher = (
  url: string,
  waitSelector?: string,
  signal?: AbortSignal,
) => Promise<string>;

export class WinTheMomentAdapter implements SiteAdapter {
  readonly siteName = "winthemoment";
  readonly scanCost = "browser" as const;

  constructor(
    private readonly renderedPageFetcher: RenderedPageFetcher = fetchRenderedHtml,
  ) {}

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listingHtml = await this.renderedPageFetcher(
      `${BASE_URL}${LIST_PATH}`,
      'a[href*="/competition/"]',
      signal,
    );
    const links = extractCompetitionLinks(listingHtml);
    const competitions: RawCompetition[] = [];
    let failedDetails = 0;

    for (const url of links) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await this.renderedPageFetcher(url, "h1", signal);
        const competition = parseDetail(detailHtml, url);
        if (competition && competition.ticketsSold < competition.maxTickets) {
          competitions.push(competition);
        }
      } catch {
        signal?.throwIfAborted();
        failedDetails += 1;
      }
    }

    if (links.length > 0 && competitions.length === 0) {
      throw new Error(
        `[Win The Moment] No competition details parsed (${failedDetails} detail failures)`,
      );
    }

    return competitions;
  }
}

function extractCompetitionLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links = new Set<string>();

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const url = new URL(href, BASE_URL);
    if (url.origin !== BASE_URL || !/^\/competition\/[^/]+\/?$/.test(url.pathname)) {
      return;
    }

    url.hash = "";
    url.search = "";
    links.add(url.toString().replace(/\/$/, ""));
  });

  return [...links];
}

function parseDetail(html: string, url: string): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText(
    ($("body").html() ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&amp;/gi, "&"),
  );
  const sourceId = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  const name = cleanText($("h1").first().text()) || cleanText($("h2").first().text());
  const price = text.match(/Price\s+per\s+entry\s+£\s*([\d.]+)/i);
  const inventory = text.match(
    /(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s+tickets\s+sold/i,
  );
  const drawDate = parseDrawDate(text);
  const maxEntries = text.match(/Max\s+(\d[\d,]*)\s+per\s+person/i);

  if (!sourceId || !name || !price || !inventory || !drawDate || !maxEntries) {
    return null;
  }

  const ticketsSold = parseInt(inventory[1].replace(/,/g, ""), 10);
  const maxTickets = parseInt(inventory[2].replace(/,/g, ""), 10);
  const maxEntriesPerUser = parseInt(maxEntries[1].replace(/,/g, ""), 10);
  if (
    !Number.isFinite(ticketsSold) ||
    !Number.isFinite(maxTickets) ||
    !Number.isFinite(maxEntriesPerUser) ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    maxEntriesPerUser <= 0
  ) {
    return null;
  }

  const category = text.match(/\b([A-Za-z]+(?:\s*&\s*[A-Za-z]+)?)\s+skill\b/i)?.[1];
  const prizeDescription = text.match(
    /About\s+this\s+Prize\s+(.+?)(?=\s+Price\s+per\s+entry\b)/i,
  )?.[1];

  return {
    sourceId,
    siteName: "winthemoment",
    url,
    name,
    prizeDescription: prizeDescription ? cleanText(prizeDescription) : undefined,
    prizeEvidence: url,
    entryPrice: parseFloat(price[1]),
    ticketsSold,
    maxTickets,
    inventorySource: "exact",
    maxEntriesPerUser,
    maxEntriesPerUserSource: "site",
    cashAlternative: null,
    drawDate,
    isAutoDraw: false,
    categories: category
      ? category.split(/\s*&\s*|\s*,\s*/).map((value) => value.toLowerCase())
      : [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseDrawDate(text: string): string | null {
  const match = text.match(
    /DRAW\s+CLOSES\s+IN\s+[A-Za-z]{3},?\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})/i,
  );
  if (!match) return null;

  const date = DateTime.fromFormat(
    `${match[1]} ${match[2]} ${match[3]} ${match[4]}:${match[5]}`,
    "d LLLL yyyy HH:mm",
    { zone: "Europe/London" },
  );
  return date.isValid ? date.toUTC().toISO() : null;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
