import { CONFIG } from "../config.js";
import { getAllAdapters } from "../adapters/registry.js";
import { getDb, getCompetitions, getSiteScanHealth } from "../storage/database.js";
import { getEntryResults } from "../storage/outcomes.js";
import { getMonitorStatus } from "../monitor/heartbeat.js";
import { getPrizeValue } from "../metrics/calculator.js";
import { excludedRaffleReason } from "../metrics/decision.js";
import { createSourceSelector } from "../monitor/source-policy.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildStatusReport(now = new Date(), days = 1) {
  if (!Number.isFinite(days) || days <= 0 || days > 90) throw new Error("Days must be greater than zero and at most 90");
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const db = getDb();
  const health = getSiteScanHealth();
  const sourceModes = createSourceSelector(getAllAdapters().map(a => a.siteName))(now.getTime());
  const healthCounts: Record<string, number> = {};
  for (const row of health) healthCounts[row.status] = (healthCounts[row.status] ?? 0) + 1;
  const latest = new Map<string, Record<string, unknown>>();
  const maths = new Set<string>();
  const value = new Set<string>();
  const outcomes: Record<string, number> = {};
  for (const {record_json} of db.prepare<[string], {record_json: string}>("SELECT record_json FROM alert_decisions WHERE recorded_at >= ? ORDER BY id").iterate(since)) {
    const r: unknown = JSON.parse(record_json);
    if (!object(r) || r.phase !== "final" || r.stage !== "entry-window" || !object(r.candidate)) continue;
    const key = JSON.stringify([r.canonicalUrl, r.candidate.drawDate]);
    latest.set(key, r);
    if (typeof r.outcome === "string") outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    const passed = object(r.recommendation) && typeof r.recommendation.stars === "number" && r.recommendation.stars > 0;
    if (passed && object(r.recommendation)) {
      (r.recommendation.category === "value" ? value : maths).add(key);
    }
  }
  const reasons: Record<string, number> = {};
  for (const r of latest.values()) {
    const reason = typeof r.deterministicReason === "string" ? r.deterministicReason : "unknown";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const competitions = getCompetitions();
  const bySite = new Map<string, typeof competitions>();
  for (const comp of competitions) {
    if (!comp.drawDate || Date.parse(comp.drawDate) <= now.getTime() || excludedRaffleReason(comp)) continue;
    const rows = bySite.get(comp.siteName) ?? [];
    rows.push(comp); bySite.set(comp.siteName, rows);
  }
  const repairPriorities = health.filter(h => h.status !== "success" && sourceModes.get(h.siteName) !== "paused").map(h => {
    const rows = bySite.get(h.siteName) ?? [];
    const valued = rows.filter(c => getPrizeValue(c) > 0);
    return {
      site: h.siteName, status: h.status, lastScanAt: h.scannedAt,
      futureStoredDraws: rows.length, valuedFutureStoredDraws: valued.length,
      closingWithin24h: valued.filter(c => Date.parse(c.drawDate!) - now.getTime() <= 86_400_000).length,
      error: h.errorMessage,
    };
  }).sort((a,b) => b.closingWithin24h-a.closingWithin24h || b.valuedFutureStoredDraws-a.valuedFutureStoredDraws || a.site.localeCompare(b.site));
  const fresh = competitions.filter(c => c.drawDate && Date.parse(c.drawDate) > now.getTime() && now.getTime()-Date.parse(c.scrapedAt) >= 0 && now.getTime()-Date.parse(c.scrapedAt) <= CONFIG.filters.maxStoredCompetitionAgeMs);
  const sends = db.prepare<[string], {messages: number; draws: number; lastSentAt: string | null}>(`SELECT count(*) messages, count(DISTINCT alert_key) draws, max(sent_at) lastSentAt FROM telegram_sent_messages WHERE sent_at >= ?`).get(since);
  return {
    generatedAt: now.toISOString(), since, monitor: getMonitorStatus(now.getTime()),
    coverage: { registeredSites: getAllAdapters().length,
      configuredPausedSites: [...sourceModes.values()].filter(mode => mode === "paused").length,
      regularSources: [...sourceModes.values()].filter(mode => mode === "regular").length,
      trialSources: [...sourceModes.values()].filter(mode => mode === "trial").length,
      latestScanResults: healthCounts,
      freshFutureRows: fresh.length, sitesWithFreshFutureRows: new Set(fresh.map(c=>c.siteName)).size,
      exactFreshFutureRows: fresh.filter(c=>c.inventorySource === "exact").length,
      valuedFreshFutureRows: fresh.filter(c=>getPrizeValue(c)>0).length },
    decisions: { observedDrawsInEntryWindow: latest.size, highChanceQualifiedDraws: maths.size,
      valueQualifiedDraws: value.size,
      observationOutcomes: outcomes, lastReasonPerDraw: reasons, confirmedDelivery: sends },
    valueOpportunities: {...CONFIG.valueOpportunities, mode: "live"},
    coverageGaps: db.prepare<[string], {started_at: string; resumed_at: string}>("SELECT started_at, resumed_at FROM monitor_gaps WHERE resumed_at >= ? ORDER BY id DESC").all(since),
    repairPriorities: repairPriorities.slice(0, 25),
    outcomes: getEntryResults().totals,
    caveats: ["Registered is not working coverage. Empty may mean no current draws.", "Qualified candidates must still pass delivery gates; they are not confirmed sends.", "Stored future draws prioritise investigation; they do not prove current entry availability.", "A stale heartbeat shows absent monitoring, not whether the host slept or the process stopped."],
  };
}

export function runStatus(options: {days?: string; json?: boolean}) {
  const report = buildStatusReport(new Date(), Number(options.days ?? 1));
  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Monitor: ${report.monitor.status}; last scan: ${report.monitor.lastScanAt ?? "unknown"}`);
  console.log(`Coverage: ${report.coverage.registeredSites} registered; ${report.coverage.sitesWithFreshFutureRows} sites with fresh future rows`);
  console.log(`Latest scans: ${JSON.stringify(report.coverage.latestScanResults)}`);
  console.log(`Since ${report.since}: ${report.decisions.observedDrawsInEntryWindow} draws evaluated; ${report.decisions.highChanceQualifiedDraws} high-chance candidates; ${report.decisions.confirmedDelivery?.draws ?? 0} draws sent`);
  console.log(`Value entries (${CONFIG.valueOpportunities.enabled ? "live" : "disabled"}): ${report.decisions.valueQualifiedDraws} qualifying draws; £${CONFIG.valueOpportunities.maxSpend} maximum stake; ${CONFIG.valueOpportunities.minWinProbability * 100}% minimum win chance`);
  console.log(`Last rejection per draw: ${JSON.stringify(report.decisions.lastReasonPerDraw)}`);
  console.log(`Recorded outcomes: ${JSON.stringify(report.outcomes)}`);
  console.log("Repair existing coverage before adding sites (stored evidence, not entry advice):");
  for (const row of report.repairPriorities.slice(0,10)) console.log(`  ${row.site}: ${row.status}; ${row.closingWithin24h} valued stored draws close within 24h`);
}
