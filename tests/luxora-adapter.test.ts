import test from "node:test";
import assert from "node:assert/strict";
import { WCLotteryAdapter } from "../src/adapters/wclottery/wclottery-adapter.js";
import { applyEstimatedValuation } from "../src/valuation/estimate.js";
import {
  enrichCompetitionFromDetail,
  parseDetailPage,
  parsePage,
} from "../src/adapters/wclottery/wclottery-parser.js";
import type { WCLotterySiteConfig } from "../src/adapters/wclottery/wclottery-site-config.js";

const config: WCLotterySiteConfig = {
  siteName: "luxora",
  displayName: "Luxora Draws",
  baseUrl: "https://luxoradraws.co.uk",
  listPath: "/all-competitions/",
  userAgent: "Mozilla/5.0",
  fetchDelayMs: 500,
};

test("WC Lottery parser reads Luxora Nera competition cards", () => {
  const [competition] = parsePage(
    `
      <main class="nera-product-listing">
        <div
          class="prize-card-aos-wrap"
          data-price="0.99"
          data-end-date="1786300200"
          data-popularity="228"
          data-categories='["technology"]'
        >
          <div class="prize-card">
            <a
              href="https://luxoradraws.co.uk/product/dji-osmo-pocket-3/"
              aria-label="View Dji Osmo Pocket 3"
            ></a>
            <div class="prize-name">Dji Osmo Pocket 3</div>
            <div class="ticket-labels">
              <span><strong>228</strong> tickets sold</span>
              <span><strong>371</strong> remaining</span>
            </div>
            <a href="https://luxoradraws.co.uk/product/dji-osmo-pocket-3/">
              Enter from <span class="woocommerce-Price-amount">£0.99</span> per ticket
            </a>
          </div>
        </div>
      </main>
    `,
    config,
  );

  assert.deepEqual(
    {
      sourceId: competition?.sourceId,
      siteName: competition?.siteName,
      url: competition?.url,
      name: competition?.name,
      entryPrice: competition?.entryPrice,
      ticketsSold: competition?.ticketsSold,
      maxTickets: competition?.maxTickets,
      drawDate: competition?.drawDate,
      categories: competition?.categories,
    },
    {
      sourceId: "dji-osmo-pocket-3",
      siteName: "luxora",
      url: "https://luxoradraws.co.uk/product/dji-osmo-pocket-3/",
      name: "Dji Osmo Pocket 3",
      entryPrice: 0.99,
      ticketsSold: 228,
      maxTickets: 599,
      drawDate: "2026-08-09T18:30:00.000Z",
      categories: ["technology"],
    },
  );
});

