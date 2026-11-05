import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://thesovereigndraw.co.uk";
const FETCH_TIMEOUT_MS = 15_000;

export interface SovereignProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string;
  tags?: string[];
  variants?: Array<{
    id: number;
    title: string;
    price: string;
    available: boolean;
  }>;
}

export class SovereignDrawAdapter implements SiteAdapter {
  readonly siteName = "sovereign";

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/products.json?limit=250`, {
      headers: headers("json"),
      signal: requestSignal(signal),
    });
    if (!response.ok) {
      throw new Error(`[Sovereign Draw] Failed to fetch products: ${response.status}`);
    }

    const payload = await response.json() as { products?: SovereignProduct[] };
    const products = payload.products ?? [];
    const competitions: RawCompetition[] = [];
    for (const product of products) {
      signal?.throwIfAborted();
      const variant = product.variants?.find((candidate) =>
        candidate.available && /^1\s+Ticket\b/i.test(candidate.title),
      );
      if (!variant) continue;

      try {
        const detailResponse = await fetch(
          `${BASE_URL}/products/${encodeURIComponent(product.handle)}`,
          { headers: headers("html"), signal: requestSignal(signal) },
        );
        if (!detailResponse.ok) continue;
        const detailHtml = await detailResponse.text();
        const competition = parseSovereignProduct(product, detailHtml, variant);
        if (competition) competitions.push(competition);
      } catch {
        signal?.throwIfAborted();
      }
    }

    return competitions;
  }
}

export function parseSovereignProduct(
  product: SovereignProduct,
  detailHtml: string,
  selectedVariant = product.variants?.find((variant) =>
    /^1\s+Ticket\b/i.test(variant.title),
  ),
): RawCompetition | null {
  if (!selectedVariant) return null;

  const description = decodeEntities(stripTags(product.body_html));
  const maxTickets = parseNumber(
    description.match(/JUST\s+([\d,]+)\s+tickets?\s+available/i)?.[1],
  );
  const remainingMatch = detailHtml.match(
    new RegExp(
      `id=["']variant-${escapeRegExp(String(selectedVariant.id))}["'][\\s\\S]*?>\\s*Only\\s+([\\d,]+)\\s+left`,
      "i",
    ),
  );
  const remaining = parseNumber(remainingMatch?.[1]);
  const entryPrice = Number(selectedVariant.price);
  const drawDate = parseDate(
    detailHtml.match(
      /["']timer["']\s*:\s*\{\s*["']date["']\s*:\s*["']([^"']+)["']/i,
    )?.[1],
  );
  const cashAlternative = parseNumber(
    `${product.title} ${description}`.match(/£\s*([\d,]+)\s+cash\b/i)?.[1],
  );

  if (
    maxTickets <= 0 ||
    remaining < 0 ||
    remaining > maxTickets ||
    entryPrice <= 0 ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId: String(product.id),
    siteName: "sovereign",
    url: `${BASE_URL}/products/${encodeURIComponent(product.handle)}`,
    name: decodeEntities(product.title).trim(),
    entryPrice,
    ticketsSold: maxTickets - remaining,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    drawDate,
    isAutoDraw: /instant\s+win/i.test(product.title),
    categories: (product.tags ?? []).map((tag) => tag.toLowerCase()),
    scrapedAt: new Date().toISOString(),
  };
}

function headers(kind: "json" | "html"): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0",
    Accept: kind === "json"
      ? "application/json"
      : "text/html,application/xhtml+xml",
    "Accept-Language": "en-GB,en;q=0.8",
  };
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
