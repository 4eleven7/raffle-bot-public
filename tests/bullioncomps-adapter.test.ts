import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBullionCompsCollection,
  parseBullionCompsDetail,
} from "../src/adapters/bullioncomps/bullioncomps-adapter.js";

test("Bullion Comps collection deduplicates product URLs", () => {
  const urls = parseBullionCompsCollection(`
    <a href="/products/rolex-datejust-36mm-competition">Rolex</a>
    <a href="/products/rolex-datejust-36mm-competition?variant=1">Rolex duplicate</a>
    <a href="/products/silver-britannia">Silver</a>
  `);

  assert.deepEqual(urls, [
    "https://mintgold.co.uk/products/rolex-datejust-36mm-competition",
    "https://mintgold.co.uk/products/silver-britannia",
  ]);
});

test("Bullion Comps detail parser reads progress, cash alternative, and fixed draw date", () => {
  const competition = parseBullionCompsDetail(
    `
      <h1>Rolex Datejust 36mm Competition!</h1>
      <div class="price">£1.49 per ticket</div>
      <p>Prefer cash instead? Take the £6,000 TAX FREE cash alternative!</p>
      <p>Competition launches 15th May and ends 15th August or when all tickets are sold!</p>
      <p>Live Draw</p>
      <p>Drawn 10pm</p>
      <div class="competition-progress-wrapper">
        <span>Competition Progress</span>
        <strong>434</strong> <span>Tickets Sold</span>
        <strong>7565</strong> <span>Tickets Remaining</span>
        <strong>7999</strong> <span>Total Tickets</span>
      </div>
    `,
    "https://mintgold.co.uk/products/rolex-datejust-36mm-competition",
  );

  assert.ok(competition);
  assert.equal(competition.siteName, "bullioncomps");
  assert.equal(competition.name, "Rolex Datejust 36mm Competition!");
  assert.equal(competition.entryPrice, 1.49);
  assert.equal(competition.ticketsSold, 434);
  assert.equal(competition.maxTickets, 7999);
  assert.equal(competition.cashAlternative, 6000);
  assert.equal(competition.estimatedPrizeValue, 6000);
  assert.equal(competition.isAutoDraw, true);
  assert.match(competition.drawDate ?? "", /-08-15T21:00:00\.000Z$/);
});

test("Bullion Comps detail parser rejects inconsistent progress", () => {
  const competition = parseBullionCompsDetail(
    `
      <h1>Old Competition</h1>
      <p>£0.25 per ticket. ends 15th August. Drawn 10pm</p>
      <div class="competition-progress-wrapper">
        <strong>1505</strong><span>Tickets Sold</span>
        <strong>0</strong><span>Tickets Remaining</span>
        <strong>1499</strong><span>Total Tickets</span>
      </div>
    `,
    "https://mintgold.co.uk/products/old-competition",
  );

  assert.equal(competition, null);
});
