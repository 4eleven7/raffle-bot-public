import { CONFIG } from "../config.js";
import type { SiteAdapter } from "../adapters/adapter.js";
import type {
  RawCompetition,
  SiteScanHealth,
  SiteScanStatus,
} from "../types.js";
import { applyEstimatedValuations } from "../valuation/estimate.js";
import { getPrizeValue } from "../metrics/calculator.js";
import { getCompetitions } from "../storage/database.js";
import { isFreshStoredCompetition } from "../cli/freshness.js";
import { closeBrowser } from "../adapters/browser/browser-pool.js";

export interface AdapterScanResult {
  adapter: SiteAdapter;
  raw: RawCompetition[];
  health: SiteScanHealth;
  error?: unknown;
}

interface InvalidCompetition {
  competition: RawCompetition;
  reason: string;
}

export async function scanAdapterWithRetry(
  adapter: SiteAdapter,
  options: {
    retries?: number;
    timeoutMs?: number;
    retryBaseDelayMs?: number;
    browserCleanupGraceMs?: number;
    getFreshFutureStoredCount?: (siteName: string, now: Date) => number;
  } = {},
): Promise<AdapterScanResult> {
  const retries = options.retries ?? CONFIG.monitor.scanRetries;
  const timeoutMs = options.timeoutMs ?? CONFIG.monitor.scanTimeoutMs;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? CONFIG.monitor.scanRetryBaseDelayMs;
  const browserCleanupGraceMs = options.browserCleanupGraceMs ?? 10000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const abortController = new AbortController();
      const fetchPromise = adapter.fetchAll(abortController.signal);
      const fetched = await withTimeout(
        fetchPromise,
        timeoutMs,
        adapter.siteName,
        async (timeoutError) => {
          abortController.abort(timeoutError);
          if (adapter.scanCost === "browser") {
            const settled = await waitForSettlement(
              fetchPromise,
              browserCleanupGraceMs,
            );
            if (!settled) {
              const closePromise = closeBrowser();
              await waitForSettlement(closePromise, 2000);
            }
          }
        },
      );
      if (fetched.length === 0) {
        const now = new Date();
        const storedCount = (
          options.getFreshFutureStoredCount ?? countFreshFutureStoredCompetitions
        )(adapter.siteName, now);
        if (storedCount > 0) {
          throw new Error(
            `[${adapter.siteName}] empty scan contradicted by ${storedCount} fresh future stored competitions`,
          );
        }
      }
      const normalised = fetched.map((competition) => ({
        ...competition,
        inventorySource: competition.inventorySource ?? "exact",
      }));
      const fetchedIntegrity = partitionCompetitionIntegrity(normalised);
      const valued = await applyEstimatedValuations(fetchedIntegrity.valid);
      const valuedIntegrity = partitionCompetitionIntegrity(valued);
      const invalid = [
        ...fetchedIntegrity.invalid,
        ...valuedIntegrity.invalid,
      ];
      const raw = valuedIntegrity.valid;
      return {
        adapter,
        raw,
        health: buildSuccessHealth(
          adapter.siteName,
          [
            ...raw,
            ...invalid.map(({ competition }) => competition),
          ],
        ),
      };
    } catch (error) {
      lastError = error;
      const status = classifyScanError(error);
      const shouldRetry =
        status === "transient_error" &&
        !(error instanceof ScanTimeoutError) &&
        attempt < retries;
      if (!shouldRetry) break;
      await delay(jitteredDelay(retryBaseDelayMs, attempt));
    }
  }

  return {
    adapter,
    raw: [],
    error: lastError,
    health: {
      siteName: adapter.siteName,
      status: classifyScanError(lastError),
      competitionsFound: 0,
      cashCompetitionsFound: 0,
      partialCompetitionsFound: 0,
      errorMessage: errorMessage(lastError),
      scannedAt: new Date().toISOString(),
    },
  };
}

export function classifyScanError(error: unknown): Extract<SiteScanStatus, "transient_error" | "blocked"> {
  const message = errorMessage(error).toLowerCase();
  if (/\b5\d{2}\b/.test(message)) return "transient_error";
  if (
    message.includes("403") ||
    message.includes("401") ||
    message.includes("forbidden") ||
    message.includes("cloudflare") ||
    message.includes("captcha")
  ) {
    return "blocked";
  }

  if (
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("err_name_not_resolved") ||
    message.includes("empty scan contradicted") ||
    message.includes("429")
  ) {
    return "transient_error";
  }

  return "blocked";
}

function countFreshFutureStoredCompetitions(siteName: string, now: Date): number {
  const nowMs = now.getTime();
  return getCompetitions(siteName).filter((competition) => {
    if (!isFreshStoredCompetition(competition, nowMs) || competition.drawDate === null) {
      return false;
    }
    const drawTime = new Date(competition.drawDate).getTime();
    return Number.isFinite(drawTime) && drawTime > nowMs;
  }).length;
}

export function buildSuccessHealth(
  siteName: string,
  raw: RawCompetition[],
): SiteScanHealth {
  const cash = raw.filter((competition) => getPrizeValue(competition) > 0);
  const invalid = raw
    .map((competition) => ({
      competition,
      reason: competitionIntegrityError(competition),
    }))
    .filter((result): result is InvalidCompetition => result.reason !== null);
  const invalidCompetitions = new Set(invalid.map(({ competition }) => competition));
  const partial = raw.filter((competition) =>
    invalidCompetitions.has(competition) ||
    (getPrizeValue(competition) > 0 && !isReadyCashCompetition(competition))
  );

  return {
    siteName,
    status: raw.length === 0 ? "empty" : partial.length > 0 ? "partial" : "success",
    competitionsFound: raw.length,
    cashCompetitionsFound: cash.length,
    partialCompetitionsFound: partial.length,
    errorMessage: formatIntegrityError(invalid),
    scannedAt: new Date().toISOString(),
  };
}

