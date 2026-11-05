import test from "node:test";
import assert from "node:assert/strict";
import { parseLuxeCompetition } from "../src/adapters/luxeprizes/luxeprizes-adapter.js";

test("LuxePrizes parser reads live-draw ticket economics", () => {
  const competition = parseLuxeCompetition(
    `
      <body>
        <h1>£100 Food Shop</h1>
        <span class="game-chip game-chip--red">Live Draw</span>
        <div class="game-countdown-strip countdown" data-end="2099-07-19T19:00:00+01:00"></div>
        <div class="game-progress-head">8.8% Sold <strong>397/4,500</strong></div>
        <div class="game-price-line"><strong>4p</strong> per ticket</div>
        <div>Live draw Sun 19 Jul 2099, 7:00pm</div>
        <div>Max 1,250 tickets per person.</div>
        <p>The winner can choose £100 Food Shop OR £100 CASH.</p>
        <p>This is a live draw only — no instant wins available.</p>
        <script>const price = 0.04;</script>
      </body>
    `,
    "https://www.luxeprizes.co.uk/game/20",
    new Date("2099-01-01T00:00:00.000Z"),
  );

  assert.equal(competition?.entryPrice, 0.04);
  assert.equal(competition?.ticketsSold, 397);
  assert.equal(competition?.maxTickets, 4500);
  assert.equal(competition?.cashAlternative, 100);
  assert.equal(competition?.maxEntriesPerUser, 1250);
  assert.equal(competition?.drawDate, "2099-07-19T18:00:00.000Z");
});

test("LuxePrizes parses the current rendered draw fields", () => {
  const competition = parseLuxeCompetition(
    `
      <body>
        <main class="game-state-live">
          <h1>£75 for £7.50!</h1>
          <div class="game-countdown-strip countdown" data-end="2099-09-13T19:00:00+01:00"></div>
          <div class="game-progress-head"><span>55.0% Sold</span><strong>9 remaining</strong></div>
          <div class="game-price-line"><strong>£7.50</strong> per ticket</div>
          <div class="game-smallprint">
            <div>Live draw <strong>Sun 13 Sep 2099, 7:30pm</strong></div>
            <div>9 tickets available.</div>
            <div>Max 5 tickets per person.</div>
          </div>
          <div class="game-type-explainer"><strong>Live Draw</strong></div>
          <div class="tab-content" id="tab-odds"><section class="odds-section odds-section--draw">
            <span>Total tickets</span><strong>20</strong>
            <span>Tickets sold</span><strong>11</strong>
          </section></div>
          <div class="tab-content" id="tab-rules">
            The total amount of tickets for this competition is 20.
          </div>
          <p>🏆 THE WINNER TAKES £75 CASH!</p>
          <script>const price = 7.5;</script>
        </main>
      </body>
    `,
    "https://www.luxeprizes.co.uk/game/52",
    new Date("2099-01-01T00:00:00.000Z"),
  );

  assert.equal(competition?.ticketsSold, 11);
  assert.equal(competition?.maxTickets, 20);
  assert.equal(competition?.maxEntriesPerUser, 5);
  assert.equal(competition?.maxEntriesPerUserSource, "site");
  assert.equal(competition?.estimatedPrizeValue, 75);
});

test("LuxePrizes parser excludes combined instant-win draws", () => {
  const competition = parseLuxeCompetition(
    `<body><h1>Double Down</h1><span class="game-chip game-chip--red">Instant Wins + Draw</span></body>`,
    "https://www.luxeprizes.co.uk/game/27",
    new Date("2099-01-01T00:00:00.000Z"),
  );
  assert.equal(competition, null);
});
