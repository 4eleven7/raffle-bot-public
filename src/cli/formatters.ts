import chalk from "chalk";
import Table from "cli-table3";
import type {
  Alert,
  Competition,
  EntryRecommendation,
  Snapshot,
  StarRating,
  TicketScenario,
} from "../types.js";
import type { TrendAnalysis } from "../metrics/trends.js";
import {
  gradeRaffle,
  isActionableRaffle,
  scoreRaffle,
} from "../metrics/decision.js";
import { getPrizeValue, getPrizeValueLabel } from "../metrics/calculator.js";
import { CONFIG } from "../config.js";
import { isFreshEntryInventory } from "./freshness.js";

// ── Helpers ──────────────────────────────────────────────────────

export function formatTimeRemaining(ms: number | null): string {
  if (ms === null) return "unknown";
  if (ms <= 0) return chalk.red("CLOSED");

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return `${days}d ${remainHours}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** OSC 8 terminal hyperlink — clickable in most modern terminals */
function termLink(text: string, url: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}

/** Compact number: 850 → "850", 12500 → "12.5k", 350000 → "350k" */
function compact(n: number): string {
  if (n >= 100_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Visual progress bar: [████░░░░░░] 42% */
function progressBar(ratio: number, width: number = 10): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pct = `${(clamped * 100).toFixed(0)}%`;

  if (clamped < 0.15) return chalk.green(`${bar} ${pct}`);
  if (clamped < 0.40) return chalk.yellow(`${bar} ${pct}`);
  if (clamped < 0.70) return chalk.hex("#FFA500")(`${bar} ${pct}`);
  return chalk.red(`${bar} ${pct}`);
}

/** Sparkline from an array of numbers */
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const ticks = " ▁▂▃▄▅▆▇█";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map((v) => {
    const idx = Math.round(((v - min) / range) * (ticks.length - 1));
    return ticks[idx];
  }).join("");
}

function evColor(ev: number): string {
  if (ev >= 50) return chalk.green.bold(`+£${ev.toFixed(0)}`);
  if (ev >= 10) return chalk.green(`+£${ev.toFixed(0)}`);
  if (ev >= 0) return chalk.yellow(`+£${ev.toFixed(1)}`);
  if (ev > -10) return chalk.red(`-£${Math.abs(ev).toFixed(1)}`);
  return chalk.red(`-£${Math.abs(ev).toFixed(0)}`);
}

function money(value: number, digits: number = 0): string {
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatPrizeValue(comp: Competition): string {
  const label = getPrizeValueLabel(comp);
  return label.startsWith("cash ")
    ? money(getPrizeValue(comp))
    : label.replace("est. ", "est ");
}

function probColor(prob: number): string {
  const pct = (prob * 100).toFixed(1);
  if (prob >= 0.5) return chalk.green.bold(`${pct}%`);
  if (prob >= 0.2) return chalk.green(`${pct}%`);
  if (prob >= 0.1) return chalk.yellow(`${pct}%`);
  return chalk.dim(`${pct}%`);
}

function lossColor(prob: number): string {
  const pct = (prob * 100).toFixed(1);
  if (prob >= 0.75) return chalk.red.bold(`${pct}%`);
  if (prob >= 0.5) return chalk.red(`${pct}%`);
  if (prob >= 0.35) return chalk.yellow(`${pct}%`);
  return chalk.green(`${pct}%`);
}

function ratioColor(ratio: number): string {
  if (!Number.isFinite(ratio)) return chalk.dim("--");
  const text = `${(ratio * 100).toFixed(0)}%`;
  if (ratio >= 1.5) return chalk.green.bold(text);
  if (ratio >= 1) return chalk.green(text);
  if (ratio >= 0.5) return chalk.yellow(text);
  return chalk.red(text);
}

function timeColor(ms: number | null): string {
  const text = formatTimeRemaining(ms);
  if (ms === null) return chalk.dim(text);
  if (ms <= 0) return chalk.red.bold(text);
  if (ms < 2 * 60 * 60 * 1000) return chalk.red(text);
  if (ms < 24 * 60 * 60 * 1000) return chalk.yellow(text);
  return chalk.dim(text);
}

/** Short site label: "pristine" → "PRIS", "guitargeargiveaway" → "GUIT" */
function siteTag(siteName: string): string {
  return chalk.dim(siteName.substring(0, 4).toUpperCase());
}

function shortTitle(comp: Competition, width: number): string {
  const title = comp.name.length > width
    ? `${comp.name.substring(0, width - 1)}…`
    : comp.name;
  return termLink(title, comp.url);
}

function compactEntryPlan(comp: Competition, scenario: TicketScenario): string {
  return `${scenario.tickets}×${money(comp.entryPrice, 2)}`;
}

function starText(stars: StarRating): string {
  return chalk.yellow("⭐".repeat(stars));
}

function compactRiskText(scenario: TicketScenario): string {
  const win = `${(scenario.winProbability * 100).toFixed(0)}%`;
  const lose = `${(scenario.lossProbability * 100).toFixed(0)}%`;
  if (scenario.winProbability >= 0.5) return chalk.green(`${win}/${lose}`);
  if (scenario.winProbability >= 0.2) return chalk.yellow(`${win}/${lose}`);
  return chalk.dim(`${win}/${lose}`);
}

function divider(label?: string): string {
  const line = "─".repeat(40);
  if (!label) return chalk.dim(line);
  return chalk.dim(`── ${chalk.reset.bold(label)} ${line}`);
}

// ── Scan table ───────────────────────────────────────────────────

export function formatCompetitionsTable(
  comps: Competition[],
  trends: ReadonlyMap<Competition, TrendAnalysis> = new Map(),
): string {
  const now = Date.now();
  const stored = formatStoredInformation(comps.filter((comp) => !isFreshEntryInventory(comp, now)));
  const entries = comps
    .filter((comp) => isFreshEntryInventory(comp, now))
    .map((comp) => ({
      comp,
      recommendation: gradeRaffle(comp, trends.get(comp) ?? null),
    }))
    .filter(({ recommendation }) => recommendation.stars > 0);

  if (entries.length === 0) {
    return chalk.dim("\n  No entries match the filters.\n") + stored;
  }

  const table = new Table({
    head: [
      "#",
      "Site",
      "Competition",
      "Cash",
      "Ticket",
      "Sold",
      "Model",
      "Odds",
      "Net EV",
      "Closes",
      "Stars",
    ].map((h) => chalk.bold(h)),
    colWidths: [4, 6, 34, 9, 8, 16, 12, 9, 10, 9, 12],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  entries.forEach(({ comp, recommendation }, i) => {
    const scenario = recommendation.projectedScenario ?? recommendation.currentScenario;
    table.push([
      chalk.dim(String(i + 1)),
      siteTag(comp.siteName),
      shortTitle(comp, 32),
      formatPrizeValue(comp),
      money(comp.entryPrice, 2),
      comp.maxTickets > 0
        ? progressBar(comp.sellThrough)
        : chalk.dim("n/a"),
      compactEntryPlan(comp, scenario),
      compactRiskText(scenario),
      evColor(scenario.netEV),
      timeColor(comp.timeToClose),
      starText(recommendation.stars),
    ]);
  });

  return table.toString() + stored;
}

// ── Entry table ──────────────────────────────────────────────────

export function formatEntryTable(
  entries: { comp: Competition; trend: TrendAnalysis }[],
): string {
  const now = Date.now();
  const stored = formatStoredInformation(entries
    .map(({ comp }) => comp).filter((comp) => !isFreshEntryInventory(comp, now)));
  const recommendations = entries
    .filter(({ comp }) => isFreshEntryInventory(comp, now))
    .map(({ comp, trend }) => ({ comp, recommendation: gradeRaffle(comp, trend) }))
    .filter(({ recommendation }) => recommendation.stars > 0);

  if (recommendations.length === 0) {
    return chalk.dim("\n  No entries worth taking in the next 24h.\n") + stored;
  }

  const table = new Table({
    head: ["#", "Competition", "Entry", "Win", "Net EV", "Closes", "Stars"]
      .map((h) => chalk.bold(h)),
    colWidths: [4, 42, 12, 9, 11, 9, 9],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  recommendations.forEach(({ comp, recommendation }, index) => {
    const scenario = recommendation.projectedScenario ?? recommendation.currentScenario;
    table.push([
      chalk.dim(String(index + 1)),
      shortTitle(comp, 40),
      compactEntryPlan(comp, scenario),
      probColor(scenario.winProbability),
      evColor(scenario.netEV),
      timeColor(comp.timeToClose),
      starText(recommendation.stars),
    ]);
  });

  return [
    "",
    `${divider("Raffles worth entering")} ${chalk.dim(`${recommendations.length} closing in the next 24h`)}`,
    "",
    table.toString() + stored,
    "",
  ].join("\n");
}

function formatStoredInformation(comps: Competition[]): string {
  if (comps.length === 0) return "";
  return "\n\n  Stored information only — fresh exact inventory required:\n" +
    comps.map((comp) => `  ${shortTitle(comp, 40)} · ${comp.ticketsSold}/${comp.maxTickets} sold · observed ${comp.scrapedAt}`).join("\n") + "\n";
}

function formatEntryLine(
  comp: Competition,
  recommendation: EntryRecommendation,
): string {
  const scenario = recommendation.projectedScenario ?? recommendation.currentScenario;
  return `  ${starText(recommendation.stars)} ${siteTag(comp.siteName)} ${shortTitle(comp, 52)} · ${compactEntryPlan(comp, scenario)} · ${probColor(scenario.winProbability)} win · ${evColor(scenario.netEV)} EV · ${timeColor(comp.timeToClose)}`;
}

function formatEntryRecommendations(
  entries: Array<{ comp: Competition; recommendation: EntryRecommendation }>,
  title: string,
): string {
  const recommendations = entries.filter(({ recommendation }) => recommendation.stars > 0);
  if (recommendations.length === 0) return "";
  const lines = ["", divider(`${title} (${recommendations.length})`), ""];
  for (const { comp, recommendation } of recommendations) {
    lines.push(formatEntryLine(comp, recommendation), "");
  }
  return lines.join("\n");
}

// ── Scenario table ───────────────────────────────────────────────

export function formatScenariosTable(
  comp: Competition,
  scenarios: TicketScenario[],
): string {
  const lines = [
    "",
    divider(comp.name.substring(0, 50)),
    "",
    `  ${chalk.dim("Prize:")} ${formatPrizeValue(comp)}    ${chalk.dim("Entry:")} £${comp.entryPrice}    ${chalk.dim("Sold:")} ${compact(comp.ticketsSold)}/${compact(comp.maxTickets)} ${progressBar(comp.sellThrough, 8)}`,
    "",
  ];

  const table = new Table({
    head: [
      "Tickets",
      "Cost",
      "P(Win)",
      "P(Lose)",
      "Expected Return",
      "Net EV",
      "EV/Stake",
    ].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  for (const s of scenarios) {
    const isOptimal = s.tickets === comp.optimalTickets;
    const prefix = isOptimal ? chalk.green("-> ") : "   ";
    table.push([
      `${prefix}${s.tickets}`,
      `£${s.cost.toFixed(0)}`,
      probColor(s.winProbability),
      lossColor(s.lossProbability),
      `£${s.expectedReturn.toFixed(0)}`,
      evColor(s.netEV),
      ratioColor(s.returnRatio),
    ]);
  }

  return lines.join("\n") + table.toString();
}

// ── Alerts ───────────────────────────────────────────────────────

export function formatAlerts(alerts: Alert[]): string {
  return formatEntryRecommendations(
    alerts.map((alert) => ({
      comp: alert.competition,
      recommendation: alert.recommendation,
    })),
    "Entries",
  );
}

// ── History ──────────────────────────────────────────────────────

export function formatHistory(snapshots: Snapshot[], name: string): string {
  if (snapshots.length === 0) return chalk.dim("No history recorded yet. Run some scans to build up data.");

  // Sparkline overview
  const values = snapshots.map((s) => s.ticketsSold);
  const spark = sparkline(values);
  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const totalChange = last.ticketsSold - first.ticketsSold;
  const timeSpan = new Date(last.scrapedAt).getTime() - new Date(first.scrapedAt).getTime();
  const hoursSpan = timeSpan / (1000 * 60 * 60);

  const lines = [
    "",
    divider(name.substring(0, 50)),
    "",
    `  ${chalk.dim("Snapshots:")} ${snapshots.length}    ${chalk.dim("Over:")} ${hoursSpan.toFixed(1)}h    ${chalk.dim("Sold:")} ${chalk.green(`+${totalChange}`)} tickets    ${chalk.dim("Rate:")} ${hoursSpan > 0 ? (totalChange / hoursSpan).toFixed(1) : "0"}/hr`,
    `  ${chalk.cyan(spark)} ${chalk.dim(`${compact(first.ticketsSold)} -> ${compact(last.ticketsSold)}`)}`,
    "",
  ];

  const table = new Table({
    head: [
      "Time",
      "Sold",
      "Change",
    ].map((h) => chalk.bold(h)),
    style: { head: [], border: [] },
  });

  let prevSold = 0;
  for (const s of snapshots) {
    const change = s.ticketsSold - prevSold;
    const changeStr =
      prevSold === 0
        ? chalk.dim("--")
        : change > 0
          ? chalk.green(`+${change}`)
          : chalk.dim("0");
    table.push([
      new Date(s.scrapedAt).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
      compact(s.ticketsSold),
      changeStr,
    ]);
    prevSold = s.ticketsSold;
  }

  return lines.join("\n") + table.toString();
}

// ── Scan summary ─────────────────────────────────────────────────

export function formatSummary(
  comps: Competition[],
  trends: ReadonlyMap<Competition, TrendAnalysis> = new Map(),
): string {
  const now = Date.now();
  const total = comps.length;
  const withPrize = comps.filter((c) => getPrizeValue(c) > 0);
  const positiveEv = comps.filter((c) => c.evPerTicket > 0);
  const actionable = comps.filter((c) =>
    isFreshEntryInventory(c, now) && isActionableRaffle(c, trends.get(c) ?? null)
  );
  const closingSoon = comps.filter(
    (c) => c.timeToClose !== null && c.timeToClose > 0 && c.timeToClose < CONFIG.filters.actionableWindowMs,
  );
  const topPick = actionable.reduce<Competition | undefined>(
    (best, c) => {
      const score = scoreRaffle(c, trends.get(c) ?? null);
      const bestScore = best
        ? scoreRaffle(best, trends.get(best) ?? null)
        : -Infinity;
      return score > bestScore ? c : best;
    },
    undefined,
  );

  // Count by site
  const siteCounts = new Map<string, number>();
  for (const c of comps) {
    siteCounts.set(c.siteName, (siteCounts.get(c.siteName) ?? 0) + 1);
  }
  const siteBreakdown = [...siteCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${chalk.dim(name)} ${count}`)
    .join(chalk.dim(" | "));

  const lines = [
    "",
    divider("Scan Complete"),
    "",
    `  ${chalk.bold(String(total))} competitions across ${chalk.bold(String(siteCounts.size))} sites`,
    `  ${siteBreakdown}`,
    "",
    `  ${chalk.green(String(positiveEv.length))} positive 1-ticket EV    ${chalk.green(String(actionable.length))} worth entering    ${chalk.yellow(String(closingSoon.length))} closing <24h    ${withPrize.length} with prize value`,
  ];

  if (topPick) {
    const recommendation = gradeRaffle(topPick, trends.get(topPick) ?? null);
    const scenario = recommendation.currentScenario;
    lines.push(
      "",
      `  ${starText(recommendation.stars)} ${chalk.green("Best one to enter:")} ${termLink(topPick.name.substring(0, 40), topPick.url)}`,
      `        ${compactEntryPlan(topPick, scenario)} · ${probColor(scenario.winProbability)} win · ${evColor(scenario.netEV)} EV · ${timeColor(topPick.timeToClose)}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
