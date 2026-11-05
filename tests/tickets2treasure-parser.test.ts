import assert from "node:assert/strict";
import test from "node:test";
import { enrichCompetitionFromDetail } from "../src/adapters/wclottery/wclottery-parser.js";

test("Tickets 2 Treasure detail text provides sold and limited ticket counts", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "win-500",
      siteName: "tickets2treasure",
      url: "https://www.tickets2treasure.com/product/win-500/",
      name: "Win £500 with Tickets 2 Treasure!",
      entryPrice: 0,
      ticketsSold: 20,
      maxTickets: 100,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: "2026-08-22T00:00:00.000Z",
    },
    `
      <article class="product">
        <h1>Win £500 with Tickets 2 Treasure!</h1>
        <p class="price">£0.49</p>
        <p>Competition ends: 07/07/2027 11:59 pm</p>
        <p>This Competition is limited to 2500 tickets</p>
        <p>Tickets sold: 515</p>
      </article>
    `,
  );

  assert.equal(competition.entryPrice, 0.49);
  assert.equal(competition.ticketsSold, 515);
  assert.equal(competition.maxTickets, 2500);
  assert.equal(competition.drawDate, "2027-07-07T22:59:00.000Z");
});

test("Tickets 2 Treasure detail text preserves explicit free-entry provenance", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "win-100",
      siteName: "tickets2treasure",
      url: "https://www.tickets2treasure.com/product/win-100/",
      name: "Win £100",
      entryPrice: 0,
      ticketsSold: 115,
      maxTickets: 10000,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: "2027-07-07T22:59:00.000Z",
      isAutoDraw: false,
      categories: ["55", "competition"],
      scrapedAt: "2026-08-22T00:00:00.000Z",
    },
    `
      <article class="product">
        <h1>Win £100</h1>
        <p class="price">£0.00 <span>free</span></p>
        <p>There is always a free entry option by post.</p>
        <p>This Competition is limited to 10000 tickets</p>
        <p>Tickets sold: 115</p>
      </article>
    `,
  );

  assert.equal(competition.entryPrice, 0);
  assert.ok(competition.categories.includes("free"));
});