test("WC Lottery parser prefers Luxora's structured lottery payload over stale detail text", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-40524 product_cat-technology">
        <h1 class="product_title">Dji Osmo Pocket 3</h1>
        <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
        <progress value="44" max="599"></progress>
        <p>Tickets Sold 44 / 599</p>
      </div>
      <script>
        var neraLotteryProduct = {
          "id":"40524",
          "name":"Dji Osmo Pocket 3",
          "price":"0.99",
          "maxTickets":"599",
          "soldTickets":"228",
          "remainingTickets":"371",
          "maxPerUser":"599",
          "endDate":"2026-08-09 18:30:00",
          "endTimestamp":"1786300200000"
        };
      </script>
    `,
    config,
    "https://luxoradraws.co.uk/product/dji-osmo-pocket-3/",
  );

  assert.deepEqual(
    {
      entryPrice: competition?.entryPrice,
      ticketsSold: competition?.ticketsSold,
      maxTickets: competition?.maxTickets,
      maxEntriesPerUser: competition?.maxEntriesPerUser,
      maxEntriesPerUserSource: competition?.maxEntriesPerUserSource,
      drawDate: competition?.drawDate,
    },
    {
      entryPrice: 0.99,
      ticketsSold: 228,
      maxTickets: 599,
      maxEntriesPerUser: 599,
      maxEntriesPerUserSource: "site",
      drawDate: "2026-08-09T18:30:00.000Z",
    },
  );
});

test("WC Lottery parser does not reduce Luxora's monotonic sold count during detail enrichment", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "dji-osmo-pocket-3",
      siteName: "luxora",
      url: "https://luxoradraws.co.uk/product/dji-osmo-pocket-3/",
      name: "Dji Osmo Pocket 3",
      entryPrice: 0.99,
      ticketsSold: 228,
      maxTickets: 599,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: "2026-08-09T18:30:00.000Z",
      isAutoDraw: false,
      categories: ["technology"],
      scrapedAt: "2026-08-09T10:00:00.000Z",
    },
    `
      <div class="product post-40524 product_cat-technology">
        <h1 class="product_title">Dji Osmo Pocket 3</h1>
        <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
        <progress value="44" max="599"></progress>
      </div>
      <script>
        var neraLotteryProduct = {
          "price":"0.99",
          "maxTickets":"599",
          "soldTickets":"44",
          "maxPerUser":"599",
          "endTimestamp":"1786300200000"
        };
      </script>
    `,
  );

  assert.equal(competition.ticketsSold, 228);
  assert.equal(competition.maxTickets, 599);
  assert.equal(competition.maxEntriesPerUser, 599);
  assert.equal(competition.maxEntriesPerUserSource, "site");
});

test("WC Lottery adapter uses Luxora's Store API stock when cached HTML is stale", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://luxoradraws.co.uk/product/dji-osmo-pocket-3/";
  const storeUrl =
    "https://luxoradraws.co.uk/wp-json/wc/store/v1/products?slug=dji-osmo-pocket-3";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://luxoradraws.co.uk/all-competitions/") {
      return new Response(
        `
          <main class="nera-product-listing">
            <div
              class="prize-card-aos-wrap"
              data-price="0.99"
              data-end-date="1786300200"
              data-popularity="44"
              data-categories='["technology"]'
            >
              <a href="${detailUrl}"></a>
              <div class="prize-name">Dji Osmo Pocket 3</div>
              <div class="ticket-labels">
                <span><strong>44</strong> tickets sold</span>
                <span><strong>555</strong> remaining</span>
              </div>
            </div>
          </main>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div class="product post-40524 product_cat-technology">
            <h1 class="product_title">Dji Osmo Pocket 3</h1>
            <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
            <progress value="44" max="599"></progress>
          </div>
          <script>
            var neraLotteryProduct = {
              "price":"0.99",
              "maxTickets":"599",
              "soldTickets":"44",
              "maxPerUser":"599",
              "endTimestamp":"1786300200000"
            };
          </script>
        `,
        { status: 200 },
      );
    }

    if (url === storeUrl) {
      return Response.json([
        {
          slug: "dji-osmo-pocket-3",
          add_to_cart: { maximum: 5 },
          stock_availability: { text: "371 in stock" },
        },
      ]);
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new WCLotteryAdapter({
      ...config,
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(competition?.ticketsSold, 228);
    assert.equal(competition?.maxTickets, 599);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Luxora DJI uses a conservative deterministic retail valuation", () => {
  const competition = applyEstimatedValuation({
    sourceId: "dji-osmo-pocket-3",
    siteName: "luxora",
    url: "https://luxoradraws.co.uk/product/dji-osmo-pocket-3/",
    name: "Dji Osmo Pocket 3",
    entryPrice: 0.99,
    ticketsSold: 228,
    maxTickets: 599,
    maxEntriesPerUser: 599,
    maxEntriesPerUserSource: "site",
    cashAlternative: null,
    drawDate: "2026-08-09T18:30:00.000Z",
    isAutoDraw: false,
    categories: ["technology"],
    scrapedAt: "2026-08-09T10:00:00.000Z",
  });

  assert.equal(competition.estimatedPrizeValue, 263);
  assert.equal(competition.valuationSource, "manual_estimate");
  assert.equal(competition.valuationConfidence, "medium");
});
