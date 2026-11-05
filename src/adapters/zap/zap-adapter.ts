import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { ZapSiteConfig } from "./zap-site-config.js";
import {
  enrichFromDetailPage,
  extractTotalPages,
  isClosedCompetitionDetailPage,
  parsePage,
} from "./zap-parser.js";

const DETAIL_CONCURRENCY = 6;
const FETCH_TIMEOUT_MS = 15_000;

export class ZapAdapter implements SiteAdapter {
  readonly siteName: string;

  constructor(private readonly config: ZapSiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const competitions: RawCompetition[] = [];

    const firstPageHtml = await this.fetchPage(this.config.listPath, signal);
    competitions.push(...parsePage(firstPageHtml, this.config));

    if (this.config.paginatedPath) {
      const totalPages = extractTotalPages(firstPageHtml, this.config);
      for (let page = 2; page <= totalPages; page++) {
        await sleep(this.config.fetchDelayMs, signal);
        const path = this.config.paginatedPath.replace("{page}", String(page));
        const html = await this.fetchPage(path, signal);
        competitions.push(...parsePage(html, this.config));
      }
    }

    const filteredCompetitions = competitions.filter(
      (competition) =>
        !(this.config.excludeUrlPatterns ?? []).some((pattern) => pattern.test(competition.url)),
    );

    // Enrich competitions that need detail-only fields:
    // - no ticket data from listing page (e.g. Urban Draw percentage-only cards)
    // - otherwise useful cash comps missing draw dates
    const needsEnrichment = filteredCompetitions.filter(
      (c) =>
        c.url &&
        isEnterable(c) &&
        (this.config.alwaysEnrichDetails ||
          (c.ticketsSold === 0 && c.maxTickets === 0) ||
          c.maxEntriesPerUserSource !== "site" ||
          (c.cashAlternative === null &&
            c.entryPrice > 0 &&
            c.maxTickets > 0 &&
            (hasDetailCashPrizeSignal(c) || DETAIL_CASH_ALTERNATIVE_SITES.has(c.siteName))) ||
          (c.drawDate === null &&
            (c.entryPrice > 0 || isFreeEntry(c)) &&
            c.maxTickets > 0)),
    );
    const closedCompetitionIds = new Set<string>();
    await runWithConcurrency(needsEnrichment, DETAIL_CONCURRENCY, async (comp) => {
      signal?.throwIfAborted();
      try {
        await sleep(this.config.fetchDelayMs, signal);
        const detailHtml = await this.fetchCompetitionDetail(comp.url, signal);
        if (isClosedCompetitionDetailPage(detailHtml, comp.sourceId)) {
          closedCompetitionIds.add(comp.sourceId);
          return;
        }
        enrichFromDetailPage(comp, detailHtml, this.config);
      } catch {
        signal?.throwIfAborted();
        // Keep listing page data if detail fetch fails
      }
    });

    return dedupCompetitions(filteredCompetitions)
      .filter(
        (competition) =>
          !closedCompetitionIds.has(competition.sourceId) && isEnterable(competition),
      )
      .map(stripPaidFreeEntryCategory);
  }

  private async fetchPage(path: string, signal?: AbortSignal): Promise<string> {
    const url = `${this.config.baseUrl}${path}`;
    return this.fetchUrl(url, signal);
  }

  private async fetchUrl(url: string, signal?: AbortSignal): Promise<string> {
    const response = await fetch(url, {
      headers: { "User-Agent": this.config.userAgent },
      signal: requestSignal(signal),
    });

    if (!response.ok) {
      throw new Error(
        `[${this.config.displayName}] Failed to fetch ${url}: ${response.status}`,
      );
    }

    return response.text();
  }

  private async fetchCompetitionDetail(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return this.fetchUrl(url, signal);
    }

    return this.fetchPage(url, signal);
  }
}

function isEnterable(competition: RawCompetition): boolean {
  return competition.maxTickets <= 0 || competition.ticketsSold < competition.maxTickets;
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

function isFreeEntry(competition: RawCompetition): boolean {
  return (
    competition.entryPrice === 0 &&
    (
      competition.categories.some((category) => category.trim().toLowerCase() === "free") ||
      /\bfree\s+(?:to\s+enter|entry|draw|raffle|ticket)\b/i.test(competition.name)
    )
  );
}

const DETAIL_CASH_ALTERNATIVE_SITES = new Set(["dreams2reality"]);

function hasDetailCashPrizeSignal(competition: RawCompetition): boolean {
  const text = `${competition.name} ${competition.categories.join(" ")}`.toLowerCase();
  return /\b(?:cash|wonga|bank|instant wins?|leaderboard)\b/i.test(text) || /£\s*\d/.test(text);
}

function dedupCompetitions(competitions: RawCompetition[]): RawCompetition[] {
  const bySourceId = new Map<string, RawCompetition>();
  for (const competition of competitions) {
    const existing = bySourceId.get(competition.sourceId);
    if (!existing || scoreCompetition(competition) > scoreCompetition(existing)) {
      bySourceId.set(competition.sourceId, competition);
    }
  }
  return Array.from(bySourceId.values());
}

function scoreCompetition(competition: RawCompetition): number {
  return (
    (competition.entryPrice > 0 || isFreeEntry(competition) ? 8 : 0) +
    (competition.maxTickets > 0 ? 8 : 0) +
    (competition.ticketsSold > 0 ? 5 : 0) +
    (competition.drawDate ? 5 : 0) +
    (competition.maxEntriesPerUser > 0 ? 3 : 0) +
    ((competition.cashAlternative ?? 0) > 0 ? 2 : 0)
  );
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await task(items[current]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}
