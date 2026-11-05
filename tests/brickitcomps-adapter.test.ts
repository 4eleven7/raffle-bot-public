import test from "node:test";
import assert from "node:assert/strict";
import { parseBrickitDetail } from "../src/adapters/brickitcomps/brickitcomps-adapter.js";

test("Brickit parser reads machine-readable draw time and ticket economics", () => {
  const competition = parseBrickitDetail(
    `
      <h1>merchant boat 910046 bricklink</h1>
      <div class="comp-price">Sale! - £1.50</div>
      <div data-draw-time="2099-08-14T22:00:00+01:00"></div>
      <span>375</span> tickets
      <p>21% Sold ( 79 / 375 )</p>
      <p>Ticket sales close TODAY 22:00 - the draw will take place 30 minutes later.</p>
      <p>Free Postal Entry</p>
    `,
    "https://brickitcomps.co.uk/prizes/merchant-boat-910046-bricklink",
    new Date("2099-08-01T12:00:00Z"),
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "merchant-boat-910046-bricklink");
  assert.equal(competition.entryPrice, 1.5);
  assert.equal(competition.ticketsSold, 79);
  assert.equal(competition.maxTickets, 375);
  assert.equal(competition.estimatedPrizeValue, 160);
  assert.equal(competition.valuationSource, "manual_estimate");
  assert.equal(competition.drawDate, "2099-08-14T21:00:00.000Z");
});

test("Brickit parser rejects instant or expired detail pages", () => {
  const competition = parseBrickitDetail(
    `
      <h1>Instant Hogwarts Castle VIP Draw</h1>
      <div class="comp-price">£1.99</div>
      <div data-draw-time="2099-08-14T22:00:00+01:00"></div>
      <p>( 10 / 100 )</p>
    `,
    "https://brickitcomps.co.uk/prizes/instant-hogwarts-castle-vip-draw",
    new Date("2099-08-01T12:00:00Z"),
  );

  assert.equal(competition, null);
});
