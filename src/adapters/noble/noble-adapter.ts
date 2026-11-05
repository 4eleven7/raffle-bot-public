import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "noblewins";
const DISPLAY_NAME = "Noble Wins";
const BASE_URL = "https://noblewins.co.uk";
const COMPETITIONS_URL = `${BASE_URL}/`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface NobleCompetitionSummary {
  id: string;
  slug: string;
  title: string;
  category?: string | null;
  status?: string | null;
  priceNumber?: number | null;
  cashFormatted?: string | null;
  drawCloseAt?: string | null;
  totalTickets?: number | null;
  ticketsSold?: number | null;
  isInstantWin?: boolean | null;
}

interface NobleCompetitionDetail {
  id: string;
  slug: string;
  title: string;
  category?: string | null;
  status?: string | null;
  cashAlternative?: string | null;
  ticketPrice?: number | null;
  maxTickets?: number | null;
  totalTickets?: number | null;
  ticketsSold?: number | null;
  maxTicketsPerUser?: number | null;
  drawCloseAt?: string | null;
  isInstantWin?: boolean | null;
}

export class NobleAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const homepage = await fetchText(COMPETITIONS_URL);
    const summaries = extractHomepageCompetitions(homepage);
    const competitions: RawCompetition[] = [];
    const scrapedAt = new Date().toISOString();

    for (const summary of summaries) {
      try {
        const detailHtml = await fetchText(`${BASE_URL}/competitions/${summary.slug}`);
        const detail = extractCompetitionDetail(detailHtml);
        const competition = mapCompetition(summary, detail, scrapedAt);
        if (competition) competitions.push(competition);
      } catch {
        continue;
      }
    }

    return competitions;
  }
}

function extractHomepageCompetitions(html: string): NobleCompetitionSummary[] {
  const content = decodeRscPushContent(html);
  if (!content) return [];
  return extractObjects<NobleCompetitionSummary>(content, '{"id":"', (obj) =>
    typeof obj.slug === "string" &&
    typeof obj.title === "string" &&
    typeof obj.totalTickets === "number" &&
    typeof obj.ticketsSold === "number" &&
    Object.prototype.hasOwnProperty.call(obj, "priceNumber") &&
    Object.prototype.hasOwnProperty.call(obj, "drawCloseAt"),
  );
}

function extractCompetitionDetail(html: string): NobleCompetitionDetail | null {
  const content = decodeRscPushContent(html);
  if (!content) return null;

  const marker = '"competition":{';
  const start = content.indexOf(marker);
  if (start < 0) return null;

  const jsonStr = extractBalancedObject(content, start + marker.length - 1);
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr) as NobleCompetitionDetail;
  } catch {
    return null;
  }
}

function mapCompetition(
  summary: NobleCompetitionSummary,
  detail: NobleCompetitionDetail | null,
  scrapedAt: string,
): RawCompetition | null {
  const status = String(detail?.status ?? summary.status ?? "").toLowerCase();
  if (status !== "live") return null;

  const url = `${BASE_URL}/competitions/${summary.slug}`;
  const entryPrice = finiteNumber(detail?.ticketPrice ?? summary.priceNumber);
  const maxTickets = finiteNumber(detail?.totalTickets ?? summary.totalTickets);
  const ticketsSold = finiteNumber(detail?.ticketsSold ?? summary.ticketsSold);
  const siteMaxEntriesPerUser = finiteNumber(detail?.maxTicketsPerUser);
  const maxEntriesPerUser = siteMaxEntriesPerUser > 0 ? siteMaxEntriesPerUser : 100;
  const drawDate = normalizeDate(detail?.drawCloseAt ?? summary.drawCloseAt);
  if (maxTickets <= 0 || ticketsSold < 0 || ticketsSold >= maxTickets || drawDate === null) {
    return null;
  }

  const title = String(detail?.title ?? summary.title ?? "").trim();
  if (!title) return null;

  const explicitCash = parseMoney(detail?.cashAlternative ?? summary.cashFormatted ?? null);
  const titleCash = parseCashFromTitle(title);
  const cashAlternative = explicitCash ?? titleCash;
  const categories = buildCategories(detail?.category ?? summary.category, summary.isInstantWin === true);

  return {
    sourceId: summary.slug || summary.id,
    siteName: SITE_NAME,
    url,
    name: title,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser,
    maxEntriesPerUserSource: siteMaxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    ...(cashAlternative === null && titleCash !== null
      ? {
          estimatedPrizeValue: titleCash,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: "Noble Wins title cash amount",
        }
      : {}),
    drawDate,
    isAutoDraw: summary.isInstantWin === true || detail?.isInstantWin === true,
    categories,
    scrapedAt,
  };
}

function decodeRscPushContent(html: string): string {
  const pushBlocks =
    html.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs) || [];

  let combined = "";
  for (const block of pushBlocks) {
    const match = block.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/s);
    if (!match) continue;
    try {
      combined += JSON.parse(`"${match[1]}"`);
    } catch {
      continue;
    }
  }

  return combined;
}

function extractObjects<T extends object>(
  content: string,
  startPattern: string,
  predicate: (obj: T) => boolean,
): T[] {
  const results: T[] = [];
  let searchFrom = 0;

  while (true) {
    const start = content.indexOf(startPattern, searchFrom);
    if (start === -1) break;

    const jsonStr = extractBalancedObject(content, start);
    if (!jsonStr) break;

    try {
      const obj = JSON.parse(jsonStr) as T;
      if (predicate(obj)) results.push(obj);
    } catch {
      // Ignore malformed objects
    }

    searchFrom = start + jsonStr.length;
  }

  return dedupeBySlug(results);
}

function extractBalancedObject(content: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < content.length; i++) {
    const char = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }

  return null;
}

function dedupeBySlug<T extends object>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const slug = String(
      ("slug" in item ? (item as { slug?: unknown }).slug : undefined) ??
      ("id" in item ? (item as { id?: unknown }).id : undefined) ??
      "",
    );
    if (!slug || seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });
}

function buildCategories(category: string | null | undefined, isInstantWin: boolean): string[] {
  const categories: string[] = [];
  const normalized = String(category ?? "").trim().toLowerCase();
  if (normalized) categories.push(normalized);
  if (isInstantWin && !categories.includes("instant wins")) categories.push("instant wins");
  return categories;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).replace(/^\$D/, "");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseMoney(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/£\s*([\d,.]+)/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function parseCashFromTitle(title: string): number | null {
  const match = title.match(/£\s*([\d,.]+)\s*(?:tax-free\s*)?cash/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function finiteNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}
