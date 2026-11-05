import test from "node:test";
import assert from "node:assert/strict";
import { parseCulchieDetail } from "../src/adapters/culchiecomps/culchiecomps-adapter.js";

test("Culchie parser reads agricultural prize economics and live draw date", () => {
  const competition = parseCulchieDetail(
    `
      <h1>Massey Ferguson 6290</h1>
      <h2 class="comp-price">Sale! - £9.97</h2>
      <p>28% 1,730 / 5,999 Tickets Sold</p>
      <li>Ticket Price: £9.97</li>
      <li>Maximum Entries: 5,999</li>
      <li>Live Draw: Sunday 23rd August 2099 @ 9:30pm</li>
      <p>Free Entry Route Available</p>
    `,
    "https://culchiecomps.com/competition/massey-ferguson-6290-1",
    new Date("2099-08-01T12:00:00Z"),
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "massey-ferguson-6290-1");
  assert.equal(competition.entryPrice, 9.97);
  assert.equal(competition.ticketsSold, 1730);
  assert.equal(competition.maxTickets, 5999);
  assert.equal(competition.maxEntriesPerUser, 100);
  assert.equal(competition.estimatedPrizeValue, 15000);
  assert.equal(competition.drawDate, "2099-08-23T20:30:00.000Z");
});

test("Culchie parser reads an explicit cash prize", () => {
  const competition = parseCulchieDetail(
    `
      <h1>£2,000 Cash</h1>
      <div class="comp-price">£2.99</div>
      <p>5% 114 / 1,999 Tickets Sold</p>
      <li>Ticket Price: £2.99</li>
      <li>Maximum Entries: 1,999</li>
      <li>Live Draw: Sunday 23rd August 2099 @ 9:30pm</li>
    `,
    "https://culchiecomps.com/competition/2-000-cash",
    new Date("2099-08-01T12:00:00Z"),
  );

  assert.ok(competition);
  assert.equal(competition.cashAlternative, 2000);
  assert.equal(competition.estimatedPrizeValue, null);
  assert.equal(competition.valuationSource, "cash");
});
