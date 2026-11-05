import assert from "node:assert/strict";
import test from "node:test";
import { determineNextScan } from "../src/monitor/monitor.js";
import { enrichCompetition } from "../src/metrics/calculator.js";
import { gradeRaffle, gradeHighChanceRaffle } from "../src/metrics/decision.js";
import { analyzeTrendSnapshots } from "../src/metrics/trends.js";
import type { Competition } from "../src/types.js";

const minute = 60_000;
const hour = 60 * minute;
type AnyModule = Record<string, any>;

function competition(overrides: Record<string, unknown> = {}): Competition {
  const timeToClose = typeof overrides.timeToClose === "number" && Number.isFinite(overrides.timeToClose)
    ? overrides.timeToClose
    : 50 * minute;
  return {
    sourceId: "entry-policy-1",
    siteName: "example",
    url: "https://example.test/entry-policy-1?utm_source=test",
    name: "£500 Cash",
    entryPrice: 1,
    ticketsSold: 3,
    maxTickets: 100,
    maxEntriesPerUser: 10,
    maxEntriesPerUserSource: "site",
    inventorySource: "exact",
    cashAlternative: 500,
    estimatedPrizeValue: null,
    valuationSource: "cash",
    valuationConfidence: "high",
    valuationNotes: "Explicit cash alternative",
    drawDate: new Date(Date.now() + timeToClose).toISOString(),
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
    prizeValue: 500,
    evPerTicket: 100,
    optimalTickets: 10,
    optimalCost: 10,
    winProbability: 0.25,
    lossProbability: 0.75,
    expectedReturn: 125,
    netEV: 115,
    returnRatio: 11.5,
    houseEdge: -99,
    sellThrough: 0.03,
    timeToClose,
    ...overrides,
  } as unknown as Competition;
}

function trend(overrides: Record<string, unknown> = {}) {
  return {
    dataPoints: 3,
    velocityPerHour: 1,
    estimatedSelloutMs: null,
    isAccelerating: false,
    projectedSellThrough: 0.06,
    isReliable: true,
    resetDetected: false,
    ...overrides,
  };
}

async function decisionApi(): Promise<AnyModule> {
  return await import("../src/metrics/decision.js") as unknown as AnyModule;
}

async function alertApi(): Promise<AnyModule> {
  return await import("../src/alerts/alerts.js") as unknown as AnyModule;
}

function requiredFunction(
  module: AnyModule,
  name: string,
): (...args: any[]) => any {
  assert.equal(typeof module[name], "function", `missing public function ${name}`);
  return module[name] as (...args: any[]) => any;
}

test("gradeRaffle gives two stars to an exact, reliable, positive entry", async () => {
  const gradeRaffle = requiredFunction(await decisionApi(), "gradeRaffle");
  const recommendation = gradeRaffle(competition(), trend());

  assert.equal(recommendation.stars, 2);
  assert.equal(recommendation.projectedSellThrough, 0.06);
  assert.ok(recommendation.currentScenario.netEV > 0);
  assert.ok(recommendation.projectedScenario?.netEV > 0);
});

test("an integer sales forecast does not gain a ticket during percentage conversion", () => {
  const comp = competition({ ticketsSold: 7, maxEntriesPerUser: 11, cashAlternative: 40 });
  const forecast = analyzeTrendSnapshots(comp, [20, 10].map((minutes, id) => ({
    id, sourceId: comp.sourceId, siteName: comp.siteName, ticketsSold: 7,
    maxTickets: 100, drawDate: comp.drawDate, inventorySource: "exact" as const,
    scrapedAt: new Date(Date.parse(comp.scrapedAt) - minutes * minute).toISOString(),
  })));
  const result = gradeRaffle(comp, forecast);
  assert.equal(forecast.projectedTicketsSold, 7);
  assert.equal(result.stars, 2);
  assert.equal(result.currentScenario.tickets, 11);
  assert.equal(result.projectedScenario?.winProbability, 11 / 18);
});

test("gradeRaffle gives three stars only when projected win and return clear their boundaries", async () => {
  const gradeRaffle = requiredFunction(await decisionApi(), "gradeRaffle");
  const recommendation = gradeRaffle(
    competition({ winProbability: 0.7, lossProbability: 0.3 }),
    trend({ projectedSellThrough: 0.05 }),
  );

  assert.equal(recommendation.stars, 3);
  assert.ok((recommendation.projectedScenario?.winProbability ?? 0) >= 0.65);
  assert.ok((recommendation.projectedScenario?.returnRatio ?? 0) >= 1.5);
});

