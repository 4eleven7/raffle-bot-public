import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config.js";
import { createQualificationReader, createSourceSelector, createTrialProgressReader, selectSourceModes,
  SOURCE_HISTORY_MS, type SourceTrial } from "../src/monitor/source-policy.js";
import { startMonitor } from "../src/monitor/monitor.js";
import { buildSourceReport, sourcePolicyOverrides } from "../src/cli/sources.js";
import { useDatabaseForTests, closeDatabaseForTests, recordAlertDecision,
  upsertCompetition, getDb } from "../src/storage/database.js";
import type { RawCompetition } from "../src/types.js";

const day = 86_400_000;
const now = Date.parse("2026-10-30T12:00:00Z");
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "raffle-source-review-"));
  useDatabaseForTests(join(dir, "test.db"));
  return dir;
}
function decision(site: string, at = now, stars = 1) {
  recordAlertDecision({ phase: "final", stage: "entry-window", recordedAt: new Date(at).toISOString(),
    outcome: "suppressed_cooldown", recommendation: { stars },
    candidate: { siteName: site, sourceId: String(at), drawDate: new Date(at + 60_000).toISOString() } });
}
function trial(at = now): SourceTrial {
  return { startedAt: new Date(at).toISOString(), endsAt: new Date(at + 14 * day).toISOString(),
    evidenceUrl: "https://example.test/current-raffle", reason: "Verified exact inventory and positive fresh potential" };
}

test("regular monitoring requires a qualifying result in the rolling 30-day window", () => {
  setup();
  try {
    decision("pristine", now - day);
    decision("old", now - SOURCE_HISTORY_MS);
    decision("future", now + day);
    decision("rejected", now, 0);
    recordAlertDecision({ phase: "final", stage: "valuation-preflight", recordedAt: new Date(now).toISOString(),
      outcome: "reviewed", candidate: { siteName: "preflight" }, recommendation: { stars: 1 } });
    const read = createQualificationReader();
    const initial = read(now);
    assert.deepEqual([...initial.keys()], ["pristine"]);
    assert.equal(selectSourceModes(["pristine", "old", "future", "rejected", "preflight"], initial, {}, now).get("old"), "paused");
    assert.equal(read(now + 29 * day).size, 0);
    decision("promoted", now + 29 * day);
    assert.equal(read(now + 29 * day).get("promoted"), now + 29 * day);
  } finally { closeDatabaseForTests(); }
});

test("recent confirmed deliveries retain sources when older decision formats lack recommendations", () => {
  setup();
  try {
    getDb().prepare("INSERT INTO telegram_sent_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("test", 1, "draw", "https://example.test/draw", "sent", "draw", "Cash", new Date(now - day).toISOString());
    const read = createQualificationReader();
    assert.equal(read(now).get("sent"), now - day);
    assert.equal(read(now + 29 * day).size, 0);
  } finally { closeDatabaseForTests(); }
});

test("trials are capped at five, last at most fourteen days, and qualify into regular monitoring", () => {
  const trials: Record<string, SourceTrial> = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map(site => [site, trial()]));
  trials.invalid = { ...trial(), endsAt: new Date(now + 15 * day).toISOString() };
  trials.noEvidence = { ...trial(), evidenceUrl: "" };
  const sites = Object.keys(trials);
  const modes = selectSourceModes(sites, new Map(), trials, now);
  assert.deepEqual([...modes].filter(([, mode]) => mode === "trial").map(([site]) => site), ["a", "b", "c", "d", "e"]);
  assert.equal(modes.get("f"), "paused");
  assert.equal(modes.get("invalid"), "paused");
  assert.equal(modes.get("noEvidence"), "paused");
  assert.equal(selectSourceModes(sites, new Map(), trials, now + 14 * day).get("a"), "paused");
  const promoted = selectSourceModes(sites, new Map([["a", now + day]]), trials, now + 14 * day);
  assert.equal(promoted.get("a"), "regular");
  assert.equal(selectSourceModes(["a"], new Map(), { a: trial(now + day) }, now).get("a"), "paused");
});

test("an optimistic future raffle and old success cannot keep an unproven source active", () => {
  setup();
  try {
    const comp: RawCompetition = { siteName: "pristine", sourceId: "future", name: "£1000 Cash", url: "https://example.test/future",
      entryPrice: 1, ticketsSold: 0, maxTickets: 100, inventorySource: "exact", maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "site", cashAlternative: 1000, valuationSource: "cash", valuationConfidence: "high",
      drawDate: new Date(now + 5 * day).toISOString(), isAutoDraw: false, categories: [], scrapedAt: new Date(now).toISOString() };
    upsertCompetition(comp); decision("pristine", now - 31 * day);
    const report = buildSourceReport(new Date(now));
    assert.equal(report.rows.find(row => row.siteName === "pristine")?.potentialRows, 1);
    assert.equal(report.rows.find(row => row.siteName === "pristine")?.status, "paused");
    assert.ok(sourcePolicyOverrides(report).pristine);
    decision("pristine");
    assert.equal(buildSourceReport(new Date(now)).rows.find(row => row.siteName === "pristine")?.status, "active");
  } finally { closeDatabaseForTests(); }
});

