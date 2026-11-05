import chalk from "chalk";
import { getAdapter, getAllAdapters } from "../adapters/registry.js";
import { enrichCompetition } from "../metrics/calculator.js";
import {
  upsertCompetition,
  insertSnapshot,
  upsertSiteScanHealth,
} from "../storage/database.js";
import { checkAlerts } from "../alerts/alerts.js";
import {
  formatCompetitionsTable,
  formatAlerts,
  formatSummary,
} from "./formatters.js";
import { compareRaffleScore } from "../metrics/decision.js";
import { getPrizeValue } from "../metrics/calculator.js";
import { analyzeTrend, type TrendAnalysis } from "../metrics/trends.js";
import { CONFIG } from "../config.js";
import { mapWithConcurrency, normalizeConcurrency } from "../utils/concurrency.js";
import type { SiteAdapter } from "../adapters/adapter.js";
import type { Competition, Alert } from "../types.js";
import {
  type AdapterScanResult,
  scanAdapterWithRetry,
} from "../scan/scan-adapter.js";
import { closeBrowser } from "../adapters/browser/browser-pool.js";
import { isFreshEntryInventory } from "./freshness.js";

export interface ScanOptions {
  site?: string;
  sort?: string;
  minEv?: number;
  limit?: number;
  json?: boolean;
  concurrency?: number;
}

export async function runScan(options: ScanOptions): Promise<void> {
  const adapters = options.site
    ? [getAdapter(options.site)].filter((adapter): adapter is SiteAdapter => adapter !== undefined)
    : getAllAdapters();

  if (adapters.length === 0) {
    console.error(chalk.red(`No adapter found for site: ${options.site}`));
    return;
  }

  const total = adapters.length;
  const concurrency = options.site
    ? 1
    : normalizeConcurrency(options.concurrency, CONFIG.monitor.scanConcurrency);
  let completed = 0;
  const jsonOutput = options.json === true;
  if (!jsonOutput) {
    console.log(chalk.dim(`Scanning ${total} sites (${concurrency} parallel)...\n`));
  }

  const allComps: Competition[] = [];
  const allAlerts: Alert[] = [];

  const results = await scanAdapters();

  for (const result of results) {
    upsertSiteScanHealth(result.health);

    if (result.error) {
      console.error(
        chalk.red(
          `Error scanning ${result.adapter.siteName}: ${result.health.status}: ${result.health.errorMessage}`,
        ),
      );
      continue;
    }

    for (const comp of result.raw) {
      upsertCompetition(comp);
      insertSnapshot(comp);
      const enriched = enrichCompetition(comp);
      allComps.push(enriched);
    }
  }

  const trendByCompetition = new Map<Competition, TrendAnalysis>();
  for (const comp of allComps) {
    trendByCompetition.set(comp, analyzeTrend(comp));
    allAlerts.push(...checkAlerts(comp, trendByCompetition.get(comp)!));
  }

  if (!jsonOutput) {
    console.log(formatScanHealthSummary(results));
  }

  // Filter
  let filtered = allComps.filter((c) => getPrizeValue(c) > 0);
  if (options.minEv !== undefined) {
    filtered = filtered.filter((c) => c.evPerTicket >= options.minEv!);
  }

  // Sort
  const sortKey = options.sort ?? "score";
  const rankedAt = Date.now();
  filtered.sort((a, b) => {
    switch (sortKey) {
      case "score": {
        const freshness = Number(isFreshEntryInventory(b, rankedAt)) - Number(isFreshEntryInventory(a, rankedAt));
        return freshness || compareRaffleScore(
          a,
          b,
          trendByCompetition.get(a) ?? null,
          trendByCompetition.get(b) ?? null,
        );
      }
      case "ev":
        return b.netEV - a.netEV;
      case "price":
        return a.entryPrice - b.entryPrice;
      case "closing":
        return (a.timeToClose ?? Infinity) - (b.timeToClose ?? Infinity);
      case "winprob":
        return b.winProbability - a.winProbability;
      case "sold":
        return a.sellThrough - b.sellThrough;
      default:
        return b.netEV - a.netEV;
    }
  });

  // Limit
  if (options.limit) {
    filtered = filtered.slice(0, options.limit);
  }

  if (jsonOutput) {
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  // Display
  console.log(formatSummary(allComps, trendByCompetition));

  if (allAlerts.length > 0) {
    console.log(formatAlerts(allAlerts));
  }

  console.log(formatCompetitionsTable(filtered, trendByCompetition));

  async function scanLane(
    laneAdapters: SiteAdapter[],
    laneConcurrency: number,
  ): Promise<AdapterScanResult[]> {
    return mapWithConcurrency(
      laneAdapters,
      laneConcurrency,
      async (adapter): Promise<AdapterScanResult> => {
        if (!jsonOutput) {
          process.stdout.write(chalk.dim(`  ${adapter.siteName}... `));
        }
        const result = await scanAdapterWithRetry(adapter);
        completed++;
        if (!jsonOutput) {
          process.stdout.write(formatSiteScanLine(result, completed, total));
        }
        return result;
      },
    );
  }

  async function scanAdapters(): Promise<AdapterScanResult[]> {
    try {
      return options.site
        ? await scanLane(adapters, 1)
        : [
            ...await scanLane(
              adapters.filter((adapter) => adapter.scanCost !== "browser"),
              concurrency,
            ),
            ...await scanLane(
              adapters.filter((adapter) => adapter.scanCost === "browser"),
              Math.min(concurrency, CONFIG.monitor.browserScanConcurrency),
            ),
          ];
    } finally {
      await closeBrowser();
    }
  }
}

function formatSiteScanLine(
  result: AdapterScanResult,
  completed: number,
  total: number,
): string {
  const suffix = chalk.dim(`[${completed}/${total}]\n`);
  switch (result.health.status) {
    case "success":
      return chalk.dim(`${result.raw.length} found ${suffix}`);
    case "partial":
      return chalk.yellow(
        `${result.raw.length} found, ${result.health.partialCompetitionsFound} partial ${suffix}`,
      );
    case "empty":
      return chalk.dim(`empty ${suffix}`);
    case "blocked":
      return chalk.red(`blocked ${suffix}`);
    case "transient_error":
      return chalk.yellow(`transient error ${suffix}`);
  }
}

function formatScanHealthSummary(results: AdapterScanResult[]): string {
  const counts = new Map<string, number>();
  for (const result of results) {
    counts.set(result.health.status, (counts.get(result.health.status) ?? 0) + 1);
  }

  const transient = counts.get("transient_error") ?? 0;
  const blocked = counts.get("blocked") ?? 0;
  const partial = counts.get("partial") ?? 0;
  const empty = counts.get("empty") ?? 0;
  const success = counts.get("success") ?? 0;

  return [
    "",
    chalk.bold("Site health"),
    `  ${chalk.green(String(success))} success  ` +
      `${chalk.yellow(String(partial))} partial  ` +
      `${chalk.dim(String(empty))} empty  ` +
      `${chalk.yellow(String(transient))} transient  ` +
      `${chalk.red(String(blocked))} blocked`,
    transient > 0
      ? chalk.dim("  Transient failures keep last known data; they are not treated as zero raffles.")
      : "",
    "",
  ].filter(Boolean).join("\n");
}
