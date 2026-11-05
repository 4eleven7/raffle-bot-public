import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enrichCompetitionAt } from "../src/metrics/calculator.js";
import {
  appendRaffleObservationBatch,
  buildRaffleObservationBatch,
} from "../src/alerts/raffle-observation.js";
import type { RawCompetition } from "../src/types.js";

const observedAt = new Date("2026-07-26T10:00:00.000Z");
const flatTrend = () => ({
  dataPoints: 3,
  velocityPerHour: 0,
  estimatedSelloutMs: null,
  isAccelerating: false,
  projectedSellThrough: 0.1,
  isReliable: true,
  resetDetected: false,
});

function raw(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "close-1",
    siteName: "close-test",
    url: "https://example.test/close-1",
    name: "£1,000 Cash",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 20,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1_000,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: "2026-07-26T10:30:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: observedAt.toISOString(),
    ...overrides,
  };
}

test("raffle observation batches expose close drift and decision-ledger coverage", () => {
  const previous = raw({ drawDate: "2026-07-26T10:45:00.000Z" });
  const current = enrichCompetitionAt(raw(), observedAt);
  const batch = buildRaffleObservationBatch({
    evaluationId: "eval-close",
    siteName: "close-test",
    scanStatus: "success",
    observedAt,
    current: [current],
    previous: [previous],
    observationWindowMs: 48 * 60 * 60 * 1000,
    trendFor: flatTrend,
  });

  assert.equal(batch.competitions[0]?.decisionCoverageExpected, true);
  assert.equal(batch.competitions[0]?.drawDate, "2026-07-26T10:30:00.000Z");
  assert.equal(batch.competitions[0]?.timeToCloseMs, 30 * 60 * 1000);
  assert.equal(batch.competitions[0]?.inventorySource, "exact");
  assert.equal(batch.competitions[0]?.recommendation.stars, 3);
  assert.equal(Object.isFrozen(batch.competitions[0]?.recommendation), true);
  assert.equal(Object.isFrozen(batch.competitions[0]?.recommendation.currentScenario), true);
  assert.equal("assessment" in (batch.competitions[0] ?? {}), false);
  assert.deepEqual(batch.drawDateChanges, [{
    canonicalUrl: "https://example.test/close-1",
    sourceId: "close-1",
    previousDrawDate: "2026-07-26T10:45:00.000Z",
    currentDrawDate: "2026-07-26T10:30:00.000Z",
    deltaMs: -15 * 60 * 1000,
  }]);
});

test("error scans do not claim alert decision coverage for stored rows", () => {
  const current = enrichCompetitionAt(raw(), observedAt);

  for (const scanStatus of ["transient_error", "blocked"] as const) {
    const batch = buildRaffleObservationBatch({
      evaluationId: `eval-${scanStatus}`,
      siteName: "close-test",
      scanStatus,
      observedAt,
      current: [current],
      previous: [],
      observationWindowMs: 48 * 60 * 60 * 1000,
      trendFor: flatTrend,
    });

    assert.equal(batch.competitions[0]?.decisionCoverageExpected, false);
  }
});

test("partial fallback rows do not claim decision coverage", () => {
  const current = enrichCompetitionAt(raw(), observedAt);
  const batch = buildRaffleObservationBatch({
    evaluationId: "eval-partial-fallback",
    siteName: "close-test",
    scanStatus: "partial",
    decisionCoverageExpected: false,
    observedAt,
    current: [current],
    previous: [],
    observationWindowMs: 48 * 60 * 60 * 1000,
    trendFor: flatTrend,
  });

  assert.equal(batch.competitions[0]?.decisionCoverageExpected, false);
});

test("successful and clean-empty scans track missing close candidates, but partial scans do not", () => {
  const previous = raw({ scrapedAt: "2026-07-26T09:55:00.000Z" });
  const base = {
    evaluationId: "eval-missing",
    siteName: "close-test",
    observedAt,
    current: [],
    previous: [previous],
    observationWindowMs: 48 * 60 * 60 * 1000,
    trendFor: flatTrend,
  };

  assert.equal(buildRaffleObservationBatch({
    ...base,
    scanStatus: "success",
  }).missingFromSuccessfulScan.length, 1);
  assert.equal(buildRaffleObservationBatch({
    ...base,
    scanStatus: "empty",
  }).missingFromSuccessfulScan.length, 1);
  assert.equal(buildRaffleObservationBatch({
    ...base,
    scanStatus: "partial",
  }).missingFromSuccessfulScan.length, 0);
});

test("raffle observation JSONL is Europe/London dated and append-only", () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-observation-"));
  const batch = buildRaffleObservationBatch({
    evaluationId: "eval-log",
    siteName: "close-test",
    scanStatus: "success",
    observedAt,
    current: [enrichCompetitionAt(raw(), observedAt)],
    previous: [],
    observationWindowMs: 48 * 60 * 60 * 1000,
    trendFor: flatTrend,
  });

  const path = appendRaffleObservationBatch(batch, directory);
  appendRaffleObservationBatch(batch, directory);
  const records = readFileSync(path, "utf8").trim().split("\n");
  assert.equal(records.length, 2);
  assert.match(records[0] ?? "", /Europe\/London/);
});
