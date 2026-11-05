import test from "node:test";
import assert from "node:assert/strict";
import { parseCentralCompetition } from "../src/adapters/central/central-adapter.js";
import { enrichCompetitionFromDetail } from "../src/adapters/wclottery/wclottery-parser.js";

test("Central Competitions parser reads API economics", () => {
  const row = parseCentralCompetition({
    name: "£2,000 Tax Free Cash",
    maxTickets: 200,
    price: 20,
    remaining: 132,
    drawDateISO: "2026-07-24T18:00:00.000Z",
    desc: "<p>Win £2,000 Tax Free Cash</p>",
  });

  assert.ok(row);
  assert.equal(row.siteName, "centralcompetitions");
  assert.equal(row.entryPrice, 20);
  assert.equal(row.ticketsSold, 68);
  assert.equal(row.maxTickets, 200);
  assert.equal(row.cashAlternative, 2000);
  assert.equal(row.drawDate, "2026-07-24T18:00:00.000Z");
});

test("WC Lottery detail enrichment handles percent plus sold-total ticket text", () => {
  const row = enrichCompetitionFromDetail(
    {
      sourceId: "32837",
      siteName: "competitionbros",
      url: "https://competitionbros.com/product/1000-for-15p-2/",
      name: "£1,000 for 15p - 12th July",
      entryPrice: 0.15,
      ticketsSold: 2,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: "2026-07-08T00:00:00.000Z",
    },
    `
      <body>
        <h1>£1,000 for 15p - 12th July</h1>
        TICKETS SOLD: 2% (824/36995)
        36995 TOTAL ENTRIES
        £0.15 PER ENTRY
        700 MAX PER PERSON
        Draw Sun 12th Jul
      </body>
    `,
  );

  assert.equal(row.ticketsSold, 824);
  assert.equal(row.maxTickets, 36995);
  assert.equal(row.cashAlternative, 1000);
});

test("WC Lottery detail enrichment replaces price-only card titles", () => {
  const row = enrichCompetitionFromDetail(
    {
      sourceId: "4442",
      siteName: "unleashed",
      url: "https://unleashed-competitions.com/product/100-tax-free-cash-profits-donated-to-grassroots-football/",
      name: "£1.00",
      entryPrice: 1,
      ticketsSold: 6,
      maxTickets: 1000,
      maxEntriesPerUser: 100,
      cashAlternative: 100,
      drawDate: "2026-08-02T18:00:00.000Z",
      isAutoDraw: false,
      categories: [],
      scrapedAt: "2026-07-08T00:00:00.000Z",
    },
    `
      <body>
        <h1>£100 Tax Free Cash (Profits Donated to Grassroots Football)</h1>
        TICKETS SOLD: 1% (6/1000)
        £1.00 PER ENTRY
      </body>
    `,
  );

  assert.equal(row.name, "£100 Tax Free Cash (Profits Donated to Grassroots Football)");
});
