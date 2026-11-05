import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.horsepowercomps.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HorsepowerAdapter implements SiteAdapter {
  readonly siteName = "horsepower";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/raffles`, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": USER_AGENT,
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`[Horse Power Comps] Failed to fetch raffles: ${response.status}`);
    }

    return parseHorsepowerRaffles(await response.text());
  }
}

export function parseHorsepowerRaffles(
  html: string,
  scrapedAt = new Date(),
): RawCompetition[] {
  const rows = extractInitialRaffles(html);
  const now = scrapedAt.toISOString();

  return rows.flatMap((row) => {
    const title = stringValue(row.title);
    const slug = stringValue(row.slug);
    const id = stringValue(row.id);
    const status = stringValue(row.status);
    const priceInPence = numberValue(row.ticketPrice);
    const maxTickets = numberValue(row.totalTickets);
    const ticketsSold = numberValue(row.ticketsSold);
    const drawDate = parseDate(row.drawDate);
    if (
      status !== "live" ||
      !id ||
      !slug ||
      !title ||
      priceInPence === null ||
      priceInPence <= 0 ||
      maxTickets === null ||
      maxTickets <= 0 ||
      ticketsSold === null ||
      ticketsSold < 0 ||
      ticketsSold > maxTickets ||
      !drawDate
    ) {
      return [];
    }

    const description = stringValue(row.description);
    const cashAlternative =
      numberValue(row.cashAlternative) ?? extractCashAlternative(`${title} ${description}`);
    const prizeValue = numberValue(row.prizeValue);
    const maxPerPerson = numberValue(row.maxPerPerson);

    return [{
      sourceId: id,
      siteName: "horsepower",
      url: `${BASE_URL}/raffles/${slug}`,
      name: title,
      entryPrice: priceInPence / 100,
      ticketsSold,
      maxTickets,
      inventorySource: "exact",
      maxEntriesPerUser: maxPerPerson && maxPerPerson > 0 ? maxPerPerson : 100,
      maxEntriesPerUserSource: maxPerPerson && maxPerPerson > 0 ? "site" : "fallback",
      cashAlternative,
      estimatedPrizeValue: cashAlternative ?? (prizeValue && prizeValue > 0 ? prizeValue : null),
      valuationSource: cashAlternative !== null
        ? "cash"
        : prizeValue && prizeValue > 0
          ? "site_estimate"
          : null,
      valuationConfidence: cashAlternative !== null || (prizeValue && prizeValue > 0) ? "high" : null,
      valuationNotes: cashAlternative !== null
        ? "Cash prize stated in the public Horse Power title or description"
        : prizeValue && prizeValue > 0
          ? "Prize value stated in the public Horse Power payload"
          : null,
      drawDate,
      isAutoDraw: row.instaWin === true,
      categories: stringValue(row.category) ? [stringValue(row.category)] : [],
      scrapedAt: now,
    }];
  });
}

function extractInitialRaffles(html: string): Array<Record<string, unknown>> {
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const script = match[1] ?? "";
    if (!script.includes("initialRaffles")) continue;
    const push = script.match(/self\.__next_f\.push\(\[1,"([\s\S]*)"\]\)/);
    if (!push) continue;

    try {
      const decoded = JSON.parse(`"${push[1]}"`) as string;
      const marker = '"initialRaffles":';
      const markerStart = decoded.indexOf(marker);
      const arrayStart = decoded.indexOf("[", markerStart + marker.length);
      const arrayEnd = findJsonArrayEnd(decoded, arrayStart);
      if (markerStart < 0 || arrayStart < 0 || arrayEnd < 0) continue;
      const rows = JSON.parse(decoded.slice(arrayStart, arrayEnd)) as unknown;
      if (Array.isArray(rows)) {
        return rows.filter(isRecord);
      }
    } catch {
      continue;
    }
  }
  return [];
}

function findJsonArrayEnd(value: string, start: number): number {
  if (start < 0) return -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function parseDate(value: unknown): string | null {
  const date = stringValue(value);
  if (!date) return null;
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/£\s*([\d,.]+)\s*(k|m)?\s*(?:tax[- ]free\s+)?cash\b/i) ??
    text.match(/£\s*([\d,.]+)\s*(k|m)?[^.]{0,30}\bcash\b/i);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return amount * (match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1);
}
