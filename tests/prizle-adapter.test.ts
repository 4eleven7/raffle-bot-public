import test from "node:test";
import assert from "node:assert/strict";
import { parsePrizleCompetition } from "../src/adapters/prizle/prizle-adapter.js";

test("Prizle parser reads server-rendered competition economics", () => {
  const competition = parsePrizleCompetition(
    `
      <div class="comp-detail__hero-info" x-data="competitionCountdown(1785708000)">
        <h1 class="comp-detail__hero-title">iPhone 17 Pro</h1>
        <p>£0.99 / ticket</p>
        <span class="comp-detail__sales-tickets">44 / 1,998 Tickets sold</span>
        <p>Take £720 cash or £1,100 Prizle site credit instead.</p>
      </div>
      <script>const quickAdd = {"max_per_user":500};</script>
    `,
    "https://prizle.co.uk/competitions/iphone-17-pro",
  );

  assert.equal(competition?.ticketsSold, 44);
  assert.equal(competition?.maxTickets, 1998);
  assert.equal(competition?.entryPrice, 0.99);
  assert.equal(competition?.cashAlternative, 720);
  assert.equal(competition?.maxEntriesPerUser, 500);
  assert.equal(competition?.maxEntriesPerUserSource, "site");
  assert.equal(competition?.drawDate, new Date(1785708000 * 1000).toISOString());

  const fallbackCap = parsePrizleCompetition(
    `
      <div x-data="competitionCountdown(1785708000)">
        <h1>Fallback cap</h1>
        <p>£1 / ticket</p>
        <span>1 / 100 Tickets sold</span>
      </div>
    `,
    "https://prizle.co.uk/competitions/fallback-cap",
  );
  assert.equal(fallbackCap?.maxEntriesPerUser, 100);
  assert.equal(fallbackCap?.maxEntriesPerUserSource, "fallback");
});
