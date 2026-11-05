import { randomUUID } from "node:crypto";
import chalk from "chalk";
import type { SiteAdapter } from "../adapters/adapter.js";
import { closeBrowser } from "../adapters/browser/browser-pool.js";
import { enrichCompetitionAt } from "../metrics/calculator.js";
import {
  upsertCompetition,
  insertSnapshot,
  getCompetitions,
  observeSiteHealthForAlerts,
  pruneOldSnapshots,
  pruneSiteHealthForRegisteredSites,
  upsertSiteScanHealth,
} from "../storage/database.js";
import { checkAlerts } from "../alerts/alerts.js";
import { formatSiteHealthDigest, recordSiteHealthEvents } from "../alerts/site-health.js";
import { CONFIG } from "../config.js";
import { processEntryCandidates, preReviewPrizeValues } from "../alerts/buy-review.js";
import { startMonitorHeartbeat, recordMonitorScan } from "./heartbeat.js";
import {
  appendRaffleObservationBatch,
  buildRaffleObservationBatch,
} from "../alerts/raffle-observation.js";
import { startTelegramFeedbackPolling } from "../alerts/telegram-feedback.js";
import { processDueTelegramReminders } from "../alerts/telegram-reminder.js";
import { analyzeTrend, type TrendAnalysis } from "../metrics/trends.js";
import { compareRaffleScore, isActionableRaffle } from "../metrics/decision.js";
import { createSourceSelector, SOURCE_TRIAL_MS, SOURCE_TRIAL_DRAWS } from "./source-policy.js";
import {
  formatAlerts,
  formatEntryTable,
} from "../cli/formatters.js";
import { isFreshEntryInventory, isFreshStoredCompetition } from "../cli/freshness.js";
import { mapWithConcurrency, normalizeConcurrency } from "../utils/concurrency.js";
import type {
  Competition,
  Alert,
  RawCompetition,
  SiteHealthNotificationEvent,
  SiteScanHealth,
} from "../types.js";
import { scanAdapterWithRetry } from "../scan/scan-adapter.js";

export interface MonitorOptions {
  intervalMs: number;
  showTable?: boolean;
  concurrency?: number;
  maxCycles?: number;
  tickMs?: number;
  /** Full registry, which may be wider than the adapters selected for this run. */
  registeredSiteNames?: readonly string[];
}

interface AdapterCycleResult {
  schedule: AdapterSchedule;
  raw: RawCompetition[];
  health: SiteScanHealth;
  error?: unknown;
}

type TrendLookup = (competition: Competition) => TrendAnalysis;
type OptionalTrendLookup = (competition: Competition) => TrendAnalysis | null;

interface ScheduleDecision {
  intervalMs: number;
  closingSoonCount: number;
  latestSafeIntervalMs: number | null;
}

interface ScanLaneAllocation {
  normal: number;
  heavy: number;
  browser: number;
}

type ScanLane = keyof ScanLaneAllocation;

interface ScanTranche {
  lanes: Record<ScanLane, AdapterSchedule[]>;
  nextLaneIndex: number;
}

const SCAN_LANES: readonly ScanLane[] = ["browser", "normal", "heavy"];

/** Adapter with dynamic scan priority */
interface AdapterSchedule {
  adapter: SiteAdapter;
  /** ms until next scan */
  nextScanAt: number;
  /** Current interval (adapts based on closing-soon comps) */
  currentIntervalMs: number;
  /** Whether this site has closing-soon opportunities */
  hasClosingSoon: boolean;
  /** Consecutive failed scan count for backoff */
  consecutiveFailures: number;
  /** One immediate refresh; repeated stale scans retain the normal polling interval. */
  retriedStaleInventory: boolean;
}

