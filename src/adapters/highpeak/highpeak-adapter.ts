import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

interface HighPeakCompetition {
  id: string;
  title: string;
  text: string | null;
  slug: string;
  new_price: string;
  ticket_counter: string;
  ticket_end: string;
  end_date: string;
  is_instant_win: string;
  number_of_tickets: string | null;
  active: string;
  free: string;
}

const API_URL = "https://api.highpeakcomps.co.uk/competitions?filter=active&page=1";
const BASE_URL = "https://highpeakcomps.co.uk";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HighPeakAdapter implements SiteAdapter {
  readonly siteName = "highpeakcomps";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(API_URL, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        "User-Agent": UA,
      },
    });

    if (!response.ok) {
      throw new Error(`[High Peak Comps] Failed to fetch ${API_URL}: ${response.status}`);
    }

    const rows = await response.json() as HighPeakCompetition[];
    const now = new Date().toISOString();

    return rows
      .filter((row) => row.active === "1" && row.slug && row.title)
      .map((row) => {
        const labelledMaxEntries = extractMaxEntries(row.text);
        return {
          sourceId: row.id,
          siteName: this.siteName,
          url: `${BASE_URL}/competition/${row.slug}`,
          name: row.title.trim(),
          entryPrice: row.free === "1" ? 0 : parseFloat(row.new_price) || 0,
          ticketsSold: parseNumber(row.ticket_counter),
          maxTickets: parseNumber(row.ticket_end),
          maxEntriesPerUser: (labelledMaxEntries ?? parseNumber(row.number_of_tickets)) || 100,
          maxEntriesPerUserSource: labelledMaxEntries === null ? "fallback" : "site",
          cashAlternative: extractCashAlternative(`${row.title} ${stripHtml(row.text ?? "")}`),
          drawDate: parseApiDate(row.end_date),
          isAutoDraw: row.is_instant_win === "1",
          categories: row.free === "1" ? ["free"] : [],
          scrapedAt: now,
        };
      });
  }
}

function parseApiDate(value: string): string | null {
  if (!value) return null;
  return new Date(value.replace(" ", "T")).toISOString();
}

function parseNumber(value: string | null | undefined): number {
  return value ? parseInt(value.replace(/,/g, ""), 10) || 0 : 0;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractMaxEntries(text: string | null): number | null {
  if (!text) return null;
  const match = stripHtml(text).match(/max(?:imum)?\s+([\d,]+)\s+tickets?/i);
  return match ? parseNumber(match[1]) : null;
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/additional draw for £\s*([\d,]+)\s*cash/i) ||
    text.match(/£\s*([\d,]+)\s*(?:winner takes it all|tax free cash|cash|end prize|final draw)/i) ||
    text.match(/(?:daily cash|win|receive)\D+£\s*([\d,]+)/i) ||
    text.match(/^£\s*([\d,]+)\s+for\s+\d+p/i);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}