test("gradeRaffle gives one star and one ticket when the cap is unverified", async () => {
  const gradeRaffle = requiredFunction(await decisionApi(), "gradeRaffle");
  const recommendation = gradeRaffle(
    competition({ ticketsSold: 0, maxTickets: 1, maxEntriesPerUserSource: "fallback" }),
    null,
  );

  assert.equal(recommendation.stars, 1);
  assert.equal(recommendation.currentScenario.tickets, 1);
  assert.equal(recommendation.projectedScenario?.tickets, 1);
  assert.equal(recommendation.projectedSellThrough, 1);
});

test("gradeRaffle gives one star without a trend only when full sell-through passes", async () => {
  const gradeRaffle = requiredFunction(await decisionApi(), "gradeRaffle");
  for (const suppliedTrend of [null, trend({ isReliable: false })]) {
    const recommendation = gradeRaffle(competition({ maxTickets: 10 }), suppliedTrend);
    assert.equal(recommendation.stars, 1);
    assert.equal(recommendation.projectedScenario?.winProbability, 0.7);
    assert.equal(recommendation.projectedSellThrough, 1);
  }
});

test("gradeRaffle has no prize floor and allows a normal physical product bundle", async () => {
  const gradeRaffle = requiredFunction(await decisionApi(), "gradeRaffle");
  const lowValue = gradeRaffle(
    competition({
      name: "£25 Camera Bundle",
      cashAlternative: 25,
      prizeValue: 25,
      evPerTicket: 5,
      expectedReturn: 6.25,
      netEV: 5.25,
      returnRatio: 5.25,
    }),
    trend({ projectedSellThrough: 0.04 }),
  );
  const physicalBundle = gradeRaffle(
    competition({ name: "Camera and lens bundle" }),
    trend(),
  );

  assert.ok(lowValue.stars > 0);
  assert.ok(physicalBundle.stars > 0);
});

test("a five percent value entry receives one star within its own budget", async () => {
  const gradeRaffle = requiredFunction(await decisionApi(), "gradeRaffle");
  const recommendation = gradeRaffle(
    competition({
      ticketsSold: 95,
      maxEntriesPerUser: 5,
      winProbability: 0.05,
      lossProbability: 0.95,
      netEV: 100,
      returnRatio: 3,
    }),
    trend({ projectedSellThrough: 0.95 }),
  );

  assert.equal(recommendation.stars, 1);
  assert.equal(recommendation.category, "value");
  assert.equal(recommendation.projectedScenario.winProbability, 0.05);
  assert.ok(recommendation.currentScenario.cost <= 20);
});

test("free-only, entry-bundle, site-credit, random-allocation, and instant multi-prize shapes get zero stars", async () => {
  const gradeRaffle = requiredFunction(await decisionApi(), "gradeRaffle");
  const cases = [
    competition({ entryPrice: 0, categories: ["free"] }),
    competition({ name: "Win 10 entries into the £10,000 cash draw" }),
    competition({ name: "£100 Site Credit" }),
    competition({ categories: ["random-ticket-allocation"] }),
    competition({ name: "£10,000 instant win prize pot" }),
  ];

  for (const candidate of cases) {
    assert.equal(gradeRaffle(candidate, trend()).stars, 0, candidate.name);
  }
});

test("checkAlerts returns one immutable entry recommendation through the full 60-minute window", async () => {
  const checkAlerts = requiredFunction(await alertApi(), "checkAlerts");
  for (const timeToClose of [50 * minute, 5 * minute]) {
    const alerts = checkAlerts(competition({ timeToClose }), trend());
    assert.equal(alerts.length, 1);
    assert.ok(alerts[0]?.recommendation);
    assert.ok(Object.isFrozen(alerts[0]?.recommendation));
    assert.ok((alerts[0]?.recommendation.stars ?? 0) > 0);
  }

  assert.equal(
    checkAlerts(competition({ timeToClose: 61 * minute }), trend()).length,
    0,
  );
});

test("known draw scheduling cannot wait past the draw-minus-60-minute entry deadline", () => {
  const now = Date.parse("2026-08-26T12:00:00.000Z");
  const drawIn = 61 * minute;
  const decision = determineNextScan(
    [competition({
      timeToClose: drawIn,
      drawDate: new Date(now + drawIn).toISOString(),
    })],
    2 * hour,
    now,
  );

  assert.ok(
    decision.intervalMs <= minute,
    `next scan interval ${decision.intervalMs}ms skips the entry deadline`,
  );
});

