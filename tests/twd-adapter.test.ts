import test from "node:test";
import assert from "node:assert/strict";
import { TwdAdapter } from "../src/adapters/twd/twd-adapter.js";

test("TWD adapter reads epoch countdown draw dates", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://twdcompetitions.com/product/big-hitters-145000-instant-win-1000-end-draw-ends-monday-15th-june/";
  const epochSeconds = 1_781_550_000;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://twdcompetitions.com/product-category/competitions/") {
      return new Response(
        `<li class="product"><a class="woocommerce-LoopProduct-link" href="${detailUrl}">Big Hitters</a></li>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">BIG HITTERS £145,000 INSTANT WIN + £1000 END DRAW ENDS MONDAY 15TH JUNE</h1>
          <button name="add-to-cart" value="142530"></button>
          <span class="woocommerce-Price-amount">£60.00</span>
          <span class="zero">SOLD: 39</span>
          <span class="max">LEFT: 2961</span>
          <p>Entries are capped at 25 entries per player.</p>
          <div class="main-lottery lottery-time-countdown" data-time="${epochSeconds}"></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new TwdAdapter().fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.drawDate, new Date(epochSeconds * 1000).toISOString());
    assert.equal(comps[0]?.maxEntriesPerUser, 25);
    assert.equal(comps[0]?.maxEntriesPerUserSource, "site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TWD adapter scopes cash alternatives to the main product", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://twdcompetitions.com/product/win-a-rolex-gmt-master-ii-batman-or-the-8000-cash-alt-on-wednesday-17th-june/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://twdcompetitions.com/product-category/competitions/") {
      return new Response(
        `<li class="product"><a class="woocommerce-LoopProduct-link" href="${detailUrl}">Rolex</a></li>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">WIN A ROLEX GMT MASTER II BATMAN OR THE £8000 CASH ALT ON WEDNESDAY 17TH JUNE</h1>
          <button name="add-to-cart" value="142168"></button>
          <span class="woocommerce-Price-amount">£60.00</span>
          <span class="zero">SOLD: 8</span>
          <span class="max">LEFT: 252</span>
          <div class="main-lottery lottery-time-countdown" data-time="1781290800"></div>
          <h2>Frequently Asked Questions</h2>
          <div>Related product: WIN A TRIUMPH TF 450-E OR THE CASH ALTERNATIVE <span>£50</span></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new TwdAdapter().fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, 8000);
    assert.equal(comps[0]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TWD adapter does not value unpriced cash-alternative wording from entry prices", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://twdcompetitions.com/product/win-a-triumph-tf-450-e-or-the-cash-alternative-on-friday-12th-june/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://twdcompetitions.com/product-category/competitions/") {
      return new Response(
        `<li class="product"><a class="woocommerce-LoopProduct-link" href="${detailUrl}">Triumph</a></li>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">WIN A TRIUMPH TF 450-E OR THE CASH ALTERNATIVE ON FRIDAY 12TH JUNE</h1>
          <button name="add-to-cart" value="141318"></button>
          <span class="woocommerce-Price-amount">£50.00</span>
          <span class="zero">SOLD: 8</span>
          <span class="max">LEFT: 252</span>
          <div class="main-lottery lottery-time-countdown" data-time="1781290800"></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new TwdAdapter().fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
