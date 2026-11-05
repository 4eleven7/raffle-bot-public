import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "goldendreamdraw";
const DISPLAY_NAME = "Golden Dream Draw";
const BASE_URL = "https://goldendreamdraw.uk";
const LISTING_URL = `${BASE_URL}/en/competitions`;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

export class GoldenDreamDrawAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const listingHtml = await fetchText(LISTING_URL, signal);
    const competitions = parseGoldenDreamDrawListing(listingHtml);

    return Promise.all(
      competitions.map(async (competition) => {
        try {
          const detailHtml = await fetchText(competition.url, signal);
          return enrichGoldenDreamDetail(competition, detailHtml);
        } catch {
          signal?.throwIfAborted();
          return competition;
        }
      }),
    );
  }
}

export function parseGoldenDreamDrawListing(
  html: string,
  scrapedAt = new Date().toISOString(),
): RawCompetition[] {
  const payload = decodeNextPayload(html);
  const competitions: RawCompetition[] = [];
  const pattern =
    /"slug":"([^"]+)","title":"([^"]+)","description":"([\s\S]*?)","category":"([^"]+)","imageUrl":"([\s\S]*?)","ticketsSold":([0-9]+),"maxTickets":([0-9]+),"drawDate":"\$D([^"]+)","pricePounds":([0-9]+(?:\.[0-9]+)?)/g;

  for (const match of payload.matchAll(pattern)) {
    const slug = match[1]?.trim() ?? "";
    const name = match[2]?.trim() ?? "";
    const category = match[4]?.trim().toLowerCase() ?? "";
    const ticketsSold = Number(match[6]);
    const maxTickets = Number(match[7]);
    const drawDate = normalizeDate(match[8]);
    const entryPrice = Number(match[9]);

    if (
      !slug ||
      !name ||
      !Number.isFinite(entryPrice) ||
      entryPrice <= 0 ||
      !Number.isFinite(ticketsSold) ||
      !Number.isFinite(maxTickets) ||
      maxTickets <= 0 ||
      ticketsSold < 0 ||
      ticketsSold >= maxTickets ||
      drawDate === null
    ) {
      continue;
    }

    competitions.push({
      sourceId: slug,
      siteName: SITE_NAME,
      url: `${BASE_URL}/en/competitions/${slug}`,
      name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      estimatedPrizeValue: null,
      valuationSource: null,
      valuationConfidence: null,
      valuationNotes: null,
      drawDate,
      isAutoDraw: false,
      categories: category ? [category] : [],
      scrapedAt,
    });
  }

  return competitions;
}

function enrichGoldenDreamDetail(
  competition: RawCompetition,
  html: string,
): RawCompetition {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const payload = decodeNextPayload(html);
  const prizeValue = parseMoney(
    payload.match(/"children":\["RRP"," £","?([\d,]+(?:\.\d{1,2})?)/i)?.[1] ??
      text.match(/\bRRP\s+£\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1],
  );
  const maxPerPerson = parseInteger(
    payload.match(/"children":"Max per person"[\s\S]{0,500}?"children":([\d,]+)/i)?.[1] ??
      text.match(/Max\s+per\s+person\s*([\d,]+)/i)?.[1],
  );

  return {
    ...competition,
    maxEntriesPerUser: maxPerPerson > 0 ? maxPerPerson : competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxPerPerson > 0 ? "site" : competition.maxEntriesPerUserSource,
    estimatedPrizeValue: prizeValue,
    valuationSource: prizeValue !== null ? "site_estimate" : null,
    valuationConfidence: prizeValue !== null ? "high" : null,
    valuationNotes: prizeValue !== null
      ? "Golden Dream Draw detail page states the RRP."
      : null,
  };
}

function decodeNextPayload(html: string): string {
  const blocks = html.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs) ?? [];
  return blocks
    .map((block) => {
      const match = block.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/s);
      if (!match) return "";
      try {
        return JSON.parse(`"${match[1]}"`) as string;
      } catch {
        return "";
      }
    })
    .join("\n");
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const timeoutSignal = AbortSignal.timeout(15_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    signal: requestSignal,
  });
  if (!response.ok) {
    throw new Error(`[${DISPLAY_NAME}] ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseInteger(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}