test("60 percent loss qualifies only for a small-stake value entry", () => {
  const comp = enrichCompetition(competition({ ticketsSold: 15, maxEntriesPerUser: 10 }));
  assert.equal(comp.lossProbability, 0.6);
  const forecast=trend({ projectedSellThrough: 0.15 });
  assert.equal(gradeHighChanceRaffle(comp, forecast).stars, 0);
  const rec=gradeRaffle(comp,forecast);
  assert.equal(rec.stars,1);
  assert.equal(rec.category,"value");
  assert.equal(rec.currentScenario.cost,10);
});

test("the 60 percent win boundary passes using the same stake at the draw", () => {
  const comp = enrichCompetition(competition({ ticketsSold: 2, maxEntriesPerUser: 3 }));
  const rec = gradeRaffle(comp, trend({ projectedSellThrough: 0.02 }));
  assert.equal(rec.stars, 2);
  assert.equal(rec.currentScenario.winProbability, 0.6);
  assert.equal(rec.projectedScenario?.winProbability, 0.6);
});

test("grading selects a permitted risk-compliant stake instead of rejecting the EV optimum", () => {
  const comp = enrichCompetition(competition({ ticketsSold: 10, maxEntriesPerUser: 100, cashAlternative: 40 }));
  assert.equal(comp.optimalTickets, 10);
  const rec = gradeRaffle(comp, trend({ projectedSellThrough: 0.1 }));
  assert.equal(rec.stars, 2);
  assert.equal(rec.currentScenario.tickets, 15);
  assert.equal(rec.projectedScenario?.tickets, 15);
  assert.equal(rec.projectedScenario?.winProbability, 0.6);
  assert.equal(rec.projectedScenario?.netEV, 9);
});

test("a purchase made now remains available in a projected sellout", () => {
  const comp = enrichCompetition(competition({ ticketsSold: 2, maxTickets: 10, maxEntriesPerUser: 8 }));
  const rec = gradeRaffle(comp, trend({ projectedSellThrough: 1, estimatedSelloutMs: minute }));
  assert.ok(rec.stars > 0);
  assert.equal(rec.projectedScenario?.tickets, 8);
  assert.equal(rec.projectedScenario?.winProbability, 0.8);
});

test("a failed draw-time forecast cannot fall back to current odds", () => {
  const comp = enrichCompetition(competition({ maxTickets: 500 }));
  for (const forecast of [
    trend({ projectedSellThrough: 0.5 }),
    trend({ projectedSellThrough: 1, estimatedSelloutMs: minute }),
  ]) {
    assert.equal(gradeRaffle(comp, forecast).stars, 0);
  }
});

test("without sales history, an entry must pass at full sell-through", () => {
  const comp = enrichCompetition(competition({ ticketsSold: 0, maxTickets: 500 }));
  assert.equal(comp.winProbability, 1);
  assert.equal(gradeRaffle(comp).stars, 0);
});

test("current and projected odds use the same tickets that can be bought now", () => {
  const comp = enrichCompetition(competition({ ticketsSold: 1, cashAlternative: 20 }));
  const rec = gradeRaffle(comp, trend({ projectedSellThrough: 0.02 }));
  assert.ok(rec.stars > 0);
  assert.equal(rec.currentScenario.tickets, rec.projectedScenario?.tickets);
  assert.equal(rec.currentScenario.cost, rec.projectedScenario?.cost);
});

test("grading recalculates odds from raw counts instead of trusting stale metrics", () => {
  const comp = competition({ ticketsSold: 490, maxTickets: 500, winProbability: 0.99, netEV: 1000 });
  assert.equal(gradeRaffle(comp, trend({ projectedSellThrough: 0.9 })).stars, 0);
});

test("invalid economics and invalid forecasts cannot receive stars", () => {
  for (const overrides of [
    { entryPrice: NaN }, { ticketsSold: NaN }, { maxTickets: Infinity },
    { ticketsSold: 1.5 }, { maxEntriesPerUser: 0 }, { cashAlternative: Infinity },
    { drawDate: "invalid", timeToClose: NaN },
  ]) {
    assert.equal(gradeRaffle(competition(overrides), trend()).stars, 0, JSON.stringify(overrides));
  }
  for (const projectedSellThrough of [NaN, Infinity, -1, 1.1]) {
    assert.equal(gradeRaffle(enrichCompetition(competition()), trend({ projectedSellThrough })).stars, 0);
  }
});
