import assert from "node:assert/strict";
import test from "node:test";
import type { Competition, EntryRecommendation } from "../src/types.js";
import type { TrendAnalysis } from "../src/metrics/trends.js";
import {
  formatAlerts,
  formatCompetitionsTable,
  formatEntryTable,
  formatSummary,
} from "../src/cli/formatters.js";

const minute = 60_000;

function competition(overrides: Partial<Competition> = {}): Competition {
  return {
    sourceId: "formatter-entry-1",
    siteName: "example",
    url: "https://example.test/formatter-entry-1",
    name: "£500 Cash",
    entryPrice: 1,
    ticketsSold: 5,
    maxTickets: 16,
    inventorySource: "exact",
    maxEntriesPerUser: 10,
    maxEntriesPerUserSource: "site",
    cashAlternative: 500,
    estimatedPrizeValue: null,
    valuationSource: "cash",
    valuationConfidence: "high",
    valuationNotes: "Explicit cash alternative",
    drawDate: "2026-12-30T19:30:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
    prizeValue: 500,
    evPerTicket: 4.5,
    optimalTickets: 10,
    optimalCost: 10,
    winProbability: 2 / 3,
    lossProbability: 1 / 3,
    expectedReturn: 333.33,
    netEV: 323.33,
    returnRatio: 32.33,
    houseEdge: -3,
    sellThrough: 0.05,
    timeToClose: 30 * minute,
    ...overrides,
  };
}

function recommendation(overrides: Partial<EntryRecommendation> = {}): EntryRecommendation {
  return Object.freeze({
    stars: 2,
    currentScenario: Object.freeze({
      tickets: 10,
      cost: 10,
      winProbability: 2 / 3,
      lossProbability: 1 / 3,
      expectedReturn: 333.33,
      netEV: 323.33,
      returnRatio: 32.33,
    }),
    projectedScenario: Object.freeze({
      tickets: 10,
      cost: 10,
      winProbability: 0.5,
      lossProbability: 0.5,
      expectedReturn: 250,
      netEV: 240,
      returnRatio: 24,
    }),
    projectedSellThrough: 0.1,
    reason: "positive current and projected entry",
    ...overrides,
  });
}

const trend: TrendAnalysis = {
  dataPoints: 3,
  velocityPerHour: 0,
  estimatedSelloutMs: null,
  isAccelerating: false,
  projectedSellThrough: 0.375,
  isReliable: true,
  resetDetected: false,
};

test("competition table shows only star-rated entries", () => {
  const output = formatCompetitionsTable([
    competition(),
    competition({ sourceId: "estimated", inventorySource: "estimated" }),
  ]);

  assert.match(output, /⭐/u);
  assert.match(output, /formatter-entry-1|£500 Cash/u);
  assert.doesNotMatch(output, /estimated/u);
  assert.doesNotMatch(output, /watch|consider|buy|pass|monitor/u);
});

test("competition table and summary use the supplied same-draw trend", () => {
  const candidate = competition({
    sourceId: "trend-entry",
    name: "Trend Candidate",
    maxTickets: 500,
    ticketsSold: 10,
    maxEntriesPerUser: 20,
  });
  const candidateTrend: TrendAnalysis = {
    ...trend,
    projectedSellThrough: 0.024,
  };
  const trends = new Map([[candidate, candidateTrend]]);

  assert.match(formatCompetitionsTable([candidate], trends), /Trend Candidate/u);
  assert.match(formatSummary([candidate], trends), /Best one to enter/u);
  assert.match(formatCompetitionsTable([candidate]), /No entries match/u);
  assert.doesNotMatch(formatSummary([candidate]), /Best one to enter/u);
});

test("entry table is terse and excludes zero-star rows", () => {
  const output = formatEntryTable([
    { comp: competition(), trend },
    { comp: competition({ sourceId: "estimated", inventorySource: "estimated" }), trend },
  ]);

  assert.match(output, /⭐⭐/u);
  assert.match(output, /10\s*[×x]\s*£1/u);
  assert.match(output, /62\.5%/u);
  assert.match(output, /EV/u);
  assert.doesNotMatch(output, /watch|consider|buy|pass|monitor/u);
});

test("alert formatter uses the supplied star recommendation", () => {
  const output = formatAlerts([{
    competition: competition(),
    recommendation: recommendation({ stars: 3 }),
    reason: "positive current and projected entry",
    priority: "high",
  }]);

  assert.match(output, /⭐⭐⭐/u);
  assert.match(output, /10\s*[×x]\s*£1/u);
  assert.doesNotMatch(output, /watch|consider|buy|pass|monitor|Codex|review/u);
});

test("scan summary names entries instead of monitoring", () => {
  const output = formatSummary([competition()]);

  assert.match(output, /worth entering/u);
  assert.match(output, /Best one to enter/u);
  assert.doesNotMatch(output, /watch|consider|buy|pass|monitor/u);
});

test("stale rows remain stored information without entry stars or a top pick", () => {
  const stale = competition({ name: "Old Cash Entry", scrapedAt: new Date(Date.now() - 60 * minute).toISOString() });
  const trends = new Map([[stale, trend]]);
  for (const output of [formatCompetitionsTable([stale], trends), formatEntryTable([{ comp: stale, trend }])]) {
    assert.match(output, /Stored information only/u);
    assert.match(output, /Old Cash Entry/u);
    assert.doesNotMatch(output, /⭐/u);
  }
  assert.doesNotMatch(formatSummary([stale], trends), /Best one to enter/u);
});
