import test from "node:test";
import assert from "node:assert/strict";
import { ShopifyAdapter } from "../src/adapters/shopify/shopify-adapter.js";
import { parsePage } from "../src/adapters/shopify/shopify-parser.js";
import type { ShopifySiteConfig } from "../src/adapters/shopify/shopify-site-config.js";

const config: ShopifySiteConfig = {
  siteName: "winlife",
  displayName: "Win Life Comps",
  baseUrl: "https://winlifecomps.co.uk",
  collections: ["/collections/current-competitions"],
  userAgent: "test",
  fetchDelayMs: 0,
};

test("Shopify adapter enriches missing detail draw dates without requiring a cash prize", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://winlifecomps.co.uk/products/ninja-bundle";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://winlifecomps.co.uk/collections/current-competitions?limit=250") {
      return new Response(
        `
          <div class="product-card">
            <button
              data-total-tickets="5995"
              data-current-stock="5363"
              data-product-price="85"
              data-product-id="15492516512119"
              data-product-title="Ninja Bundle"
              data-product-url="/products/ninja-bundle"
              data-max-per-person="100"
            ></button>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<script>document.getElementById('draw-date').title = '2026-07-31T20:00:00Z';</script>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ShopifyAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.drawDate, "2026-07-31T20:00:00.000Z");
    assert.equal(comps[0]?.maxEntriesPerUserSource, "site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopify detail scan parses exact product-page inventory and site value", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://horizonprizes.co.uk/products/harkila-bundle";
  const detailConfig: ShopifySiteConfig = {
    siteName: "horizonprizes",
    displayName: "Horizon Premium Prizes",
    baseUrl: "https://horizonprizes.co.uk",
    collections: ["/"],
    detailPageScan: true,
    userAgent: "test",
    fetchDelayMs: 0,
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://horizonprizes.co.uk/?limit=250") {
      return new Response(
        `
          <article class="competition-card">
            <a href="/products/harkila-bundle">Härkila bundle</a>
            <div data-countdown data-end-at="2026-11-06T11:00:00+0000"></div>
          </article>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <meta property="product:price:amount" content="2.99">
          <h1 class="product__title">Win Härkila Country Bundle</h1>
          <div class="product__description">
            <p>Only 499 entries. Worth over £650.</p>
          </div>
          <div id="cs-counter-test">0 / 499 Tickets</div>
          <input name="product-id" value="harkila-15464866480282">
        `,
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ShopifyAdapter(detailConfig).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 0);
    assert.equal(comps[0]?.maxTickets, 499);
    assert.equal(comps[0]?.entryPrice, 2.99);
    assert.equal(comps[0]?.estimatedPrizeValue, 650);
    assert.equal(comps[0]?.valuationSource, "site_estimate");
    assert.equal(comps[0]?.drawDate, "2026-11-06T11:00:00.000Z");
    assert.equal(comps[0]?.inventorySource, "exact");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Shopify parser marks its default cap as fallback when the card has no operator cap", () => {
  const comps = parsePage(`
    <div class="product-card">
      <button
        data-total-tickets="100"
        data-current-stock="90"
        data-product-price="100"
        data-product-id="fallback-cap"
        data-product-title="Fallback cap"
        data-product-url="/products/fallback-cap"
      ></button>
    </div>
  `, config);

  assert.equal(comps[0]?.maxEntriesPerUser, 100);
  assert.equal(comps[0]?.maxEntriesPerUserSource, "fallback");
});

test("Shopify adapter filters sold-out cards", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      `
        <div class="product-card">
          <button
            data-total-tickets="3999"
            data-current-stock="0"
            data-product-price="25"
            data-product-id="15489528988023"
            data-product-title="£500 Tax Free Cash"
            data-product-url="/products/500-tax-free-cash-6"
          ></button>
        </div>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const comps = await new ShopifyAdapter(config).fetchAll();

    assert.equal(comps.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
