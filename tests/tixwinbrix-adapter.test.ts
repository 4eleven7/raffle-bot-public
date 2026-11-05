import test from "node:test";
import assert from "node:assert/strict";
import { parseTixWinBrixDetail } from "../src/adapters/tixwinbrix/tixwinbrix-adapter.js";

test("Tix Win Brix parser reads direct ticket economics", () => {
  const competition = parseTixWinBrixDetail(
    `
      <div class="product_header">
        <div class="product_description shop-item-title">Hospital Wing plus INSTANT WINS</div>
        <div class="max_entries">Total Tickets: 100</div>
        <div class="entries_sold">39 Tickets sold</div>
        <div class="entries_left">61 remaining</div>
        <div class="max_per_entry">Max 15 tickets per user</div>
      </div>
      <div class="draw_price">£1.75</div>
      <div class="draw_Status"><label>SOLD: 39%</label></div>
      <div class="information_container content">
        This fantastic prize draw features the following prize(s):
        <br><br>Main Prize Lego Harry Potter Hospital Wing set 76463<br><br>INSTANT WINS
      </div>
      <div class="information_container content">
        The closing date of this competition is 19-07-99.
      </div>
    `,
    "https://tixwinbrix.co.uk/competitions.html?id=19",
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "19");
  assert.equal(competition.name, "Lego Harry Potter Hospital Wing set 76463");
  assert.equal(competition.entryPrice, 1.75);
  assert.equal(competition.ticketsSold, 39);
  assert.equal(competition.maxTickets, 100);
  assert.equal(competition.maxEntriesPerUser, 15);
  assert.equal(competition.estimatedPrizeValue, 90);
  assert.equal(competition.valuationSource, "manual_estimate");
  assert.equal(competition.isAutoDraw, false);
  assert.match(competition.drawDate, /^2099-07-19T/);
});
