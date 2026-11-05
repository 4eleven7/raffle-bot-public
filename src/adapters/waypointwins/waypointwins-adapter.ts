import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "waypointwins";
const BASE_URL = "https://waypointwins.co.uk";
const LIST_PATH = "/competitions";
const FETCH_TIMEOUT_MS = 15_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class WaypointWinsAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listingHtml = await fetchHtml(`${BASE_URL}${LIST_PATH}`, signal);
    const links = extractCompetitionLinks(listingHtml);
    const competitions: RawCompetition[] = [];
    let failedDetails = 0;

    for (const url of links) {
      signal?.throwIfAborted();
      try {
        const competition = parseWaypointWinsDetail(
          await fetchHtml(url, signal),
          url,
          new Date(),
        );
        if (competition) competitions.push(competition);
      } catch {
        signal?.throwIfAborted();
        failedDetails += 1;
      }
    }

    if (links.length > 0 && competitions.length === 0) {
      throw new Error(
        `[Waypoint Wins] No competition details parsed (${failedDetails} detail failures)`,
      );
    }

    return competitions;
  }
}

export function parseWaypointWinsDetail(
  html: string,
  url: string,
  now = new Date(),
): RawCompetition | null {
  const $ = cheerio.load(html);
  const sourceId = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "";
  const name = cleanText($("h1").first().text());
  const prizeDescription = fact($, "Prize");
  const entryPrice = parseMoney(fact($, "Ticket price"));
  const inventoryMatch = bodyText($).match(
    /(\d[\d,]*)\s*%\s*sold\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/i,
  );
  const closeDate = parseCloseDate(fact($, "Closes"));
  const cashAlternative = parseCash(prizeDescription || name);
  const numericEntryLimit = parseInteger(fact($, "Entry limit"));

  if (
    !sourceId ||
    !name ||
    !prizeDescription ||
    entryPrice <= 0 ||
    !inventoryMatch ||
    !closeDate ||
    new Date(closeDate).getTime() <= now.getTime()
  ) {
    return null;
  }

  const ticketsSold = parseInteger(inventoryMatch[2]);
  const maxTickets = parseInteger(inventoryMatch[3]);
  if (maxTickets <= 0 || ticketsSold < 0 || ticketsSold >= maxTickets) return null;

  return {
    sourceId,
    siteName: SITE_NAME,
    url,
    name,
    prizeDescription,
    prizeEvidence: prizeDescription,
    prizePayout: { kind: "fixed" },
    entryPrice,
    ticketsSold,
    maxTickets,
    inventorySource: "exact",
    maxEntriesPerUser: numericEntryLimit > 0 ? numericEntryLimit : 1,
    maxEntriesPerUserSource: numericEntryLimit > 0 ? "site" : "fallback",
    cashAlternative,
    ...(cashAlternative > 0
      ? {
          valuationSource: "cash" as const,
          valuationConfidence: "high" as const,
        }
      : {}),
    drawDate: closeDate,
    isAutoDraw: false,
    categories: cashAlternative > 0 ? ["cash"] : ["prize"],
    scrapedAt: now.toISOString(),
  };
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

function fact($: cheerio.CheerioAPI, label: string): string {
  const value = $("dt")
    .filter((_index, element) => cleanText($(element).text()).toLowerCase() === label.toLowerCase())
    .first()
    .next("dd")
    .text();
  return cleanText(value);
}

function parseCloseDate(value: string): string | null {
  const match = value.match(
    /(?:[A-Za-z]+,\s*)?(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+at\s+(\d{1,2}):(\d{2})/i,
  );
  if (!match) return null;

  const date = DateTime.fromFormat(
    `${match[1]} ${match[2]}:${match[3]}`,
    "d LLLL yyyy H:mm",
    { zone: "Europe/London" },
  );
  return date.isValid ? date.toUTC().toISO() : null;
}

function parseMoney(value: string): number {
  const match = value.match(/£\s*([\d,.]+)/);
  if (!match) return 0;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCash(value: string): number {
  return parseMoney(value.match(/£\s*[\d,.]+\s+cash(?:\s+prize|\s+alternative)?/i)?.[0] ?? "");
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bodyText($: cheerio.CheerioAPI): string {
  const body = $("body").clone();
  body.find("script, style, noscript").remove();
  return cleanText(body.text());
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": USER_AGENT,
    },
    signal: requestSignal,
  });
  if (!response.ok) throw new Error(`[Waypoint Wins] ${url}: HTTP ${response.status}`);
  return response.text();
}
