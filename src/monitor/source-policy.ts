import { CONFIG } from "../config.js";
import { getDb } from "../storage/database.js";

export const SOURCE_HISTORY_MS = 30 * 86_400_000;
export const SOURCE_TRIAL_MS = 14 * 86_400_000;
export const MAX_SOURCE_TRIALS = 5;
export const SOURCE_TRIAL_DRAWS = 3;

export interface SourceTrial {
  startedAt: string;
  endsAt: string;
  evidenceUrl: string;
  reason: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Count distinct draws assessed near closing, never fetches or incomplete economics. */
export function createTrialProgressReader() {
  let signature = "";
  let lastId = 0;
  const draws = new Map<string, Map<string, number>>();
  return (trials: Record<string, SourceTrial>, now = Date.now()) => {
    const nextSignature = JSON.stringify(trials);
    if (signature !== nextSignature) {
      signature = nextSignature;
      lastId = 0;
      draws.clear();
    }
    const starts = Object.values(trials).map(t => Date.parse(t.startedAt)).filter(Number.isFinite);
    if (starts.length === 0) return new Map<string, number>();
    const since = new Date(Math.min(...starts)).toISOString();
    for (const row of getDb().prepare<[number, string], { id: number; record_json: string }>(
      "SELECT id, record_json FROM alert_decisions WHERE id > ? AND recorded_at >= ? ORDER BY id",
    ).iterate(lastId, since)) {
      lastId = row.id;
      try {
        const r: unknown = JSON.parse(row.record_json);
        if (!object(r) || r.phase !== "final" || r.stage !== "entry-window" ||
            typeof r.recordedAt !== "string" || !object(r.candidate) ||
            typeof r.candidate.siteName !== "string" || typeof r.candidate.sourceId !== "string" ||
            typeof r.candidate.drawDate !== "string" || !object(r.recommendation) ||
            r.recommendation.stars !== 0 || typeof r.recommendation.reason !== "string") continue;
        const trial = trials[r.candidate.siteName];
        if (!trial) continue;
        const at = Date.parse(r.recordedAt), close = Date.parse(r.candidate.drawDate);
        const start = Date.parse(trial.startedAt), end = Date.parse(trial.endsAt);
        if (![at, close, start, end].every(Number.isFinite) || at < start || at > now ||
            at >= end || close > end || close <= at || close - at > CONFIG.alerts.notificationWindowMs) continue;
        const reason = r.recommendation.reason.replace(/^at draw: /, "");
        if (!["no positive stake", "negative EV", "too unlikely", "not enough upside"].includes(reason)) continue;
        const siteDraws = draws.get(r.candidate.siteName) ?? new Map<string, number>();
        siteDraws.set(r.candidate.sourceId, close);
        draws.set(r.candidate.siteName, siteDraws);
      } catch { /* Missing or invalid evidence does not consume a trial draw. */ }
    }
    return new Map([...draws].map(([site, closes]) =>
      [site, [...closes.values()].filter(close => close <= now).length]));
  };
}

/** One historical read per watcher; subsequent reads only inspect new decisions. */
export function createQualificationReader() {
  let lastId = 0;
  const latest = new Map<string, number>();
  return (now = Date.now()) => {
    const since = new Date(now - SOURCE_HISTORY_MS).toISOString();
    const db = getDb();
    for (const row of db.prepare<[number, string], { id: number; record_json: string }>(
      "SELECT id, record_json FROM alert_decisions WHERE id > ? AND recorded_at >= ? ORDER BY id",
    ).iterate(lastId, since)) {
      lastId = row.id;
      try {
        const r: unknown = JSON.parse(row.record_json);
        if (!object(r) || r.phase !== "final" || r.stage !== "entry-window" ||
            !object(r.candidate) || typeof r.candidate.siteName !== "string" ||
            !object(r.recommendation) || typeof r.recommendation.stars !== "number" ||
            !Number.isInteger(r.recommendation.stars) || r.recommendation.stars < 1 ||
            r.recommendation.stars > 3 || typeof r.recordedAt !== "string") continue;
        const at = Date.parse(r.recordedAt);
        if (Number.isFinite(at) && at <= now && at > now - SOURCE_HISTORY_MS) {
          latest.set(r.candidate.siteName, Math.max(latest.get(r.candidate.siteName) ?? 0, at));
        }
      } catch { /* Malformed history cannot grant monitoring. */ }
    }
    for (const row of db.prepare<[string, string], { site_name: string; last_sent: string }>(
      "SELECT site_name, max(sent_at) last_sent FROM telegram_sent_messages WHERE sent_at > ? AND sent_at <= ? GROUP BY site_name",
    ).all(since, new Date(now).toISOString())) {
      const at = Date.parse(row.last_sent);
      if (Number.isFinite(at)) latest.set(row.site_name, Math.max(latest.get(row.site_name) ?? 0, at));
    }
    return new Map([...latest].filter(([, at]) => at > now - SOURCE_HISTORY_MS && at <= now));
  };
}

export function selectSourceModes(
  sites: readonly string[],
  qualifications: ReadonlyMap<string, number>,
  trials: Record<string, SourceTrial> = CONFIG.monitor.sourceMonitoring.trials,
  now = Date.now(),
  completedTrialDraws: ReadonlyMap<string, number> = new Map(),
): Map<string, "regular" | "trial" | "paused"> {
  const regular = new Set(sites.filter(site => {
    const at = qualifications.get(site);
    return at !== undefined && at <= now && at > now - SOURCE_HISTORY_MS;
  }));
  const trialSites = sites.filter(site => {
    if (regular.has(site)) return false;
    if ((completedTrialDraws.get(site) ?? 0) >= SOURCE_TRIAL_DRAWS) return false;
    const row = trials[site];
    if (!row || typeof row.reason !== "string" || !row.reason.trim() ||
        typeof row.evidenceUrl !== "string" || !/^https?:\/\//.test(row.evidenceUrl)) return false;
    const start = Date.parse(row.startedAt), end = Date.parse(row.endsAt);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end &&
      end > start && end - start <= SOURCE_TRIAL_MS;
  }).sort((a, b) => trials[a].startedAt.localeCompare(trials[b].startedAt) || a.localeCompare(b))
    .slice(0, MAX_SOURCE_TRIALS);
  const admitted = new Set(trialSites);
  return new Map(sites.map(site => [site, regular.has(site) ? "regular" : admitted.has(site) ? "trial" : "paused"]));
}

export function createSourceSelector(sites: readonly string[]) {
  const read = createQualificationReader();
  const readTrials = createTrialProgressReader();
  let qualifications = new Map<string, number>();
  let completedTrialDraws = new Map<string, number>();
  let nextReadAt = 0;
  return (now = Date.now()) => {
    if (!CONFIG.monitor.sourceMonitoring.enabled) {
      return new Map(sites.map(site => [site, isRedundantSource(site, now) ? "paused" : "regular"]));
    }
    if (now >= nextReadAt) {
      qualifications = read(now);
      completedTrialDraws = readTrials(CONFIG.monitor.sourceMonitoring.trials, now);
      nextReadAt = now + 60_000;
    }
    return selectSourceModes(sites, qualifications, CONFIG.monitor.sourceMonitoring.trials, now, completedTrialDraws);
  };
}

export interface RedundantSource {
  reviewedAt: string;
  reviewAfter: string;
  reason: string;
}

export function isRedundantSource(site: string, now = Date.now(), sources = CONFIG.monitor.redundantSites): boolean {
  const row = sources[site];
  if (!row || typeof row.reason !== "string" || !row.reason.trim()) return false;
  const reviewedAt = Date.parse(row.reviewedAt);
  const reviewAfter = Date.parse(row.reviewAfter);
  return Number.isFinite(reviewedAt) && Number.isFinite(reviewAfter) &&
    reviewedAt <= now && reviewAfter > reviewedAt;
}
