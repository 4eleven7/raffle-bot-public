import assert from "node:assert/strict";
import test from "node:test";
import { HwdAdapter } from "../src/adapters/hwd/hwd-adapter.js";
import type { HwdSiteConfig } from "../src/adapters/hwd/hwd-site-config.js";

const config: HwdSiteConfig = {
  siteName: "hwd-test",
  displayName: "HWD Test",
  baseUrl: "https://hwd.test",
  listPath: "/competitions/",
  paginatedPath: null,
  itemsPerPage: 10,
  userAgent: "test",
  fetchDelayMs: 0,
};

test("HWD adapter enriches exact inventory from every public ticket tab", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);

    if (url === "https://hwd.test/competitions/") {
      return new Response(`
        <li class="product post-123 product_cat-main-draws">
          <a href="https://www.hwd.test/competition/prize/"></a>
          <h2 class="woocommerce-loop-product__title">Exact Prize</h2>
          <span class="price">£0.99</span>
        </li>
      `);
    }

    if (url === "https://www.hwd.test/competition/prize/") {
      return new Response(`
        <div class="fixed-odds">
          <div><span>3</span><p>Max. Entries</p></div>
          <div><span>2</span><p>per Person</p></div>
        </div>
        <p>Closing Date: <strong>August 2, 2026 8:15 pm</strong></p>
        <button class="lty-lottery-ticket-tab lty-active-tab" data-tab="1">1-2</button>
        <button class="lty-lottery-ticket-tab" data-tab="3">3</button>
        <div class="lty-lottery-ticket-tab-content">
          <li class="lty-ticket lty-booked-ticket" data-ticket="1">1</li>
          <li class="lty-ticket" data-ticket="2">2</li>
        </div>
        <input class="lty-ticket-product-id" value="123">
        <script>
          var lty_frontend_params = {
            "lottery_tickets_nonce":"nonce-123",
            "ajaxurl":"https://www.hwd.test/wp-admin/admin-ajax.php"
          };
        </script>
      `);
    }

    if (url === "https://www.hwd.test/wp-admin/admin-ajax.php") {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(init?.method, "POST");
      assert.equal(body.get("action"), "lty_ticket_tab_selection");
      assert.equal(body.get("product_id"), "123");
      assert.equal(body.get("tab"), "3");
      assert.equal(body.get("lty_security"), "nonce-123");
      return Response.json({
        success: true,
        data: {
          html: '<li class="lty-ticket lty-booked-ticket" data-ticket="3">3</li>',
        },
      });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new HwdAdapter(config).fetchAll();
    assert.equal(competition?.ticketsSold, 2);
    assert.equal(competition?.maxTickets, 3);
    assert.equal(competition?.maxEntriesPerUser, 2);
    assert.equal(competition?.maxEntriesPerUserSource, "site");
    assert.equal(competition?.drawDate, "2026-08-02T19:15:00.000Z");
    assert.deepEqual(requests, [
      "GET https://hwd.test/competitions/",
      "GET https://www.hwd.test/competition/prize/",
      "POST https://www.hwd.test/wp-admin/admin-ajax.php",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HWD adapter keeps inventory unknown when not every ticket can be counted", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/competitions/")) {
      return new Response(`
        <li class="product post-456">
          <a href="https://hwd.test/competition/incomplete/"></a>
          <h2>Incomplete Prize</h2><span class="price">£0.50</span>
        </li>
      `);
    }
    if (url.endsWith("/competition/incomplete/")) {
      return new Response(`
        <div class="fixed-odds">
          <div><span>95,000</span><p>Max. Entries</p></div>
          <div><span>2,000</span><p>per Person</p></div>
        </div>
        <p>Closing Date: <strong>August 2, 2026 8:15 pm</strong></p>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new HwdAdapter(config).fetchAll();
    assert.equal(competition?.ticketsSold, 0);
    assert.equal(competition?.maxTickets, 0);
    assert.equal(competition?.drawDate, "2026-08-02T19:15:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("HWD adapter reads counter-based inventory and countdown dates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/competitions/")) {
      return new Response(`
        <div class="product post-789 product_cat-main-draws">
          <a href="https://hwd.test/competition/counter-prize/"></a>
          <h2 class="woocommerce-loop-product__title">Counter Prize Worth £1,500</h2>
          <span class="price">£1.00</span>
          <span>279 Left</span>
        </div>
      `);
    }
    if (url.endsWith("/competition/counter-prize/")) {
      return new Response(`
        <div class="product post-789">
          <h1 class="product_title">Counter Prize Worth £1,500</h1>
          <div class="lty-lottery-countdown-timer" data-time="2026/07/26 19:00:00"></div>
          <div class="tickets-counter">
            <h3>Total Tickets</h3><p>400</p>
            <h3>Available Tickets</h3><p>279</p>
            <h3>Sold Tickets</h3><p>121</p>
          </div>
        </div>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new HwdAdapter(config).fetchAll();
    assert.equal(competition?.ticketsSold, 121);
    assert.equal(competition?.maxTickets, 400);
    assert.equal(competition?.estimatedPrizeValue, 1500);
    assert.equal(competition?.drawDate, "2026-07-26T18:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
