import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { mapWithConcurrency } from "../../utils/concurrency.js";
import { fetchRenderedHtml } from "../browser/browser-pool.js";
import type { WCLotterySiteConfig } from "./wclottery-site-config.js";
import {
  enrichCompetitionFromDetail,
  isClosedCompetitionDetailPage,
  parseDetailPage,
  parseLpeDetailPage,
  parsePage,
} from "./wclottery-parser.js";

const DETAIL_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 15_000;

export class WCLotteryAdapter implements SiteAdapter {
  readonly siteName: string;
  readonly scanCost?: "browser";

  constructor(
    private readonly config: WCLotterySiteConfig,
    private readonly fetchRenderedList: typeof fetchRenderedHtml = fetchRenderedHtml,
  ) {
    this.siteName = config.siteName;
    this.scanCost = config.renderListPage ? "browser" : undefined;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const html = await this.fetchPage(this.config.listPath, signal);
    const competitions = parsePage(html, this.config);
    if (competitions.length === 0 && this.config.siteName === "footballprizes") {
      return (await this.fetchLpeDetailPages(html, signal)).map(stripPaidFreeEntryCategory);
    }
    if (this.config.siteName === "classy") {
      return mergeDetailRows(competitions, await this.fetchExtraDetailPages(signal))
        .map(stripPaidFreeEntryCategory);
    }
    const enriched = await this.enrichMissingDetails(competitions, signal);
    const extraDetails = await this.fetchExtraDetailPages(signal);
    const rows = dedupBySourceId([...enriched, ...extraDetails]).map(stripPaidFreeEntryCategory);
    return this.config.siteName === "luxora"
      ? this.enrichLuxoraStoreStock(rows, signal)
      : rows;
  }

  private async fetchPage(path: string, signal?: AbortSignal): Promise<string> {
    const url = `${this.config.baseUrl}${path}`;
    try {
      return await this.fetchUrl(url, signal);
    } catch (error) {
      signal?.throwIfAborted();
      if (!this.config.renderListPage) throw error;
      return this.fetchRenderedList(url, 'a[href*="/product/"]', signal);
    }
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

  private async enrichMissingDetails(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched = await mapWithConcurrency(
      competitions,
      DETAIL_CONCURRENCY,
      async (competition): Promise<RawCompetition | null> => {
        signal?.throwIfAborted();
        if (!needsDetailFields(competition)) {
          return competition;
        }

        try {
          if (this.config.fetchDelayMs) {
            await delay(this.config.fetchDelayMs, signal);
          }
          const html = await this.fetchDetailPage(competition.url, signal);
          if (isClosedCompetitionDetailPage(html)) return null;
          return enrichCompetitionFromDetail(competition, html);
        } catch {
          signal?.throwIfAborted();
          return competition;
        }
      },
    );

    return enriched.filter(
      (competition): competition is RawCompetition => competition !== null,
    );
  }

  private async fetchLpeDetailPages(
    html: string,
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const $ = cheerio.load(html);
    const links = Array.from(
      new Set(
        $('a[href*="/product/"]')
          .map((_i, el) => absoluteUrl(this.config, $(el).attr("href") ?? ""))
          .get()
          .filter((href) => href.startsWith(`${this.config.baseUrl}/product/`)),
      ),
    );
    const competitions = await mapWithConcurrency(
      links,
      DETAIL_CONCURRENCY,
      async (href): Promise<RawCompetition | null> => {
        signal?.throwIfAborted();
        try {
          if (this.config.fetchDelayMs) {
            await delay(this.config.fetchDelayMs, signal);
          }
          const detailHtml = await this.fetchDetailPage(href, signal);
          if (isClosedCompetitionDetailPage(detailHtml)) return null;
          return parseLpeDetailPage(detailHtml, this.config, href);
        } catch {
          signal?.throwIfAborted();
          return null;
        }
      },
    );

    return competitions.filter(
      (competition): competition is RawCompetition => competition !== null,
    );
  }

  private async fetchExtraDetailPages(signal?: AbortSignal): Promise<RawCompetition[]> {
    const paths = this.config.extraDetailPaths ?? [];
    const competitions = await mapWithConcurrency(
      paths,
      DETAIL_CONCURRENCY,
      async (path): Promise<RawCompetition | null> => {
        signal?.throwIfAborted();
        try {
          if (this.config.fetchDelayMs) {
            await delay(this.config.fetchDelayMs, signal);
          }
          const url = absoluteUrl(this.config, path);
          const html = await this.fetchDetailPage(url, signal);
          if (isClosedCompetitionDetailPage(html)) return null;
          return parseDetailPage(html, this.config, url);
        } catch {
          signal?.throwIfAborted();
          return null;
        }
      },
    );

    return competitions.filter(
      (competition): competition is RawCompetition => competition !== null,
    );
  }

  private async enrichLuxoraStoreStock(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    return mapWithConcurrency(
      competitions,
      DETAIL_CONCURRENCY,
      async (competition): Promise<RawCompetition> => {
        signal?.throwIfAborted();
        const url = `${this.config.baseUrl}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(competition.sourceId)}`;
        const payload = await this.fetchUrl(url, signal);
        const remaining = parseLuxoraStoreRemaining(payload, competition.sourceId);
        if (remaining === null || remaining > competition.maxTickets) {
          throw new Error(
            `[${this.config.displayName}] Invalid Store API stock for ${competition.url}`,
          );
        }

        return {
          ...competition,
          ticketsSold: competition.maxTickets - remaining,
        };
      },
    );
  }

  private async fetchDetailPage(url: string, signal?: AbortSignal): Promise<string> {
    if (this.config.renderDetailPages) {
      return this.fetchRenderedList(url, "body", signal);
    }
    return this.fetchUrl(url, signal);
  }
}

function absoluteUrl(config: WCLotterySiteConfig, href: string): string {
  if (href.startsWith("http")) return href;
  if (href.startsWith("/")) return `${config.baseUrl}${href}`;
  return `${config.baseUrl}/${href}`;
}

function parseLuxoraStoreRemaining(payload: string, slug: string): number | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!Array.isArray(parsed)) return null;

    const product = parsed.find((item): item is Record<string, unknown> => (
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item) &&
      item.slug === slug
    ));
    if (!product) return null;

    const stockAvailability = product.stock_availability;
    if (
      typeof stockAvailability === "object" &&
      stockAvailability !== null &&
      !Array.isArray(stockAvailability)
    ) {
      const text = (stockAvailability as Record<string, unknown>).text;
      if (typeof text === "string") {
        const match = text.match(/([\d,]+)\s+in\s+stock/i);
        if (match) return Number.parseInt(match[1].replace(/,/g, ""), 10);
      }
    }

    return null;
  } catch {
    return null;
  }
}

