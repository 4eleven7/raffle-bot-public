import assert from "node:assert/strict";
import test from "node:test";
import { parseRaforteCompetition } from "../src/adapters/raforte/raforte-adapter.js";

test("Raforte parser extracts current price, remaining tickets, expiry, and site value", () => {
  const competition = parseRaforteCompetition(
    `
      <main>
        <div class="summary entry-summary">
          <h1 class="product_title entry-title">Rolex Explorer II</h1>
          <div class="single-product--meta">
            <p class="price"><ins><span class="amount">£175.00</span></ins></p>
            <p class="stock"><span class="stock-quantity">88 / 99</span> <span>Tickets remaining</span></p>
          </div>
        </div>
        <div class="entry-content">
          <p>This Rolex Explorer II is worth around £11,000.</p>
          <h3>Raffle expiry date:</h3><p>02/08/2026 at 21:00hrs</p>
          <h3>Total number of tickets:</h3><p>99</p>
        </div>
      </main>
    `,
    "https://raforte.com/raffle/rolex-explorer-ii/",
    "2026-07-19T08:00:00.000Z",
  );

  assert.deepEqual(competition, {
    sourceId: "rolex-explorer-ii",
    siteName: "raforte",
    url: "https://raforte.com/raffle/rolex-explorer-ii/",
    name: "Rolex Explorer II",
    entryPrice: 175,
    ticketsSold: 11,
    maxTickets: 99,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    estimatedPrizeValue: 11000,
    valuationSource: "site_estimate",
    valuationConfidence: "medium",
    valuationNotes: "Raforte detail page states the prize is worth around £11,000.",
    drawDate: "2026-08-02T20:00:00.000Z",
    isAutoDraw: false,
    categories: ["watch", "luxury"],
    scrapedAt: "2026-07-19T08:00:00.000Z",
  });
});

test("Raforte parser rejects a detail page without deterministic ticket data", () => {
  assert.equal(
    parseRaforteCompetition(
      "<main><h1>Rolex Explorer II</h1><p>Draw Date: 14 Days left</p></main>",
      "https://raforte.com/raffle/rolex-explorer-ii/",
      "2026-07-19T08:00:00.000Z",
    ),
    null,
  );
});
