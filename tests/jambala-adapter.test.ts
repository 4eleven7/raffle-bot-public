import test from "node:test";
import assert from "node:assert/strict";
import { parseJambalaCollection, parseJambalaDetail } from "../src/adapters/jambala/jambala-adapter.js";

test("Jambala collection excludes instant wins and closed products", () => {
  const urls = parseJambalaCollection(`
    <div class="product-item"><a href="/products/instant">Instant Win Bonanza</a><span>Instant Wins</span></div>
    <div class="product-item"><a href="/products/cash">£500 Cash Prize Win</a><span>Closing on 03 Aug at 4:30 PM</span></div>
    <div class="product-item"><a href="/products/closed">Closed</a></div>
  `);

  assert.deepEqual(urls, ["https://www.jambala.co.uk/products/cash"]);
});

test("Jambala detail parser reads scoped ticket economics", () => {
  const competition = parseJambalaDetail(
    `
      <product-page>
        <h1>£500 Cash Prize Win</h1>
        <div class="product-price--original">£1.50</div>
        <div class="price_val">Prize Value: £500</div>
        <p>Automated Draw</p>
        <p>Closing on 03 Aug at 4:30 PM</p>
        <p>Sold: 2% 37 / 2900</p>
      </product-page>
      <div class="related"><h2>£250 Cash Prize Win</h2><p>Sold: 80% 600 / 750</p></div>
    `,
    "https://www.jambala.co.uk/collections/live-competitions/products/500-cash-prize-win",
  );

  assert.ok(competition);
  assert.equal(competition.siteName, "jambala");
  assert.equal(competition.name, "£500 Cash Prize Win");
  assert.equal(competition.entryPrice, 1.5);
  assert.equal(competition.ticketsSold, 37);
  assert.equal(competition.maxTickets, 2900);
  assert.equal(competition.cashAlternative, 500);
  assert.equal(competition.estimatedPrizeValue, 500);
  assert.equal(competition.isAutoDraw, true);
  assert.match(competition.drawDate ?? "", /-08-03T15:30:00\.000Z$/);
});