export async function startMonitor(
  adapters: SiteAdapter[],
  options: MonitorOptions,
): Promise<void> {
  const registeredSiteNames = options.registeredSiteNames ?? adapters.map(adapter => adapter.siteName);
  const candidates = adapters;
  const selectSources = createSourceSelector(registeredSiteNames);
  const initialModes = selectSources();
  adapters = adapters.filter(adapter => initialModes.get(adapter.siteName) !== "paused");
  if (adapters.length === 0 && (!CONFIG.monitor.sourceMonitoring.enabled || options.maxCycles !== undefined)) {
    console.log("No active sources. Redundant sources remain paused pending review.");
    return;
  }
  const { intervalMs } = options;
  const concurrency = normalizeConcurrency(options.concurrency, CONFIG.monitor.scanConcurrency);
  let stopping = false;
  const stopHeartbeat = startMonitorHeartbeat();
  let stopTelegramFeedback = async (): Promise<void> => undefined;
  const stopMonitor = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    stopHeartbeat();
    console.log(chalk.dim("\nStopping monitor..."));
    await stopTelegramFeedback();
    await closeBrowser();
    process.exit(0);
  };
  process.on("SIGINT", stopMonitor);
  process.on("SIGTERM", stopMonitor);

  try {
    const cleanup = pruneSiteHealthForRegisteredSites(
      registeredSiteNames,
    );
    const removed = cleanup.siteScanHealthRemoved + cleanup.incidentStatesRemoved;
    if (removed > 0) {
      console.log(chalk.dim(
        `  Site health startup cleanup removed ${cleanup.siteScanHealthRemoved} stale latest rows and ${cleanup.incidentStatesRemoved} stale incident rows`,
      ));
    }
  } catch (error) {
    console.error(chalk.red(`  Site health startup cleanup failed: ${error}`));
  }

  const hasTelegram = !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const telegramFeedback = startTelegramFeedbackPolling();
  stopTelegramFeedback = telegramFeedback.stop;

  const telegramStatus = hasTelegram
    ? chalk.green(
        telegramFeedback.enabled
          ? " + Telegram + feedback"
          : " + Telegram",
      )
    : "";
  console.log(
    `\n  ${chalk.bold("Raffle Bot")} ${chalk.dim("— watch mode")}`,
  );
  console.log(
    `  ${chalk.bold(String(adapters.length))} sites | ${(intervalMs / 1000 / 60).toFixed(0)}m base interval | ${concurrency} parallel | smart scheduling${telegramStatus}`,
  );
  console.log(`  Value entries: ${CONFIG.valueOpportunities.enabled ? "LIVE" : "disabled"}; max £${CONFIG.valueOpportunities.maxSpend}; min win ${CONFIG.valueOpportunities.minWinProbability * 100}%; min net return ${CONFIG.valueOpportunities.minReturnRatio * 100}%`);
  if (CONFIG.monitor.sourceMonitoring.enabled) {
    console.log(`  Source policy: ${[...initialModes.values()].filter(mode => mode === "regular").length} regular; ${[...initialModes.values()].filter(mode => mode === "trial").length} trials; rolling 30-day results; trials stop after ${SOURCE_TRIAL_DRAWS} evaluated draws or ${SOURCE_TRIAL_MS / 86_400_000} days`);
  }
  console.log(chalk.dim("  Ctrl+C to stop\n"));

  // Initialize schedules
  const schedules: AdapterSchedule[] = prioritizeAdaptersForColdStart(
    candidates,
    getCompetitions(),
  ).map((adapter) => ({
    adapter,
    nextScanAt: 0, // Scan all immediately on first run
    currentIntervalMs: intervalMs,
    hasClosingSoon: false,
    consecutiveFailures: 0,
    retriedStaleInventory: false,
  }));

  const tickMs = options.tickMs ?? 30 * 1000; // Check every 30 seconds which adapters need scanning
  let cyclesCompleted = 0;
  let nextSnapshotMaintenanceAt = 0;
  let nextScanLaneIndex = 0;

  try {
    for (;;) {
      const now = Date.now();
      if (now >= nextSnapshotMaintenanceAt) {
        try {
          const result = pruneOldSnapshots({
            retentionMs: CONFIG.storage.snapshotRetentionMs,
            batchSize: CONFIG.storage.snapshotPruneBatchSize,
            maxBatches: CONFIG.storage.snapshotPruneMaxBatches,
            now: new Date(now),
          });
          if (result.deleted > 0) {
            const more = result.hasMore ? "; more queued for the next maintenance pass" : "";
            console.log(chalk.dim(`  Snapshot maintenance removed ${result.deleted} expired rows${more}`));
          }
        } catch (error) {
          console.error(chalk.red(`  Snapshot maintenance failed: ${error}`));
        }
        nextSnapshotMaintenanceAt = now + Math.max(
          60 * 1000,
          CONFIG.storage.snapshotMaintenanceIntervalMs,
        );
      }
      const modes = selectSources(now);
      const activeSchedules = schedules.filter(s => modes.get(s.adapter.siteName) !== "paused");
      const dueAdapters = activeSchedules.filter((s) => now >= s.nextScanAt);

      if (dueAdapters.length > 0) {
        nextScanLaneIndex = await runSmartCycle(
          dueAdapters,
          activeSchedules,
          { ...options, concurrency },
          intervalMs,
          nextScanLaneIndex,
        );
        cyclesCompleted++;
        if (options.maxCycles !== undefined && cyclesCompleted >= options.maxCycles) {
          return;
        }
      }

      // A bounded tranche may intentionally leave cold-start work due. Re-enter
      // the scheduler immediately so a newly due urgent rescan can pre-empt that
      // backlog without adding the normal watch tick delay.
      if (activeSchedules.some((schedule) => Date.now() >= schedule.nextScanAt)) {
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, tickMs));
    }
  } finally {
    stopHeartbeat();
    process.off("SIGINT", stopMonitor);
    process.off("SIGTERM", stopMonitor);
    await stopTelegramFeedback();
  }
}

