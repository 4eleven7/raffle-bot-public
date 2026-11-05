import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  RawCompetition,
  SiteHealthIncidentCondition,
  SiteHealthNotificationEvent,
  SiteScanHealth,
  SiteScanStatus,
  Snapshot,
} from "../types.js";
import { CONFIG } from "../config.js";
import { excludedRaffleReason } from "../metrics/decision.js";

let db: Database.Database | null = null;

export interface CachedPrizeValuation {
  cacheKey: string;
  siteName: string;
  sourceId: string;
  prizeName: string;
  url: string;
  estimatedPrizeValue: number | null;
  valuationConfidence: NonNullable<RawCompetition["valuationConfidence"]> | null;
  valuationNotes: string | null;
  status: "valued" | "no_estimate" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface StoredAlertDecision {
  id?: number;
  inputHash?: string;
  decision?: string;
  outcome: string;
  recordedAt: string;
  [key: string]: unknown;
}

export interface TelegramSentMessage {
  chatId: string;
  messageId: number;
  alertKey: string;
  canonicalUrl: string;
  siteName: string;
  sourceId: string;
  raffleName: string;
  sentAt: string;
}

export type TelegramReminderOutcome = "sent" | "not_worth" | "expired";

export interface TelegramReminder {
  chatId: string;
  messageId: number;
  alertKey: string;
  canonicalUrl: string;
  siteName: string;
  sourceId: string;
  raffleName: string;
  requestedAt: string;
  completedAt: string | null;
  outcome: TelegramReminderOutcome | null;
}

export type TelegramFeedbackClassification =
  | "entered"
  | "won"
  | "lost"
  | "other"
  | "removed";
export type TelegramFeedbackSource = "inline_button" | "message_reaction" | "text_reply";

export interface TelegramFeedbackEvent extends TelegramSentMessage {
  updateId: number;
  classification: TelegramFeedbackClassification;
  feedbackValue: string;
  source: TelegramFeedbackSource;
  actorId: string | null;
  occurredAt: string;
  receivedAt: string;
  rawJson: string;
}

export interface SnapshotPruneOptions {
  retentionMs: number;
  batchSize: number;
  maxBatches: number;
  now?: Date;
}

export interface SnapshotPruneResult {
  cutoff: string;
  deleted: number;
  hasMore: boolean;
}

export interface SiteHealthIncidentState {
  siteName: string;
  latestStatus: SiteScanStatus;
  consecutiveUnhealthy: number;
  incidentCondition: SiteHealthIncidentCondition | null;
  incidentStartedAt: string | null;
  incidentAlertedAt: string | null;
  lastRemindedAt: string | null;
  recoveredAt: string | null;
  recoveryAlertedAt: string | null;
  lastObservedAt: string;
  errorMessage: string | null;
}

export interface SiteHealthCleanupResult {
  siteScanHealthRemoved: number;
  incidentStatesRemoved: number;
}

export function getDb(): Database.Database {
  if (!db) {
    mkdirSync(dirname(CONFIG.dbPath), { recursive: true });
    db = new Database(CONFIG.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS competitions (
      source_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      url TEXT,
      name TEXT,
      entry_price REAL,
      tickets_sold INTEGER,
      max_tickets INTEGER,
      draw_uses_full_ticket_range INTEGER NOT NULL DEFAULT 0,
      inventory_source TEXT,
      max_entries_per_user INTEGER DEFAULT 100,
      max_entries_per_user_source TEXT,
      cash_alternative REAL,
      estimated_prize_value REAL,
      valuation_source TEXT,
      valuation_confidence TEXT,
      valuation_notes TEXT,
      draw_date TEXT,
      is_auto_draw INTEGER DEFAULT 0,
      categories TEXT,
      scraped_at TEXT,
      PRIMARY KEY (source_id, site_name)
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      tickets_sold INTEGER NOT NULL,
      max_tickets INTEGER,
      draw_date TEXT,
      inventory_source TEXT,
      scraped_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_sends (
      alert_key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input_hash TEXT,
      decision TEXT,
      outcome TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_sent_messages (
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      alert_key TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      site_name TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raffle_name TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, message_id)
    );

    CREATE TABLE IF NOT EXISTS telegram_feedback_events (
      update_id INTEGER PRIMARY KEY,
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      alert_key TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      site_name TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raffle_name TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      classification TEXT NOT NULL,
      feedback_value TEXT NOT NULL,
      source TEXT NOT NULL,
      actor_id TEXT,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_reminders (
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      alert_key TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      site_name TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raffle_name TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      completed_at TEXT,
      outcome TEXT,
      PRIMARY KEY (chat_id, alert_key)
    );

    CREATE TABLE IF NOT EXISTS telegram_update_state (
      consumer TEXT PRIMARY KEY,
      next_offset INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_scan_health (
      site_name TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      competitions_found INTEGER NOT NULL DEFAULT 0,
      cash_competitions_found INTEGER NOT NULL DEFAULT 0,
      partial_competitions_found INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      scanned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_health_incident_state (
      site_name TEXT PRIMARY KEY,
      latest_status TEXT NOT NULL,
      consecutive_unhealthy INTEGER NOT NULL DEFAULT 0,
      incident_condition TEXT,
      incident_started_at TEXT,
      incident_alerted_at TEXT,
      last_reminded_at TEXT,
      recovered_at TEXT,
      recovery_alerted_at TEXT,
      last_observed_at TEXT NOT NULL,
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS prize_valuation_cache (
      cache_key TEXT PRIMARY KEY,
      site_name TEXT NOT NULL,
      source_id TEXT NOT NULL,
      prize_name TEXT NOT NULL,
      url TEXT NOT NULL,
      estimated_prize_value REAL,
      valuation_confidence TEXT,
      valuation_notes TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monitor_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      started_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      last_scan_at TEXT,
      stopped_at TEXT,
      pid INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitor_gaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      resumed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS raffle_entries (
      entry_key TEXT PRIMARY KEY,
      canonical_url TEXT NOT NULL,
      site_name TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raffle_name TEXT NOT NULL,
      spent REAL CHECK (spent >= 0),
      received REAL CHECK (received >= 0),
      outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'won', 'lost')),
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_comp
      ON snapshots(source_id, site_name);
    CREATE INDEX IF NOT EXISTS idx_snapshots_time
      ON snapshots(scraped_at);
    CREATE INDEX IF NOT EXISTS idx_alert_sends_sent_at
      ON alert_sends(sent_at);
    CREATE INDEX IF NOT EXISTS idx_alert_decisions_input_hash
      ON alert_decisions(input_hash, recorded_at);
    CREATE INDEX IF NOT EXISTS idx_alert_decisions_recorded_at
      ON alert_decisions(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_telegram_sent_messages_alert_key
      ON telegram_sent_messages(alert_key);
    CREATE INDEX IF NOT EXISTS idx_telegram_feedback_message
      ON telegram_feedback_events(chat_id, message_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_telegram_feedback_recorded
      ON telegram_feedback_events(received_at);
    CREATE INDEX IF NOT EXISTS idx_prize_valuation_cache_updated
      ON prize_valuation_cache(updated_at);
  `);
  ensureColumn(db, "competitions", "prize_context_json", "TEXT");
  ensureColumn(db, "competitions", "estimated_prize_value", "REAL");
  ensureColumn(db, "competitions", "valuation_source", "TEXT");
  ensureColumn(db, "competitions", "valuation_confidence", "TEXT");
  ensureColumn(db, "competitions", "valuation_notes", "TEXT");
  ensureColumn(db, "competitions", "max_entries_per_user_source", "TEXT");
  ensureColumn(db, "competitions", "inventory_source", "TEXT");
  ensureColumn(db, "competitions", "draw_uses_full_ticket_range", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "snapshots", "inventory_source", "TEXT");
  ensureColumn(db, "snapshots", "max_tickets", "INTEGER");
  ensureColumn(db, "snapshots", "draw_date", "TEXT");
  ensureColumn(db, "site_health_incident_state", "incident_condition", "TEXT");
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function upsertCompetition(comp: RawCompetition): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO competitions (
      source_id, site_name, url, name, entry_price, tickets_sold, max_tickets,
      draw_uses_full_ticket_range, inventory_source, max_entries_per_user, max_entries_per_user_source, cash_alternative, estimated_prize_value,
      valuation_source, valuation_confidence, valuation_notes, draw_date,
      is_auto_draw, categories, scraped_at, prize_context_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, site_name) DO UPDATE SET
      url = excluded.url,
      name = excluded.name,
      entry_price = excluded.entry_price,
      tickets_sold = excluded.tickets_sold,
      max_tickets = excluded.max_tickets,
      draw_uses_full_ticket_range = excluded.draw_uses_full_ticket_range,
      inventory_source = excluded.inventory_source,
      max_entries_per_user = excluded.max_entries_per_user,
      max_entries_per_user_source = excluded.max_entries_per_user_source,
      cash_alternative = excluded.cash_alternative,
      estimated_prize_value = excluded.estimated_prize_value,
      valuation_source = excluded.valuation_source,
      valuation_confidence = excluded.valuation_confidence,
      valuation_notes = excluded.valuation_notes,
      draw_date = excluded.draw_date,
      is_auto_draw = excluded.is_auto_draw,
      categories = excluded.categories,
      scraped_at = excluded.scraped_at,
      prize_context_json = excluded.prize_context_json
  `).run(
    comp.sourceId,
    comp.siteName,
    comp.url,
    comp.name,
    comp.entryPrice,
    comp.ticketsSold,
    comp.maxTickets,
    comp.drawUsesFullTicketRange ? 1 : 0,
    comp.inventorySource ?? "unknown",
    comp.maxEntriesPerUser,
    comp.maxEntriesPerUserSource ?? "fallback",
    comp.cashAlternative,
    comp.estimatedPrizeValue ?? null,
    comp.valuationSource ?? null,
    comp.valuationConfidence ?? null,
    comp.valuationNotes ?? null,
    comp.drawDate,
    comp.isAutoDraw ? 1 : 0,
    JSON.stringify(comp.categories),
    comp.scrapedAt,
    JSON.stringify({prizeDescription: comp.prizeDescription, prizeEvidence: comp.prizeEvidence, prizePayout: comp.prizePayout}),
  );
}

export function insertSnapshot(comp: RawCompetition): boolean {
  const db = getDb();
  const inventorySource = comp.inventorySource ?? "unknown";
  const currentAt = new Date(comp.scrapedAt).getTime();
  const drawAt = comp.drawDate === null ? Number.NaN : new Date(comp.drawDate).getTime();
  const heartbeatMs = inventorySource === "exact" &&
      Number.isFinite(currentAt) &&
      Number.isFinite(drawAt) &&
      drawAt > currentAt &&
      drawAt - currentAt <= CONFIG.alerts.notificationWindowMs
    ? CONFIG.smartSchedule.urgentIntervalMs
    : CONFIG.alerts.trendHeartbeatMs;
  const last = db
    .prepare(
      "SELECT tickets_sold, max_tickets, draw_date, inventory_source, scraped_at FROM snapshots WHERE source_id = ? AND site_name = ? ORDER BY id DESC LIMIT 1",
    )
    .get(comp.sourceId, comp.siteName) as {
      tickets_sold: number;
      max_tickets: number | null;
      draw_date: string | null;
      inventory_source: string | null;
      scraped_at: string;
    } | undefined;

  if (last) {
    const lastAt = new Date(last.scraped_at).getTime();
    if (Number.isFinite(lastAt) && Number.isFinite(currentAt) && currentAt <= lastAt) {
      return false;
    }
    if (
      last.tickets_sold === comp.ticketsSold &&
      last.max_tickets === comp.maxTickets &&
      last.draw_date === comp.drawDate &&
      last.inventory_source === inventorySource &&
      Number.isFinite(lastAt) &&
      Number.isFinite(currentAt) &&
      currentAt - lastAt < heartbeatMs
    ) {
      return false;
    }
  }

  db.prepare(`
    INSERT INTO snapshots (
      source_id, site_name, tickets_sold, max_tickets, draw_date,
      inventory_source, scraped_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    comp.sourceId,
    comp.siteName,
    comp.ticketsSold,
    comp.maxTickets,
    comp.drawDate,
    inventorySource,
    comp.scrapedAt,
  );
  return true;
}

export function pruneOldSnapshots(options: SnapshotPruneOptions): SnapshotPruneResult {
  if (!Number.isFinite(options.retentionMs) || options.retentionMs <= 0) {
    throw new RangeError("snapshot retentionMs must be finite and greater than zero");
  }
  if (!Number.isFinite(options.batchSize) || options.batchSize <= 0) {
    throw new RangeError("snapshot batchSize must be finite and greater than zero");
  }
  if (!Number.isFinite(options.maxBatches) || options.maxBatches <= 0) {
    throw new RangeError("snapshot maxBatches must be finite and greater than zero");
  }

  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("snapshot maintenance now must be a valid date");
  }

  const batchSize = Math.max(1, Math.floor(options.batchSize));
  const maxBatches = Math.max(1, Math.floor(options.maxBatches));
  const cutoff = new Date(now.getTime() - options.retentionMs).toISOString();
  const database = getDb();
  const deleteBatch = database.prepare(`
    DELETE FROM snapshots
    WHERE id IN (
      SELECT id FROM snapshots
      WHERE scraped_at < ?
      ORDER BY scraped_at ASC, id ASC
      LIMIT ?
    )
  `);
  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const result = deleteBatch.run(cutoff, batchSize);
    deleted += result.changes;
    if (result.changes < batchSize) break;
  }

  const hasMore = database
    .prepare("SELECT 1 FROM snapshots WHERE scraped_at < ? LIMIT 1")
    .get(cutoff) !== undefined;
  return { cutoff, deleted, hasMore };
}

export function getCompetitions(siteName?: string): RawCompetition[] {
  const db = getDb();
  const query = siteName
    ? db.prepare("SELECT * FROM competitions WHERE site_name = ? ORDER BY draw_date ASC")
    : db.prepare("SELECT * FROM competitions ORDER BY draw_date ASC");
  const rows = siteName ? query.all(siteName) : query.all();
  return (rows as Record<string, unknown>[]).map(rowToCompetition);
}

export function getCompetition(
  sourceId: string,
  siteName: string,
): RawCompetition | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM competitions WHERE source_id = ? AND site_name = ?")
    .get(sourceId, siteName) as Record<string, unknown> | undefined;
  return row ? rowToCompetition(row) : null;
}

export function upsertSiteScanHealth(health: SiteScanHealth): void {
  getDb().prepare(`
    INSERT INTO site_scan_health (
      site_name, status, competitions_found, cash_competitions_found,
      partial_competitions_found, error_message, scanned_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_name) DO UPDATE SET
      status = excluded.status,
      competitions_found = excluded.competitions_found,
      cash_competitions_found = excluded.cash_competitions_found,
      partial_competitions_found = excluded.partial_competitions_found,
      error_message = excluded.error_message,
      scanned_at = excluded.scanned_at
  `).run(
    health.siteName,
    health.status,
    health.competitionsFound,
    health.cashCompetitionsFound,
    health.partialCompetitionsFound,
    health.errorMessage,
    health.scannedAt,
  );
}

/**
 * Persist one monitor observation and return a review transition, if any.
 * Ordinary empty scans are neutral. An empty becomes unhealthy only when stale
 * storage still proves a usable, unsold competition has a future draw.
 */
export function observeSiteHealthForAlerts(
  health: SiteScanHealth,
  now = new Date(),
): SiteHealthNotificationEvent | null {
  const database = getDb();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("site health observation now must be a valid date");
  }
  const parsedObservedAt = new Date(health.scannedAt).getTime();
  const observedAt = Number.isFinite(parsedObservedAt)
    ? health.scannedAt
    : now.toISOString();
  const threshold = Math.max(
    1,
    Math.floor(CONFIG.alerts.siteHealthConsecutiveThreshold),
  );
  const reminderMs = Math.max(0, CONFIG.alerts.siteHealthReminderMs);

  return database.transaction(() => {
    const current = getSiteHealthIncidentState(database, health.siteName);
    if (current) {
      const previousObservedMs = new Date(current.lastObservedAt).getTime();
      const nextObservedMs = new Date(observedAt).getTime();
      if (
        Number.isFinite(previousObservedMs) &&
        Number.isFinite(nextObservedMs) &&
        nextObservedMs <= previousObservedMs
      ) {
        return null;
      }
    }

    const next: SiteHealthIncidentState = current
      ? { ...current }
      : {
          siteName: health.siteName,
          latestStatus: health.status,
          consecutiveUnhealthy: 0,
          incidentCondition: null,
          incidentStartedAt: null,
          incidentAlertedAt: null,
          lastRemindedAt: null,
          recoveredAt: null,
          recoveryAlertedAt: null,
          lastObservedAt: observedAt,
          errorMessage: null,
        };
    next.latestStatus = health.status;
    next.lastObservedAt = observedAt;
    next.errorMessage = health.errorMessage;

    const staleOpenFutureCompetitions = health.status === "empty"
      ? countStaleUsableOpenFutureCompetitions(database, health.siteName, observedAt)
      : 0;
    const observedCondition: SiteHealthIncidentCondition | null =
      isActionableUnhealthyStatus(health.status)
        ? "scan_failure"
        : staleOpenFutureCompetitions > 0
          ? "expected_competition_empty"
          : null;

    if (observedCondition !== null) {
      if (observedCondition === "expected_competition_empty") {
        const noun = staleOpenFutureCompetitions === 1 ? "competition" : "competitions";
        next.errorMessage =
          `${staleOpenFutureCompetitions} stale open future ${noun} disappeared from the live scan`;
      }
      const resolvedIncident = next.recoveredAt !== null && next.recoveryAlertedAt !== null;
      if (next.incidentStartedAt === null || resolvedIncident) {
        next.consecutiveUnhealthy = 1;
        next.incidentCondition = observedCondition;
        next.incidentStartedAt = observedAt;
        next.incidentAlertedAt = null;
        next.lastRemindedAt = null;
        next.recoveredAt = null;
        next.recoveryAlertedAt = null;
      } else if (next.recoveredAt !== null) {
        // Recovery was observed but not durably recorded. A new failure means
        // the reviewable incident never actually ended.
        next.consecutiveUnhealthy = 1;
        next.recoveredAt = null;
        next.recoveryAlertedAt = null;
      } else {
        next.consecutiveUnhealthy += 1;
      }
      if (observedCondition === "scan_failure") {
        next.incidentCondition = "scan_failure";
      } else {
        next.incidentCondition ??= observedCondition;
      }
      writeSiteHealthIncidentState(database, next);

      if (
        next.consecutiveUnhealthy >= threshold &&
        next.incidentAlertedAt === null
      ) {
        return siteHealthEvent("incident", next, observedAt, next.incidentStartedAt);
      }
      if (next.incidentAlertedAt !== null) {
        const reminderBase = next.lastRemindedAt ?? next.incidentAlertedAt;
        const reminderBaseMs = new Date(reminderBase).getTime();
        if (
          Number.isFinite(reminderBaseMs) &&
          nowMs - reminderBaseMs >= reminderMs
        ) {
          return siteHealthEvent(
            "reminder",
            next,
            observedAt,
            new Date(reminderBaseMs + reminderMs).toISOString(),
          );
        }
      }
      return null;
    }

    if (health.status === "success") {
      next.consecutiveUnhealthy = 0;
      next.errorMessage = null;
      if (
        next.incidentStartedAt !== null &&
        next.incidentAlertedAt !== null &&
        next.recoveryAlertedAt === null
      ) {
        next.recoveredAt ??= observedAt;
        writeSiteHealthIncidentState(database, next);
        return siteHealthEvent("recovery", next, observedAt, next.recoveredAt);
      }
      if (next.incidentAlertedAt === null) {
        clearIncident(next);
      }
      writeSiteHealthIncidentState(database, next);
      return null;
    }

    // An ordinary empty result proves neither a fault nor a recovery.
    next.consecutiveUnhealthy = 0;
    next.errorMessage = null;
    if (
      next.incidentAlertedAt === null ||
      next.incidentCondition === "expected_competition_empty"
    ) {
      clearIncident(next);
    }
    writeSiteHealthIncidentState(database, next);
    return null;
  })();
}

export function markSiteHealthEventRecorded(
  event: SiteHealthNotificationEvent,
  now = new Date(),
): boolean {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("site health record timestamp must be a valid date");
  }
  const recordedAt = now.toISOString();
  const database = getDb();
  if (event.kind === "incident") {
    return database.prepare(`
      UPDATE site_health_incident_state
      SET incident_alerted_at = ?
      WHERE site_name = ?
        AND incident_started_at = ?
        AND incident_alerted_at IS NULL
        AND recovered_at IS NULL
    `).run(recordedAt, event.siteName, event.incidentStartedAt).changes === 1;
  }
  if (event.kind === "reminder") {
    return database.prepare(`
      UPDATE site_health_incident_state
      SET last_reminded_at = ?
      WHERE site_name = ?
        AND incident_started_at = ?
        AND incident_alerted_at IS NOT NULL
        AND recovered_at IS NULL
    `).run(recordedAt, event.siteName, event.incidentStartedAt).changes === 1;
  }
  if (event.recoveredAt === null) return false;
  return database.prepare(`
    UPDATE site_health_incident_state
    SET recovery_alerted_at = ?
    WHERE site_name = ?
      AND incident_started_at = ?
      AND recovered_at = ?
      AND recovery_alerted_at IS NULL
  `).run(
    recordedAt,
    event.siteName,
    event.incidentStartedAt,
    event.recoveredAt,
  ).changes === 1;
}

export function getSiteHealthIncidentStates(): SiteHealthIncidentState[] {
  const rows = getDb()
    .prepare("SELECT * FROM site_health_incident_state ORDER BY site_name ASC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToSiteHealthIncidentState);
}

/** Remove health-only rows for adapters that are no longer registered. */
export function pruneSiteHealthForRegisteredSites(
  registeredSiteNames: readonly string[],
): SiteHealthCleanupResult {
  const database = getDb();
  const siteNames = [...new Set(registeredSiteNames)];
  return database.transaction(() => {
    const placeholders = siteNames.map(() => "?").join(", ");
    const suffix = siteNames.length > 0
      ? ` WHERE site_name NOT IN (${placeholders})`
      : "";
    const siteScanHealthRemoved = database
      .prepare(`DELETE FROM site_scan_health${suffix}`)
      .run(...siteNames).changes;
    const incidentStatesRemoved = database
      .prepare(`DELETE FROM site_health_incident_state${suffix}`)
      .run(...siteNames).changes;
    return { siteScanHealthRemoved, incidentStatesRemoved };
  })();
}

export function getCachedPrizeValuation(
  cacheKey: string,
  maxAgeMs: number,
  now = new Date(),
): CachedPrizeValuation | null {
  const row = getDb()
    .prepare("SELECT * FROM prize_valuation_cache WHERE cache_key = ?")
    .get(cacheKey) as Record<string, unknown> | undefined;
  if (!row) return null;

  const cached = rowToCachedPrizeValuation(row);
  const updatedAt = new Date(cached.updatedAt).getTime();
  if (!Number.isFinite(updatedAt)) return null;
  if (now.getTime() - updatedAt > maxAgeMs) return null;
  return cached;
}

export function upsertCachedPrizeValuation(
  valuation: Omit<CachedPrizeValuation, "createdAt" | "updatedAt">,
  now = new Date(),
): void {
  const timestamp = now.toISOString();
  getDb().prepare(`
    INSERT INTO prize_valuation_cache (
      cache_key, site_name, source_id, prize_name, url, estimated_prize_value,
      valuation_confidence, valuation_notes, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      site_name = excluded.site_name,
      source_id = excluded.source_id,
      prize_name = excluded.prize_name,
      url = excluded.url,
      estimated_prize_value = excluded.estimated_prize_value,
      valuation_confidence = excluded.valuation_confidence,
      valuation_notes = excluded.valuation_notes,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    valuation.cacheKey,
    valuation.siteName,
    valuation.sourceId,
    valuation.prizeName,
    valuation.url,
    valuation.estimatedPrizeValue,
    valuation.valuationConfidence,
    valuation.valuationNotes,
    valuation.status,
    timestamp,
    timestamp,
  );
}

export function getSiteScanHealth(): SiteScanHealth[] {
  const rows = getDb()
    .prepare("SELECT * FROM site_scan_health ORDER BY site_name ASC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToSiteScanHealth);
}

export function getSnapshots(
  sourceId: string,
  siteName: string,
): Snapshot[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM snapshots WHERE source_id = ? AND site_name = ? ORDER BY scraped_at ASC",
    )
    .all(sourceId, siteName) as Record<string, unknown>[];
  return rows.map(rowToSnapshot);
}

export function getRecentSnapshots(
  sourceId: string,
  siteName: string,
  drawDate: string | null,
  maxTickets: number,
  limit: number,
): Snapshot[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const rows = getDb()
    .prepare(`
      SELECT * FROM (
        SELECT * FROM snapshots
        WHERE source_id = ? AND site_name = ? AND inventory_source = 'exact'
          AND draw_date IS ? AND max_tickets = ?
        ORDER BY scraped_at DESC
        LIMIT ?
      )
      ORDER BY scraped_at ASC
    `)
    .all(sourceId, siteName, drawDate, maxTickets, safeLimit) as Record<string, unknown>[];
  return rows.map(rowToSnapshot);
}

export function wasAlertSentRecently(
  alertKey: string,
  cooldownMs: number,
  now = new Date(),
): boolean {
  const db = getDb();
  pruneOldAlertSends(now);
  const row = db
    .prepare("SELECT sent_at FROM alert_sends WHERE alert_key = ?")
    .get(alertKey) as { sent_at: string } | undefined;
  if (!row) return false;

  const sentAt = new Date(row.sent_at).getTime();
  return Number.isFinite(sentAt) && now.getTime() - sentAt < cooldownMs;
}

export function recordAlertSent(alertKey: string, now = new Date()): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO alert_sends (alert_key, sent_at)
    VALUES (?, ?)
    ON CONFLICT(alert_key) DO UPDATE SET sent_at = excluded.sent_at
  `).run(alertKey, now.toISOString());
}

export function recordTelegramSentMessage(
  message: TelegramSentMessage,
): void {
  getDb().prepare(`
    INSERT INTO telegram_sent_messages (
      chat_id, message_id, alert_key, canonical_url, site_name, source_id,
      raffle_name, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id, message_id) DO UPDATE SET
      alert_key = excluded.alert_key,
      canonical_url = excluded.canonical_url,
      site_name = excluded.site_name,
      source_id = excluded.source_id,
      raffle_name = excluded.raffle_name,
      sent_at = excluded.sent_at
  `).run(
    message.chatId,
    message.messageId,
    message.alertKey,
    message.canonicalUrl,
    message.siteName,
    message.sourceId,
    message.raffleName,
    message.sentAt,
  );
}

export function getTelegramSentMessage(
  chatId: string,
  messageId: number,
): TelegramSentMessage | null {
  const row = getDb().prepare(`
    SELECT * FROM telegram_sent_messages
    WHERE chat_id = ? AND message_id = ?
  `).get(chatId, messageId) as Record<string, unknown> | undefined;
  return row ? rowToTelegramSentMessage(row) : null;
}

export function createTelegramReminder(
  message: TelegramSentMessage,
  now = new Date(),
): boolean {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Reminder time must be valid");
  const result = getDb().prepare(`
    INSERT OR IGNORE INTO telegram_reminders (
      chat_id, message_id, alert_key, canonical_url, site_name, source_id,
      raffle_name, requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.chatId,
    message.messageId,
    message.alertKey,
    message.canonicalUrl,
    message.siteName,
    message.sourceId,
    message.raffleName,
    now.toISOString(),
  );
  return result.changes === 1;
}

export function getPendingTelegramReminders(): TelegramReminder[] {
  const rows = getDb().prepare(`
    SELECT * FROM telegram_reminders
    WHERE completed_at IS NULL
    ORDER BY requested_at ASC
  `).all() as Record<string, unknown>[];
  return rows.map(rowToTelegramReminder);
}

export function completeTelegramReminder(
  chatId: string,
  alertKey: string,
  outcome: TelegramReminderOutcome,
  now = new Date(),
): boolean {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Reminder time must be valid");
  const result = getDb().prepare(`
    UPDATE telegram_reminders
    SET completed_at = ?, outcome = ?
    WHERE chat_id = ? AND alert_key = ? AND completed_at IS NULL
  `).run(now.toISOString(), outcome, chatId, alertKey);
  return result.changes === 1;
}

export function recordTelegramFeedbackEvent(
  event: TelegramFeedbackEvent,
): boolean {
  const result = getDb().prepare(`
    INSERT OR IGNORE INTO telegram_feedback_events (
      update_id, chat_id, message_id, alert_key, canonical_url, site_name,
      source_id, raffle_name, sent_at, classification, feedback_value, source,
      actor_id, occurred_at, received_at, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.updateId,
    event.chatId,
    event.messageId,
    event.alertKey,
    event.canonicalUrl,
    event.siteName,
    event.sourceId,
    event.raffleName,
    event.sentAt,
    event.classification,
    event.feedbackValue,
    event.source,
    event.actorId,
    event.occurredAt,
    event.receivedAt,
    event.rawJson,
  );
  return result.changes === 1;
}

export function getTelegramFeedbackEvents(): TelegramFeedbackEvent[] {
  const rows = getDb().prepare(`
    SELECT * FROM telegram_feedback_events
    ORDER BY update_id ASC
  `).all() as Record<string, unknown>[];
  return rows.map(rowToTelegramFeedbackEvent);
}

export function getTelegramFeedbackOffset(): number {
  const row = getDb().prepare(`
    SELECT next_offset FROM telegram_update_state
    WHERE consumer = 'feedback'
  `).get() as { next_offset: number } | undefined;
  return row?.next_offset ?? 0;
}

export function advanceTelegramFeedbackOffset(nextOffset: number): void {
  if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) {
    throw new RangeError("Telegram next update offset must be a non-negative integer");
  }
  getDb().prepare(`
    INSERT INTO telegram_update_state (consumer, next_offset)
    VALUES ('feedback', ?)
    ON CONFLICT(consumer) DO UPDATE SET
      next_offset = MAX(next_offset, excluded.next_offset)
  `).run(nextOffset);
}

function pruneOldAlertSends(now: Date): void {
  const retentionMs = 90 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - retentionMs).toISOString();
  getDb().prepare("DELETE FROM alert_sends WHERE sent_at < ?").run(cutoff);
}

export function recordAlertDecision(record: StoredAlertDecision): void {
  getDb().prepare(`
    INSERT INTO alert_decisions (
      input_hash, decision, outcome, recorded_at, record_json
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    typeof record.inputHash === "string" ? record.inputHash : null,
    typeof record.decision === "string" ? record.decision : null,
    record.outcome,
    record.recordedAt,
    JSON.stringify(record),
  );
}

export function getAlertDecisions(limit?: number): StoredAlertDecision[] {
  const rows = limit === undefined
    ? getDb().prepare("SELECT id, record_json FROM alert_decisions ORDER BY id ASC").all()
    : getDb().prepare("SELECT id, record_json FROM alert_decisions ORDER BY id DESC LIMIT ?").all(Math.max(1, Math.floor(limit)));
  return (rows as Array<{ id: number; record_json: string }>).map((row) => ({
    ...JSON.parse(row.record_json) as StoredAlertDecision,
    id: row.id,
  }));
}

export function getCachedAlertReview(
  inputHash: string,
  maxAgeMs = Infinity,
  now = new Date(),
  rejectMaxAgeMs = maxAgeMs,
): StoredAlertDecision | null {
  const row = getDb().prepare(`
    SELECT id, record_json FROM alert_decisions
    WHERE input_hash = ? AND decision IN ('approve', 'reject', 'uncertain', 'error')
    ORDER BY id DESC LIMIT 1
  `).get(inputHash) as { id: number; record_json: string } | undefined;
  if (!row) return null;
  const record = {
    ...JSON.parse(row.record_json) as StoredAlertDecision,
    id: row.id,
  };
  const decisionMaxAgeMs = record.decision === "approve" ? maxAgeMs : rejectMaxAgeMs;
  if (Number.isFinite(decisionMaxAgeMs)) {
    const recordedAt = new Date(record.recordedAt).getTime();
    if (!Number.isFinite(recordedAt) || now.getTime() - recordedAt > decisionMaxAgeMs) return null;
  }
  return record;
}

export function useDatabaseForTests(dbPath: string): void {
  if (db) db.close();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  initSchema(db);
}

export function closeDatabaseForTests(): void {
  if (db) db.close();
  db = null;
}

function rowToCompetition(row: Record<string, unknown>): RawCompetition {
  return {
    ...readPrizeContext(row.prize_context_json),
    sourceId: row.source_id as string,
    siteName: row.site_name as string,
    url: row.url as string,
    name: row.name as string,
    entryPrice: row.entry_price as number,
    ticketsSold: row.tickets_sold as number,
    maxTickets: row.max_tickets as number,
    drawUsesFullTicketRange: row.draw_uses_full_ticket_range === 1,
    inventorySource:
      (row.inventory_source as RawCompetition["inventorySource"] | null) ?? "unknown",
    maxEntriesPerUser: (row.max_entries_per_user as number) ?? 100,
    maxEntriesPerUserSource: (row.max_entries_per_user_source as RawCompetition["maxEntriesPerUserSource"]) ?? "fallback",
    cashAlternative: row.cash_alternative as number | null,
    estimatedPrizeValue: row.estimated_prize_value as number | null,
    valuationSource: row.valuation_source as RawCompetition["valuationSource"],
    valuationConfidence: row.valuation_confidence as RawCompetition["valuationConfidence"],
    valuationNotes: row.valuation_notes as string | null,
    drawDate: row.draw_date as string | null,
    isAutoDraw: row.is_auto_draw === 1,
    categories: JSON.parse((row.categories as string) || "[]"),
    scrapedAt: row.scraped_at as string,
  };
}

function rowToSnapshot(row: Record<string, unknown>): Snapshot {
  return {
    id: row.id as number,
    sourceId: row.source_id as string,
    siteName: row.site_name as string,
    ticketsSold: row.tickets_sold as number,
    maxTickets: (row.max_tickets as number | null) ?? null,
    drawDate: (row.draw_date as string | null) ?? null,
    inventorySource:
      (row.inventory_source as Snapshot["inventorySource"] | null) ?? "unknown",
    scrapedAt: row.scraped_at as string,
  };
}

function rowToSiteScanHealth(row: Record<string, unknown>): SiteScanHealth {
  return {
    siteName: row.site_name as string,
    status: row.status as SiteScanHealth["status"],
    competitionsFound: row.competitions_found as number,
    cashCompetitionsFound: row.cash_competitions_found as number,
    partialCompetitionsFound: row.partial_competitions_found as number,
    errorMessage: row.error_message as string | null,
    scannedAt: row.scanned_at as string,
  };
}

function getSiteHealthIncidentState(
  database: Database.Database,
  siteName: string,
): SiteHealthIncidentState | null {
  const row = database
    .prepare("SELECT * FROM site_health_incident_state WHERE site_name = ?")
    .get(siteName) as Record<string, unknown> | undefined;
  return row ? rowToSiteHealthIncidentState(row) : null;
}

function rowToSiteHealthIncidentState(
  row: Record<string, unknown>,
): SiteHealthIncidentState {
  const incidentStartedAt = row.incident_started_at as string | null;
  return {
    siteName: row.site_name as string,
    latestStatus: row.latest_status as SiteScanStatus,
    consecutiveUnhealthy: row.consecutive_unhealthy as number,
    incidentCondition:
      (row.incident_condition as SiteHealthIncidentCondition | null) ??
      (incidentStartedAt === null ? null : "scan_failure"),
    incidentStartedAt,
    incidentAlertedAt: row.incident_alerted_at as string | null,
    lastRemindedAt: row.last_reminded_at as string | null,
    recoveredAt: row.recovered_at as string | null,
    recoveryAlertedAt: row.recovery_alerted_at as string | null,
    lastObservedAt: row.last_observed_at as string,
    errorMessage: row.error_message as string | null,
  };
}

function writeSiteHealthIncidentState(
  database: Database.Database,
  state: SiteHealthIncidentState,
): void {
  database.prepare(`
    INSERT INTO site_health_incident_state (
      site_name, latest_status, consecutive_unhealthy, incident_condition,
      incident_started_at, incident_alerted_at, last_reminded_at, recovered_at,
      recovery_alerted_at, last_observed_at, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(site_name) DO UPDATE SET
      latest_status = excluded.latest_status,
      consecutive_unhealthy = excluded.consecutive_unhealthy,
      incident_condition = excluded.incident_condition,
      incident_started_at = excluded.incident_started_at,
      incident_alerted_at = excluded.incident_alerted_at,
      last_reminded_at = excluded.last_reminded_at,
      recovered_at = excluded.recovered_at,
      recovery_alerted_at = excluded.recovery_alerted_at,
      last_observed_at = excluded.last_observed_at,
      error_message = excluded.error_message
  `).run(
    state.siteName,
    state.latestStatus,
    state.consecutiveUnhealthy,
    state.incidentCondition,
    state.incidentStartedAt,
    state.incidentAlertedAt,
    state.lastRemindedAt,
    state.recoveredAt,
    state.recoveryAlertedAt,
    state.lastObservedAt,
    state.errorMessage,
  );
}

function isActionableUnhealthyStatus(status: SiteScanStatus): boolean {
  return status === "blocked" || status === "transient_error" || status === "partial";
}

function countStaleUsableOpenFutureCompetitions(
  database: Database.Database,
  siteName: string,
  observedAt: string,
): number {
  const observedMs = new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs)) return 0;
  const configuredMaxAgeMs = CONFIG.filters.maxStoredCompetitionAgeMs;
  const maxAgeMs = Number.isFinite(configuredMaxAgeMs) && configuredMaxAgeMs > 0
    ? configuredMaxAgeMs
    : 6 * 60 * 60 * 1000;
  const staleCutoff = new Date(observedMs - maxAgeMs).toISOString();
  const rows = database.prepare(`
    SELECT source_id, name, url, entry_price, categories
    FROM competitions
    WHERE site_name = ?
      AND julianday(draw_date) > julianday(?)
      AND max_tickets > 0
      AND tickets_sold >= 0
      AND tickets_sold < max_tickets
      AND julianday(scraped_at) < julianday(?)
      AND name IS NOT NULL
      AND entry_price > 0
      AND COALESCE(cash_alternative, estimated_prize_value, 0) > 0
  `).all(siteName, observedAt, staleCutoff) as Array<{
    source_id: string;
    name: string;
    url: string;
    entry_price: number;
    categories: string;
  }>;
  return rows.filter((row) => excludedRaffleReason({
    sourceId: row.source_id,
    name: row.name,
    url: row.url,
    entryPrice: row.entry_price,
    categories: JSON.parse(row.categories || "[]") as string[],
  }) === null).length;
}

function clearIncident(state: SiteHealthIncidentState): void {
  state.consecutiveUnhealthy = 0;
  state.incidentCondition = null;
  state.incidentStartedAt = null;
  state.incidentAlertedAt = null;
  state.lastRemindedAt = null;
  state.recoveredAt = null;
  state.recoveryAlertedAt = null;
}

function siteHealthEvent(
  kind: SiteHealthNotificationEvent["kind"],
  state: SiteHealthIncidentState,
  observedAt: string,
  transitionAt: string,
): SiteHealthNotificationEvent {
  if (state.incidentStartedAt === null) {
    throw new Error(`site health event for ${state.siteName} has no incident start`);
  }
  if (state.incidentCondition === null) {
    throw new Error(`site health event for ${state.siteName} has no incident condition`);
  }
  return {
    kind,
    condition: state.incidentCondition,
    siteName: state.siteName,
    status: state.latestStatus,
    consecutiveUnhealthy: state.consecutiveUnhealthy,
    incidentStartedAt: state.incidentStartedAt,
    transitionAt,
    observedAt,
    recoveredAt: state.recoveredAt,
    errorMessage: state.errorMessage,
  };
}

function rowToCachedPrizeValuation(row: Record<string, unknown>): CachedPrizeValuation {
  return {
    cacheKey: row.cache_key as string,
    siteName: row.site_name as string,
    sourceId: row.source_id as string,
    prizeName: row.prize_name as string,
    url: row.url as string,
    estimatedPrizeValue: row.estimated_prize_value as number | null,
    valuationConfidence: row.valuation_confidence as CachedPrizeValuation["valuationConfidence"],
    valuationNotes: row.valuation_notes as string | null,
    status: row.status as CachedPrizeValuation["status"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToTelegramSentMessage(
  row: Record<string, unknown>,
): TelegramSentMessage {
  return {
    chatId: String(row.chat_id),
    messageId: row.message_id as number,
    alertKey: row.alert_key as string,
    canonicalUrl: row.canonical_url as string,
    siteName: row.site_name as string,
    sourceId: row.source_id as string,
    raffleName: row.raffle_name as string,
    sentAt: row.sent_at as string,
  };
}

function rowToTelegramReminder(
  row: Record<string, unknown>,
): TelegramReminder {
  return {
    chatId: String(row.chat_id),
    messageId: row.message_id as number,
    alertKey: row.alert_key as string,
    canonicalUrl: row.canonical_url as string,
    siteName: row.site_name as string,
    sourceId: row.source_id as string,
    raffleName: row.raffle_name as string,
    requestedAt: row.requested_at as string,
    completedAt: row.completed_at as string | null,
    outcome: row.outcome as TelegramReminderOutcome | null,
  };
}

function rowToTelegramFeedbackEvent(
  row: Record<string, unknown>,
): TelegramFeedbackEvent {
  return {
    updateId: row.update_id as number,
    ...rowToTelegramSentMessage(row),
    classification: row.classification as TelegramFeedbackClassification,
    feedbackValue: row.feedback_value as string,
    source: row.source as TelegramFeedbackSource,
    actorId: row.actor_id as string | null,
    occurredAt: row.occurred_at as string,
    receivedAt: row.received_at as string,
    rawJson: row.raw_json as string,
  };
}

function readPrizeContext(value: unknown): Pick<RawCompetition, "prizeDescription" | "prizeEvidence" | "prizePayout"> {
  if (typeof value !== "string") return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") return {};
  const context: Pick<RawCompetition, "prizeDescription" | "prizeEvidence" | "prizePayout"> = {};
  if ("prizeDescription" in parsed && typeof parsed.prizeDescription === "string") context.prizeDescription = parsed.prizeDescription;
  if ("prizeEvidence" in parsed && typeof parsed.prizeEvidence === "string") context.prizeEvidence = parsed.prizeEvidence;
  if ("prizePayout" in parsed && parsed.prizePayout && typeof parsed.prizePayout === "object" && "kind" in parsed.prizePayout) {
    if (parsed.prizePayout.kind === "fixed") context.prizePayout = {kind: "fixed"};
    else if (parsed.prizePayout.kind === "conditional" && "terms" in parsed.prizePayout && typeof parsed.prizePayout.terms === "string") context.prizePayout = {kind: "conditional", terms: parsed.prizePayout.terms};
  }
  return context;
}
