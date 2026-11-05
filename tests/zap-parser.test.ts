import test from "node:test";
import assert from "node:assert/strict";
import { ZapAdapter } from "../src/adapters/zap/zap-adapter.js";
import { enrichFromDetailPage, parsePage } from "../src/adapters/zap/zap-parser.js";
import {
  ZAP_SITES,
  type ZapSiteConfig,
} from "../src/adapters/zap/zap-site-config.js";

const config: ZapSiteConfig = {
  siteName: "hittinitbig",
  displayName: "Hittin' It Big",
  baseUrl: "https://hittinitbig.com",
  listPath: "/competitions/",
  paginatedPath: null,
  itemsPerPage: 16,
  userAgent: "test",
  fetchDelayMs: 0,
};

test("Zap parser does not treat a Woo free taxonomy as free-entry provenance for a paid row", () => {
  const [competition] = parsePage(
    `
      <li class="product post-123 product_cat-free product_cat-cash">
        <a href="https://hittinitbig.com/competition/daily-paid-freebie/">
          <h2>Daily Player Freebie</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£2.75</span></span>
        <span class="zapc-refresh-sold-123">10</span>
        <span class="zapc-refresh-max-123">100</span>
        <input class="qty" max="20" />
      </li>
    `,
    config,
  );

  assert.ok(competition);
  assert.equal(competition.entryPrice, 2.75);
  assert.equal(competition.categories.includes("free"), false);
  assert.equal(competition.categories.includes("cash"), true);
});

test("Zap parser uses the current WooCommerce sale price", () => {
  const [competition] = parsePage(
    `
      <li class="product post-124">
        <a href="https://hittinitbig.com/competition/sale/"><h2>Sale prize</h2></a>
        <span class="price">
          <del><span class="woocommerce-Price-amount">£1.50</span></del>
          <ins><span class="woocommerce-Price-amount">£0.99</span></ins>
        </span>
        <span class="zapc-refresh-sold-124">10</span>
        <span class="zapc-refresh-max-124">100</span>
      </li>
    `,
    config,
  );

  assert.equal(competition?.entryPrice, 0.99);
});

test("Zap parser reads Little Win entry limits from detail text", () => {
  const competition = parsePage(
    `
      <li class="product post-125">
        <a href="https://littlewin.co.uk/competition/doona/"><h2>Doona</h2></a>
        <span class="price"><span class="woocommerce-Price-amount">£2.00</span></span>
        <span class="zapc-refresh-sold-125">39</span>
        <span class="zapc-refresh-max-125">999</span>
      </li>
    `,
    { ...config, siteName: "littlewin", baseUrl: "https://littlewin.co.uk" },
  )[0]!;

  enrichFromDetailPage(competition, "<div>You may enter this competition up to 99 times.</div>");

  assert.equal(competition.maxEntriesPerUser, 99);
  assert.equal(competition.maxEntriesPerUserSource, "site");
});

test("Zap parser uses the cash amount next to cash in mixed prize titles", () => {
  const [competition] = parsePage(
    `
      <li class="product post-126 product_cat-instant-win">
        <a href="https://littlewin.co.uk/competition/mums-mega/"><h2>Mum's Mega Instant Win – Over £181,000 in Prizes + £500 Cash End Prize!</h2></a>
        <span class="price"><span class="woocommerce-Price-amount">£1.49</span></span>
        <span class="zapc-refresh-sold-126">10</span>
        <span class="zapc-refresh-max-126">100</span>
      </li>
    `,
    { ...config, siteName: "littlewin", baseUrl: "https://littlewin.co.uk" },
  );

  assert.equal(competition?.cashAlternative, 500);
});

