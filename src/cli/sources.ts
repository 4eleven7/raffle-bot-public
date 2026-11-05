import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { getRegisteredSites } from "../adapters/registry.js";
import { getCompetitions, getDb, getSiteScanHealth } from "../storage/database.js";
import { CONFIG, loadConfigFromPath } from "../config.js";
import { triageRows } from "./site-discovery.js";
import { isFreshStoredCompetition, isFreshEntryInventory } from "./freshness.js";
import { enrichCompetitionAt } from "../metrics/calculator.js";
import { gradeRaffle } from "../metrics/decision.js";
import { analyzeTrend } from "../metrics/trends.js";
import { createQualificationReader, selectSourceModes, SOURCE_HISTORY_MS,
  MAX_SOURCE_TRIALS, SOURCE_TRIAL_MS, SOURCE_TRIAL_DRAWS, createTrialProgressReader,
  isRedundantSource, type RedundantSource } from "../monitor/source-policy.js";

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface DrawEvidence {
  recordedAt: string;
  economicReject: boolean;
}

export function buildSourceReport(now = new Date(), redundantSites = CONFIG.monitor.redundantSites,
  trials = CONFIG.monitor.sourceMonitoring.trials) {
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const db = getDb();
  const latest = new Map<string, Map<string, DrawEvidence>>();
  const qualified = new Map<string, Set<string>>();
  let invalidRecords = 0;
  let legacyRecords = 0;
  const retainedHistorySince = db.prepare<[], { since: string | null }>(
    "SELECT min(recorded_at) since FROM alert_decisions").get()?.since ?? null;
  for (const row of db.prepare<[], { record_json: string }>(
    "SELECT record_json FROM alert_decisions ORDER BY id",
  ).iterate()) {
    try {
      const record: unknown = JSON.parse(row.record_json);
      if (!object(record) || record.phase !== "final" || record.stage !== "entry-window" ||
          !object(record.candidate) || typeof record.recordedAt !== "string") continue;
      const candidate = record.candidate;
      if (typeof candidate.siteName !== "string" || typeof candidate.drawDate !== "string" ||
          typeof candidate.sourceId !== "string") continue;
      const at = new Date(record.recordedAt);
      if (!Number.isFinite(at.getTime()) || at > now) { invalidRecords++; continue; }
      if (at.getTime() <= Date.parse(since)) continue;
      const key = JSON.stringify([candidate.sourceId, candidate.drawDate]);
      if (object(record.recommendation) && typeof record.recommendation.stars === "number" &&
          record.recommendation.stars > 0) {
        const keys = qualified.get(candidate.siteName) ?? new Set<string>();
        keys.add(key); qualified.set(candidate.siteName, keys);
      }
      if (at.getTime() < Date.parse(since) || !Number.isFinite(Date.parse(candidate.drawDate)) ||
          Date.parse(candidate.drawDate) > now.getTime()) continue;
      const draws = latest.get(candidate.siteName) ?? new Map<string, DrawEvidence>();
      // Regrade historical economics with today's policy at the original observation time.
      // Optimistic failures are sufficient evidence of poor economics; missing data is not.
      // Older decision logs omit these non-economic fields. Empty categories remove
      // exclusions, so a failed optimistic grade remains conservative evidence.
      if (candidate.categories === undefined || candidate.isAutoDraw === undefined) legacyRecords++;
      const probe = triageRows([{ ...candidate,
        categories: candidate.categories ?? [], isAutoDraw: candidate.isAutoDraw ?? false,
      }], at).rows[0];
      const reason = probe.potential.recommendation.reason;
      draws.set(key, { recordedAt: record.recordedAt,
        economicReject: reason === "no positive stake" || reason === "too unlikely" });
      latest.set(candidate.siteName, draws);
    } catch { invalidRecords++; }
  }
  const sent = new Map(db.prepare<[string, string], { site_name: string; draws: number }>(
    "SELECT site_name, count(DISTINCT alert_key) draws FROM telegram_sent_messages WHERE sent_at > ? AND sent_at <= ? GROUP BY site_name",
  ).all(since, now.toISOString()).map(row => [row.site_name, row.draws]));
  const qualifications = createQualificationReader()(now.getTime());
  const completedTrialDraws = createTrialProgressReader()(trials, now.getTime());
  const modes = selectSourceModes(getRegisteredSites().map(s => s.siteName), qualifications, trials, now.getTime(), completedTrialDraws);
  const health = new Map(getSiteScanHealth().map(row => [row.siteName, row]));
  const fresh = new Map<string, { rows: number; potential: number; qualified: number; invalid: number }>();
  for (const comp of getCompetitions()) {
    if (!comp.drawDate || Date.parse(comp.drawDate) <= now.getTime() ||
        !isFreshStoredCompetition(comp, now.getTime())) continue;
    const counts = fresh.get(comp.siteName) ?? { rows: 0, potential: 0, qualified: 0, invalid: 0 };
    counts.rows++;
    try {
      if (triageRows([comp], now).rows[0].potential.recommendation.stars > 0) counts.potential++;
      if (Date.parse(comp.drawDate) - now.getTime() <= CONFIG.alerts.notificationWindowMs &&
          isFreshEntryInventory(comp, now)) {
        const enriched = enrichCompetitionAt(comp, now);
        if (gradeRaffle(enriched, analyzeTrend(enriched)).stars > 0) counts.qualified++;
      }
    } catch { counts.invalid++; }
    fresh.set(comp.siteName, counts);
  }
  const rows = getRegisteredSites().map(site => {
    const draws = [...(latest.get(site.siteName)?.values() ?? [])];
    const rejected = draws.filter(draw => draw.economicReject);
    const days = new Set(rejected.map(draw => new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(draw.recordedAt)))).size;
    const counts = fresh.get(site.siteName) ?? { rows: 0, potential: 0, qualified: 0, invalid: 0 };
    const scan = health.get(site.siteName);
    const qualifiedDraws = qualified.get(site.siteName)?.size ?? 0;
    const confirmedSends = sent.get(site.siteName) ?? 0;
    const needsRepair = scan && ["partial", "blocked", "transient_error"].includes(scan.status);
    const mode = modes.get(site.siteName) ?? "paused";
    const status = mode === "regular" ? "active" : mode;
    const lastQualified = qualifications.get(site.siteName);
    return { ...site, status, configuredRedundant: isRedundantSource(site.siteName, now.getTime(), redundantSites),
      scanStatus: scan?.status ?? "unknown", scannedAt: scan?.scannedAt ?? null,
      observedDraws: draws.length, economicRejects: rejected.length, economicDays: days,
      qualifiedDraws, confirmedSends, freshFutureRows: counts.rows, potentialRows: counts.potential,
      lastQualifiedAt: lastQualified === undefined ? null : new Date(lastQualified).toISOString(),
      regularUntil: lastQualified === undefined ? null : new Date(lastQualified + SOURCE_HISTORY_MS).toISOString(),
      trial: trials[site.siteName] ?? null,
      completedTrialDraws: completedTrialDraws.get(site.siteName) ?? 0,
      currentQualifiedRows: counts.qualified, needsRepair: Boolean(needsRepair),
      previousPause: redundantSites[site.siteName] ?? null,
      invalidFreshRows: counts.invalid, reviewAfter: new Date(now.getTime() + 30 * 86_400_000).toISOString() };
  });
  rows.sort((a, b) => b.economicRejects - a.economicRejects || a.siteName.localeCompare(b.siteName));
  return { generatedAt: now.toISOString(), since, retainedHistorySince, invalidRecords, legacyRecords,
    policy: { historyDays: 30, qualifyingHistory: "rolling 30 days", reviewDays: 30,
      trialDays: SOURCE_TRIAL_MS / 86_400_000, trialDraws: SOURCE_TRIAL_DRAWS,
      maximumTrials: MAX_SOURCE_TRIALS, pausedMonitoring: "no automatic scans",
      highChance: { maxSpend: CONFIG.filters.maxSpend, minWinProbability: CONFIG.filters.minWinProbability,
        minReturnRatio: CONFIG.filters.minReturnRatio }, value: { ...CONFIG.valueOpportunities } },
    counts: Object.fromEntries(["active", "trial", "paused"].map(status =>
      [status, rows.filter(row => row.status === status).length])), rows };
}

