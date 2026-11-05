import test from "node:test";
import assert from "node:assert/strict";
import {
  applySiteScanBudget,
  calculateErrorBackoff,
  capAtEntryDeadline,
  determineNextScan,
  prioritizeAdaptersForColdStart,
} from "../src/monitor/monitor.js";
import { scoreRaffle } from "../src/metrics/decision.js";
import { CONFIG } from "../src/config.js";
import type { SiteAdapter } from "../src/adapters/adapter.js";
import type { Competition } from "../src/types.js";
import type { TrendAnalysis } from "../src/metrics/trends.js";

const hour = 60 * 60 * 1000;
const baseIntervalMs = 60 * 60 * 1000;
const now = new Date("2026-05-28T12:00:00.000Z").getTime();

function competition(overrides: Partial<Competition> = {}): Competition {
  const timeToClose = overrides.timeToClose ?? 12 * hour;
  return {
    sourceId: "comp-1",
    siteName: "example",
    url: "https://example.com/comp-1",
    name: "Example Competition",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1000,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: new Date(now + timeToClose).toISOString(),
    isAutoDraw: true,
    categories: [],
    scrapedAt: new Date(now).toISOString(),
    evPerTicket: 89.9,
    optimalTickets: 90,
    optimalCost: 90,
    winProbability: 0.9,
    lossProbability: 0.1,
    expectedReturn: 900,
    netEV: 810,
    returnRatio: 9,
    houseEdge: -9,
    sellThrough: 0.1,
    timeToClose,
    ...overrides,
  };
}

test("sites with no known draws inside 10 hours slow down to two-hour polling", () => {
  const decision = determineNextScan(
    [
      competition({ sourceId: "far-1", timeToClose: 10 * hour }),
      competition({ sourceId: "far-2", timeToClose: 18 * hour }),
    ],
    baseIntervalMs,
    now,
  );

  assert.equal(decision.intervalMs, CONFIG.smartSchedule.slowIntervalMs);
  assert.equal(decision.closingSoonCount, 0);
});

test("empty sites slow down to two-hour polling", () => {
  const decision = determineNextScan([], baseIntervalMs, now);

  assert.equal(decision.intervalMs, CONFIG.smartSchedule.slowIntervalMs);
  assert.equal(decision.closingSoonCount, 0);
});

test("cold start prioritizes sites by their earliest stored future draw", () => {
  const adapters: SiteAdapter[] = [
    { siteName: "unknown", scanCost: "browser", async fetchAll() { return []; } },
    { siteName: "later", scanCost: "browser", async fetchAll() { return []; } },
    { siteName: "soon", scanCost: "browser", async fetchAll() { return []; } },
    { siteName: "past-only", scanCost: "browser", async fetchAll() { return []; } },
  ];
  const stored = [
    competition({ siteName: "later", drawDate: new Date(now + 12 * hour).toISOString() }),
    competition({ siteName: "soon", drawDate: new Date(now + 30 * 60 * 1000).toISOString() }),
    competition({ siteName: "past-only", drawDate: new Date(now - hour).toISOString() }),
  ];

  const ordered = prioritizeAdaptersForColdStart(adapters, stored, now);

  assert.deepEqual(
    ordered.map((adapter) => adapter.siteName),
    ["soon", "later", "unknown", "past-only"],
  );
});

test("unknown draw dates keep the base interval", () => {
  const decision = determineNextScan(
    [
      competition({
        drawDate: null,
        timeToClose: null,
      }),
      competition({ sourceId: "far", timeToClose: 18 * hour }),
    ],
    baseIntervalMs,
    now,
  );

  assert.equal(decision.intervalMs, baseIntervalMs);
  assert.equal(decision.closingSoonCount, 0);
});

test("a draw 90 minutes away scans again at the 60-minute entry deadline", () => {
  const decision = determineNextScan(
    [competition({ timeToClose: 90 * 60 * 1000 })],
    baseIntervalMs,
    now,
  );

  assert.equal(decision.intervalMs, 30 * 60 * 1000);
  assert.equal(decision.closingSoonCount, 0);
});

test("actionable competitions inside one hour use urgent polling", () => {
  const decision = determineNextScan(
    [competition({ timeToClose: 59 * 60 * 1000 })],
    baseIntervalMs,
    now,
  );

  assert.equal(decision.intervalMs, CONFIG.smartSchedule.urgentIntervalMs);
  assert.equal(decision.closingSoonCount, 1);
  assert.equal(decision.latestSafeIntervalMs, null);
});

test("same-draw trend keeps a two-star candidate on the urgent schedule", () => {
  const candidate = competition({
    timeToClose: 50 * 60 * 1000,
    maxTickets: 500,
    maxEntriesPerUser: 20,
  });
  const trend: TrendAnalysis = {
    dataPoints: 3,
    velocityPerHour: 0,
    estimatedSelloutMs: null,
    isAccelerating: false,
    projectedSellThrough: 0.024,
    isReliable: true,
    resetDetected: false,
  };

  assert.equal(scoreRaffle(candidate), -Infinity);
  assert.ok(Number.isFinite(scoreRaffle(candidate, trend)));
  assert.equal(
    determineNextScan([candidate], baseIntervalMs, now).intervalMs,
    CONFIG.smartSchedule.upcomingIntervalMs,
  );
  const decision = determineNextScan(
    [candidate],
    baseIntervalMs,
    now,
    () => trend,
  );
  assert.equal(decision.intervalMs, CONFIG.smartSchedule.urgentIntervalMs);
  assert.equal(decision.closingSoonCount, 1);
});

test("a site budget cannot cross the entry deadline", () => {
  assert.equal(capAtEntryDeadline(2 * hour, 30 * 60 * 1000), 30 * 60 * 1000);
  assert.equal(capAtEntryDeadline(2 * hour, null), 2 * hour);
});

test("known draws inside one hour use upcoming polling even before passing risk filters", () => {
  const decision = determineNextScan(
    [
      competition({
        timeToClose: 50 * 60 * 1000,
        cashAlternative: 1,
        netEV: -10,
      }),
    ],
    baseIntervalMs,
    now,
  );

  assert.equal(decision.intervalMs, CONFIG.smartSchedule.upcomingIntervalMs);
  assert.equal(decision.closingSoonCount, 0);
});

test("browser-backed sites use slower normal polling", () => {
  const interval = applySiteScanBudget(
    { siteName: "browser-example", scanCost: "browser" },
    baseIntervalMs,
    false,
  );

  assert.equal(interval, baseIntervalMs * CONFIG.monitor.browserIntervalMultiplier);
});

test("time-sensitive polling ignores browser scan cost", () => {
  const interval = applySiteScanBudget(
    { siteName: "browser-example", scanCost: "browser" },
    CONFIG.smartSchedule.urgentIntervalMs,
    true,
  );

  assert.equal(interval, CONFIG.smartSchedule.urgentIntervalMs);
});

test("error backoff grows then caps", () => {
  assert.equal(calculateErrorBackoff(baseIntervalMs, 1), baseIntervalMs * 2);
  assert.equal(
    calculateErrorBackoff(baseIntervalMs, 10),
    baseIntervalMs * CONFIG.smartSchedule.maxErrorBackoffMultiplier,
  );
});
