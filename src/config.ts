import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, readFileSync } from "fs";
import type { RedundantSource, SourceTrial } from "./monitor/source-policy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const DEFAULT_CONFIG = {
  dbPath: process.env.RAFFLE_BOT_DB_PATH ?? join(__dirname, "..", "data", "competitions.db"),
  monitor: {
    defaultIntervalMs: 60 * 60 * 1000, // 60 minutes — keep background watch mode light on the PC
    fetchDelayMs: 500, // delay between page fetches
    scanConcurrency: 6, // site-level parallelism; keep conservative to avoid rate limits/browser churn
    scanRetries: 2,
    scanRetryBaseDelayMs: 750,
    scanTimeoutMs: 90 * 1000,
    browserScanConcurrency: 1, // RaffleX/browser scans collapse into false empty results under parallel load
    browserIntervalMultiplier: 2, // browser-backed sites are heavier, so keep them slower outside urgent windows
    siteIntervalMultipliers: {} as Record<string, number>,
    siteMinIntervalsMs: {} as Record<string, number>,
    redundantSites: {} as Record<string, RedundantSource>,
    sourceMonitoring: {
      enabled: false,
      trials: {} as Record<string, SourceTrial>,
    },
    heartbeatIntervalMs: 60_000,
    heartbeatStaleMs: 5 * 60_000,
  },
  storage: {
    snapshotRetentionMs: 30 * 24 * 60 * 60 * 1000,
    snapshotMaintenanceIntervalMs: 60 * 60 * 1000,
    snapshotPruneBatchSize: 25_000,
    snapshotPruneMaxBatches: 4,
  },
  alerts: {
    closingSoonMs: 60 * 60 * 1000, // 1 hour — only fast-track when the draw is genuinely close
    notificationWindowMs: 60 * 60 * 1000, // 1 hour — the only Telegram entry window
    minTrendDataPoints: 3, // need velocity history before interrupting
    buyMinWinProbability: 0.65, // 65% — 3-star projected-entry threshold
    buyMinReturnRatio: 1.5, // 150% — 3-star projected-entry threshold
    reviewerEnabled: process.env.RAFFLE_BOT_ALERT_REVIEWER !== "0",
    reviewerTimeoutMs: 60 * 1000,
    telegramTimeoutMs: 10 * 1000,
    reviewerCacheTtlMs: 6 * 60 * 60 * 1000,
    reviewerRejectCacheTtlMs: 5 * 60 * 1000,
    reviewerSchemaVersion: "6",
    decisionLogDir: process.env.RAFFLE_BOT_ALERT_REVIEW_DIR ?? join(__dirname, "..", "data", "alert-reviews"),
    raffleObservationLogDir: process.env.RAFFLE_BOT_RAFFLE_OBSERVATION_DIR ?? join(__dirname, "..", "data", "raffle-observations"),
    raffleObservationWindowMs: 48 * 60 * 60 * 1000,
    telegramFeedbackLogDir: process.env.RAFFLE_BOT_TELEGRAM_FEEDBACK_DIR ?? join(__dirname, "..", "data", "telegram-feedback"),
    telegramFeedbackPollTimeoutMs: 30 * 1000,
    telegramFeedbackRetryMs: 5 * 1000,
    siteHealthLogDir: process.env.RAFFLE_BOT_SITE_HEALTH_REVIEW_DIR ?? join(__dirname, "..", "data", "site-health-reviews"),
    siteHealthConsecutiveThreshold: 2,
    siteHealthReminderMs: 24 * 60 * 60 * 1000,
    siteHealthMaxMessageLength: 3800,
    maxTrendSnapshots: 120,
    maxTrendAgeMs: 24 * 60 * 60 * 1000,
    trendHeartbeatMs: 15 * 60 * 1000,
  },
  smartSchedule: {
    urgentIntervalMs: 2 * 60 * 1000, // 2 min — when risk-filtered comps close within 1h
    upcomingIntervalMs: 10 * 60 * 1000, // 10 min — when any known draw is inside the fast-track window
    fastTrackWindowMs: 60 * 60 * 1000, // 1 hour — do not increase polling before this
    slowIntervalMs: 2 * 60 * 60 * 1000, // 2 hours — when all known draws are far away
    slowThresholdMs: 10 * 60 * 60 * 1000, // 10 hours — outside the alert window, hourly checks are enough
    errorBackoffMultiplier: 2,
    maxErrorBackoffMultiplier: 8,
  },
  filters: {
    actionableWindowMs: 24 * 60 * 60 * 1000, // 24 hours — beyond this, current odds are too stale to rank as actionable
    maxStoredCompetitionAgeMs: 6 * 60 * 60 * 1000, // hide stored odds older than the normal 2-4h polling budget
    maxEntryInventoryAgeMs: 2 * 60 * 1000, // entry counts must be fresh at dispatch
    maxSpend: 100, // GBP — hard ceiling for a single recommended entry
    minWinProbability: 0.6, // 60% — minimum win probability now and at the draw
    minReturnRatio: 0.5, // 50% — minimum current return ratio for an entry alert
  },
  valueOpportunities: {
    enabled: true,
    maxSpend: 20,
    minWinProbability: 0.05,
    minReturnRatio: 0.5,
  },
  valuation: {
    llmEnabled: process.env.RAFFLE_BOT_LLM_VALUATION !== "0",
    llmTimeoutMs: 60 * 1000,
    llmMaxRafflesPerRequest: 8,
    llmCacheTtlMs: 30 * 24 * 60 * 60 * 1000,
    llmRetailHaircut: 0.8,
    llmMinValue: 25,
  },
};

export type Config = typeof DEFAULT_CONFIG;
type PartialDeep<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? PartialDeep<T[K]>
    : T[K];
};

export const CONFIG: Config = loadConfig();

function loadConfig(): Config {
  const configPath = process.env.RAFFLE_BOT_CONFIG ?? join(process.cwd(), "raffle-bot.config.json");
  return loadConfigFromPath(configPath);
}

export function loadConfigFromPath(configPath: string, base: Config = DEFAULT_CONFIG): Config {
  if (!existsSync(configPath)) return base;

  try {
    const localConfig = JSON.parse(readFileSync(configPath, "utf8")) as PartialDeep<Config>;
    return deepMerge(base, localConfig);
  } catch (err) {
    console.warn(`Could not load raffle-bot config at ${configPath}: ${err}`);
    return base;
  }
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: PartialDeep<T>): T {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const baseValue = merged[key];
    if (isPlainObject(baseValue) && isPlainObject(value)) {
      merged[key] = deepMerge(baseValue, value as PartialDeep<Record<string, unknown>>);
    } else {
      merged[key] = value;
    }
  }

  return merged as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
