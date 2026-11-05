import test from "node:test";
import assert from "node:assert/strict";
import { checkAlerts } from "../src/alerts/alerts.js";
import { analyzeTrendSnapshots } from "../src/metrics/trends.js";
import type { Competition, Snapshot } from "../src/types.js";

const DRAW_DATE = "2026-07-15T14:00:00.000Z";

function competition(overrides: Partial<Competition> = {}): Competition {
  return {
    sourceId: "comp-1", siteName: "example", url: "https://example.com/1", name: "Cash",
    entryPrice: 1, ticketsSold: 50, maxTickets: 100, maxEntriesPerUser: 100,
    inventorySource: "exact",
    maxEntriesPerUserSource: "site", cashAlternative: 1_000,
    isAutoDraw: false, categories: [], scrapedAt: "2026-07-15T12:00:00.000Z",
    evPerTicket: 1, optimalTickets: 10, optimalCost: 10, winProbability: 0.7,
    lossProbability: 0.3, expectedReturn: 20, netEV: 10, returnRatio: 2,
    houseEdge: -1, sellThrough: 0.5, timeToClose: 2 * 60 * 60 * 1000,
    drawDate: DRAW_DATE, ...overrides,
  } as Competition;
}

function snapshots(...sold: number[]): Snapshot[] {
  return sold.map((ticketsSold, index) => ({
    id: index + 1, sourceId: "comp-1", siteName: "example", ticketsSold,
    maxTickets: 100, drawDate: DRAW_DATE,
    inventorySource: "exact",
    scrapedAt: new Date(Date.UTC(2026, 6, 15, 8 + index)).toISOString(),
  }));
}

test("trend analysis suppresses projections after a sold-counter reset", () => {
  const trend = analyzeTrendSnapshots(
    competition({ ticketsSold: 100 }),
    snapshots(47_772, 0, 100),
  );
  assert.equal(trend.resetDetected, true);
  assert.equal(trend.isReliable, false);
  assert.equal(trend.velocityPerHour, 0);
  assert.equal(trend.projectedSellThrough, null);
});

test("trend analysis recovers only after three monotonic observations following a reset", () => {
  const trend = analyzeTrendSnapshots(
    competition({ ticketsSold: 150 }),
    snapshots(47_772, 0, 50, 100),
  );
  assert.equal(trend.resetDetected, true);
  assert.equal(trend.isReliable, true);
  assert.ok(trend.velocityPerHour > 0);
  assert.ok((trend.projectedSellThrough ?? 0) >= 0.15);
});