export function prioritizeAdaptersForColdStart(
  adapters: SiteAdapter[],
  storedCompetitions: Array<Pick<RawCompetition, "siteName" | "drawDate">>,
  now = Date.now(),
): SiteAdapter[] {
  const earliestFutureDrawBySite = new Map<string, number>();
  for (const competition of storedCompetitions) {
    if (!competition.drawDate) continue;
    const drawTime = new Date(competition.drawDate).getTime();
    if (!Number.isFinite(drawTime) || drawTime <= now) continue;
    const current = earliestFutureDrawBySite.get(competition.siteName);
    if (current === undefined || drawTime < current) {
      earliestFutureDrawBySite.set(competition.siteName, drawTime);
    }
  }

  return adapters
    .map((adapter, index) => ({ adapter, index }))
    .sort((left, right) => {
      const leftDraw = earliestFutureDrawBySite.get(left.adapter.siteName);
      const rightDraw = earliestFutureDrawBySite.get(right.adapter.siteName);
      if (leftDraw !== undefined && rightDraw !== undefined) return leftDraw - rightDraw;
      if (leftDraw !== undefined) return -1;
      if (rightDraw !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ adapter }) => adapter);
}

async function runSmartCycle(
  dueAdapters: AdapterSchedule[],
  allSchedules: AdapterSchedule[],
  options: MonitorOptions,
  baseIntervalMs: number,
  nextLaneIndex: number,
): Promise<number> {
  const timestamp = new Date().toLocaleTimeString("en-GB");
  const line = "─".repeat(30);
  const concurrency = normalizeConcurrency(options.concurrency, CONFIG.monitor.scanConcurrency);
  const tranche = selectDueScanTranche(
    dueAdapters,
    concurrency,
    CONFIG.monitor.browserScanConcurrency,
    nextLaneIndex,
  );
  const selectedCount = SCAN_LANES.reduce(
    (count, lane) => count + tranche.lanes[lane].length,
    0,
  );
  const dueSuffix = selectedCount < dueAdapters.length
    ? ` of ${dueAdapters.length} due`
    : "";
  console.log(`\n${chalk.dim(`── ${timestamp} ──`)} Scanning ${chalk.bold(String(selectedCount))}${dueSuffix} sites (${concurrency} parallel) ${chalk.dim(line)}`);

  const allComps: Competition[] = [];
  const allAlerts: Alert[] = [];
  const siteHealthEvents: SiteHealthNotificationEvent[] = [];
  const trendCache = new Map<string, TrendAnalysis>();
  const trendFor: TrendLookup = (competition) => {
    const key = competitionIdentity(competition);
    const cached = trendCache.get(key);
    if (cached) return cached;
    const trend = analyzeTrend(competition);
    trendCache.set(key, trend);
    return trend;
  };

  await Promise.all(
    SCAN_LANES
      .filter((lane) => tranche.lanes[lane].length > 0)
      .map((lane) =>
        scanLane(tranche.lanes[lane], tranche.lanes[lane].length)
      ),
  );

  if (siteHealthEvents.length > 0) {
    console.warn(chalk.yellow(`\n${formatSiteHealthDigest(siteHealthEvents)}`));
    const outcome = recordSiteHealthEvents(siteHealthEvents);
    if (outcome === "failed") {
      console.error(chalk.red(
        `  Failed to record ${siteHealthEvents.length} site health event${siteHealthEvents.length === 1 ? "" : "s"}; pending for retry`,
      ));
    } else {
      console.log(chalk.dim(
        `  Recorded ${siteHealthEvents.length} site health event${siteHealthEvents.length === 1 ? "" : "s"} for next-day review`,
      ));
    }
  }

  if (allAlerts.length === 0) {
    console.log(chalk.dim("\n  No alerts this cycle"));
  }

  // Show top risk-filtered raffles with trend data
  if (options.showTable) {
    const rankedAt = Date.now();
    const top = allComps
      .filter((c) =>
        isFreshEntryInventory(c, rankedAt) &&
        c.timeToClose !== null &&
        c.timeToClose > 0 &&
        c.timeToClose < CONFIG.filters.actionableWindowMs,
      )
      .map((comp) => ({ comp, trend: trendFor(comp) }))
      .filter(({ comp, trend }) => isActionableRaffle(comp, trend))
      .sort((left, right) => compareRaffleScore(
        left.comp,
        right.comp,
        left.trend,
        right.trend,
      ))
      .slice(0, 15);

    console.log(formatEntryTable(top));

    // Show smart scheduling status
    const urgentSites = allSchedules.filter((s) => s.hasClosingSoon);
    if (urgentSites.length > 0) {
      console.log(
        chalk.yellow(
          `  Fast-tracking: ${urgentSites.map((s) => s.adapter.siteName).join(", ")}`,
        ),
      );
    }
  }

  async function scanLane(
    schedules: AdapterSchedule[],
    laneConcurrency: number,
  ): Promise<void> {
    await mapWithConcurrency(
      schedules,
      laneConcurrency,
      async (schedule) => {
        const result = await scanAdapterWithRetry(schedule.adapter);
        await processBatch([{
          schedule,
          raw: result.raw,
          health: result.health,
          error: result.error,
        }]);
      },
    );
  }

  async function processBatch(results: AdapterCycleResult[]): Promise<void> {
    const evaluationId = randomUUID();
    const freshBatchComps: Competition[] = [];
    const batchAlerts: Alert[] = [];

    for (const result of results) {
      const { schedule, raw } = result;
      const observedAt = new Date();
      const previousCompetitions = getCompetitions(schedule.adapter.siteName);
      upsertSiteScanHealth(result.health);
      recordMonitorScan(observedAt);
      const siteHealthEvent = observeSiteHealthForAlerts(result.health);
      if (siteHealthEvent) siteHealthEvents.push(siteHealthEvent);

      if (result.error) {
        const stored = previousCompetitions
          .filter((competition) =>
            isFreshStoredCompetition(competition, observedAt.getTime())
          )
          .map((competition) => enrichCompetitionAt(competition, observedAt));
        recordRaffleObservation(
          evaluationId,
          schedule.adapter.siteName,
          result.health.status,
          observedAt,
          stored,
          previousCompetitions,
          false,
        );
        schedule.consecutiveFailures++;
        const backoffMs = calculateErrorBackoff(baseIntervalMs, schedule.consecutiveFailures);
        allComps.push(...stored);
        const decision = determineNextScan(
          stored,
          backoffMs,
          observedAt.getTime(),
          trendFor,
        );
        schedule.hasClosingSoon = decision.closingSoonCount > 0;
        schedule.currentIntervalMs = capAtEntryDeadline(
          decision.intervalMs,
          decision.latestSafeIntervalMs,
        );
        console.error(
          chalk.red(
            `  Error scanning ${schedule.adapter.siteName}: ${result.error} ` +
            chalk.dim(`(retry in ${(schedule.currentIntervalMs / 1000 / 60).toFixed(0)}m)`),
          ),
        );
        schedule.nextScanAt = Date.now() + schedule.currentIntervalMs;
        continue;
      }
      schedule.consecutiveFailures = 0;

      const enrichedComps: Competition[] = [];
      for (const comp of raw) {
        upsertCompetition(comp);
        insertSnapshot(comp);
        const enriched = enrichCompetitionAt(comp, observedAt);
        trendCache.delete(competitionIdentity(enriched));
        const trend = trendFor(enriched);
        allComps.push(enriched);
        freshBatchComps.push(enriched);
        enrichedComps.push(enriched);
        const alerts = checkAlerts(enriched, trend, observedAt);
        allAlerts.push(...alerts);
        batchAlerts.push(...alerts);
      }
      recordRaffleObservation(
        evaluationId,
        schedule.adapter.siteName,
        result.health.status,
        observedAt,
        enrichedComps,
        previousCompetitions,
      );

      // Smart scheduling: adapt interval based on urgency
      const decision = determineNextScan(enrichedComps, baseIntervalMs, observedAt.getTime(), trendFor);
      schedule.hasClosingSoon = decision.closingSoonCount > 0;
      schedule.currentIntervalMs = applySiteScanBudget(
        schedule.adapter,
        decision.intervalMs,
        isTimeSensitiveInterval(decision.intervalMs),
      );
      schedule.currentIntervalMs = capAtEntryDeadline(
        schedule.currentIntervalMs,
        decision.latestSafeIntervalMs,
      );
      schedule.nextScanAt = Date.now() + schedule.currentIntervalMs;

      const intervalLabel = (schedule.currentIntervalMs / 1000 / 60).toFixed(0);
      const urgencyTag = schedule.hasClosingSoon
        ? chalk.red(` URGENT: ${decision.closingSoonCount} closing soon`)
        : "";
      console.log(
        chalk.dim(`  ${schedule.adapter.siteName} ${chalk.reset(String(raw.length))}${chalk.dim(` comps (next ${intervalLabel}m)`)}${urgencyTag}`),
      );
    }

    if (batchAlerts.length > 0) {
      console.log(formatAlerts(batchAlerts));
    }
    const decisions = await processEntryCandidates(freshBatchComps, {
      evaluationId,
      analyzeTrend: trendFor,
    });
    const valueDecisions = decisions.filter(record => record.recommendation?.category === "value");
    if (valueDecisions.length > 0) console.log(`  Value entries: ${valueDecisions.length} candidates; ${valueDecisions.filter(record => record.outcome === "sent").length} sent`);
    for (const { schedule } of results) {
      const stale = decisions.some((record) => record.outcome === "suppressed_stale_inventory" &&
        (record.recommendation?.stars ?? 0) > 0 &&
        record.candidate?.siteName === schedule.adapter.siteName);
      if (stale && !schedule.retriedStaleInventory) {
        schedule.nextScanAt = Math.min(schedule.nextScanAt, Date.now());
        console.log(chalk.dim(`  ${schedule.adapter.siteName}: entry inventory expired; one fresh scan requested`));
      }
      schedule.retriedStaleInventory = stale;
    }
    try {
      const reminders = await processDueTelegramReminders(freshBatchComps);
      if (reminders.sent > 0) {
        console.log(
          `  Sent ${reminders.sent} Telegram raffle reminder${reminders.sent === 1 ? "" : "s"}`,
        );
      }
    } catch (error) {
      console.warn(`Could not process Telegram raffle reminders: ${error}`);
    }
    try { await preReviewPrizeValues(freshBatchComps, trendFor); }
    catch (error) { console.warn(`Could not pre-review prize values: ${error}`); }
  }

  function recordRaffleObservation(
    evaluationId: string,
    siteName: string,
    scanStatus: SiteScanHealth["status"],
    observedAt: Date,
    current: Competition[],
    previous: RawCompetition[],
    decisionCoverageExpected?: boolean,
  ): void {
    try {
      const batch = buildRaffleObservationBatch({
        evaluationId,
        siteName,
        scanStatus,
        observedAt,
        current,
        previous,
        decisionCoverageExpected,
      });
      appendRaffleObservationBatch(
        batch,
        CONFIG.alerts.raffleObservationLogDir,
      );
    } catch (error) {
      console.warn(
        `Could not append raffle observation JSONL for ${siteName}: ${error}`,
      );
    }
  }

  return tranche.nextLaneIndex;
}

