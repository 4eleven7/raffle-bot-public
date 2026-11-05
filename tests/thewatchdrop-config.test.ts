import test from "node:test";
import assert from "node:assert/strict";
import { ZapAdapter } from "../src/adapters/zap/zap-adapter.js";
import { enrichFromDetailPage } from "../src/adapters/zap/zap-parser.js";

test("The Watch Drop config excludes its instant-win Vault product", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `
        <ul>
          <li class="product post-8572">
            <a href="https://thewatchdrop.co.uk/competition/vault_summer_edition/"><h2>Vault</h2></a>
            <span class="price"><span class="woocommerce-Price-amount">£2.49</span></span>
            <span class="zapc-refresh-sold-8572">5,515</span>
            <span class="zapc-refresh-max-8572">99,999</span>
            <div data-end-date="2099-10-07T20:55:00"></div>
          </li>
          <li class="product post-10105">
            <a href="https://thewatchdrop.co.uk/competition/d35/"><h2>Tudor Black Bay Ceramic</h2></a>
            <span class="price"><span class="woocommerce-Price-amount">£19.99</span></span>
            <span class="zapc-refresh-sold-10105">45</span>
            <span class="zapc-refresh-max-10105">499</span>
            <div data-end-date="2099-07-22T20:30:00"></div>
          </li>
        </ul>
      `,
      { status: 200 },
    );

  try {
    const competitions = await new ZapAdapter({
      siteName: "thewatchdrop",
      displayName: "The Watch Drop",
      baseUrl: "https://thewatchdrop.co.uk",
      listPath: "/competitions/",
      paginatedPath: null,
      itemsPerPage: 3,
      userAgent: "test",
      fetchDelayMs: 0,
      excludeUrlPatterns: [/\/competition\/vault_summer_edition\/?$/i],
    }).fetchAll();

    assert.deepEqual(competitions.map((competition) => competition.sourceId), ["10105"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("The Watch Drop detail parser reads public retail value", () => {
  const competition = {
    sourceId: "10105",
    siteName: "thewatchdrop",
    url: "https://thewatchdrop.co.uk/competition/d35/",
    name: "Tudor Black Bay Ceramic",
    entryPrice: 19.99,
    ticketsSold: 45,
    maxTickets: 499,
    maxEntriesPerUser: 100,
    cashAlternative: null,
    drawDate: null,
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
  };

  enrichFromDetailPage(
    competition,
    `<main>REF: 79210CNU | RV £4,780 | Full set</main>`,
    {
      siteName: "thewatchdrop",
      displayName: "The Watch Drop",
      baseUrl: "https://thewatchdrop.co.uk",
      listPath: "/competitions/",
      paginatedPath: null,
      itemsPerPage: 3,
      userAgent: "test",
      fetchDelayMs: 0,
      detailPrizeValuePattern: /\b(?:RV|worth)\s*:?\s*£\s*([\d,]+(?:\.\d{1,2})?)/i,
    },
  );

  assert.equal(competition.estimatedPrizeValue, 4780);
  assert.equal(competition.valuationSource, "site_estimate");
});