function stripPaidFreeEntryCategory(competition: RawCompetition): RawCompetition {
  if (competition.entryPrice <= 0) return competition;
  return {
    ...competition,
    categories: competition.categories.filter(
      (category) => !/^free(?:[-_\s](?:entry|draw|raffle|ticket)s?)?$/i.test(category.trim()),
    ),
  };
}

function needsDetailFields(competition: RawCompetition): boolean {
  if (competition.siteName === "unlockd") {
    return false;
  }

  return (
    competition.url.length > 0 &&
    (
      competition.maxTickets <= 0 ||
      competition.maxEntriesPerUserSource !== "site" ||
      competition.drawDate === null ||
      (competition.entryPrice <= 0 && !isFreeEntry(competition)) ||
      (
        (competition.cashAlternative ?? 0) <= 0 &&
        (competition.estimatedPrizeValue ?? 0) <= 0
      )
    )
  );
}

function isFreeEntry(competition: RawCompetition): boolean {
  return (
    competition.entryPrice === 0 &&
    (
      competition.categories.some((category) => category.trim().toLowerCase() === "free") ||
      /\bfree\s+(?:to\s+enter|entry|draw|raffle|ticket)\b/i.test(competition.name)
    )
  );
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return;

  await new Promise<void>((resolve, reject) => {
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

function dedupBySourceId(competitions: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return competitions.filter((competition) => {
    if (seen.has(competition.sourceId)) return false;
    seen.add(competition.sourceId);
    return true;
  });
}

function mergeDetailRows(
  competitions: RawCompetition[],
  details: RawCompetition[],
): RawCompetition[] {
  const detailBySourceId = new Map(details.map((competition) => [competition.sourceId, competition]));
  const merged = competitions.map((competition) => {
    const detail = detailBySourceId.get(competition.sourceId);
    if (!detail) return competition;

    return {
      ...competition,
      name: detail.name || competition.name,
      entryPrice: detail.entryPrice > 0 ? detail.entryPrice : competition.entryPrice,
      cashAlternative: detail.cashAlternative ?? competition.cashAlternative,
      estimatedPrizeValue: detail.estimatedPrizeValue ?? competition.estimatedPrizeValue,
      valuationSource: detail.valuationSource ?? competition.valuationSource,
      valuationConfidence: detail.valuationConfidence ?? competition.valuationConfidence,
      valuationNotes: detail.valuationNotes ?? competition.valuationNotes,
      drawDate: detail.drawDate ?? competition.drawDate,
    };
  });

  const seen = new Set(merged.map((competition) => competition.sourceId));
  return [
    ...merged,
    ...details.filter((competition) => !seen.has(competition.sourceId)),
  ];
}