export function sourcePolicyOverrides(report: ReturnType<typeof buildSourceReport>): Record<string, RedundantSource> {
  return Object.fromEntries(report.rows.filter(row => row.status === "paused").map(row => [row.siteName, {
    reviewedAt: report.generatedAt, reviewAfter: row.reviewAfter,
    reason: `No qualifying observation or confirmed send in the last 30 days; no admitted active trial. ` +
      `Scan health: ${row.scanStatus}. ${row.economicRejects} economic failures; missing evidence is not proof of unprofitability.`,
  }]));
}

export function runSources(options: { json?: boolean; writePolicy?: string }): void {
  const config = options.writePolicy ? loadConfigFromPath(options.writePolicy, CONFIG) : CONFIG;
  const report = buildSourceReport(new Date(), config.monitor.redundantSites, config.monitor.sourceMonitoring.trials);
  if (options.writePolicy) {
    const existing: unknown = existsSync(options.writePolicy)
      ? JSON.parse(readFileSync(options.writePolicy, "utf8")) : {};
    if (!object(existing) || (existing.monitor !== undefined && !object(existing.monitor))) {
      throw new Error("Source policy output must be a raffle-bot configuration object");
    }
    const monitor = object(existing.monitor) ? existing.monitor : {};
    writeFileSync(options.writePolicy, JSON.stringify({ ...existing, monitor: {
      ...monitor, redundantSites: sourcePolicyOverrides(report),
      sourceMonitoring: { enabled: true, trials: config.monitor.sourceMonitoring.trials },
    } }, null, 2) + "\n");
  }
  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Sources: ${JSON.stringify(report.counts)}; reviewed ${report.since} to ${report.generatedAt}`);
  for (const row of report.rows.filter(row => row.status !== "paused")) {
    console.log(`${row.siteName}: ${row.status}; ${row.qualifiedDraws} qualifying draws; ${row.confirmedSends} confirmed sends`);
  }
  console.log(`Regular: qualifying result in 30 days. Trials: at most ${MAX_SOURCE_TRIALS}, stop after ${SOURCE_TRIAL_DRAWS} completed evaluated draws or ${SOURCE_TRIAL_MS / 86_400_000} days. All other sources are paused.`);
}
