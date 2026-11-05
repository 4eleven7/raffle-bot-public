import { getDb, type TelegramFeedbackEvent } from "./database.js";

export interface EntryIdentity {
  entryKey: string;
  canonicalUrl: string;
  siteName: string;
  sourceId: string;
  raffleName: string;
}

function requireMoney(value: number): void {
  if (!Number.isFinite(value) || value < 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) {
    throw new Error("Use a non-negative GBP amount with at most two decimal places");
  }
}

export function recordActualEntry(entry: EntryIdentity, spent: number, now = new Date()): void {
  requireMoney(spent);
  getDb().prepare(`INSERT INTO raffle_entries (entry_key, canonical_url, site_name, source_id, raffle_name, spent, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry_key) DO UPDATE SET spent=excluded.spent, updated_at=excluded.updated_at`)
    .run(entry.entryKey, entry.canonicalUrl, entry.siteName, entry.sourceId, entry.raffleName, spent, now.toISOString());
}

export function recordActualOutcome(entryKey: string, outcome: "won" | "lost", received: number, now = new Date()): void {
  requireMoney(received);
  if (outcome === "lost" && received !== 0) throw new Error("A lost entry must have a zero return");
  const result = getDb().prepare("UPDATE raffle_entries SET outcome = ?, received = ?, updated_at = ? WHERE entry_key = ?")
    .run(outcome, received, now.toISOString(), entryKey);
  if (!result.changes) throw new Error("Record the entry first; use entries to find its key");
}

export function recordActualSpend(entryKey: string, spent: number, now = new Date()): void {
  requireMoney(spent);
  const result = getDb().prepare("UPDATE raffle_entries SET spent = ?, updated_at = ? WHERE entry_key = ?")
    .run(spent, now.toISOString(), entryKey);
  if (!result.changes) throw new Error("Unknown entry key; record the entry first");
}

export function recordEntryFeedback(event: TelegramFeedbackEvent): void {
  const outcome = event.classification;
  if (outcome !== "entered" && outcome !== "won" && outcome !== "lost") return;
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO raffle_entries (entry_key, canonical_url, site_name, source_id, raffle_name, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(event.alertKey, event.canonicalUrl, event.siteName, event.sourceId, event.raffleName, event.occurredAt);
  if (outcome !== "entered") {
    db.prepare(`UPDATE raffle_entries SET outcome = ?, received = CASE WHEN ? = 'lost' THEN 0 WHEN outcome = 'won' THEN received ELSE NULL END,
      updated_at = ? WHERE entry_key = ? AND updated_at <= ?`)
      .run(outcome, outcome, event.occurredAt, event.alertKey, event.occurredAt);
  }
}

interface EntryRow {
  entry_key: string;
  canonical_url: string;
  site_name: string;
  source_id: string;
  raffle_name: string;
  spent: number | null;
  received: number | null;
  outcome: "pending" | "won" | "lost";
  updated_at: string;
}

export function getEntryResults() {
  const entries = getDb().prepare<[], EntryRow>("SELECT * FROM raffle_entries ORDER BY updated_at DESC").all();
  const settled = entries.flatMap(e => e.outcome !== "pending" && e.spent !== null && e.received !== null ? [{spent: e.spent, received: e.received}] : []);
  const spent = settled.reduce((sum, e) => sum + e.spent, 0);
  const received = settled.reduce((sum, e) => sum + e.received, 0);
  return {
    entries,
    totals: {
      entries: entries.length,
      knownSpend: entries.reduce((sum, e) => sum + (e.spent ?? 0), 0),
      missingSpend: entries.filter(e => e.spent === null).length,
      pending: entries.filter(e => e.outcome === "pending").length,
      won: entries.filter(e => e.outcome === "won").length,
      lost: entries.filter(e => e.outcome === "lost").length,
      fullyRecordedSettledEntries: settled.length,
      settledSpend: spent, settledReturn: received, realisedNet: received - spent,
      realisedReturnRatio: spent > 0 ? (received - spent) / spent : null,
    },
  };
}
