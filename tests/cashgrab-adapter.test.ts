import test from "node:test";
import assert from "node:assert/strict";
import { toCompetition } from "../src/adapters/cashgrab/cashgrab-adapter.js";

const NOW = new Date("2026-11-05T09:45:00.000Z");

const base = {
  id: "cash-1",
  slug: "1-000-tax-free-cash",
  title: "£1,000 Tax Free Cash",
  description: "£1k tax free cash paid straight into your bank account.",
  ticket_price: 1,
  sale_price: null,
  max_entries: 2500,
  entries_sold: 67,
  max_entries_per_user: 499,
  draw_date: "2026-11-15T18:30:00+00:00",
  category: "cash",
  status: "active",
  is_free: false,
  cash_alternative_enabled: false,
  cash_alternative_value: 0,
};

test("Cash Grab maps exact public economics and a cash prize", () => {
  const competition = toCompetition(base, NOW, "2026-11-05T09:45:00.000Z");

  assert.deepEqual(competition, {
    sourceId: "cash-1",
    siteName: "cashgrabcompetitions",
    url: "https://cashgrabcompetitions.co.uk/competition/1-000-tax-free-cash",
    name: "£1,000 Tax Free Cash",
    entryPrice: 1,
    ticketsSold: 67,
    maxTickets: 2500,
    inventorySource: "exact",
    maxEntriesPerUser: 499,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1000,
    estimatedPrizeValue: 1000,
    valuationSource: "cash",
    valuationConfidence: "high",
    valuationNotes: "Cash Grab public competition record states the cash prize or alternative",
    drawDate: "2026-11-15T18:30:00.000Z",
    isAutoDraw: false,
    categories: ["cash"],
    scrapedAt: "2026-11-05T09:45:00.000Z",
  });
});

test("Cash Grab maps a cash alternative and rejects free or mixed rows", () => {
  const physical = toCompetition({
    ...base,
    id: "ps5-1",
    slug: "ps5-slim-console-disc-edition",
    title: "PS5 Slim Console — Disc Edition",
    description: "Or take £400 as a cash alternative.",
    ticket_price: 1.25,
    max_entries: 1500,
    entries_sold: 13,
    max_entries_per_user: 399,
    cash_alternative_enabled: true,
    cash_alternative_value: 400,
  }, NOW);
  assert.equal(physical?.cashAlternative, 400);
  assert.equal(physical?.estimatedPrizeValue, 400);

  assert.equal(toCompetition({ ...base, is_free: true }, NOW), null);
  assert.equal(toCompetition({
    ...base,
    description: "£15,000 in total prizes plus instant wins.",
  }, NOW), null);
  assert.equal(toCompetition({ ...base, draw_date: "2026-11-05T09:44:59.000Z" }, NOW), null);
});
