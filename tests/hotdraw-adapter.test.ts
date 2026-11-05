import test from "node:test";
import assert from "node:assert/strict";
import { parseHotDrawDetail } from "../src/adapters/hotdraw/hotdraw-adapter.js";

test("HotDraw parses exact inventory, cap, price, and countdown", () => {
  const scrapedAt = "2026-09-26T10:35:40.000Z";
  const competition = parseHotDrawDetail(
    `<h1>DEWALT Cordless Twin Pack</h1>
      <p>Tickets Remaining: 694/750</p>
      <p>Max Tickets Per User: 75</p>
      <p>£0.97 Per Entry</p>
      <div>01 D 09 H 25 M 37 S</div>
      <p>End date: 27/09/2026</p>`,
    "https://www.hotdraw.co.uk/prizes/NcbewQ6wOdpXkjB3fa8I",
    scrapedAt,
  );

  assert.equal(competition?.sourceId, "NcbewQ6wOdpXkjB3fa8I");
  assert.equal(competition?.name, "DEWALT Cordless Twin Pack");
  assert.equal(competition?.entryPrice, 0.97);
  assert.equal(competition?.ticketsSold, 56);
  assert.equal(competition?.maxTickets, 750);
  assert.equal(competition?.inventorySource, "exact");
  assert.equal(competition?.maxEntriesPerUser, 75);
  assert.equal(competition?.maxEntriesPerUserSource, "site");
  assert.equal(competition?.estimatedPrizeValue, 189.99);
  assert.equal(competition?.valuationSource, "manual_estimate");
  assert.equal(competition?.drawDate, "2026-09-27T20:01:17.000Z");
});

test("HotDraw rejects the initial sold-out placeholder", () => {
  assert.equal(
    parseHotDrawDetail(
      `<h1>Prize</h1><p>Tickets Remaining: 0/750</p><p>£0.97 Per Entry</p><div>01 D 09 H 25 M 37 S</div>`,
      "https://www.hotdraw.co.uk/prizes/example",
      "2026-09-26T10:35:40.000Z",
    ),
    null,
  );
});

test("HotDraw does not take a cash alternative from another prize card", () => {
  const competition = parseHotDrawDetail(
    `<h1>DEWALT Cordless Twin Pack</h1>
      <p>Tickets Remaining: 694/750</p>
      <p>Max Tickets Per User: 75</p>
      <p>£0.97 Per Entry</p>
      <div>01 D 09 H 25 M 37 S</div>
      <div class="page-description">The main prize description.</div>
      <section>£5,000 Cash Alternative</section>`,
    "https://www.hotdraw.co.uk/prizes/NcbewQ6wOdpXkjB3fa8I",
    "2026-09-26T10:35:40.000Z",
  );

  assert.equal(competition?.cashAlternative, null);
});