test("Little Win scans its complete paginated catalogue", async () => {
  const littleWin = ZAP_SITES.find((site) => site.siteName === "littlewin");
  assert.ok(littleWin);

  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  const card = (sourceId: string, name: string) => `
    <li class="product post-${sourceId}">
      <a href="https://littlewin.co.uk/competition/${sourceId}/"><h2>${name}</h2></a>
      <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
      <span class="zapc-refresh-sold-${sourceId}">1</span>
      <span class="zapc-refresh-max-${sourceId}">100</span>
      <input class="qty" max="10" />
    </li>
    <script>competition-countdown-${sourceId}; DateTime.fromISO("2026-12-01T20:00:00+00:00")</script>
  `;

  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url === "https://littlewin.co.uk/competitions/") {
      return new Response(
        `<p class="woocommerce-result-count">Showing 1–6 of 7 results</p>${card("7933", "Newest prize")}`,
        { status: 200 },
      );
    }
    if (url === "https://littlewin.co.uk/competitions/page/2/") {
      return new Response(card("5968", "Seventh prize"), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new ZapAdapter({ ...littleWin, fetchDelayMs: 0 }).fetchAll();

    assert.deepEqual(requestedUrls, [
      "https://littlewin.co.uk/competitions/",
      "https://littlewin.co.uk/competitions/page/2/",
    ]);
    assert.deepEqual(competitions.map(({ sourceId }) => sourceId), ["7933", "5968"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("TC Comps uses the generic user agent accepted by its live edge", () => {
  const tcComps = ZAP_SITES.find((site) => site.siteName === "tccomps");

  assert.ok(tcComps);
  assert.equal(
    tcComps.userAgent,
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  );
});

test("Zap parser values Hittin' It Big bare cash title competitions", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-3395472 product_cat-cash-competitions">
          <a href="https://hittinitbig.com/competition/5000-49/">
            <h2>£5000</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£0.07</span></span>
          <span class="zapc-refresh-sold-3395472">39,103</span>
          <span class="zapc-refresh-max-3395472">163,999</span>
          <input class="qty" max="3500" />
        </li>
        <li class="product post-3405245 product_cat-mini-draw">
          <a href="https://hittinitbig.com/competition/150k-mini-draw-24/">
            <h2>£150k MINI DRAW</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£0.10</span></span>
          <span class="zapc-refresh-sold-3405245">1,368</span>
          <span class="zapc-refresh-max-3405245">6,799</span>
          <input class="qty" max="750" />
        </li>
      </ul>
    `,
    config,
  );

  assert.equal(comps.length, 2);
  assert.equal(comps[0]?.cashAlternative, 5000);
  assert.equal(comps[1]?.cashAlternative, 150000);
});

test("Zap parser does not value voucher titles as cash", () => {
  const comps = parsePage(
    `
      <li class="product post-1 product_cat-vouchers">
        <a href="https://hittinitbig.com/competition/voucher/">
          <h2>£200 Shopping Voucher</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
        <span class="zapc-refresh-sold-1">1</span>
        <span class="zapc-refresh-max-1">100</span>
      </li>
    `,
    config,
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, null);
});

test("Zap parser reads cash alternative after amount", () => {
  const comps = parsePage(
    `
      <li class="product post-302225 product_cat-uncategorised">
        <a href="https://www.prizeplaycompetitions.com/product/ninja-luxe-coffee-machine-2/">
          <h2>Ninja Luxe Coffee Machine</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.39</span></span>
        <span>Tickets Sold: 224</span>
        <span>3333</span>
        <span>Enter for the chance to win a Ninja Luxe Coffee Machine or a £450 Cash Alternative</span>
        <span class="lty-lottery-countdown-timer" data-time="2026/06/25 19:30:00"></span>
      </li>
    `,
    {
      ...config,
      siteName: "prizeplay",
      displayName: "Prize Play Competitions",
      baseUrl: "https://www.prizeplaycompetitions.com",
      listPath: "/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 450);
});

test("Zap adapter filters sold-out competitions", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      `
        <ul>
          <li class="product post-3271825 product_cat-all">
            <a href="https://hittinitbig.com/competition/sold-out/">
              <h2>WIN 5X BERRY BOMB LIQUIDS OR £50 CASH</h2>
            </a>
            <span class="price"><span class="woocommerce-Price-amount">£0.02</span></span>
            <span class="zapc-refresh-sold-3271825">4,999</span>
            <span class="zapc-refresh-max-3271825">4,999</span>
          </li>
        </ul>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const comps = await new ZapAdapter(config).fetchAll();

    assert.equal(comps.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap adapter does not enrich sold-out rows from related detail cards", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://gigahertzgiveaways.co.uk/competition/switch-2-pokopia-star-fox-260629/";
  let detailRequested = false;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://gigahertzgiveaways.co.uk/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-569966 product_cat-instant-win-comps outofstock competition-closed">
              <a href="${detailUrl}">
                <h2>Nintendo Switch 2 | Pokopia + Star Fox</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£0.15</span></span>
              <span class="zapc-refresh-sold-569966">6,500</span>
              <span class="zapc-refresh-max-569966">6,500</span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      detailRequested = true;
      return new Response(
        `
          <div class="related">
            <span class="zapc-refresh-sold-569997">328</span>
            <span class="zapc-refresh-max-569997">500</span>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter({
      ...config,
      siteName: "gigahertz",
      displayName: "Gigahertz Giveaways",
      baseUrl: "https://gigahertzgiveaways.co.uk",
      listPath: "/competitions/",
    }).fetchAll();

    assert.equal(comps.length, 0);
    assert.equal(detailRequested, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap detail enrichment ignores unrelated zap refresh counters", () => {
  const comp = parsePage(
    `
      <li class="product post-569966 product_cat-instant-win-comps outofstock competition-closed">
        <a href="https://gigahertzgiveaways.co.uk/competition/switch-2-pokopia-star-fox-260629/">
          <h2>Nintendo Switch 2 | Pokopia + Star Fox</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.15</span></span>
        <span class="zapc-refresh-sold-569966">6,500</span>
        <span class="zapc-refresh-max-569966">6,500</span>
      </li>
    `,
    {
      ...config,
      siteName: "gigahertz",
      displayName: "Gigahertz Giveaways",
      baseUrl: "https://gigahertzgiveaways.co.uk",
      listPath: "/competitions/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <h1>Nintendo Switch 2 | Pokopia + Star Fox</h1>
      <div class="related">
        <span class="zapc-refresh-sold-569997">328</span>
        <span class="zapc-refresh-max-569997">500</span>
      </div>
    `,
    {
      ...config,
      siteName: "guitarmarketplace",
    },
  );

  assert.equal(comp.ticketsSold, 6500);
  assert.equal(comp.maxTickets, 6500);
});

test("Zap detail enrichment turns an explicit available ticket total into valid economics", () => {
  const comp = parsePage(
    `
      <li class="product post-652555">
        <a href="https://theguitarmarketplace.com/competition/the-ultimate-guitar-summer/"><h2>The Ultimate Guitar Summer</h2></a>
        <span class="price">£1.99 Per Entry</span>
      </li>
    `,
    config,
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <div id="product-652555">
        <h3>99,999 tickets available</h3>
      </div>
    `,
    {
      ...config,
      siteName: "guitarmarketplace",
    },
  );

  assert.equal(comp.ticketsSold, 0);
  assert.equal(comp.maxTickets, 99999);
});


test("Zap adapter enriches detail-only draw dates", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://hittinitbig.com/competition/the-half-price-pull/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://hittinitbig.com/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-7543 product_cat-single-sports">
              <a href="${detailUrl}">
                <h2>The Half-Price Pull</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
              <span class="zapc-refresh-sold-7543">141</span>
              <span class="zapc-refresh-max-7543">600</span>
              <span>Cash Alternative: £50</span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<script>DateTime.fromISO("2026-06-22T19:00:00+00:00", {zone: "Europe/London"});</script>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.drawDate, "2026-06-22T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap detail enrichment prefers a visible draw time over a countdown ISO value", () => {
  const [comp] = parsePage(
    `
      <li class="product post-26441 product_cat-tech">
        <a href="https://snapcompetitions.co.uk/competition/apple-airtags/">
          <h2>Apple AirTags</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.60</span></span>
        <span class="zapc-refresh-sold-26441">10</span>
        <span class="zapc-refresh-max-26441">300</span>
        <div id="competition-countdown-26441"></div>
        <script>jQuery('.competition-countdown-26441').countdown(DateTime.fromISO("2026-09-02T18:00:00+00:00", {zone: "Europe/London"}))</script>
      </li>
    `,
    config,
  );

  assert.ok(comp);
  assert.equal(comp.drawDate, "2026-09-02T18:00:00.000Z");

  enrichFromDetailPage(comp, "<div>Live draw 2/09/2026 @ 8:00 PM</div>");

  assert.equal(comp.drawDate, "2026-09-02T19:00:00.000Z");
});

test("Zap adapter refreshes details for sites that opt in", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://snapcompetitions.co.uk/competition/apple-airtags/";
  let detailRequested = false;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://snapcompetitions.co.uk/competitions/") {
      return new Response(
        `
          <li class="product post-26441 product_cat-tech">
            <a href="${detailUrl}"><h2>Apple AirTags</h2></a>
            <span class="price"><span class="woocommerce-Price-amount">£0.60</span></span>
            <span class="zapc-refresh-sold-26441">10</span>
            <span class="zapc-refresh-max-26441">300</span>
            <div id="competition-countdown-26441"></div>
            <script>jQuery('.competition-countdown-26441').countdown(DateTime.fromISO("2026-09-02T18:00:00+00:00", {zone: "Europe/London"}))</script>
          </li>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      detailRequested = true;
      return new Response("<div>Live draw 2/09/2026 @ 8:00 PM</div>", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter({
      ...config,
      siteName: "snapcompetitions",
      baseUrl: "https://snapcompetitions.co.uk",
      alwaysEnrichDetails: true,
    }).fetchAll();

    assert.equal(detailRequested, true);
    assert.equal(comps[0]?.drawDate, "2026-09-02T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap adapter enriches detail-only draw dates without cash alternative", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://hittinitbig.com/competition/bike-bundle/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://hittinitbig.com/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-8123 product_cat-tools">
              <a href="${detailUrl}">
                <h2>Bike Bundle</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£0.50</span></span>
              <span class="zapc-refresh-sold-8123">90</span>
              <span class="zapc-refresh-max-8123">500</span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<script>DateTime.fromISO("2026-06-24T20:30:00+01:00", {zone: "Europe/London"});</script>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.drawDate, "2026-06-24T19:30:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap adapter enriches detail-only main cash prizes", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://bullpencompetitions.com/competition/bullys-safe-cracker/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://hittinitbig.com/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-24321 product_cat-cash product_cat-instant-wins">
              <a href="${detailUrl}">
                <h2>BULLY'S SAFE CRACKER</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£0.07</span></span>
              <span class="zapc-refresh-sold-24321">15,742</span>
              <span class="zapc-refresh-max-24321">99,999</span>
              <script>jQuery('.competition-countdown-24321').countdown(DateTime.fromISO("2026-07-13T20:55:00+00:00"));</script>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div id="tab-description">
            <p>1 X £250 MAIN PRIZE WINNER AT THE END SELECTED BY AUTO DRAW!</p>
            <p>£3000 IN INSTANT WIN PRIZES TO BE FOUND!</p>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, 250);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap adapter enriches Dreams2Reality detail cash alternatives", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://www.dreams2reality.co.uk/competition/nintendo-switch-2-bundle/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://www.dreams2reality.co.uk/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-2450811 product_cat-tech-luxury">
              <a href="${detailUrl}">
                <h2>Nintendo Switch 2 Bundle</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£0.08</span></span>
              <span class="zapc-refresh-sold-2450811">849</span>
              <span class="zapc-refresh-max-2450811">9,999</span>
              <script>DateTime.fromISO("2026-07-02T20:55:00+00:00")</script>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div id="tab-description">Nintendo Switch 2 bundle prize details.</div>
          <div class="zapc-cash-alt">Cash Alt: £300</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter({
      ...config,
      siteName: "dreams2reality",
      displayName: "Dreams 2 Reality",
      baseUrl: "https://www.dreams2reality.co.uk",
      listPath: "/competitions/",
    }).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "2450811");
    assert.equal(comps[0]?.cashAlternative, 300);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap adapter enriches detail pages when listing links use a different host form", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://www.hittinitbig.com/competition/host-mismatch/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://hittinitbig.com/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-9911 product_cat-tools">
              <a href="${detailUrl}">
                <h2>Host Mismatch</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
              <span class="zapc-refresh-sold-9911">40</span>
              <span class="zapc-refresh-max-9911">400</span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<script>DateTime.fromISO("2026-06-26T20:00:00+00:00", {zone: "Europe/London"});</script>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.url, detailUrl);
    assert.equal(comps[0]?.drawDate, "2026-06-26T20:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap adapter deduplicates repeated cards without deriving inventory from percentages", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://sploshcompetitions.com/competition/example/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://sploshcompetitions.com/") {
      return new Response(
        `
          <ul>
            <li class="product post-123 product_cat-all">
              <a href="${detailUrl}">
                <h2>Example Draw</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£0.20</span></span>
            </li>
            <li class="product post-123 product_cat-featured">
              <a href="${detailUrl}">
                <h2>Example Draw</h2>
              </a>
              <span class="price"><span class="woocommerce-Price-amount">£0.20</span></span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div>12 % Sold</div>
          <div>5,000 tickets available</div>
          <div>Maximum 500 tickets per person</div>
          <script>DateTime.fromISO("2026-07-01T19:00:00+00:00", {zone: "Europe/London"});</script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ZapAdapter({
      ...config,
      siteName: "splosh",
      displayName: "Splosh Competitions",
      baseUrl: "https://sploshcompetitions.com",
      listPath: "/",
    }).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "123");
    assert.equal(comps[0]?.ticketsSold, 0);
    assert.equal(comps[0]?.maxTickets, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap detail enrichment parses explicit main cash prizes without using instant-win pots", () => {
  const comp = parsePage(
    `
      <li class="product post-24535 product_cat-cash product_cat-instant-wins">
        <a href="https://bullpencompetitions.com/competition/fiver-to-500/">
          <h2>FIVER TO £500</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£5.00</span></span>
        <span class="zapc-refresh-sold-24535">159</span>
        <span class="zapc-refresh-max-24535">16,999</span>
      </li>
    `,
    {
      ...config,
      siteName: "bullpen",
      displayName: "Bullpen Competitions",
      baseUrl: "https://bullpencompetitions.com",
      listPath: "/competitions/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org/",
          "@type": "Product",
          "description": "75 X £500 CASH INSTANT WINS! 50 X £100 SITE CREDIT INSTANT WINS! 1 X £500 CASH MAIN WINNER SELECTED BY AUTO DRAW AT THE END"
        }
      </script>
    `,
  );

  assert.equal(comp.cashAlternative, 500);
});

test("Zap detail enrichment ignores footer winner cash alternatives when product description has no cash", () => {
  const comp = parsePage(
    `
      <li class="product post-3818694 product_cat-uncategorized">
        <a href="https://www.kiltedcompetitions.co.uk/product/garden-patio-furniture-set-2/">
          <h2>Garden Patio Furniture Set</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£1.50</span></span>
        <span class="zapc-refresh-sold-3818694">142</span>
        <span class="zapc-refresh-max-3818694">699</span>
      </li>
    `,
    {
      ...config,
      siteName: "kilted",
      displayName: "Kilted Competitions",
      baseUrl: "https://www.kiltedcompetitions.co.uk",
      listPath: "/competitions/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <div id="tab-description">
        <p>Transform your garden into a stylish retreat with this stunning rattan garden sofa set.</p>
      </div>
      <footer>
        <h3>SET FOR LIFE- £320,000 CASH ALTERNATIVE</h3>
        <h3>£275,000 CASH ALT ON THE 5 BEDROOM ARBROATH HOUSE!</h3>
      </footer>
    `,
  );

  assert.equal(comp.cashAlternative, null);
});

test("Zap detail enrichment ignores unrelated cash alternatives when the product description is missing", () => {
  const comp = parsePage(
    `
      <li class="product post-874736 product_cat-home-garden">
        <a href="https://bonkerscompetitions.co.uk/competition/ninja-creami/">
          <h2>Ninja CREAMi Scoop & Swirl – RRP £349</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
        <span class="zapc-refresh-sold-874736">297</span>
        <span class="zapc-refresh-max-874736">499</span>
      </li>
    `,
    {
      ...config,
      siteName: "bonkers",
      displayName: "Bonkers Competitions",
      baseUrl: "https://bonkerscompetitions.co.uk",
      listPath: "/competitions/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <main id="product-874736" class="product post-874736">
        <h1>Ninja CREAMi Scoop & Swirl – RRP £349</h1>
      </main>
      <section class="related products post-999999">
        <article class="product post-999999">
          <div class="zapc-cash-alt">Cash Alternative: £7,500</div>
        </article>
      </section>
    `,
  );

  assert.equal(comp.cashAlternative, null);
});

test("Zap parser reads Bullpen listing countdowns with Luxon options", () => {
  const comps = parsePage(
    `
      <li class="product post-26440 product_cat-food-drink product_cat-just-added product_cat-tech competition-draw-days-1">
        <a href="https://bullpencompetitions.com/competition/sage-barista-express-impress/">
          <div class="zapc-banner zapc-date-banner zap-draw-days-1">Draw Tomorrow</div>
          <h2>SAGE BARISTA EXPRESS IMPRESS</h2>
        </a>
        <div class="zap-competitions-progress zap-competitions-progress-loop">
          <span class="zapc-refresh-sold-26440">9</span>
          /
          <span class="zapc-refresh-max-26440">250</span>
        </div>
        <div id="competition-countdown-26440" class="zapc-countdown competition-countdown-26440"></div>
        <script>
          let overrideZone = DateTime.fromISO("2026-07-01T19:00:00+00:00", {zone: "Europe/London"});
          jQuery('.competition-countdown-26440').countdown(overrideZone.toLocal().toFormat('yyyy-LL-dd HH:mm:ss'));
        </script>
        <span class="price"><span class="woocommerce-Price-amount">£5.91</span></span>
        <div class="zapc-cash-alt">Cash Alternative: £562</div>
      </li>
    `,
    {
      ...config,
      siteName: "bullpen",
      displayName: "Bullpen Competitions",
      baseUrl: "https://bullpencompetitions.com",
      listPath: "/competitions/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.url, "https://bullpencompetitions.com/competition/sage-barista-express-impress/");
  assert.equal(comps[0]?.entryPrice, 5.91);
  assert.equal(comps[0]?.ticketsSold, 9);
  assert.equal(comps[0]?.maxTickets, 250);
  assert.equal(comps[0]?.cashAlternative, 562);
  assert.equal(comps[0]?.drawDate, "2026-07-01T19:00:00.000Z");
});

test("Zap detail enrichment parses VHS competition fields", () => {
  const comp = parsePage(
    `
      <li class="product post-935 product_cat-watches">
        <a href="https://outdoorcomps.com/competition/omega/">
          <h2>Omega X Swatch - MISSION TO THE MOON</h2>
        </a>
        <span>Cash Alternative: £200</span>
      </li>
    `,
    {
      ...config,
      siteName: "outdoorcomps",
      baseUrl: "https://outdoorcomps.com",
      listPath: "/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <div class="summary entry-summary">
        <div class="vhs-countdown-timer" data-end-date-time="2026-06-14 20:00:00"></div>
        <div>£3.49 <span>PER ENTRY</span></div>
        <div>TICKETS SOLD: 30%</div>
        <div>(51/169)</div>
      </div>
    `,
  );

  assert.equal(comp.entryPrice, 3.49);
  assert.equal(comp.ticketsSold, 51);
  assert.equal(comp.maxTickets, 169);
  assert.equal(comp.drawDate, new Date(2026, 5, 14, 20, 0, 0, 0).toISOString());
});

test("Zap detail enrichment parses slash-formatted data-time countdowns", () => {
  const comp = parsePage(
    `
      <li class="product post-222 product_cat-tech">
        <a href="https://acecompetitions.co.uk/competition/example/">
          <h2>Example</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
        <span class="zapc-refresh-sold-222">25</span>
        <span class="zapc-refresh-max-222">250</span>
      </li>
    `,
    {
      ...config,
      siteName: "acecompetitions",
      baseUrl: "https://acecompetitions.co.uk",
      listPath: "/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `<div class="lty-lottery-countdown-timer" data-time="2026/06/19 20:20:00"></div>`,
  );

  assert.equal(comp.drawDate, new Date(2026, 5, 19, 20, 20, 0, 0).toISOString());
});

test("Zap detail enrichment parses numeric draw date labels", () => {
  const comp = parsePage(
    `
      <li class="product post-2001615 product_cat-tech-competitions">
        <a href="https://www.redline-competitions.com/competition/win-a-nintendo-switch-2-for-just-2p-3-7-26/">
          <h2>Win A Nintendo Switch 2 for just 2p!</h2>
        </a>
        <span class="price">2p Per Entry</span>
        <span class="zapc-refresh-sold-2001615">3,877</span>
        <span class="zapc-refresh-max-2001615">49,999</span>
        <span>Cash Alternative: £350</span>
      </li>
    `,
    {
      ...config,
      siteName: "redline",
      displayName: "Redline Competitions",
      baseUrl: "https://www.redline-competitions.com",
      listPath: "/competitions/",
    },
  )[0]!;

  enrichFromDetailPage(comp, "<div>MAX PER PERSON 4000 DRAW DATE 3/7/26 @ 9:30pm</div>");

  assert.equal(comp.maxEntriesPerUser, 4000);
  assert.equal(comp.drawDate, new Date(2026, 6, 3, 21, 30, 0, 0).toISOString());
});

test("Zap detail enrichment quarantines Splosh percentage-only inventory", () => {
  const comp = parsePage(
    `
      <li class="product post-217714 product_cat-gold-cash">
        <a href="https://sploshcompetitions.com/competition/lucky-7s-777-auto-site-credit-draw-with-over-14000-worth-of-instants/">
          <h2>Lucky 7's! £777 Auto Site Credit Draw with over £14,000 worth of Instants!</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.07</span></span>
      </li>
    `,
    {
      ...config,
      siteName: "splosh",
      displayName: "Splosh Competitions",
      baseUrl: "https://sploshcompetitions.com",
      listPath: "/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <div>13 % Sold</div>
      <div>400000 tickets available</div>
      <div>Maximum 10000 tickets per person</div>
      <script>DateTime.fromISO("2026-07-31T19:55:00+00:00", {zone: "Europe/London"});</script>
    `,
  );

  assert.equal(comp.entryPrice, 0.07);
  assert.equal(comp.maxTickets, 0);
  assert.equal(comp.ticketsSold, 0);
  assert.equal(comp.maxEntriesPerUser, 10000);
  assert.equal(comp.drawDate, "2026-07-31T19:55:00.000Z");
});

test("Zap detail enrichment reads Splosh source-scoped aria inventory", () => {
  const comp = parsePage(
    `
      <li class="product post-230400 product_cat-gold-cash">
        <a href="https://sploshcompetitions.com/competition/example/">
          <h2>Splosh Example</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.07</span></span>
      </li>
    `,
    {
      ...config,
      siteName: "splosh",
      displayName: "Splosh Competitions",
      baseUrl: "https://sploshcompetitions.com",
      listPath: "/",
    },
  )[0]!;

  enrichFromDetailPage(
    comp,
    `
      <div
        class="progress-bar zapc-refresh-progress-230400"
        role="progressbar"
        aria-valuenow="181344"
        aria-valuemax="399999"
      ></div>
      <section class="related">
        <div
          class="progress-bar zapc-refresh-progress-999999"
          role="progressbar"
          aria-valuenow="10"
          aria-valuemax="20"
        ></div>
      </section>
    `,
  );

  assert.equal(comp.ticketsSold, 181344);
  assert.equal(comp.maxTickets, 399999);
});

test("Zap adapter drops competitions whose detail page is closed", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://sploshcompetitions.com/competition/daily-draw-win-a-12ft-trampoline-or-120/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://sploshcompetitions.com/") {
      return new Response(
        `
          <li class="product post-335788 product_cat-auto-draw">
            <a href="${detailUrl}">
              <h2>DAILY DRAW! Win a 12Ft Kanga Trampoline or £120</h2>
            </a>
            <span class="price"><span class="woocommerce-Price-amount">£0.20</span></span>
            <script>DateTime.fromISO("2026-07-20T22:00:00+00:00")</script>
          </li>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div id="product-335788" class="product type-product post-335788 outofstock competition-closed competition-finished">
            <h1>DAILY DRAW! Win a 12Ft Kanga Trampoline or £120</h1>
            <div class="requirement requirement-max-entries">950 tickets available</div>
          </div>
        `,
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new ZapAdapter({
      ...config,
      siteName: "splosh",
      displayName: "Splosh Competitions",
      baseUrl: "https://sploshcompetitions.com",
      listPath: "/",
      paginatedPath: null,
      fetchDelayMs: 0,
    }).fetchAll();

    assert.deepEqual(competitions, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap parser reads card-level slash data-time countdowns", () => {
  const comps = parsePage(
    `
      <li class="product post-333 product_cat-tools">
        <a href="https://boboncomps.co.uk/competition/slushi/">
          <div class="lty-lottery-countdown-timer" data-time="2026/06/22 20:00:00"></div>
          <h2>Instant Wins SLUSHi</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.25</span></span>
        <span>0 Tickets Sold: 107 700 15%</span>
      </li>
    `,
    {
      ...config,
      siteName: "boboncomps",
      baseUrl: "https://boboncomps.co.uk",
      listPath: "/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.ticketsSold, 107);
  assert.equal(comps[0]?.maxTickets, 700);
  assert.equal(comps[0]?.drawDate, new Date(2026, 5, 22, 20, 0, 0, 0).toISOString());
});

test("Zap detail enrichment reads common per-user limit phrases", () => {
  const cases = [
    ["50000 tickets per person", 50000],
    ["125 tickets per user", 125],
    ["50 Max per person", 50],
    ["Ticket limit: 250 per customer", 250],
    ["Maximum per user - 75", 75],
  ] as const;

  for (const [detailText, expected] of cases) {
    const comp = parsePage(
      `
        <li class="product post-123">
          <a href="https://example.com/competition/cash/"><h2>Cash Draw</h2></a>
          <span class="price">£1 Per Entry</span>
          <span class="zapc-refresh-sold-123">1</span>
          <span class="zapc-refresh-max-123">100</span>
        </li>
      `,
      config,
    )[0]!;

    enrichFromDetailPage(comp, `<div>${detailText}</div>`);

    assert.equal(comp.maxEntriesPerUser, expected);
    assert.equal(comp.maxEntriesPerUserSource, "site");
  }
});

test("Zap parser reads simple ends text from cards", () => {
  const comps = parsePage(
    `
      <li class="product post-444 product_cat-cash">
        <a href="https://reverecompetitions.co.uk/product/bottle-blast/">
          <h2>£10K BOTTLE BLAST! INTERACTIVE GAME!</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
        <span>ENDS 24th Jun at 8:00 PM SOLD: 0.19% 37 / 19999</span>
      </li>
    `,
    {
      ...config,
      siteName: "revere",
      baseUrl: "https://reverecompetitions.co.uk",
      listPath: "/shop/",
    },
  );

  const now = new Date();
  const expectedDrawDate = new Date(now.getFullYear(), 5, 24, 20, 0, 0, 0);
  if (expectedDrawDate.getTime() < now.getTime() - (24 * 60 * 60 * 1000)) {
    expectedDrawDate.setFullYear(expectedDrawDate.getFullYear() + 1);
  }

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.drawDate, expectedDrawDate.toISOString());
});

test("Zap adapter bounds parallel detail enrichment and attaches request signals", async () => {
  const originalFetch = globalThis.fetch;
  const detailSignals: Array<AbortSignal | undefined> = [];
  let activeDetails = 0;
  let maxActiveDetails = 0;
  const cards = Array.from({ length: 8 }, (_, index) => {
    const sourceId = 9100 + index;
    return `
      <li class="product post-${sourceId} product_cat-prizes">
        <a href="https://caddycomps.com/competition/prize-${sourceId}/">
          <h2>Prize ${sourceId}</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.50</span></span>
        <span class="zapc-refresh-sold-${sourceId}">10</span>
        <span class="zapc-refresh-max-${sourceId}">100</span>
        <script>DateTime.fromISO("2026-09-01T20:00:00+01:00")</script>
      </li>
    `;
  }).join("");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://caddycomps.com/competitions/") {
      return new Response(`<ul>${cards}</ul>`, { status: 200 });
    }

    if (url.startsWith("https://caddycomps.com/competition/prize-")) {
      detailSignals.push(init?.signal ?? undefined);
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
      } finally {
        activeDetails -= 1;
      }
      return new Response("<div>Ticket limit: 25 per customer</div>", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new ZapAdapter({
      ...config,
      siteName: "caddy",
      displayName: "Caddy Comps",
      baseUrl: "https://caddycomps.com",
      listPath: "/competitions/",
      paginatedPath: null,
      itemsPerPage: 40,
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(competitions.length, 8);
    assert.ok(maxActiveDetails > 1);
    assert.ok(maxActiveDetails <= 6);
    assert.equal(detailSignals.length, 8);
    assert.ok(detailSignals.every((signal) => signal instanceof AbortSignal));
    assert.ok(competitions.every((competition) => competition.maxEntriesPerUser === 25));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap adapter propagates the scan abort signal through detail requests", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  let markDetailStarted!: () => void;
  const detailStarted = new Promise<void>((resolve) => {
    markDetailStarted = resolve;
  });

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://caddycomps.com/competitions/") {
      return new Response(
        `
          <li class="product post-9200 product_cat-prizes">
            <a href="https://caddycomps.com/competition/prize-9200/">
              <h2>Prize 9200</h2>
            </a>
            <span class="price"><span class="woocommerce-Price-amount">£0.50</span></span>
            <span class="zapc-refresh-sold-9200">10</span>
            <span class="zapc-refresh-max-9200">100</span>
            <script>DateTime.fromISO("2026-09-01T20:00:00+01:00")</script>
          </li>
        `,
        { status: 200 },
      );
    }

    if (url === "https://caddycomps.com/competition/prize-9200/") {
      markDetailStarted();
      const signal = init?.signal;
      if (!signal) throw new Error("detail fetch missing abort signal");
      return new Promise<Response>((_resolve, reject) => {
        const rejectForAbort = () => reject(signal.reason);
        if (signal.aborted) {
          rejectForAbort();
        } else {
          signal.addEventListener("abort", rejectForAbort, { once: true });
        }
      });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const pending = new ZapAdapter({
      ...config,
      siteName: "caddy",
      displayName: "Caddy Comps",
      baseUrl: "https://caddycomps.com",
      listPath: "/competitions/",
      paginatedPath: null,
      itemsPerPage: 40,
      fetchDelayMs: 0,
    }).fetchAll(controller.signal);

    await detailStarted;
    controller.abort(new Error("scan cancelled"));
    await assert.rejects(pending, /scan cancelled/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Zap parser reads Lottery Toolkit sold, total, and close fields", () => {
  const [competition] = parsePage(
    `
      <li class="product post-4955">
        <a href="https://danddinittowinit.co.uk/product/nintendo-switch-2/">
          <h2>Nintendo Switch 2</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
        <span class="lty-lottery-countdown-timer" data-time="2026/09/20 23:00:00"></span>
        <div class="lty-progress-count-loop">
          <span class="lty-progress-bar-notice">Sold: 172</span>
          <span class="lty-progress-bar-end">800</span>
        </div>
      </li>
    `,
    { ...config, siteName: "danddinittowinit", baseUrl: "https://danddinittowinit.co.uk" },
  );

  assert.equal(competition?.ticketsSold, 172);
  assert.equal(competition?.maxTickets, 800);
  assert.equal(competition?.drawDate, "2026-09-20T22:00:00.000Z");
});
