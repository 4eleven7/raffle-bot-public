import test from "node:test";
import assert from "node:assert/strict";
import { parseHorsepowerRaffles } from "../src/adapters/horsepower/horsepower-adapter.js";

test("Horse Power parser reads the live Next Flight raffle payload", () => {
  const decoded = `6:["$","$L13",null,{"initialRaffles":${JSON.stringify([
    {
      id: "cash-id",
      title: "£200 Cash Prize",
      slug: "200-cash-prize",
      description: "Win £200 in cash, paid directly to your bank account.",
      prizeValue: null,
      cashAlternative: null,
      ticketPrice: 25,
      totalTickets: 1600,
      ticketsSold: 92,
      drawDate: "2026-10-01T00:02:47.737Z",
      category: "cash",
      status: "live",
      maxPerPerson: 200,
      instaWin: false,
    },
    {
      id: "draft-id",
      title: "Draft row",
      slug: "draft-row",
      ticketPrice: 25,
      totalTickets: 100,
      ticketsSold: 0,
      drawDate: "2026-10-01T00:00:00.000Z",
      status: "draft",
    },
  ])}}]`;
  const html = `<script>self.__next_f.push([1,${JSON.stringify(decoded)}])</script>`;

  const [competition] = parseHorsepowerRaffles(html, new Date("2026-09-22T09:00:00.000Z"));
  assert.ok(competition);
  assert.equal(competition.sourceId, "cash-id");
  assert.equal(competition.entryPrice, 0.25);
  assert.equal(competition.ticketsSold, 92);
  assert.equal(competition.maxTickets, 1600);
  assert.equal(competition.maxEntriesPerUser, 200);
  assert.equal(competition.cashAlternative, 200);
  assert.equal(competition.estimatedPrizeValue, 200);
  assert.equal(competition.drawDate, "2026-10-01T00:02:47.737Z");
  assert.equal(competition.inventorySource, "exact");
});
