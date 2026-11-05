import test from "node:test";
import assert from "node:assert/strict";
import { parseCalibreClubDetail } from "../src/adapters/calibreclub/calibreclub-adapter.js";

test("TheCalibreClub parser reads cash draw economics", () => {
  const competition = parseCalibreClubDetail(
    `
      <div class="summary entry-summary">
        <h1 class="product_title">Midnight Money</h1>
        <p class="price">£0.99 Per Ticket</p>
        <table class="comp-detail">
          <tr><td>Competition Ends</td><td>20th July 2099 10:00 pm</td></tr>
          <tr><td>Ticket Limit</td><td>5000</td></tr>
          <tr><td>User Ticket Limit</td><td>3000</td></tr>
        </table>
        <span class="wc-comps-tickets-sold">Tickets sold: <span>0</span>/5000</span>
        <span class="wc-comps-tickets-remaining">Tickets remaining: 5000</span>
        <p>The top prize is £2,500 cash. Max 250 tickets per person.</p>
      </div>
    `,
    "https://thecalibreclub.com/competition/lounge-midnight-money/",
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "lounge-midnight-money");
  assert.equal(competition.name, "Midnight Money");
  assert.equal(competition.entryPrice, 0.99);
  assert.equal(competition.ticketsSold, 0);
  assert.equal(competition.maxTickets, 5000);
  assert.equal(competition.maxEntriesPerUser, 250);
  assert.equal(competition.cashAlternative, 2500);
  assert.match(competition.drawDate, /^2099-07-20T/);
});

test("TheCalibreClub parser rejects the free multi-gift Concierge page", () => {
  const competition = parseCalibreClubDetail(
    `
      <main>
        <div class="summary entry-summary">
          <h1 class="product_title">Lounge Concierge Gift</h1>
          <p>The Calibre Club Lounge — free daily reveal. No purchase necessary.</p>
          <p>250 gifts. One gift per member per evening. Top gift £25.</p>
        </div>
        <div class="unrelated-competition">
          <p class="price">£0.01 Per Ticket</p>
          <p>Tickets sold: 0 / 500</p>
          <p>Competition Ends 20th July 2099 10:00 pm</p>
          <p>Cash £825</p>
        </div>
      </main>
    `,
    "https://thecalibreclub.com/competition/lounge-concierge-gift/",
  );

  assert.equal(competition, null);
});

test("TheCalibreClub parser marks multi-winner reveal boards as instant-win pools", () => {
  const competition = parseCalibreClubDetail(
    `
      <div class="summary entry-summary">
        <h1 class="product_title">Midnight Money</h1>
        <p class="price">£0.99 Per Ticket</p>
        <p>This competition will have 563 winners</p>
        <p>Tickets sold: 25 / 5000</p>
        <p>Competition Ends 20th July 2099 10:00 pm</p>
        <p>Top prize £2,500 cash. All prizes paid as cash. Scratch to reveal at checkout.</p>
      </div>
    `,
    "https://thecalibreclub.com/competition/lounge-midnight-money/",
  );

  assert.ok(competition);
  assert.equal(competition.cashAlternative, 2500);
  assert.equal(competition.isAutoDraw, true);
  assert.deepEqual(competition.categories, ["cash", "instant-win"]);
});

test("TheCalibreClub parser does not borrow price or cash from adjacent products", () => {
  const competition = parseCalibreClubDetail(
    `
      <div class="summary entry-summary">
        <h1 class="product_title">Watch Members Gift</h1>
        <p>Members-only product prize.</p>
      </div>
      <aside>
        <p class="price">£1.99 Per Ticket</p>
        <p>Tickets sold: 10 / 500</p>
        <p>Competition Ends 20th July 2099 10:00 pm</p>
        <p>Cash alternative £825</p>
      </aside>
    `,
    "https://thecalibreclub.com/competition/watch-members-gift/",
  );

  assert.equal(competition, null);
});
