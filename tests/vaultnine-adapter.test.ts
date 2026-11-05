import assert from "node:assert/strict";
import test from "node:test";
import { VaultNineAdapter, toCompetition } from "../src/adapters/vaultnine/vaultnine-adapter.js";

const NOW = new Date("2026-08-27T08:40:00.000Z");

test("VaultNine maps sale price, exact inventory, cash alternative, and draw date", () => {
  const competition = toCompetition({
    id: "a603870c-e3cd-4ad3-9b4a-7025f4716318",
    title: "Target Omni Autoscoring System",
    slug: "target-omni-autoscoring-system-copy-9",
    ticket_price: 0.25,
    sale_price: 0.2,
    max_entries: 4999,
    entries_sold: 228,
    draw_date: "2026-08-30T20:30:00+00:00",
    status: "active",
    is_free: false,
    competition_type: "standard",
    is_instant_win: false,
    max_entries_per_user: null,
    cash_alternative_value: 350,
    cash_alternative_enabled: true,
    draws_on_sellout: false,
  }, NOW);

  assert.deepEqual(competition && {
    sourceId: competition.sourceId,
    url: competition.url,
    entryPrice: competition.entryPrice,
    ticketsSold: competition.ticketsSold,
    maxTickets: competition.maxTickets,
    inventorySource: competition.inventorySource,
    maxEntriesPerUser: competition.maxEntriesPerUser,
    maxEntriesPerUserSource: competition.maxEntriesPerUserSource,
    cashAlternative: competition.cashAlternative,
    valuationSource: competition.valuationSource,
    valuationConfidence: competition.valuationConfidence,
    drawDate: competition.drawDate,
  }, {
    sourceId: "a603870c-e3cd-4ad3-9b4a-7025f4716318",
    url: "https://vaultninecompetitions.co.uk/competition/target-omni-autoscoring-system-copy-9",
    entryPrice: 0.2,
    ticketsSold: 228,
    maxTickets: 4999,
    inventorySource: "exact",
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: 350,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: "2026-08-30T20:30:00.000Z",
  });
});

test("VaultNine rejects free, instant-win, sold-out, and stale rows", () => {
  const base = {
    id: "row",
    title: "Row",
    slug: "row",
    ticket_price: 1,
    sale_price: null,
    max_entries: 100,
    entries_sold: 10,
    draw_date: "2026-08-30T20:30:00+00:00",
    status: "active",
    is_free: false,
    competition_type: "standard",
    is_instant_win: false,
    max_entries_per_user: null,
    cash_alternative_value: null,
    cash_alternative_enabled: false,
    draws_on_sellout: false,
  };

  assert.equal(toCompetition({ ...base, is_free: true }, NOW), null);
  assert.equal(toCompetition({ ...base, is_instant_win: true }, NOW), null);
  assert.equal(toCompetition({ ...base, entries_sold: 100 }, NOW), null);
  assert.equal(toCompetition({ ...base, draw_date: "2026-08-27T08:39:00+00:00" }, NOW), null);
});

test("VaultNine adapter reads active rows from its public API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([{
    id: "current",
    title: "Current Prize",
    slug: "current-prize",
    ticket_price: 1,
    sale_price: 0.75,
    max_entries: 100,
    entries_sold: 10,
    draw_date: "2099-08-30T20:30:00+00:00",
    status: "active",
    is_free: false,
    competition_type: "standard",
    is_instant_win: false,
    max_entries_per_user: 25,
    cash_alternative_value: 100,
    cash_alternative_enabled: true,
    draws_on_sellout: false,
  }]);

  try {
    const competitions = await new VaultNineAdapter().fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "current");
    assert.equal(competitions[0]?.entryPrice, 0.75);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
