import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "luckynumberpink";
const DISPLAY_NAME = "Lucky Number Pink";
const BASE_URL = "https://www.luckynumberpink.co.uk";
const UK_ZONE = "Europe/London";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface LuckyNumberPinkProduct {
  name?: unknown;
  price?: unknown;
  discountedPrice?: unknown;
  quantityInStock?: unknown;
  description?: unknown;
}

interface LuckyNumberPinkRecord {
  _id?: unknown;
  title?: unknown;
  liveDraw?: unknown;
  drawDate?: unknown;
  time?: unknown;
  ticketsSold?: unknown;
  soldCount?: unknown;
  _publishStatus?: unknown;
  "link-pinkstant-wins-title"?: unknown;
  linkPath?: unknown;
  productLink?: LuckyNumberPinkProduct | null;
}

export class LuckyNumberPinkAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Homepage failed: ${response.status}`);
    }

    return parseHomepage(await response.text(), new Date());
  }
}

export function parseHomepage(
  html: string,
  now = new Date(),
): RawCompetition[] {
  const $ = cheerio.load(html);
  const raw = $("script#wix-warmup-data").html();
  if (!raw) throw new Error(`[${DISPLAY_NAME}] Wix warmup data not found`);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error(`[${DISPLAY_NAME}] Invalid Wix warmup data`);
  }

  const records = findCompetitionRecords(payload);
  const scrapedAt = now.toISOString();
  return records
    .map((record) => toCompetition(record, scrapedAt, now))
    .filter((competition): competition is RawCompetition => competition !== null);
}

export function toCompetition(
  record: LuckyNumberPinkRecord,
  scrapedAt = new Date().toISOString(),
  now = new Date(),
): RawCompetition | null {
  const sourceId = stringValue(record._id);
  const product = record.productLink;
  const name = cleanText(record.title) || cleanText(product?.name);
  const maxTickets = positiveInteger(record.soldCount ?? product?.quantityInStock);
  const ticketsSold = nonNegativeInteger(record.ticketsSold);
  const entryPrice = positiveNumber(product?.price ?? product?.discountedPrice);
  const drawDate = parseDrawDate(record.drawDate, record.time);
  const description = cleanText(product?.description);
  const linkPath = stringValue(
    record["link-pinkstant-wins-title"] ?? record.linkPath,
  );

  if (
    !sourceId ||
    !name ||
    record.liveDraw !== true ||
    stringValue(record._publishStatus).toUpperCase() !== "PUBLISHED" ||
    entryPrice === null ||
    maxTickets === null ||
    ticketsSold === null ||
    ticketsSold >= maxTickets ||
    drawDate === null ||
    new Date(drawDate).getTime() <= now.getTime() ||
    !linkPath
  ) {
    return null;
  }

  const cashAlternative = extractCashAlternative(`${name} ${description}`);
  return {
    sourceId,
    siteName: SITE_NAME,
    url: new URL(linkPath, BASE_URL).toString(),
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: false,
    categories: ["live draw", ...(cashAlternative !== null ? ["cash"] : [])],
    scrapedAt,
  };
}

function findCompetitionRecords(payload: unknown): LuckyNumberPinkRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as {
    appsWarmupData?: {
      dataBinding?: {
        dataStore?: {
          recordsByCollectionId?: {
            Competitions?: Record<string, LuckyNumberPinkRecord>;
          };
        };
      };
    };
  };
  const records = root.appsWarmupData?.dataBinding?.dataStore?.recordsByCollectionId?.Competitions;
  return records ? Object.values(records) : [];
}

function parseDrawDate(dateValue: unknown, timeValue: unknown): string | null {
  const date = stringValue(dateValue);
  if (!date) return null;
  const time = stringValue(timeValue).match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  const parsed = DateTime.fromISO(date, { zone: UK_ZONE });
  if (!parsed.isValid) return null;

  let hour = time ? Number(time[1]) : 20;
  const minute = time ? Number(time[2] ?? "0") : 0;
  const meridiem = time?.[3].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return parsed.set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toISO();
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/\bor\s+£\s*([\d,.]+)\s*cash\s+alt\b/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: unknown): string {
  return stringValue(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = positiveNumber(value);
  return parsed === null ? null : Math.floor(parsed);
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}
