import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichCompetitionFromDetail,
  parsePage,
} from "../src/adapters/wclottery/wclottery-parser.js";
import type { WCLotterySiteConfig } from "../src/adapters/wclottery/wclottery-site-config.js";

const config: WCLotterySiteConfig = {
  siteName: "brickdrop",
  displayName: "Brick Drop Comps",
  baseUrl: "https://brickdropcomps.co.uk",
  listPath: "/",
  renderListPage: true,
  renderDetailPages: true,
  userAgent: "test",
  fetchDelayMs: 0,
};

test("Brick Drop parses its Woo listing cards and ARIA detail progress", () => {
  const [listing] = parsePage(
    `
      <li class="product type-product post-123">
        <a href="/product/tom-jerry-brickheadz-retired-40793/"><h2>Tom &amp; Jerry Brickheadz – Retired (40793)</h2></a>
        <span class="price">£0.35</span>
        <div class="countdown-timer" data-enddate="2026-07-26 18:00"></div>
      </li>
    `,
    config,
  );

  assert.ok(listing);
  const competition = enrichCompetitionFromDetail(
    listing,
    `
      <div class="product">
        <h2>Tom &amp; Jerry Brickheadz – Retired (40793)</h2>
        <div class="aihc-product-desc-addon aihc-max-tickets">MAX ENTRIES 100</div>
        <div>MAX 30 PER PERSON</div>
        <div class="aihc-ecb-progress-bar-container" aria-valuenow="61" aria-valuemax="100"></div>
        <div>Draw 26/07/2026 6:00 pm</div>
      </div>
    `,
  );

  assert.equal(competition.ticketsSold, 61);
  assert.equal(competition.maxTickets, 100);
  assert.equal(competition.maxEntriesPerUser, 30);
  assert.equal(competition.maxEntriesPerUserSource, "site");
  assert.equal(competition.estimatedPrizeValue, 20);
  assert.equal(competition.valuationSource, "manual_estimate");
  assert.equal(competition.drawDate, "2026-07-26T17:00:00.000Z");
});