test("trend analysis excludes history older than the configured freshness window", () => {
  const trend = analyzeTrendSnapshots(competition({ ticketsSold: 50 }), [
    { id: 1, sourceId: "comp-1", siteName: "example", ticketsSold: 1, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-13T08:00:00.000Z" },
    { id: 2, sourceId: "comp-1", siteName: "example", ticketsSold: 20, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-13T09:00:00.000Z" },
  ]);
  assert.equal(trend.dataPoints, 1);
  assert.equal(trend.isReliable, false);
  assert.equal(trend.projectedSellThrough, null);
});

test("three unchanged observations produce a reliable zero-velocity projection", () => {
  const trend = analyzeTrendSnapshots(
    competition({ ticketsSold: 50 }),
    [
      { id: 1, sourceId: "comp-1", siteName: "example", ticketsSold: 50, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-15T11:30:00.000Z" },
      { id: 2, sourceId: "comp-1", siteName: "example", ticketsSold: 50, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-15T11:45:00.000Z" },
      { id: 3, sourceId: "comp-1", siteName: "example", ticketsSold: 50, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-15T12:00:00.000Z" },
    ],
  );
  assert.equal(trend.dataPoints, 3);
  assert.equal(trend.isReliable, true);
  assert.equal(trend.velocityPerHour, 0);
  assert.equal(trend.projectedSellThrough, 0.5);
});

test("trend projection never falls below current sold or exceeds the competition maximum", () => {
  const comp = competition({ ticketsSold: 95, timeToClose: 10 * 60 * 60 * 1000 });
  const trend = analyzeTrendSnapshots(comp, snapshots(10, 90, 95));
  assert.ok((trend.projectedSellThrough ?? 0) >= 0.95);
  assert.ok((trend.projectedSellThrough ?? 2) <= 1);
});

test("conservative velocity does not understate a faster recent valid sales window", () => {
  const trend = analyzeTrendSnapshots(competition(), snapshots(10, 12, 13, 23));
  assert.ok(trend.velocityPerHour >= 10, `expected recent 10 tickets/hour, got ${trend.velocityPerHour}`);
});

test("a fast latest interval is not diluted by much older quiet history", () => {
  const trend = analyzeTrendSnapshots(competition({ ticketsSold: 22 }), [
    { id: 1, sourceId: "comp-1", siteName: "example", ticketsSold: 10, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-15T08:00:00.000Z" },
    { id: 2, sourceId: "comp-1", siteName: "example", ticketsSold: 11, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-15T09:00:00.000Z" },
    { id: 3, sourceId: "comp-1", siteName: "example", ticketsSold: 12, maxTickets: 100, drawDate: DRAW_DATE, inventorySource: "exact", scrapedAt: "2026-07-15T11:59:00.000Z" },
  ]);
  assert.ok(trend.velocityPerHour >= 600, `expected latest 600 tickets/hour, got ${trend.velocityPerHour}`);
});

test("a latest sales surge is not averaged away by the recent half of a long history", () => {
  const trend = analyzeTrendSnapshots(competition({ ticketsSold: 22 }), [
    ...snapshots(10, 10, 10, 10),
    { ...snapshots(12)[0]!, scrapedAt: "2026-07-15T11:59:00.000Z" },
  ]);
  assert.ok(trend.velocityPerHour >= 600, `expected latest 600 tickets/hour, got ${trend.velocityPerHour}`);
});

test("duplicate timestamps do not count as independent sales observations", () => {
  const point = { ...snapshots(50)[0]!, scrapedAt: "2026-07-15T11:45:00.000Z" };
  const trend = analyzeTrendSnapshots(competition(), [point, point, point]);
  assert.equal(trend.dataPoints, 2);
  assert.equal(trend.isReliable, false);
});

test("trend projection uses the scrape-to-draw horizon and sellout time reaches the evaluation clock", () => {
  const scrapedAt = "2026-07-15T10:00:00.000Z";
  const drawDate = "2026-07-15T12:00:00.000Z";
  const trend = analyzeTrendSnapshots(
    competition({
      ticketsSold: 40,
      scrapedAt,
      drawDate,
      timeToClose: 90 * 60 * 1000,
    }),
    [
      { id: 1, sourceId: "comp-1", siteName: "example", ticketsSold: 20, maxTickets: 100, drawDate, inventorySource: "exact", scrapedAt: "2026-07-15T08:00:00.000Z" },
      { id: 2, sourceId: "comp-1", siteName: "example", ticketsSold: 30, maxTickets: 100, drawDate, inventorySource: "exact", scrapedAt: "2026-07-15T09:00:00.000Z" },
    ],
  );

  assert.equal(trend.velocityPerHour, 10);
  assert.equal(trend.projectedSellThrough, 0.6);
  assert.equal(trend.estimatedSelloutMs, 5.5 * 60 * 60 * 1000);
});

test("entry alerts reject stale or future exact inventory", () => {
  const observedAt = Date.parse("2026-07-15T12:01:00.000Z");
  const trend = {
    dataPoints: 3,
    velocityPerHour: 0,
    estimatedSelloutMs: null,
    isAccelerating: false,
    projectedSellThrough: 0.02,
    isReliable: true,
    resetDetected: false,
  };
  const base = {
    ticketsSold: 2,
    timeToClose: 30 * 60 * 1000,
    drawDate: "2026-07-15T12:31:00.000Z",
    scrapedAt: "2026-07-15T12:00:00.000Z",
    valuationSource: "cash",
    valuationConfidence: "high",
  };

  const fresh = competition(base);
  assert.equal(checkAlerts(fresh, trend, observedAt).length, 1);
  assert.equal(
    checkAlerts(competition({ ...base, scrapedAt: "2026-07-15T11:58:59.999Z" }), trend, observedAt).length,
    0,
  );
  assert.equal(
    checkAlerts(competition({ ...base, scrapedAt: "2026-07-15T12:01:00.001Z" }), trend, observedAt).length,
    0,
  );
});
