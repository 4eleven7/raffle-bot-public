import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "allforgiveaways";
const BASE_URL = "https://www.allforgiveaways.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const JWT_PATTERN =
  /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

interface AllForGiveawaysCompetition {
  id?: unknown;
  slug?: unknown;
  title?: unknown;
  subtitle?: unknown;
  description?: unknown;
  status?: unknown;
  site_section?: unknown;
  ticket_price_pennies?: unknown;
  max_tickets?: unknown;
  tickets_sold?: unknown;
  draw_at?: unknown;
  closed_at?: unknown;
  is_free?: unknown;
  free_entries_per_user?: unknown;
  classic_kind?: unknown;
}

export class AllForGiveawaysAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const homepage = await fetchText(`${BASE_URL}/`, signal);
    const scriptUrls = extractScriptUrls(homepage);
    const bundles = await Promise.all(scriptUrls.map((url) => fetchText(url, signal)));
    const bundle = bundles.join("\n");
    const supabaseUrl = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
    const anonKey = bundle.match(JWT_PATTERN)?.[0];
    if (!supabaseUrl || !anonKey) {
      throw new Error("[All For Giveaways] Supabase client configuration not found");
    }

    const apiUrl = new URL("/rest/v1/competitions", supabaseUrl);
    apiUrl.searchParams.set("select", "*");
    apiUrl.searchParams.set("site_section", "eq.classic");
    apiUrl.searchParams.set("status", "eq.live");
    apiUrl.searchParams.set("order", "draw_at.asc");

    const response = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`[All For Giveaways] Competitions API: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) return [];

    const now = new Date();
    const scrapedAt = now.toISOString();
    return payload
      .map((row) => parseAllForGiveawaysCompetition(row as AllForGiveawaysCompetition, scrapedAt, now))
      .filter((row): row is RawCompetition => row !== null);
  }
}

export function parseAllForGiveawaysCompetition(
  record: AllForGiveawaysCompetition,
  scrapedAt = new Date().toISOString(),
  now = new Date(),
): RawCompetition | null {
  const sourceId = stringValue(record.id) || stringValue(record.slug);
  const name = stringValue(record.title);
  const subtitle = stringValue(record.subtitle);
  const description = stringValue(record.description);
  const text = `${name} ${subtitle} ${description}`.replace(/\s+/g, " ");
  const status = stringValue(record.status).toLowerCase();
  const section = stringValue(record.site_section).toLowerCase();
  const classicKind = stringValue(record.classic_kind).toLowerCase();
  const entryPricePence = nonNegativeInteger(record.ticket_price_pennies);
  const maxTickets = positiveInteger(record.max_tickets);
  const ticketsSold = nonNegativeInteger(record.tickets_sold);
  const drawDate = parseDate(record.draw_at) ?? parseDate(record.closed_at);
  const explicitFree = record.is_free === true || /\bfree\s+to\s+enter\b|\bfree\s+entry\b/i.test(text);
  const entryPrice = entryPricePence === null ? null : entryPricePence / 100;
  const parsedMaxEntries = parseMaxEntries(text);
  const freeEntriesPerUser = positiveInteger(record.free_entries_per_user);
  const maxPerPerson = parsedMaxEntries ?? freeEntriesPerUser ?? 100;
  const cashAlternative = parseCashAlternative(text);
  const prizeValue = parsePrizeValue(text, cashAlternative);
  const instantHeavy = /\b(?:instant|instantly|arcade)\b/i.test(text);

  if (
    !sourceId ||
    !name ||
    status !== "live" ||
    section !== "classic" ||
    (classicKind && classicKind !== "standard" && classicKind !== "standard_draw") ||
    entryPrice === null ||
    (entryPrice === 0 && !explicitFree) ||
    maxTickets === null ||
    ticketsSold === null ||
    ticketsSold < 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null ||
    new Date(drawDate).getTime() <= now.getTime() ||
    (instantHeavy && cashAlternative === null && !/\bworth\s+£/i.test(text))
  ) {
    return null;
  }

  const categories = ["classic"];
  if (explicitFree) categories.push("free");
  if (cashAlternative !== null || prizeValue !== null) categories.push("cash");
  if (instantHeavy) categories.push("instant-win");

  return {
    sourceId,
    siteName: SITE_NAME,
    url: `${BASE_URL}/competition/${sourceId}`,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxPerPerson,
    maxEntriesPerUserSource: parsedMaxEntries !== null || freeEntriesPerUser !== null ? "site" : "fallback",
    cashAlternative,
    estimatedPrizeValue: prizeValue,
    valuationSource: cashAlternative !== null ? "cash" : prizeValue !== null ? "site_estimate" : null,
    valuationConfidence: cashAlternative !== null || prizeValue !== null ? "high" : null,
    valuationNotes: cashAlternative !== null
      ? "All For Giveaways description states an explicit cash alternative."
      : prizeValue !== null
        ? "All For Giveaways description states the prize value."
        : null,
    drawDate,
    isAutoDraw: false,
    categories,
    scrapedAt,
  };
}

function extractScriptUrls(html: string): string[] {
  return [...new Set(
    [...html.matchAll(/(?:src|href)=["']([^"']+\.js[^"']*)["']/g)]
      .map((match) => new URL(match[1], BASE_URL).toString()),
  )];
}

function parseCashAlternative(text: string): number | null {
  const match = text.match(/(?:cash\s+alt(?:ernative)?|take)\s*[:.]?\s*£\s*([\d,]+(?:\.\d{1,2})?)/i)
    ?? text.match(/£\s*([\d,]+(?:\.\d{1,2})?)\s*cash\s+alt(?:ernative)?/i);
  return positiveNumber(match?.[1]);
}

function parsePrizeValue(text: string, cashAlternative: number | null): number | null {
  const amounts = [
    ...[...text.matchAll(/\bworth\s+£\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((match) => match[1]),
    ...[...text.matchAll(/\btop\s+prizes?\s+of\s+£\s*([\d,]+(?:\.\d{1,2})?)/gi)].map((match) => match[1]),
  ]
    .map((value) => positiveNumber(value))
    .filter((value): value is number => value !== null);
  if (amounts.length > 0) return Math.max(...amounts);
  return cashAlternative;
}

function parseMaxEntries(text: string): number | null {
  const match = text.match(/([\d,]+)\s+Max\s+Entr(?:y|ies|ires)\s+Per\s+Person/i);
  return positiveInteger(match?.[1]);
}

function parseDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function positiveNumber(value: unknown): number | null {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function positiveInteger(value: unknown): number | null {
  const number = positiveNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/javascript",
    },
    signal,
  });
  if (!response.ok) throw new Error(`[All For Giveaways] ${url}: HTTP ${response.status}`);
  return response.text();
}