function selectDueScanTranche(
  dueAdapters: AdapterSchedule[],
  totalConcurrency: number,
  browserConcurrency: number,
  nextLaneIndex: number,
): ScanTranche {
  const total = normalizeConcurrency(totalConcurrency, 1);
  const browserLimit = normalizeConcurrency(browserConcurrency, 1);
  const pending: Record<ScanLane, AdapterSchedule[]> = {
    normal: dueAdapters.filter((schedule) =>
      schedule.adapter.scanCost !== "browser" && schedule.adapter.scanCost !== "heavy"
    ),
    heavy: dueAdapters.filter((schedule) => schedule.adapter.scanCost === "heavy"),
    browser: dueAdapters.filter((schedule) => schedule.adapter.scanCost === "browser"),
  };
  const selected: Record<ScanLane, AdapterSchedule[]> = {
    normal: [],
    heavy: [],
    browser: [],
  };

  for (const lane of SCAN_LANES) {
    pending[lane].sort(compareDueSchedulePriority);
  }

  let laneIndex = ((Math.floor(nextLaneIndex) % SCAN_LANES.length) + SCAN_LANES.length) %
    SCAN_LANES.length;
  let selectedBrowser = 0;

  for (let selectedCount = 0; selectedCount < total; selectedCount += 1) {
    const hasTimeSensitiveDue = SCAN_LANES.some((lane) => {
      if (lane === "browser" && selectedBrowser >= browserLimit) return false;
      const schedule = pending[lane][0];
      return schedule !== undefined && isTimeSensitiveRescan(schedule);
    });
    let selectedLaneIndex: number | null = null;

    for (let offset = 0; offset < SCAN_LANES.length; offset += 1) {
      const candidateIndex = (laneIndex + offset) % SCAN_LANES.length;
      const lane = SCAN_LANES[candidateIndex];
      if (lane === "browser" && selectedBrowser >= browserLimit) continue;
      const schedule = pending[lane][0];
      if (!schedule) continue;
      if (hasTimeSensitiveDue && !isTimeSensitiveRescan(schedule)) continue;
      selectedLaneIndex = candidateIndex;
      break;
    }

    if (selectedLaneIndex === null) break;
    const lane = SCAN_LANES[selectedLaneIndex];
    const schedule = pending[lane].shift();
    if (!schedule) break;
    selected[lane].push(schedule);
    if (lane === "browser") selectedBrowser += 1;
    laneIndex = (selectedLaneIndex + 1) % SCAN_LANES.length;
  }

  return { lanes: selected, nextLaneIndex: laneIndex };
}

