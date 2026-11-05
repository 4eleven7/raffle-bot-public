import chalk from "chalk";
import Table from "cli-table3";
import { getCompetitions } from "../storage/database.js";
import { enrichCompetition, getPrizeValueLabel } from "../metrics/calculator.js";
import { analyzeTrend } from "../metrics/trends.js";
import { compareRaffleScore } from "../metrics/decision.js";
import { formatTimeRemaining } from "./formatters.js";
import { isFreshStoredCompetition } from "./freshness.js";

export interface TrendsOptions {
  site?: string;
  closingWithin?: string;
  limit?: number;
}

export function runTrends(options: TrendsOptions): void {
  const raw = getCompetitions(options.site);
  const comps = raw.filter((comp) => isFreshStoredCompetition(comp)).map(enrichCompetition);

  const withinMs = parseTime(options.closingWithin || "24h");

  const closing = comps.filter((c) =>
    c.timeToClose !== null &&
    c.timeToClose > 0 &&
    c.timeToClose < withinMs &&
    c.prizeValue > 0,
  );

  if (closing.length === 0) {
    console.log(chalk.dim("\n  No competitions with trend data closing within that window."));
    console.log(chalk.dim("  Run some scans first to build up snapshot history.\n"));
    return;
  }

  const analyzed = closing.map((comp) => ({
    comp,
    trend: analyzeTrend(comp),
  }));

  analyzed.sort((a, b) => {
    return compareRaffleScore(a.comp, b.comp, a.trend, b.trend);
  });

  const limited = analyzed.slice(0, options.limit || 20);

  const line = "─".repeat(40);
  console.log(`\n${chalk.dim("── ")}${chalk.bold("Trend Analysis")}${chalk.dim(` ${line}`)} ${chalk.dim(`${closing.length} competitions closing <${options.closingWithin || "24h"}`)}\n`);

  const table = new Table({
    head: [
      "#",
      "Site",
      "Competition",
      "Prize",
      "Sell-through",
      "Velocity",
      "Projected",
      "Confidence",
      "Net EV",
      "Closes",
    ].map((h) => chalk.bold(h)),
    colWidths: [4, 6, 26, 8, 18, 10, 10, 12, 10, 8],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  limited.forEach(({ comp, trend }, i) => {
    const velocity = trend.velocityPerHour > 0
      ? `${trend.velocityPerHour.toFixed(1)}/hr`
      : chalk.green("stalled");

    const accel = trend.isAccelerating ? chalk.red(" ^") : "";

    const projected = trend.projectedSellThrough !== null
      ? colorPct(trend.projectedSellThrough)
      : chalk.dim("--");

    const confidence = trend.projectedSellThrough !== null
      ? undersoldLabel(1 - trend.projectedSellThrough)
      : chalk.dim("--");

    const ev = comp.netEV > 0
      ? chalk.green(`+£${comp.netEV.toFixed(0)}`)
      : chalk.red(`£${comp.netEV.toFixed(0)}`);

    // Progress bar for sell-through
    const sellRatio = comp.maxTickets > 0 ? comp.ticketsSold / comp.maxTickets : 0;
    const barWidth = 10;
    const filled = Math.round(Math.min(1, sellRatio) * barWidth);
    const empty = barWidth - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);
    const pctStr = `${(sellRatio * 100).toFixed(0)}%`;
    let sellBar: string;
    if (sellRatio < 0.15) sellBar = chalk.green(`${bar} ${pctStr}`);
    else if (sellRatio < 0.40) sellBar = chalk.yellow(`${bar} ${pctStr}`);
    else sellBar = chalk.red(`${bar} ${pctStr}`);

    table.push([
      chalk.dim(String(i + 1)),
      chalk.dim(comp.siteName.substring(0, 4).toUpperCase()),
      comp.name.substring(0, 24),
      getPrizeValueLabel(comp),
      comp.maxTickets > 0 ? sellBar : chalk.dim("n/a"),
      velocity + accel,
      projected,
      confidence,
      ev,
      formatTimeRemaining(comp.timeToClose),
    ]);
  });

  console.log(table.toString());

  // Summary
  const stalled = analyzed.filter(
    (a) => a.trend.velocityPerHour < 1 && a.comp.sellThrough < 0.2,
  );
  const accelerating = analyzed.filter((a) => a.trend.isAccelerating);

  console.log(
    chalk.dim(`\n  ${chalk.green(String(stalled.length))} stalled (<1/hr, <20% sold)    ${chalk.yellow(String(accelerating.length))} accelerating\n`),
  );
}

function colorPct(pct: number): string {
  const label = `${(pct * 100).toFixed(0)}%`;
  if (pct < 0.2) return chalk.green(label);
  if (pct < 0.5) return chalk.yellow(label);
  return chalk.red(label);
}

function undersoldLabel(confidence: number): string {
  if (confidence > 0.7) return chalk.green.bold("HIGH");
  if (confidence > 0.4) return chalk.yellow("MEDIUM");
  return chalk.red("LOW");
}

function parseTime(s: string): number {
  const match = s.match(/^(\d+)\s*(m|h|d)$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case "m": return val * 60 * 1000;
    case "h": return val * 60 * 60 * 1000;
    case "d": return val * 24 * 60 * 60 * 1000;
    default: return val * 60 * 60 * 1000;
  }
}
