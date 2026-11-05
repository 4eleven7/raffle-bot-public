import assert from "node:assert/strict";
import test from "node:test";
import { triageRows, registeredSitesForHost, candidateQueue } from "../src/cli/site-discovery.js";
import type { RawCompetition } from "../src/types.js";

const now = new Date("2026-09-10T12:00:00Z");
const raw: RawCompetition = {
  sourceId: "potential", siteName: "example", url: "https://example.test/draw",
  name: "£500 cash", entryPrice: 1, ticketsSold: 20, maxTickets: 1000,
  inventorySource: "exact", maxEntriesPerUser: 100, maxEntriesPerUserSource: "site",
  cashAlternative: 500, valuationSource: "cash", valuationConfidence: "high",
  drawDate: "2026-09-20T20:00:00Z", scrapedAt: now.toISOString(),
  isAutoDraw: false, categories: ["cash"],
};

test("discovery potential is an explicit upper bound, never a live recommendation", () => {
  const { rows: [row], policy } = triageRows([raw], now);
  assert.equal(row.current.recommendation.stars, 0);
  assert.equal(row.potential.recommendation.stars, 1);
  assert.equal(row.potential.observedAt, "2026-09-19T21:00:00.000Z");
  assert.equal(row.potential.assumption, "no further ticket sales");
  assert.equal(row.potential.recommendation.currentScenario.winProbability, 0.8);
  assert.ok(row.potential.score! > 0);
  assert.equal(policy.minWinProbability, 0.6);
  const nearClose = triageRows([{ ...raw, drawDate: "2026-09-10T12:30:00Z" }], now).rows[0];
  assert.equal(nearClose.current.recommendation.stars, 0, "live full-sell-through gate must remain strict");
  assert.equal(nearClose.potential.recommendation.stars, 1);
});

test("potential preserves exact inventory, cap, prize, full-range and closed-draw gates", () => {
  for (const overrides of [
    { inventorySource: "estimated" }, { maxEntriesPerUserSource: "fallback" },
    { valuationConfidence: "low" }, { drawUsesFullTicketRange: true },
    { drawDate: now.toISOString() }, { ticketsSold: 1000 }, { ticketsSold: 20.5 },
  ]) {
    const row = triageRows([{ ...raw, ...overrides }], now).rows[0];
    assert.equal(row.potential.recommendation.stars, 0, JSON.stringify(overrides));
    assert.equal(row.potential.score, null);
  }
});

test("triage rejects malformed input and keeps stale current inventory labelled", () => {
  assert.throws(() => triageRows({}, now), /array/);
  assert.throws(() => triageRows([null], now), /row 1/);
  assert.throws(() => triageRows([{ ...raw, entryPrice: -1 }], now), /entryPrice/);
  assert.throws(() => triageRows([{ ...raw, categories: [null] }], now), /categories/);
  const row = triageRows([{ ...raw, scrapedAt: "2026-09-09T12:00:00Z" }], now).rows[0];
  assert.equal(row.current.freshInventory, false);
});

test("operator preflight recognises 2JS and custom adapters before onboarding", () => {
  assert.equal(registeredSitesForHost("HTTPS://WWW.2JSCOMPETITIONS.COM.:443/product/cash")[0]?.siteName, "twojs");
  assert.equal(registeredSitesForHost("vaultninecompetitions.co.uk")[0]?.siteName, "vaultnine");
  assert.equal(registeredSitesForHost("cashcitydraws.co.uk")[0]?.siteName, "cashcity");
  assert.deepEqual(registeredSitesForHost("unregistered.example"), []);
});

test("due queues exclude completed and registered discovery work but retain health repairs", () => {
  const ledger = `| operator_host | decision | recheck_on |
| --- | --- | --- |
| candidate.example | defer | 2026-09-10 |
| pending.example | add-direct | - |
| future.example | defer | 2026-09-11 |
| finished.example | complete | - |
| repeated.example | duplicate | 2026-09-10 |
| rejected.example | reject | - |
| vaultninecompetitions.co.uk | add-custom | 2026-09-10 |
| cashcitydraws.co.uk | health-debug-first | 2026-09-10 |`;
  const londonMidnight = new Date("2026-09-09T23:05:00Z");
  const discovery = candidateQueue(ledger, false, londonMidnight);
  assert.deepEqual(discovery.map((row) => row.operator_host), ["candidate.example", "pending.example"]);
  assert.equal(discovery[1].decision, "defer", "queued add decisions must pass fresh triage");
  assert.deepEqual(candidateQueue(ledger, true, londonMidnight).map((row) => row.registeredSite), ["cashcity", "vaultnine"]);
  assert.throws(() => candidateQueue(ledger.replace("2026-09-10", "2026-09-31"), false, now), /invalid recheck_on/);
});