test("the running selector expires trials and regular eligibility without a restart", () => {
  setup(); const previous = CONFIG.monitor.sourceMonitoring;
  try {
    CONFIG.monitor.sourceMonitoring = { enabled: true, trials: { trial: trial() } };
    decision("regular", now - day);
    const select = createSourceSelector(["regular", "trial", "unknown"]);
    assert.equal(select(now).get("trial"), "trial");
    assert.equal(select(now + 14 * day).get("trial"), "paused");
    assert.equal(select(now + 29 * day).get("regular"), "paused");
    decision("trial", now + 29 * day);
    assert.equal(select(now + 29 * day + 60_001).get("trial"), "regular");
  } finally { CONFIG.monitor.sourceMonitoring = previous; closeDatabaseForTests(); }
});

test("a trial stops after three distinct completed economic evaluations, not repeated scans or missing data", () => {
  setup(); const previous = CONFIG.monitor.sourceMonitoring;
  try {
    const trials = { pristine: trial(now - day) };
    CONFIG.monitor.sourceMonitoring = { enabled: true, trials };
    const record = (id: string, close: number, reason = "too unlikely", at = close - 60_000) =>
      recordAlertDecision({ phase: "final", stage: "entry-window", outcome: "suppressed_deterministic", recordedAt: new Date(at).toISOString(),
        recommendation: { stars: 0, reason },
        candidate: { siteName: "pristine", sourceId: id, drawDate: new Date(close).toISOString() } });
    record("before-trial", now - 2 * day);
    record("first", now - 600_000);
    record("first", now - 600_000);
    record("second", now - 300_000, "at draw: too unlikely");
    record("missing-value", now - 100_000, "prize valuation is not reliable");
    record("missing-inventory", now - 100_000, "ticket inventory is not exact");
    record("too-early", now - 100_000, "too unlikely", now - 2 * 3_600_000);
    record("third", now + 60_000);
    const read = createTrialProgressReader();
    assert.equal(read(trials, now).get("pristine"), 2);
    const select = createSourceSelector(["pristine"]);
    assert.equal(select(now).get("pristine"), "trial");
    assert.equal(read(trials, now + 60_001).get("pristine"), 3);
    assert.equal(select(now + 60_001).get("pristine"), "paused");
    const report = buildSourceReport(new Date(now + 60_001));
    assert.equal(report.rows.find(r => r.siteName === "pristine")?.completedTrialDraws, 3);
    assert.equal(report.rows.find(r => r.siteName === "pristine")?.status, "paused");
    assert.equal(createSourceSelector(["pristine"])(now + 60_001).get("pristine"), "paused");
    decision("pristine", now + 120_000);
    assert.equal(select(now + 120_002).get("pristine"), "regular");
    assert.equal(read({ pristine: trial(now + 120_000) }, now + 120_000).get("pristine"), undefined);
  } finally { CONFIG.monitor.sourceMonitoring = previous; closeDatabaseForTests(); }
});

test("watcher never fetches unproven sources and stops fetching an expired trial", async () => {
  const dir = setup(); const previous = CONFIG.monitor.sourceMonitoring;
  const previousAlerts = { ...CONFIG.alerts }; const realNow = Date.now;
  let clock = realNow(); const started = clock;
  const fetched: string[] = [];
  try {
    CONFIG.monitor.sourceMonitoring = { enabled: true, trials: { trial: trial(started) } };
    for (const key of ["decisionLogDir", "siteHealthLogDir", "raffleObservationLogDir", "telegramFeedbackLogDir"] as const) {
      CONFIG.alerts[key] = join(dir, key);
    }
    decision("regular", started);
    Date.now = () => clock;
    await startMonitor([
      { siteName: "trial", async fetchAll() { fetched.push("trial"); clock += 15 * day; return []; } },
      { siteName: "regular", async fetchAll() { fetched.push("regular"); return []; } },
      { siteName: "unknown", async fetchAll() { fetched.push("unknown"); return []; } },
    ], { intervalMs: 1, concurrency: 1, maxCycles: 2, tickMs: 1, showTable: false });
    assert.deepEqual(fetched, ["trial", "regular"]);
  } finally {
    Date.now = realNow; CONFIG.monitor.sourceMonitoring = previous;
    Object.assign(CONFIG.alerts, previousAlerts); closeDatabaseForTests();
  }
});
