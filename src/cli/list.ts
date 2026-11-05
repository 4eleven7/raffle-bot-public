import chalk from "chalk";
import { getCompetitions, getCompetition, getSnapshots } from "../storage/database.js";
import { enrichCompetition, generateScenarios, getPrizeValue } from "../metrics/calculator.js";
import {
  formatCompetitionsTable,
  formatScenariosTable,
  formatHistory,
} from "./formatters.js";
import { compareRaffleScore } from "../metrics/decision.js";
import type { Competition } from "../types.js";
import { analyzeTrend, type TrendAnalysis } from "../metrics/trends.js";
import { isFreshEntryInventory, isFreshStoredCompetition } from "./freshness.js";

export interface ListOptions {
  site?: string;
  sort?: string;
  minEv?: number;
  closingWithin?: string;
  limit?: number;
}

export function runList(options: ListOptions): void {
  const raw = getCompetitions(options.site);

  if (raw.length === 0) {
    console.log(
      chalk.dim("No competitions in database. Run 'scan' first."),
    );
    return;
  }

  let comps: Competition[] = raw
    .filter((c) => isFreshStoredCompetition(c))
    .filter((c) => getPrizeValue(c) > 0)
    .map(enrichCompetition);

  // Filter by EV
  if (options.minEv !== undefined) {
    comps = comps.filter((c) => c.evPerTicket >= options.minEv!);
  }

  // Filter by closing time
  if (options.closingWithin) {
    const ms = parseTimeString(options.closingWithin);
    comps = comps.filter(
      (c) => c.timeToClose !== null && c.timeToClose > 0 && c.timeToClose <= ms,
    );
  }

  const trendByCompetition = new Map<Competition, TrendAnalysis>();
  for (const comp of comps) {
    trendByCompetition.set(comp, analyzeTrend(comp));
  }

  // Sort
  const sortKey = options.sort ?? "score";
  const rankedAt = Date.now();
  comps.sort((a, b) => {
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
      case "ev": return b.netEV - a.netEV;
      case "price": return a.entryPrice - b.entryPrice;
      case "closing": return (a.timeToClose ?? Infinity) - (b.timeToClose ?? Infinity);
      case "winprob": return b.winProbability - a.winProbability;
      default: return b.netEV - a.netEV;
    }
  });

  if (options.limit) {
    comps = comps.slice(0, options.limit);
  }

  console.log(chalk.bold(`\n${comps.length} competitions:\n`));
  console.log(formatCompetitionsTable(comps, trendByCompetition));
}

export function runScenario(
  sourceId: string,
  ticketCounts: number[],
  siteName: string = "pristine",
): void {
  const comp = getCompetition(sourceId, siteName);
  if (!comp) {
    console.log(chalk.red(`Competition ${sourceId} not found. Run 'scan' first.`));
    return;
  }

  const enriched = enrichCompetition(comp);
  const scenarios = generateScenarios(comp, ticketCounts);
  console.log(formatScenariosTable(enriched, scenarios));
}

export function runHistory(
  sourceId: string,
  siteName: string = "pristine",
): void {
  const comp = getCompetition(sourceId, siteName);
  const snapshots = getSnapshots(sourceId, siteName);
  console.log(formatHistory(snapshots, comp?.name ?? sourceId));
}

function parseTimeString(s: string): number {
  const match = s.match(/^(\d+)\s*(h|m|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case "h": return val * 60 * 60 * 1000;
    case "m": return val * 60 * 1000;
    case "d": return val * 24 * 60 * 60 * 1000;
    default: return val * 60 * 60 * 1000;
  }
}
