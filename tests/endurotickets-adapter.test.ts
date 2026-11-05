import assert from "node:assert/strict";
import test from "node:test";
import { parseRaffle } from "../src/adapters/endurotickets/endurotickets-adapter.js";

test("Enduro Tickets parser reads the public raffle record", () => {
  const competition = parseRaffle(
    {
      id: "febb53bc-86ae-4712-b288-7f234cc1da90",
      slug: "win-an-m2r-racing-dirt-bike-loads-of-instant-wins-cash-1400",
      title: "Win an M2R Racing Dirt Bike + Loads of Instant Wins! CASH £1400",
      ticket_price: 20,
      total_tickets: 250,
      tickets_sold: 2,
      draw_date: "2026-09-30T17:14:00+00:00",
      status: "active",
    },
    "2026-07-22T09:00:00.000Z",
  );

  assert.ok(competition);
  assert.equal(competition.entryPrice, 20);
  assert.equal(competition.ticketsSold, 2);
  assert.equal(competition.maxTickets, 250);
  assert.equal(competition.cashAlternative, 1400);
  assert.equal(competition.drawDate, "2026-09-30T17:14:00.000Z");
});
