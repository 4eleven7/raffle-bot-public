import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { ShopifySiteConfig } from "./shopify-site-config.js";
import {
  parsePage,
  parseProductLinks,
  parseProductPage,
} from "./shopify-parser.js";

const FETCH_TIMEOUT_MS = 15_000;

export class ShopifyAdapter implements SiteAdapter {
  readonly siteName: string;

  constructor(private readonly config: ShopifySiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const allComps: RawCompetition[] = [];
    const seenIds = new Set<string>();

    for (const collection of this.config.collections) {
      signal?.throwIfAborted();
      await this.fetchCollection(collection, allComps, seenIds, signal);
    }

    const enterable = allComps.filter(isEnterable);
    return this.enrichMissingDrawDates(enterable, signal);
  }

  private async fetchCollection(
    collectionPath: string,
    allComps: RawCompetition[],
    seenIds: Set<string>,
    signal?: AbortSignal,
  ): Promise<void> {
    // Fetch with high limit to try to get everything in one request
    const html = await this.fetchPage(`${collectionPath}?limit=250`, signal);

    if (this.config.detailPageScan) {
      for (const product of parseProductLinks(html, this.config)) {
        signal?.throwIfAborted();
        try {
          if (this.config.fetchDelayMs) {
            await delay(this.config.fetchDelayMs, signal);
          }
          const detailHtml = await this.fetchUrl(product.url, signal);
          const competition = parseProductPage(
            detailHtml,
            this.config,
            product.url,
            product.drawDate,
          );
          if (competition && !seenIds.has(competition.sourceId)) {
            seenIds.add(competition.sourceId);
            allComps.push(competition);
          }
        } catch {
          signal?.throwIfAborted();
        }
      }
      return;
    }

    const comps = parsePage(html, this.config);

    for (const comp of comps) {
      if (!seenIds.has(comp.sourceId)) {
        seenIds.add(comp.sourceId);
        allComps.push(comp);
      }
    }
  }

  private async fetchPage(path: string, signal?: AbortSignal): Promise<string> {
    const url = `${this.config.baseUrl}${path}`;
    return this.fetchUrl(url, signal);
  }

  private async fetchUrl(url: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": this.config.userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      signal: requestSignal(signal),
    });

    if (!response.ok) {
      throw new Error(
        `[${this.config.displayName}] Failed to fetch ${url}: ${response.status}`,
      );
    }

    return response.text();
  }

  private async enrichMissingDrawDates(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched: RawCompetition[] = [];

    for (const competition of competitions) {
      if (
        competition.drawDate !== null ||
        competition.entryPrice <= 0 ||
        competition.maxTickets <= 0
      ) {
        enriched.push(competition);
        continue;
      }

      try {
        signal?.throwIfAborted();
        if (this.config.fetchDelayMs) {
          await delay(this.config.fetchDelayMs, signal);
        }
        const html = await this.fetchUrl(competition.url, signal);
        enriched.push({
          ...competition,
          drawDate: extractDrawDate(html) ?? competition.drawDate,
        });
      } catch {
        signal?.throwIfAborted();
        enriched.push(competition);
      }
    }

    return enriched;
  }
}

function isEnterable(competition: RawCompetition): boolean {
  return competition.maxTickets <= 0 || competition.ticketsSold < competition.maxTickets;
}

function extractDrawDate(html: string): string | null {
  const value =
    html.match(/data-draw-date=["']([^"']+)["']/i)?.[1] ??
    html.match(/draw-date["'][^>]*title=["']([^"']+)["']/i)?.[1] ??
    html.match(/getElementById\(\s*["']draw-date["']\s*\)\.title\s*=\s*["']([^"']+)["']/i)?.[1];
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    function done(): void {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