function partitionCompetitionIntegrity(raw: RawCompetition[]): {
  valid: RawCompetition[];
  invalid: InvalidCompetition[];
} {
  const valid: RawCompetition[] = [];
  const invalid: InvalidCompetition[] = [];

  for (const competition of raw) {
    const reason = competitionIntegrityError(competition);
    if (reason === null) {
      valid.push(competition);
    } else {
      invalid.push({ competition, reason });
    }
  }

  return { valid, invalid };
}

export function competitionIntegrityError(competition: RawCompetition): string | null {
  if (!String(competition.sourceId ?? "").trim()) {
    return "sourceId is required";
  }
  if (!String(competition.siteName ?? "").trim()) {
    return "siteName is required";
  }
  if (!String(competition.name ?? "").trim()) {
    return "name is required";
  }
  if (!isValidHttpUrl(competition.url)) {
    return "url must be an absolute HTTP(S) URL";
  }
  if (!Number.isFinite(competition.entryPrice) || competition.entryPrice < 0) {
    return `entryPrice ${competition.entryPrice} must be finite and non-negative`;
  }
  if (competition.entryPrice > 0 && hasExplicitFreeEntryProvenance(competition)) {
    return `entryPrice ${competition.entryPrice} contradicts explicit free-entry provenance`;
  }
  if (competition.entryPrice === 0 && !isFreeEntry(competition)) {
    return "entryPrice 0 requires explicit free-entry provenance";
  }
  if (!Number.isFinite(competition.ticketsSold) || competition.ticketsSold < 0) {
    return `ticketsSold ${competition.ticketsSold} must be finite and non-negative`;
  }
  if (!Number.isFinite(competition.maxTickets) || competition.maxTickets <= 0) {
    return `maxTickets ${competition.maxTickets} must be finite and greater than zero`;
  }
  if (competition.ticketsSold > competition.maxTickets) {
    return `ticketsSold ${competition.ticketsSold} exceeds maxTickets ${competition.maxTickets}`;
  }
  if (!Number.isFinite(competition.maxEntriesPerUser) || competition.maxEntriesPerUser < 0) {
    return `maxEntriesPerUser ${competition.maxEntriesPerUser} must be finite and non-negative`;
  }
  if (
    competition.cashAlternative !== null &&
    (!Number.isFinite(competition.cashAlternative) || competition.cashAlternative < 0)
  ) {
    return `cashAlternative ${competition.cashAlternative} must be finite and non-negative`;
  }
  if (
    competition.estimatedPrizeValue !== null &&
    competition.estimatedPrizeValue !== undefined &&
    (!Number.isFinite(competition.estimatedPrizeValue) || competition.estimatedPrizeValue < 0)
  ) {
    return `estimatedPrizeValue ${competition.estimatedPrizeValue} must be finite and non-negative`;
  }
  if (competition.drawDate === null || !String(competition.drawDate).trim()) {
    return "drawDate is required";
  }
  if (!Number.isFinite(new Date(competition.drawDate).getTime())) {
    return `drawDate ${competition.drawDate} must be a valid date`;
  }
  if (!Number.isFinite(new Date(competition.scrapedAt).getTime())) {
    return `scrapedAt ${competition.scrapedAt} must be a valid date`;
  }
  return null;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatIntegrityError(invalid: InvalidCompetition[]): string | null {
  if (invalid.length === 0) return null;

  const label = invalid.length === 1 ? "competition" : "competitions";
  const details = invalid
    .slice(0, 3)
    .map(({ competition, reason }) => `${competition.sourceId}: ${reason}`)
    .join("; ");
  const remainder = invalid.length > 3 ? `; plus ${invalid.length - 3} more` : "";
  return `${invalid.length} invalid ${label} excluded: ${details}${remainder}`;
}

function isReadyCashCompetition(competition: RawCompetition): boolean {
  return (
    getPrizeValue(competition) > 0 &&
    (competition.entryPrice > 0 || isFreeEntry(competition)) &&
    competition.maxTickets > 0 &&
    competition.drawDate !== null
  );
}

function isFreeEntry(competition: RawCompetition): boolean {
  return competition.entryPrice === 0 && hasExplicitFreeEntryProvenance(competition);
}

function hasExplicitFreeEntryProvenance(competition: RawCompetition): boolean {
  return (
    competition.categories.some((category) =>
      /^free(?:[-_\s](?:entry|draw|raffle|ticket)s?)?$/.test(category.trim().toLowerCase())
    ) ||
    /\bfree\s+(?:to\s+enter|(?:2|two)\s+enter|entry|draw|raffle|ticket)\b/i.test(competition.name)
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: (error: ScanTimeoutError) => Promise<void>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      const timeoutError = new ScanTimeoutError(timeoutMs, label);
      void (async () => {
        try {
          await onTimeout?.(timeoutError);
        } finally {
          reject(timeoutError);
        }
      })();
    }, timeoutMs);

    promise.then(
      (value) => {
        if (timedOut) return;
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        if (timedOut) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

class ScanTimeoutError extends Error {
  constructor(timeoutMs: number, label: string) {
    super(`timeout after ${timeoutMs}ms: ${label}`);
    this.name = "ScanTimeoutError";
  }
}

async function waitForSettlement(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function jitteredDelay(baseDelayMs: number, attempt: number): number {
  const backoff = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * Math.max(1, baseDelayMs / 2));
  return backoff + jitter;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${cause}`;
  }
  return String(error ?? "unknown error");
}