function compareDueSchedulePriority(
  left: AdapterSchedule,
  right: AdapterSchedule,
): number {
  const leftTimeSensitive = isTimeSensitiveRescan(left);
  const rightTimeSensitive = isTimeSensitiveRescan(right);
  if (leftTimeSensitive !== rightTimeSensitive) return leftTimeSensitive ? -1 : 1;
  if (leftTimeSensitive && left.nextScanAt !== right.nextScanAt) {
    return left.nextScanAt - right.nextScanAt;
  }
  return 0;
}

function isTimeSensitiveRescan(schedule: AdapterSchedule): boolean {
  return schedule.nextScanAt > 0 &&
    (
      schedule.hasClosingSoon ||
      isTimeSensitiveInterval(schedule.currentIntervalMs)
    );
}

export function applySiteScanBudget(
  adapter: Pick<SiteAdapter, "siteName" | "scanCost">,
  intervalMs: number,
  isTimeSensitive: boolean,
): number {
  if (isTimeSensitive) return intervalMs;

  const siteMultiplier = CONFIG.monitor.siteIntervalMultipliers[adapter.siteName];
  const costMultiplier = adapter.scanCost === "browser"
    ? CONFIG.monitor.browserIntervalMultiplier
    : adapter.scanCost === "heavy"
      ? Math.max(CONFIG.monitor.browserIntervalMultiplier, 2)
      : 1;
  const multiplier = Math.max(1, siteMultiplier ?? costMultiplier);
  const minInterval = CONFIG.monitor.siteMinIntervalsMs[adapter.siteName] ?? 0;

  return Math.max(Math.round(intervalMs * multiplier), minInterval);
}

