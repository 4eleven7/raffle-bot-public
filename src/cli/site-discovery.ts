import { readFileSync } from "node:fs";
import { DateTime } from "luxon";
import { checkSiteRegistry, getRegisteredSites, normalizeOperatorHost } from "../adapters/registry.js";
import { enrichCompetitionAt } from "../metrics/calculator.js";
import { evaluateRafflePotential, gradeRaffle, scoreRaffle } from "../metrics/decision.js";
import { competitionIntegrityError } from "../scan/scan-adapter.js";
import { CONFIG } from "../config.js";
import type { RawCompetition } from "../types.js";
import { isFreshEntryInventory } from "./freshness.js";

export function registeredSitesForHost(host?: string) {
  checkSiteRegistry();
  const sites = getRegisteredSites();
  return host === undefined ? sites : sites.filter(
    (site) => site.operatorHosts.includes(normalizeOperatorHost(host)),
  );
}

export function runSites(host?: string, options: { check?: boolean } = {}): void {
  const sites = registeredSitesForHost(host);
  console.log(JSON.stringify(options.check ? {
    sites: sites.length,
    operatorHosts: new Set(sites.flatMap((site) => site.operatorHosts)).size,
    direct: sites.filter((site) => site.source === "direct").length,
    compwatch: sites.filter((site) => site.source === "compwatch").length,
  } : sites, null, 2));
}

/** Read-only probe: no scans, database writes, invented history, or alert dispatch. */
export function triageRows(input: unknown, now = new Date()) {
  if (!Array.isArray(input)) throw new Error("Triage input must be an array of raw or scan JSON rows");
  const rows = input.map((value, index) => {
    if (!value || typeof value !== "object" || !Array.isArray(value.categories) ||
        !value.categories.every((category: unknown) => typeof category === "string") ||
        !["name", "sourceId", "siteName", "url", "drawDate", "scrapedAt"].every((key) => typeof value[key] === "string") ||
        typeof value.isAutoDraw !== "boolean" ||
        (value.drawUsesFullTicketRange !== undefined && typeof value.drawUsesFullTicketRange !== "boolean")) {
      throw new Error(`Invalid triage row ${index + 1}: invalid identity, dates, categories, or draw flags`);
    }
    const raw = value as RawCompetition;
    const error = competitionIntegrityError(raw);
    if (error) throw new Error(`Invalid triage row ${index + 1}: ${error}`);
    const current = enrichCompetitionAt(raw, now);
    const potential = evaluateRafflePotential(raw, now);
    const currentGrade = gradeRaffle(current);
    const currentScore = scoreRaffle(current);
    return {
      siteName: raw.siteName, url: raw.url, sourceId: raw.sourceId,
      current: {
        recommendation: currentGrade,
        score: Number.isFinite(currentScore) ? currentScore : null,
        freshInventory: isFreshEntryInventory(raw, now),
        trend: "unavailable; current grade requires full sell-through",
      },
      potential: { ...potential, score: Number.isFinite(potential.score) ? potential.score : null },
    };
  });
  rows.sort((a, b) => (b.potential.score ?? -Infinity) - (a.potential.score ?? -Infinity));
  return { checkedAt: now.toISOString(), policy: {
    minWinProbability: CONFIG.filters.minWinProbability,
    maxSpend: CONFIG.filters.maxSpend, minReturnRatio: CONFIG.filters.minReturnRatio,
    valueOpportunities: { ...CONFIG.valueOpportunities },
    potentialAssumption: "no further ticket sales",
  }, rows };
}

export function runTriage(file: string): void {
  console.log(JSON.stringify(triageRows(JSON.parse(readFileSync(file, "utf8"))), null, 2));
}

export function candidateQueue(ledger: string, health = false, now = new Date()) {
  checkSiteRegistry();
  const lines = ledger.split("\n").filter((line) => line.startsWith("|"));
  const cells = (line: string) => line.split("|").slice(1, -1).map((cell) => cell.trim());
  const headers = cells(lines[0] ?? "");
  for (const header of ["operator_host", "decision", "recheck_on"]) {
    if (!headers.includes(header)) throw new Error(`Candidate ledger is missing ${header}`);
  }
  const today = DateTime.fromJSDate(now, { zone: "Europe/London" }).toISODate();
  if (!today) throw new Error("Invalid queue date");
  const owners = new Map(getRegisteredSites().flatMap((site) =>
    site.operatorHosts.map((host) => [host, site.siteName] as const)));
  return lines.slice(2).map((line) => {
    const values = cells(line);
    if (values.length !== headers.length) throw new Error(`Invalid ledger row: ${line}`);
    const row = Object.fromEntries(headers.map((key, index) => [key, values[index]]));
    if (!["add-direct", "add-direct-parser-fix", "add-custom", "add-compwatch-fallback",
      "health-debug-first", "defer", "complete", "duplicate", "reject"].includes(row.decision)) {
      throw new Error(`Unknown ledger decision: ${row.decision}`);
    }
    const aliases = [row.operator_host, ...(row.operator_aliases ?? "").split(/[,;\s]+/).filter(Boolean)];
    const matches = new Set(aliases.map((alias) => owners.get(normalizeOperatorHost(alias))).filter(Boolean));
    if (matches.size > 1) throw new Error(`Conflicting operator aliases: ${row.operator_host}`);
    const registeredSite = [...matches][0] ?? null;
    // A run can stop after registration but before onboarding verification.
    const pendingAdd = row.decision.startsWith("add-");
    return { ...row, operator_host: row.operator_host,
      decision: pendingAdd ? registeredSite ? "health-debug-first" : "defer" : row.decision,
      next_action: pendingAdd ? registeredSite
        ? "Verify incomplete onboarding before marking support complete"
        : "Rerun current triage before any support edit; a queued add decision is not fresh authorization"
        : row.next_action,
      recheck_on: pendingAdd ? today : row.recheck_on, registeredSite };
  }).filter((row) => {
    if (["complete", "duplicate", "reject"].includes(row.decision)) return false;
    if (health ? row.decision !== "health-debug-first" : row.decision === "health-debug-first" || row.registeredSite !== null) return false;
    const date = DateTime.fromISO(row.recheck_on, { zone: "Europe/London" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.recheck_on) || !date.isValid) {
      throw new Error(`Missing or invalid recheck_on: ${row.operator_host}`);
    }
    return row.recheck_on <= today;
  }).sort((a, b) => a.recheck_on.localeCompare(b.recheck_on) || a.operator_host.localeCompare(b.operator_host));
}

export function runSiteQueue(file: string, options: { health?: boolean }): void {
  console.log(JSON.stringify(candidateQueue(readFileSync(file, "utf8"), options.health), null, 2));
}
