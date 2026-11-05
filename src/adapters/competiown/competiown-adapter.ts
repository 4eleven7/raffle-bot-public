import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://competiown.co.uk";
const FETCH_TIMEOUT_MS = 15_000;

interface CompetiownProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  tags?: string[];
  variants?: Array<{
    price: string;
    available: boolean;
  }>;
}

export class CompetiownAdapter implements SiteAdapter {
  readonly siteName = "competiown";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/products.json?limit=250`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
        "Accept-Language": "en-GB,en;q=0.8",
      },
      signal: requestSignal(signal),
    });
    if (!response.ok) {
      throw new Error(`[Competiown] Failed to fetch products: ${response.status}`);
    }

    const payload = await response.json() as { products?: CompetiownProduct[] };
    const scrapedAt = new Date().toISOString();
    return (payload.products ?? [])
      .map((product) => parseCompetiownProduct(product, scrapedAt))
      .filter((competition): competition is RawCompetition => competition !== null);
  }
}

export function parseCompetiownProduct(
  product: CompetiownProduct,
  scrapedAt = new Date().toISOString(),
): RawCompetition | null {
  const description = decodeEntities(stripTags(product.body_html));
  const maxTickets = parseNumber(description.match(/Maximum Entries:\s*([\d,]+)/i)?.[1]);
  const ticketsSold = parseNumber(description.match(/Tickets Sold:\s*([\d,]+)/i)?.[1]);
  const selectedVariant = product.variants?.find((variant) => variant.available);
  const entryPrice = Number(selectedVariant?.price);
  const drawDate = parseDate(
    description.match(/Closing Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1],
  );
  const cashAlternative = parseNumber(
    description.match(/£\s*([\d,]+)\s+cash alternative/i)?.[1],
  );

  if (
    !product.id ||
    !product.handle ||
    !product.title ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold >= maxTickets ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId: String(product.id),
    siteName: "competiown",
    url: `${BASE_URL}/products/${encodeURIComponent(product.handle)}`,
    name: product.title.trim(),
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    drawDate,
    isAutoDraw: false,
    categories: (product.tags ?? []).map((tag) => tag.toLowerCase()),
    scrapedAt,
  };
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const [day, month, year] = value.split("/").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ? date.toISOString()
    : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ndash;/g, "–")
    .replace(/&nbsp;/g, " ");
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}
