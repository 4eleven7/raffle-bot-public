import test from "node:test";
import assert from "node:assert/strict";
import { calculateOptimalScenario, calculateScenario, enrichCompetition } from "../src/metrics/calculator.js";
import { gradeRaffle } from "../src/metrics/decision.js";
import { CONFIG } from "../src/config.js";
import type { RawCompetition } from "../src/types.js";

const hour = 60 * 60 * 1000;

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "comp-1",
    siteName: "example",
    url: "https://example.com/comp-1",
    name: "Example Competition",
    entryPrice: 10,
    ticketsSold: 100,
    maxTickets: 1000,
    inventorySource: "exact",
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "site",
    cashAlternative: 10_000,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: new Date(Date.now() + 12 * hour).toISOString(),
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("optimal ticket count is capped by configured spend, not rejected after valuation", () => {
  const comp = enrichCompetition(competition());

  assert.equal(comp.optimalTickets, 10);
  assert.equal(comp.optimalCost, 100);
  assert.equal(comp.netEV > 0, true);
  assert.notEqual(gradeRaffle(comp).reason, "stake > £100");
});

test("free-entry competitions do not produce a recommended stake", () => {
  const comp = enrichCompetition(competition({
    entryPrice: 0,
    ticketsSold: 18,
    maxTickets: 999,
    maxEntriesPerUser: 1,
    cashAlternative: 219,
    categories: ["free"],
  }));

  assert.equal(comp.optimalTickets, 0);
  assert.equal(comp.optimalCost, 0);
  assert.equal(comp.netEV, 0);
  assert.equal(comp.returnRatio, -Infinity);
  assert.equal(calculateScenario(comp, 1).returnRatio, Infinity);
});

test("estimated prize values drive EV when no cash alternative exists", () => {
  const comp = enrichCompetition(competition({
    cashAlternative: null,
    estimatedPrizeValue: 270,
    valuationSource: "manual_estimate",
    valuationConfidence: "medium",
    entryPrice: 0.98,
    ticketsSold: 56,
    maxTickets: 698,
    maxEntriesPerUser: 70,
  }));

  assert.equal(comp.prizeValue, 270);
  assert.equal(comp.optimalTickets > 0, true);
  assert.equal(comp.netEV > 0, true);
});

test("zero-sales paid raffles support a one-ticket scenario", () => {
  const comp = enrichCompetition(competition({
    ticketsSold: 0,
    maxTickets: 100,
    entryPrice: 1,
    cashAlternative: 100,
  }));

  assert.equal(comp.optimalTickets, 1);
  assert.equal(comp.optimalCost, 1);
  assert.equal(comp.winProbability, 1);
  assert.equal(comp.netEV, 99);
});

test("full-ticket-range draws include unsold numbers in the odds", () => {
  const raw = {
    ...competition({
      ticketsSold: 0,
      maxTickets: 75,
      maxEntriesPerUser: 8,
      entryPrice: 3.71,
      cashAlternative: 102,
    }),
    drawUsesFullTicketRange: true,
  };

  const oneTicket = calculateScenario(raw, 1);
  const comp = enrichCompetition(raw);

  assert.equal(oneTicket.winProbability, 1 / 75);
  assert.equal(oneTicket.expectedReturn, 102 / 75);
  assert.equal(oneTicket.netEV, 102 / 75 - 3.71);
  assert.equal(comp.optimalTickets, 0);
  assert.equal(comp.evPerTicket, 102 / 75 - 3.71);
  assert.equal(gradeRaffle(comp).stars, 0);

  const positive = enrichCompetition({
    ...raw,
    ticketsSold: 10,
    entryPrice: 1,
    cashAlternative: 300,
  });
  assert.equal(positive.optimalTickets, 8);
  assert.equal(positive.winProbability, 8 / 75);
  assert.equal(positive.netEV, 24);
});

test("integer stake optimization checks both sides of the continuous optimum", () => {
  const raw = competition({ ticketsSold: 1, entryPrice: 1, cashAlternative: 3 });
  assert.equal(calculateOptimalScenario(raw).tickets, 1);
  assert.equal(calculateOptimalScenario(raw).netEV, 0.5);

  const tied = competition({ ticketsSold: 1, entryPrice: 0.3, cashAlternative: 6 });
  assert.equal(calculateOptimalScenario(tied, 1, CONFIG.filters).tickets, 3);
});

test("unknown entry caps do not produce a multi-ticket optimal stake", () => {
  const raw = competition({ maxEntriesPerUserSource: "fallback" });
  assert.equal(calculateOptimalScenario(raw).tickets, 1);
});

test("entry stake maximizes draw-time EV among ticket counts that meet the risk limits", () => {
  const cases = [
    { ticketsSold: 10, maxTickets: 100, cashAlternative: 40, projectedSold: 10 },
    { ticketsSold: 3, maxTickets: 10, cashAlternative: 20, projectedSold: 4 },
    { ticketsSold: 0, maxTickets: 20, cashAlternative: 100, projectedSold: 5 },
    { ticketsSold: 2, maxTickets: 10, cashAlternative: 100, projectedSold: 10 },
    { ticketsSold: 3, maxTickets: 10, cashAlternative: 30, projectedSold: 10, drawUsesFullTicketRange: true },
  ];
  for (const { projectedSold, ...overrides } of cases) {
    const raw = competition({ entryPrice: 1, ...overrides });
    const valid = Array.from({ length: raw.maxTickets - raw.ticketsSold }, (_, i) => i + 1)
      .map((tickets) => calculateScenario({
        ...raw, ticketsSold: Math.min(projectedSold, raw.maxTickets - tickets),
      }, tickets))
      .filter((s) => s.cost <= CONFIG.filters.maxSpend &&
        s.winProbability >= CONFIG.filters.minWinProbability &&
        s.returnRatio >= CONFIG.filters.minReturnRatio && s.netEV > 0)
      .sort((a, b) => b.netEV - a.netEV || a.cost - b.cost);
    const actual = calculateOptimalScenario(raw, projectedSold, CONFIG.filters);
    assert.equal(actual.tickets, valid[0]?.tickets ?? 0, JSON.stringify(overrides));
  }
});

test("entry stake cannot bypass budget, exact operator cap, or projected return floor", () => {
  for (const overrides of [
    { maxEntriesPerUser: 14 },
    { entryPrice: 10, cashAlternative: 400 },
    { cashAlternative: 35 },
    { maxEntriesPerUserSource: "fallback" as const },
  ]) {
    const raw = competition({ entryPrice: 1, ticketsSold: 10, cashAlternative: 40, ...overrides });
    assert.equal(calculateOptimalScenario(raw, 10, CONFIG.filters).tickets, 0, JSON.stringify(overrides));
  }
});
