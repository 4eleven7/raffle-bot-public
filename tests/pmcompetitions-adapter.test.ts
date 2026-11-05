import test from "node:test";
import assert from "node:assert/strict";
import { parsePMCompetition } from "../src/adapters/pmcompetitions/pmcompetitions-adapter.js";

test("PM Competitions parser reads public API economics", () => {
  const competition = parsePMCompetition({
    id: "test-id",
    name: "£500 cash!",
    slug: "500-cash",
    status: "active",
    ticket_price: 5,
    total_tickets: 200,
    tickets_sold: 11,
    draw_date: "2099-07-31T19:00:00+00:00",
    prize_value: 500,
    cash_alternative: null,
    is_instant_win: false,
    max_tickets_per_order: 100,
  });

  assert.ok(competition);
  assert.equal(competition.sourceId, "500-cash");
  assert.equal(competition.entryPrice, 5);
  assert.equal(competition.ticketsSold, 11);
  assert.equal(competition.maxTickets, 200);
  assert.equal(competition.maxEntriesPerUserSource, "site");
  assert.equal(competition.cashAlternative, 500);
  assert.equal(competition.drawDate, "2099-07-31T19:00:00.000Z");

  const fallbackCap = parsePMCompetition({
    id: "fallback-id",
    name: "Fallback cap",
    slug: "fallback-cap",
    status: "active",
    ticket_price: 1,
    total_tickets: 100,
    tickets_sold: 1,
    draw_date: "2099-07-31T19:00:00+00:00",
  });
  assert.equal(fallbackCap?.maxEntriesPerUser, 100);
  assert.equal(fallbackCap?.maxEntriesPerUserSource, "fallback");
});