export function selectMonitoredAdapters(adapters: SiteAdapter[]): SiteAdapter[] {
  const modes = createSourceSelector(adapters.map(adapter => adapter.siteName))();
  return adapters.filter(adapter => modes.get(adapter.siteName) !== "paused");
}

export function calculateErrorBackoff(
  baseIntervalMs: number,
  consecutiveFailures: number,
): number {
  const cappedMultiplier = Math.min(
    CONFIG.smartSchedule.maxErrorBackoffMultiplier,
    Math.pow(CONFIG.smartSchedule.errorBackoffMultiplier, consecutiveFailures),
  );

  return Math.round(baseIntervalMs * cappedMultiplier);
}

export function capAtEntryDeadline(
  intervalMs: number,
  latestSafeIntervalMs: number | null,
): number {
  return latestSafeIntervalMs === null
    ? intervalMs
    : Math.min(intervalMs, latestSafeIntervalMs);
}

function isTimeSensitiveInterval(intervalMs: number): boolean {
  return intervalMs <= CONFIG.smartSchedule.upcomingIntervalMs;
}

export function determineNextScan(
  comps: Competition[],
  baseIntervalMs: number,
  now = Date.now(),
  trendFor: OptionalTrendLookup = () => null,
): ScheduleDecision {
  let closingSoonCount = 0;
  let hasUpcoming = false;
  let hasUnknownDrawDate = false;
  let soonestKnownDrawMs: number | null = null;

  for (const comp of comps) {
    if (comp.timeToClose !== null) {
      const ms = comp.timeToClose;
      if (ms > 0) {
        soonestKnownDrawMs = soonestKnownDrawMs === null
          ? ms
          : Math.min(soonestKnownDrawMs, ms);
      }

      if (
        ms > 0 &&
        ms < CONFIG.alerts.closingSoonMs &&
        isActionableRaffle(comp, trendFor(comp))
      ) {
        closingSoonCount++;
      }
    } else if (!comp.drawDate) {
      hasUnknownDrawDate = true;
    } else {
      const parsedMs = new Date(comp.drawDate).getTime() - now;
      if (Number.isFinite(parsedMs) && parsedMs > 0) {
        soonestKnownDrawMs = soonestKnownDrawMs === null
          ? parsedMs
          : Math.min(soonestKnownDrawMs, parsedMs);
      } else if (!Number.isFinite(parsedMs)) {
        hasUnknownDrawDate = true;
      }
    }
  }

  const latestSafeIntervalMs =
    soonestKnownDrawMs !== null &&
      soonestKnownDrawMs > CONFIG.alerts.notificationWindowMs
      ? soonestKnownDrawMs - CONFIG.alerts.notificationWindowMs
      : null;

  if (closingSoonCount > 0) {
    return {
      intervalMs: CONFIG.smartSchedule.urgentIntervalMs,
      closingSoonCount,
      latestSafeIntervalMs,
    };
  }

  if (
    soonestKnownDrawMs !== null &&
    soonestKnownDrawMs < CONFIG.smartSchedule.fastTrackWindowMs
  ) {
    hasUpcoming = true;
  }

  if (hasUpcoming) {
    return {
      intervalMs: CONFIG.smartSchedule.upcomingIntervalMs,
      closingSoonCount,
      latestSafeIntervalMs,
    };
  }

  if (
    latestSafeIntervalMs !== null &&
    latestSafeIntervalMs < baseIntervalMs
  ) {
    return {
      intervalMs: latestSafeIntervalMs,
      closingSoonCount,
      latestSafeIntervalMs,
    };
  }

  if (
    !hasUnknownDrawDate &&
    (soonestKnownDrawMs === null || soonestKnownDrawMs >= CONFIG.smartSchedule.slowThresholdMs)
  ) {
    return {
      intervalMs: Math.max(baseIntervalMs, CONFIG.smartSchedule.slowIntervalMs),
      closingSoonCount,
      latestSafeIntervalMs,
    };
  }

  return {
    intervalMs: baseIntervalMs,
    closingSoonCount,
    latestSafeIntervalMs,
  };
}

function competitionIdentity(
  competition: Pick<Competition, "sourceId" | "siteName" | "drawDate" | "maxTickets">,
): string {
  return [
    competition.siteName,
    competition.sourceId,
    competition.drawDate ?? "",
    competition.maxTickets,
  ].join("\u0000");
}
