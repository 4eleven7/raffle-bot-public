import test from "node:test";
import assert from "node:assert/strict";
import { parseMentalMoneyDetail } from "../src/adapters/mentalmoney/mentalmoney-adapter.js";

test("Mental Money parser reads closing date and sold ticket count", () => {
  const competition = parseMentalMoneyDetail(
    `
      <h1>Win a Harley-Davidson FXDR</h1>
      <div class="price"><h3>£2.50</h3></div>
      <p>Max 600 per person</p>
      <p>Tickets sold: 7069 /15000</p>
      <p>The closing date for this competition is 16/08/2099 unless all tickets are sold beforehand.</p>
    `,
    "https://www.mentalmoney.com/competitions/win-a-harley-davidson-fxdr",
    new Date("2099-08-01T12:00:00Z"),
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "win-a-harley-davidson-fxdr");
  assert.equal(competition.entryPrice, 2.5);
  assert.equal(competition.ticketsSold, 7069);
  assert.equal(competition.maxTickets, 15000);
  assert.equal(competition.maxEntriesPerUser, 600);
  assert.equal(competition.estimatedPrizeValue, 10000);
  assert.match(competition.drawDate ?? "", /^2099-08-16T22:59:59\.000Z$/);
});

test("Mental Money parser rejects a closed competition", () => {
  const competition = parseMentalMoneyDetail(
    `
      <h1>Closed prize</h1>
      <div class="price">£1.00</div>
      <p>Tickets sold: 1 / 100</p>
      <p>The closing date for this competition is 16/08/2020.</p>
    `,
    "https://www.mentalmoney.com/competitions/closed-prize",
    new Date("2026-08-14T12:00:00Z"),
  );

  assert.equal(competition, null);
});
