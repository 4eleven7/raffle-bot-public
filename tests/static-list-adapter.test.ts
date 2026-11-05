import test from "node:test";
import assert from "node:assert/strict";
import { StaticListAdapter } from "../src/adapters/static-list/static-list-adapter.js";

test("Static list adapter follows generic WooCommerce pagination", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "toomuch",
    displayName: "Too Much Competitions",
    baseUrl: "https://toomuchcompetitions.co.uk",
    listPath: "/competitions-to-enter-win-cash-cars-gold-luxury-prizes/",
    userAgent: "test",
  };
  const firstUrl =
    "https://toomuchcompetitions.co.uk/competition/win-100-tax-free-cash/";
  const secondUrl =
    "https://toomuchcompetitions.co.uk/competition/win-5-entries-into-50g-gold-bar-draw-on-thursday/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <a href="${firstUrl}">Win £100 Tax Free Cash</a>
          <nav class="woocommerce-pagination">
            <a class="page-numbers" href="${config.baseUrl}/competitions-to-enter-win-cash-cars-gold-luxury-prizes/page/2/">2</a>
          </nav>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (
      url ===
      `${config.baseUrl}/competitions-to-enter-win-cash-cars-gold-luxury-prizes/page/2/`
    ) {
      return new Response(
        `
          <a href="${firstUrl}">Win £100 Tax Free Cash</a>
          <a href="${secondUrl}">Win 5 entries into 50g Gold Bar Draw on Thursday</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === firstUrl) {
      return new Response(
        `
          <h1 class="product_title">Win £100 Tax Free Cash</h1>
          <div>£0.17 Per Entry</div>
          <div>66 / 1000 6% Sold</div>
          <div>100 Max Per Person</div>
          <div>Cash Alternative: £100</div>
          <script>DateTime.fromISO("2026-06-18T19:00:00+00:00")</script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === secondUrl) {
      return new Response(
        `
          <h1 class="product_title">Win 5 entries into 50g Gold Bar Draw on Thursday</h1>
          <div>£1.00 Per Entry</div>
          <div>0 / 200 0% Sold</div>
          <div>30 Max Per Person</div>
          <script>DateTime.fromISO("2026-06-18T20:00:00+00:00")</script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);
    assert.deepEqual(
      comps.map((comp) => comp.sourceId),
      [
        "win-100-tax-free-cash",
        "win-5-entries-into-50g-gold-bar-draw-on-thursday",
      ],
    );
    assert.equal(comps[0]?.cashAlternative, 100);
    assert.equal(comps[1]?.maxTickets, 200);
    assert.equal(comps[1]?.drawDate, "2026-06-18T20:00:00+00:00");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter maps Full Motion progress and countdown fields", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "fullmotioncomps",
    displayName: "Full Motion Competition",
    baseUrl: "https://fullmotioncomps.com",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl = `${config.baseUrl}/product/dewalt-184pcs-mechanics-tool-set/`;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">Dewalt 184pcs Mechanics Tool Set</a>`, { status: 200 });
    }
    if (url === detailUrl) {
      return new Response(`
        <div class="product" id="product-2104">
          <h1 class="product_title">Dewalt 184pcs Mechanics Tool Set</h1>
          <div class="pg-countdown" data-pg-countdown="1794950100"><span>39 / 199 tickets</span></div>
          <div class="pg-progress" role="progressbar" aria-valuenow="39" aria-valuemax="199"></div>
          <div class="summary entry-summary">
            <div class="price-per-ticket">£1.49 <small>per entry</small></div>
            <input name="quantity" max="10" />
          </div>
          <div>Free Entry postal route</div>
          <div class="pg-card-grid">
            <article class="pg-comp-card">
              <h3>Related competition worth over £650</h3>
              <div class="pg-progress__track" role="progressbar" aria-valuenow="6" aria-valuemax="99"></div>
            </article>
          </div>
        </div>
      `, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new StaticListAdapter(config).fetchAll();

    assert.equal(competition?.name, "Dewalt 184pcs Mechanics Tool Set");
    assert.equal(competition?.entryPrice, 1.49);
    assert.equal(competition?.ticketsSold, 39);
    assert.equal(competition?.maxTickets, 199);
    assert.equal(competition?.maxEntriesPerUser, 10);
    assert.equal(competition?.estimatedPrizeValue, null);
    assert.equal(competition?.drawDate, "2026-11-17T21:15:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Valtorix exact economics", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "valtorix",
    displayName: "Valtorix Competitions",
    baseUrl: "https://valtorixcompetitions.com",
    listPath: "/competitions",
    userAgent: "test",
  };
  const detailUrl = `${config.baseUrl}/competitions/details/28`;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href=" ${detailUrl} ">Maserati Ghibli DV6</a>`, { status: 200 });
    }
    if (url === detailUrl) {
      return new Response(`
        <h1>Maserati Ghibli DV6 — 3.0 V6 Diesel</h1>
        <div>Price per entry | 1.5 GBP</div>
        <div>Draw date and time | 03 Oct 2026, 00:00</div>
        <div>Cash alternative value | 6000 GBP</div>
        <div>Sold: 0 / 11,294 (0%) Remaining: 11,294</div>
      `, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new StaticListAdapter(config).fetchAll();

    assert.equal(competition?.entryPrice, 1.5);
    assert.equal(competition?.ticketsSold, 0);
    assert.equal(competition?.maxTickets, 11294);
    assert.equal(competition?.cashAlternative, 6000);
    assert.equal(competition?.drawDate, "2026-10-02T23:00:00.000Z");
    assert.equal(competition?.categories[0], "cash");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Prestige Watch Circle progress widgets", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "prestigewatchcircle",
    displayName: "Prestige Watch Circle",
    baseUrl: "https://prestige-watch-circle.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl = `${config.baseUrl}/product/2000-cash/`;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">£2,000 CASH</a>`, { status: 200 });
    }
    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">£2,000 CASH</h1>
          <div class="elementor-icon-box-content">
            <p class="elementor-icon-box-title">£2.50</p>
            <p class="elementor-icon-box-description">Ticket Price</p>
          </div>
          <div class="pwc-loop-progress-tickets-remaining">983 / 1,000 TICKETS REMAINING</div>
          <div class="pwc-loop-countdown" data-end-timestamp="1785958200"></div>
          <div>Fully Automated Draw. Cash prize.</div>
        `,
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new StaticListAdapter(config).fetchAll();

    assert.equal(competition?.entryPrice, 2.5);
    assert.equal(competition?.ticketsSold, 17);
    assert.equal(competition?.maxTickets, 1000);
    assert.equal(competition?.cashAlternative, 2000);
    assert.equal(competition?.drawDate, "2026-08-05T19:30:00.000Z");
    assert.equal(competition?.isAutoDraw, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list Woo cash alternatives stay on the current product", async () => {
  const originalFetch = globalThis.fetch;
  const configs = [
    {
      siteName: "heaven",
      displayName: "Heaven Competitions",
      baseUrl: "https://heavencompetitions.co.uk",
      listPath: "/shop/",
      userAgent: "test",
    },
    {
      siteName: "cashcity",
      displayName: "Cash City Draws",
      baseUrl: "https://cashcitydraws.co.uk",
      listPath: "/",
      userAgent: "test",
    },
    {
      siteName: "magma",
      displayName: "Magma Comps",
      baseUrl: "https://magmacomps.co.uk",
      listPath: "/",
      userAgent: "test",
    },
  ];
  const detailUrls = {
    heaven: "https://heavencompetitions.co.uk/product/gopro-hero13-black/",
    cashcity: "https://cashcitydraws.co.uk/product/amazon-fire-hd-10-kids-pro-tablet/",
    magma: "https://magmacomps.co.uk/competition/new-macbook-air-15inch-for-just-1-99-3/",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    for (const config of configs) {
      if (url === `${config.baseUrl}${config.listPath}`) {
        return new Response(`<a href="${detailUrls[config.siteName as keyof typeof detailUrls]}">Enter</a>`);
      }
    }

    if (url === detailUrls.heaven) {
      return new Response(`
        <h1 class="product_title">GoPro HERO13 Black</h1>
        <div class="woocommerce-product-details__short-description">
          Capture every moment in exceptional detail.
        </div>
        <div>£0.99 Per Entry</div>
        <div>Tickets Sold: 10 / 500</div>
        <script>DateTime.fromISO("2099-07-26T20:00:00+00:00")</script>
        <section>
          <h2>Related Competition</h2>
          <h3>Dyson Supersonic or £280 Cash</h3>
          <p>Cash Alternative: £280</p>
        </section>
      `);
    }

    if (url === detailUrls.cashcity) {
      return new Response(`
        <h1 class="product_title">AMAZON FIRE HD 10 KIDS PRO TABLET</h1>
        <div class="woocommerce-product-details__short-description">
          The current prize is an Amazon tablet.
        </div>
        <div>£0.25 Per Entry</div>
        <div>Tickets Sold: 153 / 1,200</div>
        <script>DateTime.fromISO("2099-07-27T20:00:00+00:00")</script>
        <aside>
          <h2>More competitions</h2>
          <a href="/product/schools-out-summers-in-win-100-cash/">Win £100 CASH</a>
          <p>Cash Alternative: £100</p>
        </aside>
      `);
    }

    if (url === detailUrls.magma) {
      return new Response(`
        <div class="product">
          <h1 class="product_title">NEW MACBOOK AIR 15INCH FOR JUST £1.99 #3</h1>
          <div class="summary entry-summary">
            <div class="zapc-cash-alt">Cash Alternative: AVAILABLE</div>
            <p class="price">£1.99 Per Entry</p>
            <div class="woocommerce-product-details__short-description">
              NEW MACBOOK AIR 15INCH FOR JUST £1.99 #3
            </div>
            <div>Tickets Sold: 1 / 1,299</div>
          </div>
        </div>
        <div id="collapse-desc" class="woocommerce-Tabs-panel--desc">
          <div class="card-body">
            <p>Ticket price: £1.99</p>
            <p>Maximum tickets available: 1,299</p>
            <p>CASH ALTERNATIVE: £1,000</p>
          </div>
        </div>
        <script>DateTime.fromISO("2099-07-22T20:00:00+00:00")</script>
      `);
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const [heaven, cashCity, magma] = await Promise.all(
      configs.map((config) => new StaticListAdapter(config).fetchAll()),
    );

    assert.equal(heaven.length, 1);
    assert.equal(heaven[0]?.cashAlternative, null);
    assert.equal(cashCity.length, 1);
    assert.equal(cashCity[0]?.cashAlternative, null);
    assert.equal(magma.length, 1);
    assert.equal(magma[0]?.entryPrice, 1.99);
    assert.equal(magma[0]?.cashAlternative, 1_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cash City keeps the final draw value separate from larger instant wins", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "cashcity",
    displayName: "Cash City Draws",
    baseUrl: "https://cashcitydraws.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const url =
    "https://cashcitydraws.co.uk/product/throw-for-dough-win-up-to-1000-instantly/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">Throw For Dough</a>`);
    }
    if (String(input) === url) {
      return new Response(`
        <div class="product">
          <h1 class="product_title">Throw For Dough! – Win Up To £1,000 Instantly!</h1>
          <div class="summary entry-summary">
            <p>£0.99 Per Entry</p>
            <p>Tickets Sold: 254 / 15,999</p>
            <p>£250 Main Prize</p>
            <p>Instant wins up to £1,000 cash</p>
            <p>1x £1,000 Cash, 3x £500 Cash, 6x £250 Cash</p>
          </div>
        </div>
        <script>DateTime.fromISO("2099-07-26T20:00:00+00:00")</script>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, 250);
    assert.deepEqual(comps[0]?.categories, ["instant-win"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cash City parses the current product ticket cap", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "cashcity",
    displayName: "Cash City Draws",
    baseUrl: "https://cashcitydraws.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl = `${config.baseUrl}/product/100-amazon-voucher/`;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">£100 AMAZON VOUCHER</a>`);
    }
    if (url === detailUrl) {
      return new Response(`
        <div class="product">
          <h1 class="product_title">£100 AMAZON VOUCHER</h1>
          <div class="summary entry-summary">
            <p>£1.00 Per Entry</p>
            <p>22/150 15% Sold</p>
            <p>Main Prize: £100 Amazon Gift Card or £80 Cash</p>
          </div>
          <p>Max 15 Tickets Per Person</p>
          <div class="countdown-timer" data-enddate="2026-10-04 20:00"></div>
        </div>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new StaticListAdapter(config).fetchAll();

    assert.equal(competition?.maxEntriesPerUser, 15);
    assert.equal(competition?.maxEntriesPerUserSource, "site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter follows configured extra detail paths", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "gaminggiveaways",
    displayName: "Gaming Giveaways",
    baseUrl: "https://www.gaminggiveaways.co.uk",
    listPath: "/competitions/",
    extraDetailPaths: ["/competition/nintendo-switch-2-bundle-instant-wins-33/"],
    userAgent: "test",
  };
  const detailUrl =
    "https://www.gaminggiveaways.co.uk/competition/nintendo-switch-2-bundle-instant-wins-33/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response("<main></main>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">Nintendo Switch 2 Bundle + Instant Wins #33</h1>
          <div>£0.40 Per Entry</div>
          <div>Only 1,432/17,500 sold</div>
          <div>£359 main prize cash alt</div>
          <div>Max 1,400 tickets per user</div>
          <div>Draw 13th Jul 2026 @ 11:59 PM</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "nintendo-switch-2-bundle-instant-wins-33");
    assert.equal(comps[0]?.url, detailUrl);
    assert.equal(comps[0]?.entryPrice, 0.4);
    assert.equal(comps[0]?.ticketsSold, 1432);
    assert.equal(comps[0]?.maxTickets, 17500);
    assert.equal(comps[0]?.maxEntriesPerUser, 1400);
    assert.equal(comps[0]?.cashAlternative, 359);
    assert.equal(comps[0]?.drawDate, new Date(2026, 6, 13, 23, 59, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter follows shop detail links for generic Woo sites", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "3cheers",
    displayName: "3 Cheers Competitions",
    baseUrl: "https://www.3cheerscompetitions.co.uk",
    listPath: "/shop/",
    userAgent: "test",
  };
  const detailUrl = "https://www.3cheerscompetitions.co.uk/shop/1000-cash/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">£1000 CASH</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">£1000 CASH</h1>
          <div>£10.00 Per Ticket.</div>
          <div>Competition ends on: July 26, 2026 9:00 pm (UTC +00:00)</div>
          <div>This competition is limited to 150 tickets</div>
          <div>Tickets Sold : 13</div>
          <div>This competition will have 1 winners</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "1000-cash");
    assert.equal(comps[0]?.entryPrice, 10);
    assert.equal(comps[0]?.ticketsSold, 13);
    assert.equal(comps[0]?.maxTickets, 150);
    assert.equal(comps[0]?.cashAlternative, 1000);
    assert.equal(comps[0]?.drawDate, new Date(2026, 6, 26, 21, 0, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Gaming Loot Shopify-style product pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "gamingloot",
    displayName: "Gaming Loot",
    baseUrl: "https://gamingloot.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://gamingloot.co.uk/products/plug-n-play-rtx-5080-pc-bundle-1";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">RTX 5080 PC Bundle</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1>PLUG N' PLAY | RTX 5080 PC BUNDLE</h1>
          <div>£2.49 Per Ticket</div>
          <div>Tickets Sold: 753/3400</div>
          <div>Only 3400 tickets available</div>
          <div>Live draw on Aug 09 2026, 19:00</div>
          <div>This competition is open to entrants from the UK only.</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "plug-n-play-rtx-5080-pc-bundle-1");
    assert.equal(comps[0]?.entryPrice, 2.49);
    assert.equal(comps[0]?.ticketsSold, 753);
    assert.equal(comps[0]?.maxTickets, 3400);
    assert.equal(comps[0]?.drawDate, new Date(2026, 7, 9, 19, 0, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses The Lucky Hunter detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "theluckyhunter",
    displayName: "The Lucky Hunter",
    baseUrl: "https://theluckyhunter.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://theluckyhunter.co.uk/competition/lokaway-lok4k-14-18-cabinet-2000-cash/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `<a href="${detailUrl}">LOKAWAY LOK-4K 14-18 Cabinet + £2,000 Cash</a>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1>LOKAWAY LOK-4K 14-18 Cabinet + £2,000 Cash</h1>
          <div>£2.49 <span>Per ticket</span></div>
          <div class="vhs-countdown-timer" data-end-date-time="2026-07-06 21:30:00"></div>
          <div>42% Sold <span>(962/2299)</span></div>
          <div>80 Max Per Person</div>
          <div>2299 Total Entries</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "lokaway-lok4k-14-18-cabinet-2000-cash");
    assert.equal(comps[0]?.url, detailUrl);
    assert.equal(comps[0]?.entryPrice, 2.49);
    assert.equal(comps[0]?.ticketsSold, 962);
    assert.equal(comps[0]?.maxTickets, 2299);
    assert.equal(comps[0]?.maxEntriesPerUser, 80);
    assert.equal(comps[0]?.cashAlternative, 2000);
    assert.equal(comps[0]?.drawDate, new Date(2026, 6, 6, 21, 30, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses WilderGoat competition detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "wildergoat",
    displayName: "WilderGoat",
    baseUrl: "https://wildergoat.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://wildergoat.co.uk/competitions/wildergoat-wild-capture-kit-2/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `<a href="${detailUrl}">DJI Outdoor Content Creator Bundle</a>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">DJI Outdoor Content Creator Bundle</h1>
          <div class="wg-single-ticket-progress__track"
               role="progressbar"
               aria-valuenow="25"
               aria-valuemax="1999"></div>
          <div>Entry price From £2.69 per entry</div>
          <div class="main-competition competition-time-countdown"
               data-time="1788721200"></div>
          <input name="quantity" max="150">
          <div>Prize worth £1,722.00</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "wildergoat-wild-capture-kit-2");
    assert.equal(comps[0]?.url, detailUrl);
    assert.equal(comps[0]?.entryPrice, 2.69);
    assert.equal(comps[0]?.ticketsSold, 25);
    assert.equal(comps[0]?.maxTickets, 1999);
    assert.equal(comps[0]?.maxEntriesPerUser, 150);
    assert.equal(comps[0]?.estimatedPrizeValue, 1464);
    assert.equal(comps[0]?.valuationSource, "site_estimate");
    assert.equal(comps[0]?.drawDate, "2026-09-06T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses no-year draw banner dates", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "littlewinzclub",
    displayName: "Little Winz Club",
    baseUrl: "https://www.littlewinzclub.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl = "https://www.littlewinzclub.co.uk/competition/win-200-tax-free-cash/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">Win £200 tax free cash</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">Win £200 tax free cash!</h1>
          <div>First ever draw this Sunday 5th July 8pm</div>
          <div>£0.75 per ticket</div>
          <div>12 tickets sold 848 remaining</div>
          <div>Win £200 tax free cash!</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.75);
    assert.equal(comps[0]?.ticketsSold, 12);
    assert.equal(comps[0]?.maxTickets, 860);
    assert.equal(comps[0]?.cashAlternative, 200);
    assert.equal(comps[0]?.drawDate, new Date(2027, 6, 5, 20, 0, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter prefers slash sold totals before percentage fallback", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "littlewinzclub",
    displayName: "Little Winz Club",
    baseUrl: "https://www.littlewinzclub.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl = "https://www.littlewinzclub.co.uk/competition/win-a-dyson-airwrap/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">Win a Dyson Airwrap</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">Win a Dyson Airwrap</h1>
          <div>£ 2.99 £ 1.99 per ticket</div>
          <div>
            <span>202 / 999 tickets sold</span>
            <strong>21%</strong>
          </div>
          <div data-enddate="2026-07-05 19:00:00"></div>
          <section>
            Amazon Fire HD 10 Kids Tablet
            593 tickets left
            2%
            Ticket price £ 0.99
          </section>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 1.99);
    assert.equal(comps[0]?.ticketsSold, 202);
    assert.equal(comps[0]?.maxTickets, 999);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter keeps LetsWin non-instant prizes despite FAQ instant-win text", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "letswin",
    displayName: "Let's Win",
    baseUrl: "https://www.letswin.co.uk",
    listPath: "/competitions",
    userAgent: "test",
  };
  const url =
    "https://www.letswin.co.uk/competition/firepit-table-with-glass-screen-or-cash-only-89-tickets-02-07/";

  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `<a href="${url}">Firepit Table with Glass Screen or Cash!! Only 89 Tickets!! 02/07</a>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (requestUrl === url) {
      return new Response(
        `
          <h1 class="product_title">Firepit Table with Glass Screen or Cash!! Only 89 Tickets!! 02/07</h1>
          <div>TICKET PRICE £ 3.00</div>
          <div>The prize will be drawn on 02/07/2026 at 20:30</div>
          <div>0% 0 / 89</div>
          <section>FAQs Instant Wins are issued automatically.</section>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "firepit-table-with-glass-screen-or-cash-only-89-tickets-02-07");
    assert.equal(comps[0]?.entryPrice, 3);
    assert.equal(comps[0]?.ticketsSold, 0);
    assert.equal(comps[0]?.maxTickets, 89);
    assert.equal(comps[0]?.cashAlternative, null);
    assert.equal(comps[0]?.maxEntriesPerUserSource, "fallback");
    assert.equal(comps[0]?.drawDate, new Date(2026, 6, 2, 20, 30, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter does not value entry-bundle titles as direct cash", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "netadeal",
    displayName: "Net-A-Deal",
    baseUrl: "https://www.net-a-deal.com",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const url =
    "https://www.net-a-deal.com/competition/100-entries-into-fridays-10000-cash/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">100 Entries into Friday’s £10,000 Cash</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (String(input) === url) {
      return new Response(
        `
          <h1 class="product_title">100 Entries into Friday’s £10,000 Cash</h1>
          <div>£0.99 Per Entry</div>
          <div>137 / 250 55% Sold</div>
          <div>50 Max Per Person</div>
          <script>DateTime.fromISO("2026-06-17T22:59:00+00:00")</script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "100-entries-into-fridays-10000-cash");
    assert.equal(comps[0]?.cashAlternative, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter ignores Net-A-Deal quantity slider ARIA", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "netadeal",
    displayName: "Net-A-Deal",
    baseUrl: "https://www.net-a-deal.com",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const url = "https://www.net-a-deal.com/competition/3000-for-60p-july/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">£3000 for 60p July</a>`);
    }

    if (String(input) === url) {
      return new Response(`
        <main id="product-1827735" class="product">
          <h1 class="product_title">£3000 for 60p July</h1>
          <div class="summary entry-summary">
            <p>£0.60 Per Entry</p>
            <div id="bod-range-track" aria-valuenow="10" aria-valuemax="100"></div>
            <p class="bod-max-tickets">Maximum tickets per user: 100</p>
            <div
              class="progress-bar nadc-refresh-progress-1827735"
              aria-valuenow="3095"
              aria-valuemax="9999"
            ></div>
            <p>Tickets Sold: 3095 of 9999</p>
            <script>DateTime.fromISO("2099-07-29T22:00:00+00:00")</script>
          </div>
        </main>
      `);
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 3095);
    assert.equal(comps[0]?.maxTickets, 9999);
    assert.equal(comps[0]?.maxEntriesPerUser, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Lucky Day remaining plus cap markup", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "luckyday",
    displayName: "Lucky Day Competitions",
    baseUrl: "https://www.luckydaycompetitions.com",
    listPath: "/all-competitions/",
    userAgent: "test",
  };
  const url =
    "https://www.luckydaycompetitions.com/product/ninja-autobarista-pro-bean-to-cup-coffee-machine/";
  const soldOutUrl =
    "https://www.luckydaycompetitions.com/product/lego-technic-construction-bundle/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `<a href="${url}">Ninja Autobarista Pro Bean To Cup Coffee Machine</a>
         <a href="${soldOutUrl}">LEGO Technic Construction Bundle</a>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (String(input) === url) {
      return new Response(
        `
          <h1 class="product_title">Ninja Autobarista Pro Bean To Cup Coffee Machine</h1>
          <div class="product-details-btn-n1">Ends Thu 26th Jun</div>
          <div class="grid-countdown" data-time="2026/06/26 23:00:00"></div>
          <h3>Tickets remaining: 20126</h3>
          <div class="valuesprogress">20126/39997</div>
          <h4>£1.97 <span>per ticket</span></h4>
          <input type="number" max="150" />
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (String(input) === soldOutUrl) {
      return new Response(
        `
          <div id="product-4737084" class="product outofstock">
            <h1 class="product_title">LEGO Technic Construction Bundle</h1>
            <div class="summary entry-summary">
              <p>Sold Out</p>
              <h3>Tickets remaining: 0</h3>
              <div>0%</div>
              <div class="valuesprogress">0/697</div>
              <h4>£1.97 <span>per ticket</span></h4>
            </div>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);
    assert.equal(comps[0]?.sourceId, "ninja-autobarista-pro-bean-to-cup-coffee-machine");
    assert.equal(comps[0]?.ticketsSold, 19871);
    assert.equal(comps[0]?.maxTickets, 39997);
    assert.equal(comps[0]?.entryPrice, 1.97);
    assert.equal(comps[0]?.drawDate, "2026-06-26T22:00:00.000Z");
    assert.equal(comps[1]?.sourceId, "lego-technic-construction-bundle");
    assert.equal(comps[1]?.ticketsSold, 697);
    assert.equal(comps[1]?.maxTickets, 697);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter keeps supported Competition Fox non-cash prizes", async () => {
  const originalFetch = globalThis.fetch;
  const OriginalDate = globalThis.Date;
  const fixedNow = new OriginalDate("2026-06-26T10:00:00.000Z");
  const config = {
    siteName: "competitionfox",
    displayName: "Competition Fox",
    baseUrl: "https://www.competitionfox.com",
    listPath: "/live-competitions/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <div class="product type-product post-18406483 product_cat-ninja-shark">
            <div class="loop-progress-bar"><span>41/66</span></div>
            <a href="https://www.competitionfox.com/competition/ninja-af110uk-4-7l-air-fryer-grey-auto-win-26-06/" class="product-item-heading">
              <h2 class="woocommerce-loop-product__title">Ninja AF110UK 4.7L Air Fryer - Grey-AUTO WIN 26/06</h2>
            </a>
            <span class="status">25 Left</span>
            <span class="price"><span class="woocommerce-Price-amount amount">£3.00</span></span>
          </div>
          <div class="product type-product post-18401542 product_cat-voucher-competitions">
            <div class="loop-progress-bar"><span>36/100</span></div>
            <a href="https://www.competitionfox.com/competition/winner-picks-50-gift-card-for-dunelm-or-the-range-auto-win-26-06/" class="product-item-heading">
              <h2 class="woocommerce-loop-product__title">WINNER PICKS £50 GIFT CARD FOR DUNELM OR THE RANGE -AUTO WIN 26/06</h2>
            </a>
            <span class="status">64 Left</span>
            <span class="price"><span class="woocommerce-Price-amount amount">£2.00</span></span>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };
  globalThis.Date = class extends OriginalDate {
    constructor(...args: ConstructorParameters<DateConstructor>) {
      super(...(args.length === 0 ? [fixedNow.getTime()] : args));
    }

    static now(): number {
      return fixedNow.getTime();
    }
  } as DateConstructor;

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "ninja-af110uk-4-7l-air-fryer-grey-auto-win-26-06");
    assert.equal(comps[0]?.entryPrice, 3);
    assert.equal(comps[0]?.ticketsSold, 41);
    assert.equal(comps[0]?.maxTickets, 66);
    assert.equal(comps[0]?.cashAlternative, null);
    assert.equal(comps[0]?.drawDate, new Date(2026, 5, 26, 21, 0, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = OriginalDate;
  }
});

test("Static list adapter parses Young Comps homepage cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "youngcomps",
    displayName: "Young Comps",
    baseUrl: "https://youngcomps.co.uk",
    listPath: "/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <a href="/prizes/ps10000-draw">
            <div class="group">
              <div class="draw-date">Jun 26th @ 20:00</div>
              <div class="countdown" data-ends="2026-06-26T20:00:00+01:00"></div>
              <h3>£10,000 DRAW</h3>
              <div>Tickets sold: <span>3,224</span></div>
              <div>Available: <span>25,000</span></div>
              <button><span>Enter Now</span><span>99p</span></button>
            </div>
          </a>
          <a href="/prizes/1-mini-draw-100-entries-to-10k-2">
            <div class="group">
              <div class="draw-date">Jun 26th @ 18:00</div>
              <div class="countdown" data-ends="2026-06-26T18:00:00+01:00"></div>
              <h3>£1 Mini Draw - 100 Entries to £10K</h3>
              <div>Tickets sold: <span>11</span></div>
              <div>Available: <span>250</span></div>
              <button><span>Enter Now</span><span>£1.00</span></button>
            </div>
          </a>
          <a href="/prizes/every-ticket-wins">
            <div class="group">
              <h3>EVERY TICKET WINS</h3>
              <div>Tickets sold: <span>999</span></div>
              <div>Available: <span>2000</span></div>
              <button><span>Enter Now</span><span>£2.00</span></button>
            </div>
          </a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "ps10000-draw");
    assert.equal(comps[0]?.entryPrice, 0.99);
    assert.equal(comps[0]?.ticketsSold, 3224);
    assert.equal(comps[0]?.maxTickets, 25000);
    assert.equal(comps[0]?.cashAlternative, 10000);
    assert.equal(comps[0]?.drawDate, "2026-06-26T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses R Kings competitions from __NEXT_DATA__", async () => {
  const originalFetch = globalThis.fetch;
  const futureDrawDate = (days: number) => {
    const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return `${date.toISOString().slice(0, 10)} 21:00:00`;
  };
  const firstDrawDate = futureDrawDate(1);
  const secondDrawDate = futureDrawDate(2);
  const config = {
    siteName: "rkings",
    displayName: "R Kings Competitions",
    baseUrl: "https://rkingscompetitions.com",
    listPath: "/competitions",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "data": [
                    {
                      "short_name": "money-tree-2026-jul-j9",
                      "status": 1,
                      "draw_date": "${firstDrawDate}",
                      "tickets_total": 199999,
                      "tickets_sold": 466,
                      "user_limit_amount": 3999,
                      "price": "0.9900",
                      "sale_price": null,
                      "title": "Money Tree Madness Instant Win Cash Competition"
                    },
                    {
                      "short_name": "cash-2026-jul-vm",
                      "status": 1,
                      "draw_date": "${secondDrawDate}",
                      "tickets_total": 399999,
                      "tickets_sold": 9735,
                      "user_limit_amount": 5000,
                      "price": "0.9900",
                      "sale_price": "0.7900",
                      "title": "Cash, Home & DIY Instant Win Competition"
                    },
                    {
                      "short_name": "expired-comp",
                      "status": 1,
                      "draw_date": "2025-01-01 21:00:00",
                      "tickets_total": 1000,
                      "tickets_sold": 100,
                      "user_limit_amount": 100,
                      "price": "1.0000",
                      "sale_price": null,
                      "title": "Expired Draw"
                    }
                  ]
                }
              }
            }
          </script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);
    assert.equal(comps[0]?.sourceId, "money-tree-2026-jul-j9");
    assert.equal(comps[0]?.entryPrice, 0.99);
    assert.equal(comps[0]?.ticketsSold, 466);
    assert.equal(comps[0]?.maxTickets, 199999);
    assert.equal(comps[0]?.cashAlternative, null);
    assert.equal(comps[0]?.maxEntriesPerUser, 3999);
    assert.equal(
      comps[0]?.url,
      "https://rkingscompetitions.com/competitions/money-tree-2026-jul-j9",
    );
    assert.equal(comps[1]?.entryPrice, 0.79);
    assert.equal(comps[1]?.maxEntriesPerUser, 5000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter uses single-product price before prize title amounts", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "giveawayguysuk",
    displayName: "Giveaway Guys",
    baseUrl: "https://giveawayguys.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const url =
    "https://giveawayguys.co.uk/product/simpsons-hit-and-run-17500-prize-pot/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">SIMPSONS HIT & RUN £17500 PRIZE POT!</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (String(input) === url) {
      return new Response(
        `
          <h1 class="product_title entry-title">SIMPSONS HIT &amp; RUN £17500 PRIZE POT!</h1>
          <p class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">£</span>0.99</bdi></span></p>
          <div>Prize SIMPSONS HIT & RUN £17500 PRIZE POT!</div>
          <div>Competition Ends 30th September 2026 12:00 am</div>
          <div>Ticket Limit 25000</div>
          <div>User Ticket Limit 25000</div>
          <div>Tickets sold: 10 /25000 Tickets remaining: 24990</div>
          <div>Final Getaway Jackpot 1 £1,750</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.99);
    assert.equal(comps[0]?.maxTickets, 25000);
    assert.equal(comps[0]?.ticketsSold, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Coast 2 Coast raffle detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "coast2coast",
    displayName: "Coast 2 Coast Comps",
    baseUrl: "https://www.coast2coastcomps.com",
    listPath: "/active-draws",
    userAgent: "test",
  };
  const firstUrl =
    "https://www.coast2coastcomps.com/raffle/master-of-malt-gift-card-150-to-spend-your-way/";
  const secondUrl =
    "https://www.coast2coastcomps.com/raffle/jellycat-golden-puppy/";
  const thirdUrl =
    "https://www.coast2coastcomps.com/raffle/100-thursday-hustle-2/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <a href="${firstUrl}">Master of Malt</a>
          <div class="pagination">
            <a class="page-numbers" href="${config.baseUrl}/active-draws/page/2">2</a>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === `${config.baseUrl}/active-draws/page/2`) {
      return new Response(
        `
          <a href="${secondUrl}">Jellycat Golden Puppy</a>
          <a href="${thirdUrl}">£100 Thursday Hustle</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === firstUrl) {
      return new Response(
        `
          <h1>MASTER OF MALT GIFT CARD - £150 TO SPEND YOUR WAY!</h1>
          <p>57 Tickets Sold</p>
          <p>541 remaining</p>
          <span class="lty-lottery-countdown-timer" data-time="2026/06/17 20:00:00"></span>
          <p class="price"><span class="woocommerce-Price-amount amount"><bdi><span>£</span>0.58</bdi></span> <span class="suffix">/per entry</span></p>
          <button data-raffle_mpp="20">Enter Now</button>
          <ul><li>Prize Cash Alternative: £130.00</li></ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === secondUrl) {
      return new Response(
        `
          <h1>JELLYCAT GOLDEN PUPPY</h1>
          <p>1 Tickets Sold</p>
          <p>77 remaining</p>
          <span class="lty-lottery-countdown-timer" data-time="2026/06/22 20:00:00"></span>
          <p class="price"><span class="woocommerce-Price-amount amount"><bdi><span>£</span>1.78</bdi></span> <span class="suffix">/per entry</span></p>
          <button data-raffle_mpp="10">Enter Now</button>
          <div class="instant-wins">Instant win prize: £2,000 cash</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === thirdUrl) {
      return new Response(
        `
          <meta name="description" content="&lt;p&gt;Thursday Hustle £100 CASH&lt;/p&gt;">
          <h1>£100 THURSDAY HUSTLE</h1>
          <p>1 Tickets Sold</p>
          <p>127 remaining</p>
          <span class="lty-lottery-countdown-timer" data-time="2026/06/18 20:00:00"></span>
          <p class="price"><span class="woocommerce-Price-amount amount"><bdi><span>£</span>1.78</bdi></span> <span class="suffix">/per entry</span></p>
          <button data-raffle_mpp="10">Enter Now</button>
          <div class="instant-wins">Instant win prize: £500 cash</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 3);
    assert.equal(
      comps[0]?.sourceId,
      "master-of-malt-gift-card-150-to-spend-your-way",
    );
    assert.equal(comps[0]?.entryPrice, 0.58);
    assert.equal(comps[0]?.ticketsSold, 57);
    assert.equal(comps[0]?.maxTickets, 598);
    assert.equal(comps[0]?.maxEntriesPerUser, 20);
    assert.equal(comps[0]?.cashAlternative, 130);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 5, 17, 20, 0, 0, 0).toISOString(),
    );
    assert.equal(comps[1]?.sourceId, "jellycat-golden-puppy");
    assert.equal(comps[1]?.maxTickets, 78);
    assert.equal(comps[1]?.cashAlternative, null);
    assert.equal(comps[2]?.sourceId, "100-thursday-hustle-2");
    assert.equal(comps[2]?.cashAlternative, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter values Pure Prizes cash-only title amounts", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "pureprizes",
    displayName: "Pure Prizes",
    baseUrl: "https://pure-prizes.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const url = "https://pure-prizes.co.uk/product/2500/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">£2500</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (String(input) === url) {
      return new Response(
        `
          <h1 class="product_title">£2500</h1>
          <div>£0.50 Per Ticket</div>
          <div>Competition Ends 5th July 2026 9:00 pm</div>
          <div>Ticket Limit 22000</div>
          <div>User Ticket Limit 500</div>
          <div>Tickets sold: 4106/22000 Tickets remaining: 17894</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, 2500);
    assert.equal(comps[0]?.entryPrice, 0.5);
    assert.equal(comps[0]?.ticketsSold, 4106);
    assert.equal(comps[0]?.maxTickets, 22000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter treats Pure Prizes mini entry draws as entry bundles", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "pureprizes",
    displayName: "Pure Prizes",
    baseUrl: "https://pure-prizes.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const url = "https://pure-prizes.co.uk/product/3k-mini-4/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">£3K Mini 4</a>`);
    }

    if (String(input) === url) {
      return new Response(`
        <main id="product-1234" class="product">
          <h1 class="product_title">£3K Mini 4</h1>
          <div class="summary entry-summary">
            <p class="price">£0.10 Per Ticket</p>
            <p>Competition Ends 29th July 2099 9:00 pm</p>
            <p>Ticket Limit 1500</p>
            <p>User Ticket Limit 75</p>
            <div
              class="wc-comps-tickets-progress-bar"
              aria-valuenow="18"
              aria-valuemax="1500"
            ></div>
            <p>Tickets sold: 270/1500</p>
            <div class="prize-detail">
              <p>Win 500 Entries into The £3000 Draw</p>
            </div>
          </div>
        </main>
      `);
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.name, "Win 500 Entries into The £3000 Draw");
    assert.equal(comps[0]?.ticketsSold, 270);
    assert.equal(comps[0]?.maxTickets, 1500);
    assert.equal(comps[0]?.maxEntriesPerUser, 75);
    assert.equal(comps[0]?.cashAlternative, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter preserves Pure Prizes instant/end-draw identity", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "pureprizes",
    displayName: "Pure Prizes",
    baseUrl: "https://pure-prizes.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const url = "https://pure-prizes.co.uk/product/300/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">300</a>`);
    }
    if (String(input) === url) {
      return new Response(`
        <main class="product product_cat-instants">
          <h1 class="product_title">300</h1>
          <div class="summary entry-summary">
            <p class="price">£0.10 Per Ticket</p>
            <p>10x £300 Instant Wins With A £100 End Prize</p>
            <p>Competition Ends 30th July 2026 9:00 pm</p>
            <p>Ticket Limit 30,000</p>
            <p>Tickets sold: 4,106/30,000</p>
            <span class="posted_in">Category: Instants</span>
          </div>
        </main>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.name, "10x £300 Instant Wins With A £100 End Prize");
    assert.equal(comps[0]?.entryPrice, 0.1);
    assert.equal(comps[0]?.ticketsSold, 4106);
    assert.equal(comps[0]?.maxTickets, 30000);
    assert.deepEqual(comps[0]?.categories, ["instant-win"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Your UK live draws without related-card value leakage", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "yourukcompetitions",
    displayName: "Your UK Competitions",
    baseUrl: "https://www.yourukcompetitions.co.uk",
    listPath: "/competitions",
    userAgent: "test",
  };
  const liveUrl =
    "https://www.yourukcompetitions.co.uk/competitions/33/2-harry-potter-london-tour-tickets-100";
  const noCashUrl =
    "https://www.yourukcompetitions.co.uk/competitions/91/slush-puppie-machine";
  const instantUrl =
    "https://www.yourukcompetitions.co.uk/competitions/18/instant-win-appliance";
  const roundedInventoryUrl =
    "https://www.yourukcompetitions.co.uk/competitions/92/rounded-inventory-only";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <a href="${liveUrl}">2 Harry Potter London Tour Tickets + £100!</a>
          <a href="${noCashUrl}">Slush Puppie Machine</a>
          <a href="${instantUrl}">Instant Win - Appliance!</a>
          <a href="${roundedInventoryUrl}">Rounded Inventory Only</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (String(input) === liveUrl) {
      return new Response(
        `
          <h1>2 Harry Potter London Tour Tickets + £100!</h1>
          <main>
            Live Draws 2 Harry Potter London Tour Tickets + £100!
            £2.50 per ticket 11.4% SOLD Draw 2026-07-04 16:00
            Price £2.50 57 / 500 tickets sold Available 443 Category Live Draws
          </main>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (String(input) === noCashUrl) {
      return new Response(
        `
          <h1>Slush Puppie Machine</h1>
          <main>
            Live Draws Slush Puppie Machine £0.30 per ticket 6.3% SOLD
            Draw 2026-06-27 16:00 19 / 300 tickets sold Remaining 281 Entry £0.30
            Category Live Draws
          </main>
          <aside>Featured: 25P For £100!</aside>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (String(input) === instantUrl) {
      return new Response(
        `
          <h1>Instant Win - Appliance!</h1>
          <main>
            Instant Win - Appliance! £1.00 per ticket 36.6% SOLD
            Draw Instant Win Remaining 168 Category Instant Win
          </main>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (String(input) === roundedInventoryUrl) {
      return new Response(
        `
          <h1>Rounded Inventory Only</h1>
          <main>
            Live Draws Rounded Inventory Only £1.00 per ticket 11.4% SOLD
            Draw 2026-07-04 16:00 Remaining 443 Category Live Draws
          </main>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.deepEqual(
      comps.map((comp) => comp.sourceId),
      ["2-harry-potter-london-tour-tickets-100", "slush-puppie-machine"],
    );
    assert.equal(comps[0]?.entryPrice, 2.5);
    assert.equal(comps[0]?.ticketsSold, 57);
    assert.equal(comps[0]?.maxTickets, 500);
    assert.equal(comps[0]?.cashAlternative, 100);
    assert.equal(comps[1]?.cashAlternative, null);
    assert.equal(comps[1]?.maxTickets, 300);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Prize Pig competition detail cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "prizepig",
    displayName: "Prize Pig Competitions",
    baseUrl: "https://prizepigcompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://prizepigcompetitions.co.uk/competitions/") {
      return new Response(
        '<a href="https://prizepigcompetitions.co.uk/competitions/mamas-papas-harwell-dresser-changer/">Mamas & Papas Harwell Dresser Changer</a>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response(
      `
        <html>
          <body>
            <h1>Mamas & Papas Harwell Dresser Changer</h1>
            <div>550 Max Tickets</div>
            <div>55 MAX PER PERSON</div>
            <div>£3.00 Per Ticket</div>
            <div data-end-date-time="2026-07-04 13:38:00"></div>
            <div>Tickets Sold:</div>
            <div>0 / 550</div>
            <div>GUARANTEED DRAW - No extensions, regardless of ticket sales</div>
          </body>
        </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "mamas-papas-harwell-dresser-changer");
    assert.equal(comps[0]?.entryPrice, 3);
    assert.equal(comps[0]?.ticketsSold, 0);
    assert.equal(comps[0]?.maxTickets, 550);
    assert.equal(comps[0]?.maxEntriesPerUser, 55);
    assert.equal(comps[0]?.drawDate, new Date(2026, 6, 4, 13, 38, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Flagship prize draw detail cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "flagship",
    displayName: "Flagship Competitions",
    baseUrl: "https://flagshipcompetitions.co.uk",
    listPath: "/prize-draws/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://flagshipcompetitions.co.uk/prize-draws/") {
      return new Response(
        '<a href="https://flagshipcompetitions.co.uk/product/100-cash/">£100 Cash</a>',
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response(
      `
        <div class="product">
          <h1 class="product_title">£100 Cash</h1>
          <div class="summary entry-summary">
            <p class="price">£1.00 per entry</p>
            <p>Online entries close Wednesday 30 September 2026 at 8:00pm.</p>
          </div>
          <input name="quantity" max="35" />
          <div class="fc-entry-meter" data-fc-online-close-at="1790794800">
            <dt>Sold</dt>
            <dd>1 of 350 entries allocated</dd>
          </div>
          <p>Total ticket pool: 350</p>
        </div>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "100-cash");
    assert.equal(comps[0]?.entryPrice, 1);
    assert.equal(comps[0]?.ticketsSold, 1);
    assert.equal(comps[0]?.maxTickets, 350);
    assert.equal(comps[0]?.maxEntriesPerUser, 35);
    assert.equal(comps[0]?.cashAlternative, 100);
    assert.equal(comps[0]?.drawDate, "2026-09-30T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses The Kitchen Draw cards and detail data", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "kitchendraw",
    displayName: "The Kitchen Draw",
    baseUrl: "https://inthekitchendraw.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const grillUrl =
    "https://inthekitchendraw.co.uk/product/20262401-traeger-pro-series-575-wood-pellet-grill/";
  const voucherUrl =
    "https://inthekitchendraw.co.uk/product/20262514-400-shopping-vouchers/";
  const cashUrl =
    "https://inthekitchendraw.co.uk/product/20262506-200-tax-free-cash/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://inthekitchendraw.co.uk/") {
      return new Response(
        `
          <div class="kitchen_open_draw__grid">
            <div class="kitchen_open_draw__grid-item">
              <a href="${grillUrl}"><h2>Traeger Pro Series 575 Wood Pellet Grill</h2></a>
              <span class="woocommerce-Price-amount amount">£3.49</span>
              <small>Per Entry</small>
              <div class="kcp-countdown-timer" data-end-time="2026-06-16T20:00:00"></div>
              <span class="kitchen_open_draw__grid-item--remaining">Tickets Available: 307 of 400</span>
            </div>
            <div class="kitchen_open_draw__grid-item">
              <a href="${cashUrl}"><h2>£200 Tax-Free Cash</h2></a>
              <span class="woocommerce-Price-amount amount">£0.99</span>
              <small>Per Entry</small>
              <div class="kcp-countdown-timer" data-end-time="2026-06-18T20:00:00"></div>
              <span class="kitchen_open_draw__grid-item--remaining">Tickets Available: 365 of 400</span>
            </div>
            <div class="kitchen_open_draw__grid-item">
              <a href="${voucherUrl}"><h2>£400 Shopping Vouchers</h2></a>
              <span class="woocommerce-Price-amount amount">£2.49</span>
              <small>Per Entry</small>
              <div class="kcp-countdown-timer" data-end-time="2026-06-23T20:00:00"></div>
              <span class="kitchen_open_draw__grid-item--remaining">Tickets Available: 198 of 300</span>
            </div>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === grillUrl) {
      return new Response(
        `
          <h1>Traeger Pro Series 575 Wood Pellet Grill</h1>
          <span class="woocommerce-Price-amount amount">£3.49</span><small>Per Entry</small>
          <div class="kcp-countdown-timer" data-end-time="2026-06-16 20:00:00"></div>
          <div class="summary">
            <small class="kitchen-ticket-bar__v2--remaining">Tickets Sold: 96 of 400</small>
          </div>
          <table>
            <tr><th>Max Entries Per Customer:</th><td>40</td></tr>
            <tr><th>Prize RRP:</th><td>£799.99</td></tr>
          </table>
          <p>No, we don't offer cash alternatives.</p>
          <section class="related-products">
            <h2>Related Products</h2>
            <div>Tickets Available: 87 of 120</div>
          </section>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === cashUrl) {
      return new Response(
        `
          <h1>£200 Tax-Free Cash</h1>
          <span class="woocommerce-Price-amount amount">£0.99</span><small>Per Entry</small>
          <div class="kcp-countdown-timer" data-end-time="2026-06-18 20:00:00"></div>
          <table>
            <tr><th>Max Entries:</th><td>400</td></tr>
            <tr><th>Entries Received:</th><td>35</td></tr>
            <tr><th>Max Entries Per Customer:</th><td>25</td></tr>
          </table>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === voucherUrl) {
      return new Response(
        `
          <h1>£400 Shopping Vouchers</h1>
          <span class="woocommerce-Price-amount amount">£2.49</span><small>Per Entry</small>
          <div class="summary">
            <small class="kitchen-ticket-bar__v2--remaining">Tickets Sold: 102 of 300</small>
          </div>
          <div class="kcp-countdown-timer" data-end-time="2026-06-23 20:00:00"></div>
          <table>
            <tr><th>Max Entries:</th><td>300</td></tr>
            <tr><th>Entries Received:</th><td>102</td></tr>
            <tr><th>Max Entries Per Customer:</th><td>30</td></tr>
            <tr><th>Prize RRP:</th><td>£400.00</td></tr>
          </table>
          <section class="related-products">
            <h2>Related Products</h2>
            <div>Tickets Available: 87 of 120</div>
          </section>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 3);
    assert.equal(comps[0]?.sourceId, "20262401-traeger-pro-series-575-wood-pellet-grill");
    assert.equal(comps[0]?.entryPrice, 3.49);
    assert.equal(comps[0]?.ticketsSold, 96);
    assert.equal(comps[0]?.maxTickets, 400);
    assert.equal(comps[0]?.maxEntriesPerUser, 40);
    assert.equal(comps[0]?.maxEntriesPerUserSource, "site");
    assert.equal(comps[0]?.cashAlternative, null);
    assert.equal(comps[0]?.estimatedPrizeValue, 799.99);
    assert.equal(comps[0]?.valuationSource, "site_estimate");
    assert.equal(comps[0]?.drawDate, new Date(2026, 5, 16, 20, 0, 0, 0).toISOString());

    assert.equal(comps[1]?.sourceId, "20262506-200-tax-free-cash");
    assert.equal(comps[1]?.entryPrice, 0.99);
    assert.equal(comps[1]?.ticketsSold, 35);
    assert.equal(comps[1]?.maxTickets, 400);
    assert.equal(comps[1]?.maxEntriesPerUser, 25);
    assert.equal(comps[1]?.maxEntriesPerUserSource, "site");
    assert.equal(comps[1]?.cashAlternative, 200);
    assert.equal(comps[1]?.drawDate, new Date(2026, 5, 18, 20, 0, 0, 0).toISOString());

    assert.equal(comps[2]?.sourceId, "20262514-400-shopping-vouchers");
    assert.equal(comps[2]?.entryPrice, 2.49);
    assert.equal(comps[2]?.ticketsSold, 102);
    assert.equal(comps[2]?.maxTickets, 300);
    assert.equal(comps[2]?.maxEntriesPerUser, 30);
    assert.equal(comps[2]?.maxEntriesPerUserSource, "site");
    assert.equal(comps[2]?.cashAlternative, null);
    assert.equal(comps[2]?.estimatedPrizeValue, 400);
    assert.equal(comps[2]?.valuationSource, "site_estimate");
    assert.equal(comps[2]?.drawDate, new Date(2026, 5, 23, 20, 0, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses MCV competition detail cards", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const now = new Date("2026-06-14T10:00:00.000Z").getTime();
  const config = {
    siteName: "mcv",
    displayName: "MCV Competitions",
    baseUrl: "https://www.mcvcompetitions.com",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.mcvcompetitions.com/product/mcgregor-v-holloway-2-las-vegas-package/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://www.mcvcompetitions.com/competitions/") {
      return new Response(
        `<a href="${detailUrl}">MCGREGOR V HOLLOWAY 2 - LAS VEGAS PACKAGE</a>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <html>
            <body>
              <h1>MCGREGOR V HOLLOWAY 2 - LAS VEGAS PACKAGE</h1>
              <div>£14.94 Per Entry</div>
              <div>543 / 1497 36.3% Sold</div>
              <div>100 Max Per Person</div>
              <div>or £2,000 cash</div>
              <div>ENDS IN: 7 DAYS | 12 HRS | 29 MIN</div>
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    Date.now = () => now;
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "mcgregor-v-holloway-2-las-vegas-package");
    assert.equal(comps[0]?.siteName, "mcv");
    assert.equal(comps[0]?.entryPrice, 14.94);
    assert.equal(comps[0]?.ticketsSold, 543);
    assert.equal(comps[0]?.maxTickets, 1497);
    assert.equal(comps[0]?.maxEntriesPerUser, 100);
    assert.equal(comps[0]?.cashAlternative, 2000);
    assert.equal(
      comps[0]?.drawDate,
      new Date(now + ((7 * 24 * 60) + (12 * 60) + 29) * 60 * 1000).toISOString(),
    );
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Heaven competition detail cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "heaven",
    displayName: "Heaven Competitions",
    baseUrl: "https://heavencompetitions.co.uk",
    listPath: "/shop/",
    userAgent: "test",
  };
  const detailUrl = "https://heavencompetitions.co.uk/product/1000-cash-2/";
  const cameraUrl =
    "https://heavencompetitions.co.uk/product/fujifilm-x-m5-mirrorless-with-xc-15-45mm-lens/";
  const freeVoucherUrl =
    "https://heavencompetitions.co.uk/product/free-entry-100-harrods-gift-voucher-3/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://heavencompetitions.co.uk/shop/") {
      return new Response(
        `
          <a href="${detailUrl}">£1000 Cash</a>
          <a href="${cameraUrl}">Fujifilm X-M5 Mirrorless with XC 15–45mm lens</a>
          <a href="${freeVoucherUrl}">Free Entry – £100 Harrods Gift Voucher</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <html>
            <head>
              <meta property="product:price:amount" content="1.99" />
            </head>
            <body>
              <h1 class="product_title">£1000 Cash</h1>
              <div class="lty-lottery-countdown-timer" data-time="2026/07/12 19:30:00"></div>
              <p class="lty-maximum-ticket-notice">This lottery is limited to <b>1199</b> tickets</p>
              <p class="lty-gift-product-notice">Winner will get the Products mentioned in £1000 cash</p>
              <p class="lty-tickets-sold">Tickets Sold : <b>22</b></p>
              <input type="number" name="quantity" max="199" />
              <button><span class="lty-lottery-price" data-price-amount="1.99">£1.99</span></button>
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === freeVoucherUrl) {
      return new Response(
        `
          <html>
            <head>
              <script type="application/ld+json">
                {"@type":"Product","offers":{"@type":"Offer","price":"0","priceCurrency":"GBP"}}
              </script>
            </head>
            <body>
              <h1 class="product_title">Free Entry – £100 Harrods Gift Voucher</h1>
              <div class="lty-lottery-countdown-timer" data-time="2026/06/14 19:30:00"></div>
              <p class="lty-maximum-ticket-notice">This lottery is limited to <b>500</b> tickets</p>
              <p class="lty-gift-product-notice">Winner will get the Products mentioned in £80 cash</p>
              <p class="lty-tickets-sold">Tickets Sold : <b>329</b></p>
              <input type="number" name="quantity" max="1" />
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === cameraUrl) {
      return new Response(
        `
          <html>
            <head>
              <meta property="product:price:amount" content="0.99" />
            </head>
            <body>
              <h1 class="product_title">Fujifilm X-M5 Mirrorless with XC 15–45mm lens</h1>
              <div class="lty-lottery-countdown-timer" data-time="2026/06/14 19:30:00"></div>
              <p class="lty-maximum-ticket-notice">This lottery is limited to <b>271</b> tickets</p>
              <p class="lty-gift-product-notice">Winner will get the Products mentioned in £800 Prize or £800 cash</p>
              <p class="lty-tickets-sold">Tickets Sold : <b>0</b></p>
              <input type="number" name="quantity" max="100" />
              <button><span class="lty-lottery-price" data-price-amount="0.99">£0.99</span></button>
            </body>
          </html>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);

    const cash = comps.find((comp) => comp.sourceId === "1000-cash-2");
    assert.equal(cash?.siteName, "heaven");
    assert.equal(cash?.entryPrice, 1.99);
    assert.equal(cash?.ticketsSold, 22);
    assert.equal(cash?.maxTickets, 1199);
    assert.equal(cash?.maxEntriesPerUser, 199);
    assert.equal(cash?.cashAlternative, 1000);
    assert.equal(cash?.drawDate, new Date(2026, 6, 12, 19, 30, 0, 0).toISOString());

    const camera = comps.find(
      (comp) => comp.sourceId === "fujifilm-x-m5-mirrorless-with-xc-15-45mm-lens",
    );
    assert.equal(camera?.entryPrice, 0.99);
    assert.equal(camera?.ticketsSold, 0);
    assert.equal(camera?.maxTickets, 271);
    assert.equal(camera?.maxEntriesPerUser, 100);
    assert.equal(camera?.cashAlternative, 800);
    assert.equal(
      comps.some((comp) => comp.sourceId === "free-entry-100-harrods-gift-voucher-3"),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter enriches Lucky Turbo cards from the Next payload", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "luckyturbo",
    displayName: "Lucky Turbo",
    baseUrl: "https://luckyturbo.co.uk",
    listPath: "/",
    userAgent: "test",
  };

  globalThis.fetch = async () =>
    new Response(
      `
        <html>
          <body>
            <a href="/competition/win-ooni-koda-12-essentials-bundle">
              Live Draw Win Ooni Koda 12 Essentials Bundle
              Cash Alternative: £250
              SOLD 18.6%
              813 left
              £0.89 Enter
            </a>
            <script>
              self.__next_f.push([1,"{\\"id\\":124,\\"title\\":\\"Win Ooni Koda 12 Essentials Bundle\\",\\"slug\\":\\"win-ooni-koda-12-essentials-bundle\\",\\"description\\":\\"\\",\\"shortDescription\\":\\"\\",\\"mainImageUrl\\":\\"\\",\\"galleryImages\\":\\"[]\\",\\"ticketPrice\\":89,\\"salePrice\\":null,\\"minTickets\\":1,\\"maxTickets\\":999,\\"maxTicketsPerUser\\":12,\\"ticketsSold\\":186,\\"mainPrizeTitle\\":\\"Ooni Koda 12 Essentials Bundle\\",\\"mainPrizeValue\\":25000,\\"prizeDeliveryMethod\\":\\"Delivered to winner\\",\\"startDate\\":\\"2026-05-11T08:27:00+00:00\\",\\"endDate\\":\\"2026-06-12T17:30:00+00:00\\",\\"drawDate\\":\\"2026-06-12T17:30:00+00:00\\",\\"type\\":\\"draw\\",\\"instantWinPercentage\\":0,\\"status\\":\\"active\\"}"])
            </script>
          </body>
        </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.89);
    assert.equal(comps[0]?.ticketsSold, 186);
    assert.equal(comps[0]?.maxTickets, 999);
    assert.equal(comps[0]?.maxEntriesPerUser, 12);
    assert.equal(comps[0]?.cashAlternative, 250);
    assert.equal(comps[0]?.drawDate, new Date("2026-06-12T17:30:00+00:00").toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter leaves Lucky Turbo inventory unknown without an exact payload", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "luckyturbo",
    displayName: "Lucky Turbo",
    baseUrl: "https://luckyturbo.co.uk",
    listPath: "/",
    userAgent: "test",
  };

  globalThis.fetch = async () =>
    new Response(
      `
        <a href="/competition/win-ooni-koda-12-essentials-bundle">
          Live Draw Win Ooni Koda 12 Essentials Bundle
          Cash Alternative: £250 SOLD 18.6% 813 left £0.89 Enter
        </a>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 0);
    assert.equal(comps[0]?.maxTickets, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter leaves Competition Platform inventory unknown when only rounded percentage and remaining are shown", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "competitionplatform",
    displayName: "Competition Platform",
    baseUrl: "https://competition-platform.test",
    listPath: "/competitions",
    userAgent: "test",
  };

  globalThis.fetch = async () =>
    new Response(
      `
        <article>
          <a href="/competitions/rounded-inventory"><h2>Rounded Inventory</h2></a>
          <div>£1.00 Per Entry 11.4% Sold 443 remaining</div>
          <div>Draw 2099-07-04 16:00</div>
        </article>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 0);
    assert.equal(comps[0]?.maxTickets, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter quarantines generic Woo rows with percentage-derived inventory only", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "campfirecomps",
    displayName: "Campfire Comps UK",
    baseUrl: "https://campfirecomps.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl = "https://campfirecomps.co.uk/competition/rounded-inventory/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">Rounded Inventory</a>`, { status: 200 });
    }
    if (String(input) === detailUrl) {
      return new Response(
        `
          <h1 class="product_title">Rounded Inventory</h1>
          <div>£1.00 Per Entry</div>
          <div>11.4% Sold 443 Tickets Available</div>
          <div>Draw 4th Jul 2099 @ 4:00 PM</div>
        `,
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();
    assert.deepEqual(comps, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter leaves Jammy inventory unknown when only remaining and rounded progress are shown", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "jammy",
    displayName: "Jammy",
    baseUrl: "https://www.jammy.co.uk",
    listPath: "/auto-draws/",
    userAgent: "test",
  };

  globalThis.fetch = async () =>
    new Response(
      `
        <li class="product">
          <a href="https://www.jammy.co.uk/shop/rounded-inventory">
            <img alt="Win £500 Cash" />
          </a>
          <span class="price">£1.00</span>
          <span>800 Tickets Left</span>
          <div class="progress-bar-inner" style="width: 20%"></div>
          <div class="clockdiv" data-date="2099-07-04T20:00:00Z"></div>
        </li>
      `,
      { status: 200 },
    );

  try {
    const comps = await new StaticListAdapter(config).fetchAll();
    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 0);
    assert.equal(comps[0]?.maxTickets, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter only uses exact Campervan sold plus remaining inventory", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "campervanwin",
    displayName: "Campervan.Win",
    baseUrl: "https://www.campervan.win",
    listPath: "/competitions",
    userAgent: "test",
  };

  globalThis.fetch = async () =>
    new Response(
      `
        <article>
          <a href="/competitions/rounded-inventory"><h2>Rounded Inventory</h2></a>
          <div>ENTRIES SOLD 200 20% SOLD ENTER COMPETITION</div>
        </article>
        <article>
          <a href="/competitions/exact-inventory"><h2>Exact Inventory</h2></a>
          <div>ENTRIES SOLD 200 ENTRIES REMAINING 800 ENTER COMPETITION</div>
        </article>
      `,
      { status: 200 },
    );

  try {
    const comps = await new StaticListAdapter(config).fetchAll();
    assert.equal(comps.length, 2);
    assert.equal(comps[0]?.ticketsSold, 200);
    assert.equal(comps[0]?.maxTickets, 0);
    assert.equal(comps[1]?.ticketsSold, 200);
    assert.equal(comps[1]?.maxTickets, 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter enriches Lucky Charm draw dates from detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "luckycharm",
    displayName: "Lucky Charm Raffles",
    baseUrl: "https://www.luckycharmraffles.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.luckycharmraffles.co.uk/product/win-this-prada-paradoxe-or-cash-alternative/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://www.luckycharmraffles.co.uk/") {
      return new Response(
        `
          <ul>
            <li class="product">
              <a href="${detailUrl}">
                <h2>Lucky £50 Cash Drop - Only £1.99</h2>
              </a>
              <span>2,000 available</span>
              <span>1,500 Tickets remaining</span>
              <span>instant wins</span>
              <span>£1.99</span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<div class="lty-lottery-countdown-timer" data-time="2026/06/29 17:30:00"></div>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 1.99);
    assert.equal(comps[0]?.ticketsSold, 500);
    assert.equal(comps[0]?.maxTickets, 2000);
    assert.equal(comps[0]?.cashAlternative, 50);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 5, 29, 17, 30, 0, 0).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter enriches Lucky Charm Free 2 Enter draw dates", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "luckycharm",
    displayName: "Lucky Charm Raffles",
    baseUrl: "https://www.luckycharmraffles.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.luckycharmraffles.co.uk/product/free-2-enter-plouise-mystery-box/";
  const fetched: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url === `${config.baseUrl}/`) {
      return new Response(
        `
          <ul>
            <li class="product">
              <a href="${detailUrl}">
                <h2>Free 2 Enter – plouise mystery box</h2>
              </a>
              <span>2,000 available</span>
              <span>1,880 Tickets remaining</span>
              <span>£0.00</span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<div class="lty-lottery-countdown-timer" data-time="2026/07/27 17:30:00"></div>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0);
    assert.equal(comps[0]?.ticketsSold, 120);
    assert.equal(comps[0]?.maxTickets, 2000);
    assert.deepEqual(comps[0]?.categories, ["free"]);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 6, 27, 17, 30, 0, 0).toISOString(),
    );
    assert.ok(fetched.includes(detailUrl));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter reads Lucky Charm EventScheduled JSON-LD dates", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "luckycharm",
    displayName: "Lucky Charm Raffles",
    baseUrl: "https://www.luckycharmraffles.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.luckycharmraffles.co.uk/product/win-this-meta-quest-3s-128gb-vr-headset/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://www.luckycharmraffles.co.uk/") {
      return new Response(
        `
          <ul>
            <li class="product">
              <a href="${detailUrl}">
                <h2>Win This Meta Quest 3S 128GB VR Headset - £1.79</h2>
              </a>
              <span>250 available</span>
              <span>244 Tickets remaining</span>
              <span>£1.79</span>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"EventScheduled","endDate":"2026-07-20T18:30:00+01:00"}
          </script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 6);
    assert.equal(comps[0]?.maxTickets, 250);
    assert.equal(
      comps[0]?.drawDate,
      new Date("2026-07-20T18:30:00+01:00").toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter enriches Borders epoch countdown draw dates", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "borders",
    displayName: "Borders Competitions",
    baseUrl: "https://borderscompetitions.co.uk",
    listPath: "/all-competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://borderscompetitions.co.uk/product/win-10000-tax-free-cash-for-just-1p/";
  const epochSeconds = 1_781_293_500;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://borderscompetitions.co.uk/all-competitions/") {
      return new Response(
        `
          <div class="mu-product-card">
            <a href="${detailUrl}">
              <h3 class="mu-product-title">WIN THIS PORSCHE GT3RS + £2.5K CASH | £175,000 CASH ALTERNATIVE</h3>
            </a>
            <span>Tickets Sold: 48%</span>
            <span>Tickets available: 784068 1517222</span>
            <span>£0.01 PER ENTRY</span>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<div class="main-lottery lottery-time-countdown" data-time="${epochSeconds}"></div>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.01);
    assert.equal(comps[0]?.ticketsSold, 733154);
    assert.equal(comps[0]?.maxTickets, 1517222);
    assert.equal(comps[0]?.cashAlternative, 175000);
    assert.equal(
      comps[0]?.drawDate,
      new Date(epochSeconds * 1000).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter reads embedded DrawDate fields from generic detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "enhancedlife",
    displayName: "Enhanced Life Competitions",
    baseUrl: "https://enhancedlifecompetitions.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://enhancedlifecompetitions.co.uk/competition/ford-mustang-gt-50-or-ps27500";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://enhancedlifecompetitions.co.uk/") {
      return new Response(
        `<a href="${detailUrl}">Ford Mustang GT 5.0 OR £27,500!</a>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1>Ford Mustang GT 5.0 OR £27,500!</h1>
          <div>Tickets Sold: 55,085 / 480,000</div>
          <div>£0.25 Per Entry</div>
          <script>
            const item = {"DrawDate":"2026-08-02T19:30:00.000000Z","CashAlternative":27500};
          </script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, 27500);
    assert.equal(comps[0]?.drawDate, "2026-08-02T19:30:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Enhanced Life ticket-bundle pages do not borrow the target draw cash alternative", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "enhancedlife",
    displayName: "Enhanced Life Competitions",
    baseUrl: "https://enhancedlifecompetitions.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://enhancedlifecompetitions.co.uk/competition/connors-ticket-booth-ps500-ticket-bundle-end-prize";

  globalThis.fetch = async (input) => {
    if (String(input) === "https://enhancedlifecompetitions.co.uk/") {
      return new Response(`<a href="${detailUrl}">Connor's Ticket Booth</a>`);
    }

    return new Response(`
      <h1>Connors Ticket Booth - £500 Ticket Bundle End Prize</h1>
      <div>Tickets Sold: 1,125 / 202,000</div>
      <div>£0.15 Per Entry</div>
      <script>
        const current = {"DrawDate":"2030-08-02T18:30:00.000000Z","CashAlternative":0};
      </script>
      <section class="related-products">
        Ford Mustang GT 5.0 OR £27,500 Cash Alternative
      </section>
    `);
  };

  try {
    const [competition] = await new StaticListAdapter(config).fetchAll();

    assert.ok(competition);
    assert.equal(competition.name, "Connors Ticket Booth - £500 Ticket Bundle End Prize");
    assert.equal(competition.cashAlternative, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter reads generic data-enddate countdowns", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "collie",
    displayName: "Collie Competitions",
    baseUrl: "https://colliecompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://colliecompetitions.co.uk/competitions/pokemon-tcg-mega-evolution-ascended-heroes-pokemon-centre-edition-etb/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://colliecompetitions.co.uk/competitions/") {
      return new Response(
        `<a href="${detailUrl}">Pokémon TCG: Mega Evolution</a>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <h1>Pokémon TCG: Mega Evolution</h1>
          <div>Tickets Sold: 10 / 220</div>
          <div>£3 Per Entry</div>
          <div>£300 Tax-Free Cash Alternative</div>
          <div class="countdown-timer" data-enddate="2026-06-14 19:00"></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, 300);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 5, 14, 19, 0, 0, 0).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter does not leak a neighbouring Collie cash prize into the target product", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "collie",
    displayName: "Collie Competitions",
    baseUrl: "https://colliecompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://colliecompetitions.co.uk/competitions/auto-draw-pre-order-lego-hubble-space-telescope-11382/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">LEGO Hubble Space Telescope</a>`);
    }

    if (String(input) === detailUrl) {
      return new Response(`
        <main>
          <div class="summary entry-summary">
            <h1>LEGO Hubble Space Telescope</h1>
            <div>Tickets Sold: 10 / 220</div>
            <div>£3 Per Entry</div>
            <div class="countdown-timer" data-enddate="2099-07-24 19:00"></div>
          </div>
          <section class="related products">
            <h2>Win £2,000 Cash</h2>
            <p>Cash Alternative: £2,000</p>
            <script type="application/json">{"CashAlternative":2000}</script>
          </section>
        </main>
      `);
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new StaticListAdapter(config).fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.name, "LEGO Hubble Space Telescope");
    assert.equal(competitions[0]?.cashAlternative, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter enriches Donkey competition details", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "donkeycomps",
    displayName: "Donkey Comps",
    baseUrl: "https://www.donkeycomps.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.donkeycomps.co.uk/product/win-this-stunning-1992-ford-sierra-2-0-twin-cam/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://www.donkeycomps.co.uk/") {
      return new Response(
        `
          <div>
            <img alt="WIN THIS STUNNING 1992 FORD SIERRA 2.0 TWIN CAM">
            <span>£8.97 per Entry</span>
            <a href="${detailUrl}">Enter Now</a>
            <span>OR £6500 CASH ALTERNATIVE!</span>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div class="lottery-time-countdown" data-time="1781730000"></div>
          <p>This Draw is limited to 1550 tickets</p>
          <p>Tickets sold: 374</p>
          <progress max="1550" value="374"></progress>
          <input class="qty" max="75">
          <p>OR <strong>£6500</strong> CASH ALTERNATIVE!</p>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 374);
    assert.equal(comps[0]?.maxTickets, 1550);
    assert.equal(comps[0]?.maxEntriesPerUser, 75);
    assert.equal(comps[0]?.cashAlternative, 6500);
    assert.equal(comps[0]?.drawDate, new Date(1_781_730_000 * 1000).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Spin Competitions listing cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "spincompetitions",
    displayName: "Spin Competitions",
    baseUrl: "https://www.spincompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://www.spincompetitions.co.uk/competitions/");
    return new Response(
      `
        <div class="jet-listing-grid__item jet-listing-dynamic-post-133380">
          <a href="https://www.spincompetitions.co.uk/competition/lego-harry-potter-bundle-or-1500-with-6250-of-instant-wins/">
            <h1>LEGO Harry Potter Bundle (or £1,500) with £6,250 of Instant Wins</h1>
          </a>
          <span>Cash Alternative : £1,500</span>
          <span>Guaranteed Draw : Thurs 18th June @ 7:15pm</span>
          <span>£3.00 Each</span>
          <span>3999 Total</span>
          <span>400 Max</span>
          <span>Tickets available: 1956</span>
          <div class="main-lottery lottery-time-countdown" data-time="1781805600"></div>
          <a href="https://www.spincompetitions.co.uk/competition/lego-harry-potter-bundle-or-1500-with-6250-of-instant-wins/">View Competition</a>
        </div>
        <div class="jet-listing-grid__item jet-listing-dynamic-post-133370">
          <a href="https://www.spincompetitions.co.uk/competition/300-spin-credit-low-odds-64/">
            <h1>£300 Spin Credit Low Odds</h1>
          </a>
          <span>£4.00 Each</span>
          <span>99 Total</span>
          <span>10 Max</span>
          <span>Tickets available: 53</span>
          <div class="main-lottery lottery-time-countdown" data-time="1781805600"></div>
          <a href="https://www.spincompetitions.co.uk/competition/300-spin-credit-low-odds-64/">View Competition</a>
        </div>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);
    assert.equal(
      comps[0]?.sourceId,
      "lego-harry-potter-bundle-or-1500-with-6250-of-instant-wins",
    );
    assert.equal(
      comps[0]?.name,
      "LEGO Harry Potter Bundle (or £1,500) with £6,250 of Instant Wins",
    );
    assert.equal(comps[0]?.entryPrice, 3);
    assert.equal(comps[0]?.ticketsSold, 2043);
    assert.equal(comps[0]?.maxTickets, 3999);
    assert.equal(comps[0]?.maxEntriesPerUser, 400);
    assert.equal(comps[0]?.cashAlternative, 1500);
    assert.equal(comps[0]?.drawDate, new Date(1_781_805_600 * 1000).toISOString());

    assert.equal(comps[1]?.sourceId, "300-spin-credit-low-odds-64");
    assert.equal(comps[1]?.cashAlternative, null);
    assert.equal(comps[1]?.ticketsSold, 46);
    assert.equal(comps[1]?.maxTickets, 99);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Victory Vaults listing cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "victoryvaults",
    displayName: "Victory Vaults",
    baseUrl: "https://victoryvaults.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://victoryvaults.co.uk/competitions/");
    return new Response(
      `
        <div class="product type-product post-22602 status-publish instock product_cat-tech product-type-lottery">
          <a class="product-content-image" href="https://victoryvaults.co.uk/product/main-prize-ninja-wood-fire-bbq-grill-smoker-or-250-cash-and-8-instant-wins/">
            <div class="enddate-overlay"><strong>Closes</strong> 11/07/2026 7:00 pm</div>
          </a>
          <h2 class="product-title">
            <a href="https://victoryvaults.co.uk/product/main-prize-ninja-wood-fire-bbq-grill-smoker-or-250-cash-and-8-instant-wins/">Main Prize - NINJA WOOD FIRE BBQ GRILL SMOKER OR £250 CASH AND 8 INSTANT WINS</a>
          </h2>
          <span class="price"><span class="woocommerce-Price-amount amount">£1.50</span></span>
          <span class="lty-progress-bar-start">0</span>
          <span class="lty-progress-bar-notice">Tickets Sold: 10</span>
          <span class="lty-progress-bar-end">1500</span>
          <a class="button product_type_lottery add_to_cart_button">ENTER NOW</a>
        </div>
        <div class="product type-product post-18391 status-publish instock product_cat-tech product-type-lottery">
          <a class="product-content-image" href="https://victoryvaults.co.uk/product/nintendo-switch-2/">
            <div class="enddate-overlay"><strong>Closes</strong> 13/06/2026 7:00 pm</div>
          </a>
          <h2 class="product-title"><a href="https://victoryvaults.co.uk/product/nintendo-switch-2/">NINTENDO SWITCH 2</a></h2>
          <span class="price"><span class="woocommerce-Price-amount amount">£0.99</span></span>
          <span class="lty-progress-bar-notice">Tickets Sold: 900</span>
          <span class="lty-progress-bar-end">1000</span>
          <a class="button product_type_lottery add_to_cart_button">VIEW WINNER</a>
        </div>
        <div class="product type-product post-18409 status-publish instock product_cat-cash product-type-lottery">
          <a class="product-content-image" href="https://victoryvaults.co.uk/product/free-entry-250-cash/">
            <div class="enddate-overlay"><strong>Closes</strong> 30/06/2026 7:00 pm</div>
          </a>
          <h2 class="product-title">
            <a href="https://victoryvaults.co.uk/product/free-entry-250-cash/">FREE ENTRY £250 CASH!</a>
          </h2>
          <span class="price"><span class="woocommerce-Price-amount amount">£0.00</span></span>
          <span class="lty-progress-bar-notice">Tickets Sold: 275</span>
          <span class="lty-progress-bar-end">25000</span>
          <a class="button product_type_lottery add_to_cart_button">ENTER NOW</a>
        </div>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);
    assert.equal(
      comps[0]?.sourceId,
      "main-prize-ninja-wood-fire-bbq-grill-smoker-or-250-cash-and-8-instant-wins",
    );
    assert.equal(
      comps[0]?.name,
      "Main Prize - NINJA WOOD FIRE BBQ GRILL SMOKER OR £250 CASH AND 8 INSTANT WINS",
    );
    assert.equal(comps[0]?.entryPrice, 1.5);
    assert.equal(comps[0]?.ticketsSold, 10);
    assert.equal(comps[0]?.maxTickets, 1500);
    assert.equal(comps[0]?.cashAlternative, 250);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 6, 11, 19, 0, 0, 0).toISOString(),
    );
    assert.deepEqual(comps[0]?.categories, ["tech"]);

    assert.equal(comps[1]?.sourceId, "free-entry-250-cash");
    assert.equal(comps[1]?.entryPrice, 0);
    assert.equal(comps[1]?.ticketsSold, 275);
    assert.equal(comps[1]?.maxTickets, 25000);
    assert.equal(comps[1]?.cashAlternative, 250);
    assert.deepEqual(comps[1]?.categories, ["cash"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses generic Woo detail variants from live-style copy", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "campfirecomps",
    displayName: "Campfire Comps UK",
    baseUrl: "https://campfirecomps.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const campfireUrl = "https://campfirecomps.co.uk/competition/dji-mini-4k-5/";
  const winningWazeUrl =
    "https://campfirecomps.co.uk/competition/winning-waze-proxy/";
  const winABundleUrl =
    "https://campfirecomps.co.uk/competition/win-a-bundle-proxy/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <a href="${campfireUrl}">DJI Mini 4K</a>
          <a href="${winningWazeUrl}">Winning Waze Proxy</a>
          <a href="${winABundleUrl}">Win A Bundle Proxy</a>
          <a href="https://campfirecomps.co.uk/competition/stale-link/">Stale</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === campfireUrl) {
      return new Response(
        `
          <h1 class="product_title">DJI Mini 4K</h1>
          <div>Max Entires: 350</div>
          <div>47 Tickets Sold 303 Tickets Left</div>
          <div>Max Per User: 35</div>
          <div>£0.99</div>
          <div>Draw on Wednesday, 24 Jun</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === winningWazeUrl) {
      return new Response(
        `
          <h1 class="product_title">LAY-Z-SPA Hollywood AirJet - 6 person Hot Tub or £400 CASH</h1>
          <div>68p to play</div>
          <div>11% SOLD 215 of 1999 tickets sold</div>
          <div>Limit: 200 tickets per person.</div>
          <div>Entries close Friday 19th June at 7:30pm, and the live draw will take place at 8pm LIVE on our Facebook page.</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === winABundleUrl) {
      return new Response(
        `
          <h1 class="product_title">Win A New Smoby Playhouse and Kitchen (or £135 cash) #36</h1>
          <meta property="product:price:amount" content="2" />
          <div>Only 150 tickets available</div>
          <div>Up to 30 entries per person</div>
          <div>18 of 150 (12%) tickets claimed</div>
          <div>End date: June 21, 2026 8:30 pm</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://campfirecomps.co.uk/competition/stale-link/") {
      return new Response("not found", { status: 404 });
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 3);

    assert.equal(comps[0]?.sourceId, "dji-mini-4k-5");
    assert.equal(comps[0]?.entryPrice, 0.99);
    assert.equal(comps[0]?.ticketsSold, 47);
    assert.equal(comps[0]?.maxTickets, 350);
    assert.equal(comps[0]?.maxEntriesPerUser, 35);
    const now = new Date();
    const expectedCampfireDate = new Date(now.getFullYear(), 5, 24, 20, 0, 0, 0);
    if (expectedCampfireDate.getTime() < now.getTime() - (24 * 60 * 60 * 1000)) {
      expectedCampfireDate.setFullYear(expectedCampfireDate.getFullYear() + 1);
    }
    assert.equal(comps[0]?.drawDate, expectedCampfireDate.toISOString());

    assert.equal(comps[1]?.sourceId, "winning-waze-proxy");
    assert.equal(comps[1]?.entryPrice, 0.68);
    assert.equal(comps[1]?.ticketsSold, 215);
    assert.equal(comps[1]?.maxTickets, 1999);
    assert.equal(comps[1]?.maxEntriesPerUser, 200);
    assert.equal(comps[1]?.cashAlternative, 400);

    assert.equal(comps[2]?.sourceId, "win-a-bundle-proxy");
    assert.equal(comps[2]?.entryPrice, 2);
    assert.equal(comps[2]?.ticketsSold, 18);
    assert.equal(comps[2]?.maxTickets, 150);
    assert.equal(comps[2]?.maxEntriesPerUser, 30);
    assert.equal(comps[2]?.cashAlternative, 135);
    assert.equal(comps[2]?.drawDate, "2026-06-21T19:30:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter reads Prize Drawn on DD.MM.YY generic Woo dates", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "audrey",
    displayName: "Audrey Competitions",
    baseUrl: "https://www.audreycompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const url =
    "https://www.audreycompetitions.co.uk/competition/win-a-ninja-creami-ice-cream-frozen-dessert-maker-or-150-cash-alternative/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">Ninja Creami</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (String(input) === url) {
      return new Response(
        `
          <h1 class="product_title">Win a Ninja CREAMi - Ice Cream & Frozen Dessert Maker or £150 Cash Alternative!</h1>
          <div>£0.50 Per Entry</div>
          <div>Tickets Sold: 73</div>
          <div>737 Tickets Left</div>
          <div>Max Per User: 100</div>
          <div>Don't fancy it? Take the £150 cash instead!</div>
          <p>Prize Drawn on 01.07.26</p>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.5);
    assert.equal(comps[0]?.ticketsSold, 73);
    assert.equal(comps[0]?.maxTickets, 810);
    assert.equal(comps[0]?.cashAlternative, 150);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 6, 1, 21, 0, 0, 0).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Audrey keeps draw-day cash scoped to the instant competition", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "audrey",
    displayName: "Audrey Competitions",
    baseUrl: "https://www.audreycompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const url =
    "https://www.audreycompetitions.co.uk/competition/queen-of-hearts-spin-and-win-250-prize-on-draw-day/";
  const cashUrl =
    "https://www.audreycompetitions.co.uk/competition/win-saint-laurent-cassandre-mattelasse-pouch-or-400-cash/";
  const slotsUrl =
    "https://www.audreycompetitions.co.uk/competition/audreys-slots-win-instant-cash-250-jackpot/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`
        <a href="${url}">Queen Of Hearts</a>
        <a href="${cashUrl}">Saint Laurent</a>
        <a href="${slotsUrl}">Audrey's Slots</a>
      `);
    }
    if (String(input) === url) {
      return new Response(`
        <div class="product">
          <h1 class="product_title">Queen Of Hearts! Spin and Win & £250 Prize on Draw Day</h1>
          <div class="summary entry-summary">
            <p>£2.50 Per Entry</p>
            <p>Tickets Sold: 2,264 / 7,700</p>
            <p>Win Instant Cash and gain an entry into the jackpot prize of £250 on draw day.</p>
            <p>This competition will end no later than the 7th October 2026 at 9.15pm.</p>
          </div>
          <section class="related products">
            <h2>Win SAINT LAURENT Pouch or £400 Cash</h2>
            <p>Cash Alternative: £400</p>
          </section>
        </div>
      `);
    }
    if (String(input) === cashUrl) {
      return new Response(`
        <div class="product">
          <h1 class="product_title">Win SAINT LAURENT Pouch or £400 Cash!</h1>
          <div class="summary entry-summary">
            <p>£1.00 Per Entry</p>
            <p>Tickets Sold: 214 / 954</p>
            <p>This competition will end no later than the 5th August 2026 at 9.00pm.</p>
            <aside>
              <p>Related: Spin and Win £250 Jackpot</p>
            </aside>
          </div>
        </div>
      `);
    }
    if (String(input) === slotsUrl) {
      return new Response(`
        <div class="product">
          <h1 class="product_title">Audrey's Slots - Win Instant Cash! £250 Jackpot</h1>
          <div class="summary entry-summary">
            <p>£0.10 Per Entry</p>
            <p>Tickets Sold: 50,950 / 99,999</p>
            <p>This competition will end no later than the 5th August 2026 at 9pm.</p>
          </div>
        </div>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 3);
    const queen = comps.find((comp) => comp.sourceId.startsWith("queen-of-hearts"));
    const cash = comps.find((comp) => comp.sourceId.startsWith("win-saint-laurent"));
    const slots = comps.find((comp) => comp.sourceId.startsWith("audreys-slots"));
    assert.equal(queen?.cashAlternative, 250);
    assert.deepEqual(queen?.categories, ["instant-win"]);
    assert.equal(
      queen?.drawDate,
      new Date(2026, 9, 7, 21, 15, 0, 0).toISOString(),
    );
    assert.equal(cash?.cashAlternative, 400);
    assert.deepEqual(cash?.categories, []);
    assert.equal(slots?.cashAlternative, 250);
    assert.deepEqual(slots?.categories, ["instant-win"]);
    assert.equal(
      slots?.drawDate,
      new Date(2026, 7, 5, 21, 0, 0, 0).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter reads Belter widget countdown and sold-ticket attributes", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "belter",
    displayName: "Belter Competitions",
    baseUrl: "https://beltercompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const url =
    "https://beltercompetitions.co.uk/competition/win-jellycat-jack-giant-head-worth-200-or-cash-alternative/";

  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${url}">Belter Jellycat</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (requestUrl === url) {
      return new Response(
        `
          <h1 class="product_title">WIN Jellycat Jack Giant Head (Worth £200) OR CASH ALTERNATIVE</h1>
          <div class="rgg-draw-date-container"><span class="draw">Draw</span><span class="date-format">July 26, 2026 7:00 PM</span></div>
          <div class="rgg-product-price">£0.99 Per Ticket</div>
          <div class="rgg-ticket-available">450 TICKETS AVAILABLE</div>
          <div class="rgg-progress" data-lottery-participant-count="32" data-max-ticket="450" style="width: 7.1%;"></div>
          <div class="rgg-sold info-inside"><span class="rgg-sold-title">Sold</span><span class="rgg-sold-value">7.1%</span></div>
          <div class="cash-alternative-title"><h2 class="rgg-title-tag">£150 CASH ALTERNATIVE</h2></div>
          <div class="competition-countdown" data-time="1785088800"></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "win-jellycat-jack-giant-head-worth-200-or-cash-alternative");
    assert.equal(comps[0]?.entryPrice, 0.99);
    assert.equal(comps[0]?.ticketsSold, 32);
    assert.equal(comps[0]?.maxTickets, 450);
    assert.equal(comps[0]?.cashAlternative, 150);
    assert.equal(comps[0]?.drawDate, "2026-07-26T18:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Bee The Winner generic Woo detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "beethewinner",
    displayName: "Bee The Winner",
    baseUrl: "https://beethewinner.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const firstUrl =
    "https://beethewinner.co.uk/product/ninja-slushi-frozen-drink-maker/";
  const secondUrl =
    "https://beethewinner.co.uk/product/win-a-samsung-50-4k-ultra-hd-smart-tv/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <a href="${firstUrl}">Ninja SLUSHi Frozen Drink Maker</a>
          <a href="${secondUrl}">Win a Samsung 50” 4K Ultra HD Smart TV</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === firstUrl || url === "/product/ninja-slushi-frozen-drink-maker/") {
      return new Response(
        `
          <h1>Ninja SLUSHi Frozen Drink Maker</h1>
          <p class="price"><span class="woocommerce-Price-amount amount"><bdi><span>&pound;</span>0.59</bdi></span></p>
          <div>Ticket price: £0.59 Maximum tickets: 1,000 Live draw: Thursday, 2nd July at 6:00 PM UK time Ticket limit: 10% per person</div>
          <div>Giveaway ends on: July 2, 2026 6:00 pm</div>
          <p class="lty-tickets-sold">Tickets Sold : <b>1</b></p>
          <div>0 Tickets Sold: 1 1000 0%</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === secondUrl || url === "/product/win-a-samsung-50-4k-ultra-hd-smart-tv/") {
      return new Response(
        `
          <h1>Win a Samsung 50” 4K Ultra HD Smart TV</h1>
          <p class="price"><span class="woocommerce-Price-amount amount"><bdi><span>&pound;</span>0.59</bdi></span></p>
          <div>Ticket price: £0.59 Maximum tickets: 1,000 Live draw: 25th June</div>
          <div>Giveaway ends on: June 25, 2026 6:00 pm</div>
          <p class="lty-tickets-sold">Tickets Sold : <b>103</b></p>
          <div>0 Tickets Sold: 103 1000 10%</div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new StaticListAdapter(config).fetchAll();

    assert.equal(competitions.length, 2);
    assert.equal(competitions[0]?.sourceId, "ninja-slushi-frozen-drink-maker");
    assert.equal(competitions[0]?.entryPrice, 0.59);
    assert.equal(competitions[0]?.ticketsSold, 1);
    assert.equal(competitions[0]?.maxTickets, 1000);
    assert.equal(competitions[0]?.drawDate, "2026-07-02T17:00:00.000Z");

    assert.equal(competitions[1]?.sourceId, "win-a-samsung-50-4k-ultra-hd-smart-tv");
    assert.equal(competitions[1]?.ticketsSold, 103);
    assert.equal(competitions[1]?.maxTickets, 1000);
    assert.equal(competitions[1]?.drawDate, "2026-06-25T17:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Bike Life Competitions homepage cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "bikelifecompetitions",
    displayName: "Bike Life Competitions",
    baseUrl: "https://bikelifecompetitions.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const firstUrl =
    "https://bikelifecompetitions.co.uk/shop/kawasaki-zx10r-30th-anniversary-edition/";
  const secondUrl =
    "https://bikelifecompetitions.co.uk/shop/dewalt-digital-torque-wrench/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `
          <a href="${firstUrl}" class="lty-product-card-link category-motorbikes">
            <div class="lty-progress-text">SOLD: 1% (37/5599)</div>
            <div class="grid-only-countdown safari-fix-countdown" data-end="2026-07-05 19:10:00"></div>
            <div class="lty-price-instant-container"><div class="lty-grid-price"><span class="lty-price-number">&pound;2.99</span> <span class="lty-per-entry">Per Entry</span></div></div>
            <h2 class="lty-product-title">Kawasaki ZX10R – 30th Anniversary Edition</h2>
            <div class="lty-cash-alternative">Cash Alternative <span class="lty-cash-value">&pound;6,000.00</span></div>
          </a>
          <a href="${secondUrl}" class="lty-product-card-link category-tools">
            <div class="lty-progress-text">SOLD: 18% (80/449)</div>
            <div class="grid-only-countdown safari-fix-countdown" data-end="2026-06-28 19:10:00"></div>
            <div class="lty-price-instant-container"><div class="lty-grid-price"><span class="lty-price-number">&pound;0.97</span> <span class="lty-per-entry">Per Entry</span></div></div>
            <h2 class="lty-product-title">DeWalt Digital Torque Wrench</h2>
            <div class="lty-cash-alternative">Cash Alternative <span class="lty-cash-value">&pound;170.00</span></div>
          </a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new StaticListAdapter(config).fetchAll();

    assert.equal(competitions.length, 2);
    assert.equal(competitions[0]?.sourceId, "kawasaki-zx10r-30th-anniversary-edition");
    assert.equal(competitions[0]?.entryPrice, 2.99);
    assert.equal(competitions[0]?.ticketsSold, 37);
    assert.equal(competitions[0]?.maxTickets, 5599);
    assert.equal(competitions[0]?.cashAlternative, 6000);
    assert.equal(competitions[0]?.drawDate, "2026-07-05T18:10:00.000Z");
    assert.deepEqual(competitions[0]?.categories, ["motorbikes"]);

    assert.equal(competitions[1]?.sourceId, "dewalt-digital-torque-wrench");
    assert.equal(competitions[1]?.entryPrice, 0.97);
    assert.equal(competitions[1]?.ticketsSold, 80);
    assert.equal(competitions[1]?.maxTickets, 449);
    assert.equal(competitions[1]?.cashAlternative, 170);
    assert.deepEqual(competitions[1]?.categories, ["tools"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Pitstop Prizes generic Woo detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "pitstopprizes",
    displayName: "Pitstop Prizes",
    baseUrl: "https://pitstopprizes.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const url = "https://pitstopprizes.co.uk/product/3-49-from-pole-to-goal-17000-in-prizes/";

  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl === `${config.baseUrl}/`) {
      return new Response(`<a href="${url}">FROM POLE TO GOAL</a>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }

    if (requestUrl === url) {
      return new Response(
        `
          <h1 class="product_title">£3.49: FROM POLE TO GOAL! £17,000+ IN PRIZES!</h1>
          <div class="price-per-ticket">£3.49 <span class="perticket">Per Ticket</span></div>
          <p class="max-pariticipants">Max Entries: 9999</p>
          <p class="cureent-participating">Tickets Sold: 1395</p>
          <span class="sold">Tickets available: 8604</span>
          <p>Pick ANY item from the Instant Win table OR take £500 cash!</p>
          <p>Live Draw: Monday 22 November at 9PM</p>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();
    const now = new Date();
    let expectedDrawDate = new Date(now.getFullYear(), 10, 22, 21, 0, 0, 0);
    if (expectedDrawDate.getTime() < now.getTime()) {
      expectedDrawDate = new Date(now.getFullYear() + 1, 10, 22, 21, 0, 0, 0);
    }

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 3.49);
    assert.equal(comps[0]?.ticketsSold, 1395);
    assert.equal(comps[0]?.maxTickets, 9999);
    assert.equal(comps[0]?.cashAlternative, 500);
    assert.equal(comps[0]?.drawDate, expectedDrawDate.toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Fifty20 competitions from embedded React query state", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "fifty20",
    displayName: "Fifty20",
    baseUrl: "https://fifty20.com",
    listPath: "/en-US/",
    userAgent: "test",
  };

  const state = {
    mutations: [],
    queries: [
      {
        state: {
          data: {
            blockData: [
              {
                slug: "dji-osmo-action-camera",
                status: "open",
                drawDate: "2026-06-24T12:01:00",
                drawMethod: 0,
                totalNumberOfTicketsInPool: 1087,
                totalNumberOfTicketsSold: 236,
                maxTicketsAllowedPerPlayer: 150,
                singleTicketPricePerCurrency: [
                  { ticketPrice: "0.55000", currencies: { code: "GBP" } },
                ],
                translation: {
                  title: "DJI OSMO ACTION CAMERA",
                  subTitle: "Win this cool action camera for 55p per ticket",
                  extraInformation: "<p>Adventure camera</p>",
                  competitionDetails:
                    "<p><strong>Cash alt &pound;250</strong></p>",
                },
                rafflePrizePrizeDraws: [],
                rafflesPrizeInstantWins: [],
              },
              {
                slug: "quick-cash-grab-18th-july",
                status: "open",
                drawDate: "2026-07-18T12:01:00",
                drawMethod: 0,
                totalNumberOfTicketsInPool: 24899,
                totalNumberOfTicketsSold: 52,
                maxTicketsAllowedPerPlayer: 2000,
                singleTicketPricePerCurrency: [
                  { ticketPrice: "0.60000", currencies: { code: "GBP" } },
                ],
                translation: {
                  title: "Quick Cash Grab",
                  subTitle: "Instant cash game",
                  extraInformation:
                    "<p>Prizes available: &pound;400 Cash and &pound;100 Cash</p>",
                  competitionDetails: "<p>Final drawn prize of &pound;50.</p>",
                },
                rafflePrizePrizeDraws: [
                  { prize_type: 1, prize_value: "50.00000000" },
                ],
                rafflesPrizeInstantWins: [
                  { prize_type: 1, prize_value: "400.00000000" },
                  { prize_type: 1, prize_value: "100.00000000" },
                  { prize_type: 0, prize_value: "100.00000000" },
                ],
              },
              {
                slug: "shark-instant-18th-july",
                status: "open",
                drawDate: "2026-07-18T12:01:00",
                drawMethod: 0,
                totalNumberOfTicketsInPool: 12245,
                totalNumberOfTicketsSold: 4,
                maxTicketsAllowedPerPlayer: 1000,
                singleTicketPricePerCurrency: [
                  { ticketPrice: "0.49000", currencies: { code: "GBP" } },
                ],
                translation: {
                  title: "Shark Beauty Bonanza",
                  subTitle: "Win some of the best beauty products on the market instantly",
                  extraInformation:
                    "<p>Premium Shark prizes worth nearly &pound;3,000</p>",
                  competitionDetails: "<p><strong>&pound;50 Cash Final Prize</strong></p>",
                },
                rafflePrizePrizeDraws: [
                  { prize_type: 1, prize_value: "50.00000000" },
                ],
                rafflesPrizeInstantWins: [],
              },
              {
                slug: "garden-gains-18th-july",
                status: "open",
                type: 0,
                drawDate: "2026-07-19T19:00:00",
                endDateTime: "2026-08-09T19:00:00",
                drawMethod: 0,
                totalNumberOfTicketsInPool: 18999,
                totalNumberOfTicketsSold: 45,
                maxTicketsAllowedPerPlayer: 800,
                singleTicketPricePerCurrency: [
                  { ticketPrice: "0.49000", currencies: { code: "GBP" } },
                ],
                translation: {
                  title: "Garden Gains",
                  subTitle: "Instant reveal with 600+ prizes",
                  extraInformation: "<p>Prizes worth £934. Competition closes 9th August at 7pm.</p>",
                  competitionDetails: "<p>One £50 final draw prize.</p>",
                },
                rafflePrizePrizeDraws: [
                  { prize_type: 1, prize_value: "50.00000000" },
                ],
                rafflesPrizeInstantWins: [
                  { prize_type: 1, prize_value: "400.00000000" },
                ],
              },
              {
                slug: "coming-soon-comp",
                status: "draft",
                drawDate: "2026-08-01T12:01:00",
                drawMethod: 0,
                totalNumberOfTicketsInPool: 500,
                totalNumberOfTicketsSold: 0,
                maxTicketsAllowedPerPlayer: 50,
                singleTicketPricePerCurrency: [
                  { ticketPrice: "0.25000", currencies: { code: "GBP" } },
                ],
                translation: {
                  title: "Coming Soon",
                },
                rafflePrizePrizeDraws: [],
                rafflesPrizeInstantWins: [],
              },
            ],
          },
        },
      },
    ],
  };

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(
        `<script>try{window.$REACT_QUERY_STATE = ${JSON.stringify(JSON.stringify(state))};}catch(e){}</script>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 4);

    assert.equal(comps[0]?.sourceId, "dji-osmo-action-camera");
    assert.equal(comps[0]?.entryPrice, 0.55);
    assert.equal(comps[0]?.ticketsSold, 236);
    assert.equal(comps[0]?.maxTickets, 1087);
    assert.equal(comps[0]?.cashAlternative, 250);
    assert.equal(comps[0]?.drawDate, "2026-06-24T11:01:00.000Z");

    assert.equal(comps[1]?.sourceId, "quick-cash-grab-18th-july");
    assert.equal(comps[1]?.cashAlternative, 50);
    assert.equal(comps[1]?.estimatedPrizeValue, undefined);
    assert.deepEqual(comps[1]?.categories, ["cash", "instant-win"]);

    assert.equal(comps[2]?.sourceId, "shark-instant-18th-july");
    assert.equal(comps[2]?.cashAlternative, 50);
    assert.equal(comps[2]?.estimatedPrizeValue, undefined);

    assert.equal(comps[3]?.sourceId, "garden-gains-18th-july");
    assert.equal(comps[3]?.drawDate, "2026-08-09T18:00:00.000Z");
    assert.equal(comps[3]?.maxEntriesPerUser, 800);
    assert.equal(comps[3]?.maxEntriesPerUserSource, "site");
    assert.equal(comps[3]?.cashAlternative, 50);
    assert.equal(comps[3]?.estimatedPrizeValue, undefined);
    assert.ok(comps[3]?.categories.includes("instant-win"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses North Coast homepage cards and detail enrichment", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "northcoast",
    displayName: "North Coast Competitions",
    baseUrl: "https://northcoastcomps.co.uk",
    listPath: "/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}/`) {
      return new Response(
        `
          <div class="card">
            <h3>CosmoGrill Pro Deluxe 6 In 1 BBQ</h3>
            <p>34 Tickets Sold</p>
            <p>265 remaining</p>
            <span>£1.99 /per entry</span>
            <a href="https://northcoastcomps.co.uk/product/cosmogrill-pro-deluxe-6-in-1-bbq/">View Competition</a>
          </div>
          <div class="card">
            <h3>£500 Cash &amp; 10 x Instant Wins</h3>
            <p>684 Tickets Sold</p>
            <p>316 remaining</p>
            <span>£1.99 /per entry</span>
            <a href="https://northcoastcomps.co.uk/product/500-cash-10-x-instant-wins-12/">View Competition</a>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === `${config.baseUrl}/product/cosmogrill-pro-deluxe-6-in-1-bbq/`) {
      return new Response(
        `
          <h1>CosmoGrill Pro Deluxe 6 In 1 BBQ</h1>
          <span class="lty-lottery-countdown-timer" data-time="2026/06/28 20:00:00"></span>
          <div data-raffle_mpp="50"></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === `${config.baseUrl}/product/500-cash-10-x-instant-wins-12/`) {
      return new Response(
        `
          <h1>£500 Cash &amp; 10 x Instant Wins</h1>
          <span class="lty-lottery-countdown-timer" data-time="2026/06/29 20:00:00"></span>
          <div data-raffle_mpp="25"></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);
    assert.equal(comps[0]?.sourceId, "cosmogrill-pro-deluxe-6-in-1-bbq");
    assert.equal(comps[0]?.entryPrice, 1.99);
    assert.equal(comps[0]?.ticketsSold, 34);
    assert.equal(comps[0]?.maxTickets, 299);
    assert.equal(comps[0]?.maxEntriesPerUser, 50);
    assert.equal(comps[0]?.drawDate, "2026-06-28T19:00:00.000Z");

    assert.equal(comps[1]?.sourceId, "500-cash-10-x-instant-wins-12");
    assert.equal(comps[1]?.ticketsSold, 684);
    assert.equal(comps[1]?.maxTickets, 1000);
    assert.equal(comps[1]?.cashAlternative, 500);
    assert.equal(comps[1]?.maxEntriesPerUser, 25);
    assert.equal(comps[1]?.drawDate, "2026-06-29T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses REALCOMPS homepage cards", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "realcomps",
    displayName: "REALCOMPS LTD",
    baseUrl: "https://real-comps.com",
    listPath: "/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}/`) {
      return new Response(
        `
          <div class="content-product">
            <div class="text-center product-details">
              <h2 class="product-title"><a href="https://real-comps.com/product/win-500-tui-voucher-or-cash-alternative/">Win £500 Tui Voucher or Cash Alternative</a></h2>
              <span class="price">£1.99</span>
              <span class="lty-lottery-countdown-timer" data-time="2026/07/01 20:00:00"></span>
              <span class="lty-progress-bar-notice">Tickets Sold: 103</span>
              <span class="lty-progress-bar-end">599</span>
              <p class="lty-progress-remaining-count">496 Tickets remaining</p>
            </div>
          </div>
          <div class="content-product">
            <div class="text-center product-details">
              <h2 class="product-title"><a href="https://real-comps.com/product/meal-for-two-at-denleys/">Meal for Two at Denley's</a></h2>
              <span class="price">£0.99</span>
              <span class="lty-lottery-countdown-timer" data-time="2026/07/16 19:00:00"></span>
              <span class="lty-progress-bar-notice">Tickets Sold: 18</span>
              <span class="lty-progress-bar-end">199</span>
              <p class="lty-progress-remaining-count">181 Tickets remaining</p>
            </div>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 2);
    assert.equal(comps[0]?.sourceId, "win-500-tui-voucher-or-cash-alternative");
    assert.equal(comps[0]?.entryPrice, 1.99);
    assert.equal(comps[0]?.ticketsSold, 103);
    assert.equal(comps[0]?.maxTickets, 599);
    assert.equal(comps[0]?.cashAlternative, 500);
    assert.equal(comps[0]?.drawDate, "2026-07-01T19:00:00.000Z");

    assert.equal(comps[1]?.sourceId, "meal-for-two-at-denleys");
    assert.equal(comps[1]?.entryPrice, 0.99);
    assert.equal(comps[1]?.ticketsSold, 18);
    assert.equal(comps[1]?.maxTickets, 199);
    assert.equal(comps[1]?.drawDate, "2026-07-16T18:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Prize Queen Store API lottery fields", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "prizequeen",
    displayName: "Prize Queen",
    baseUrl: "https://www.prizequeen.co.uk",
    listPath: "/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.equal(
      url,
      `${config.baseUrl}/wp-json/wc/store/v1/products?type=lottery&per_page=100`,
    );

    return new Response(
      JSON.stringify([
        {
          id: 24222,
          name: "£250 CASH",
          permalink: "https://www.prizequeen.co.uk/product/250-cash/",
          prices: { price: "50", currency_minor_unit: 2 },
          categories: [{ name: "Cash" }],
          extensions: {
            pq_lottery: {
              closes_at: "2099-07-16 20:00",
              max_tickets: 999,
              sold: 91,
              remaining: 908,
            },
          },
        },
        {
          id: 16761,
          name: "1p For £100",
          permalink: "https://www.prizequeen.co.uk/product/1p-for-100/",
          prices: { price: "1", currency_minor_unit: 2 },
          categories: [{ name: "Cash" }],
          extensions: {
            pq_lottery: {
              closes_at: "2099-07-16 20:00",
              max_tickets: 20000,
              sold: 20000,
              remaining: 0,
            },
          },
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "24222");
    assert.equal(comps[0]?.url, "https://www.prizequeen.co.uk/product/250-cash/");
    assert.equal(comps[0]?.name, "£250 CASH");
    assert.equal(comps[0]?.entryPrice, 0.5);
    assert.equal(comps[0]?.ticketsSold, 91);
    assert.equal(comps[0]?.maxTickets, 999);
    assert.equal(comps[0]?.cashAlternative, 250);
    assert.equal(comps[0]?.drawDate, "2099-07-16T19:00:00.000Z");
    assert.deepEqual(comps[0]?.categories, ["cash"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter renders Pura Vida listing and deterministic detail economics", async () => {
  const config = {
    siteName: "puravidacompetitions",
    displayName: "Pura Vida Competitions",
    baseUrl: "https://pura-vidacompetitions.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://pura-vidacompetitions.co.uk/product/win-12000-for-12p-50000-prize-pool/";
  const renderedUrls: string[] = [];
  const controller = new AbortController();
  const renderedSignals: Array<AbortSignal | undefined> = [];

  const renderPage = async (
    url: string,
    _waitSelector?: string,
    signal?: AbortSignal,
  ): Promise<string> => {
    renderedUrls.push(url);
    renderedSignals.push(signal);
    if (url === `${config.baseUrl}/`) {
      return `<a href="${detailUrl}">Enter</a>`;
    }
    if (url === detailUrl) {
      return `
        <div class="product">
          <h1 class="product_title">Win £12,000 For 12p – £50,000 Prize Pool!</h1>
          <div class="summary entry-summary">
            <div><span class="woocommerce-Price-amount">£0.12</span> Per Entry</div>
            <p>Max Tickets: 709999</p>
            <div class="progress-text">SOLD: 1%</div>
            <div class="progress-sold">10583<span class="progress-sep">/</span>709999</div>
            <input name="quantity" min="1" max="70999" value="1">
            <div class="countdown-timer" data-enddate="2026-08-03 12:00"></div>
            <p>Every ticket enters the draw for our massive £12,000 Grand Prize.</p>
          </div>
        </div>
      `;
    }
    throw new Error(`Unexpected rendered URL: ${url}`);
  };

  const comps = await new StaticListAdapter(config, renderPage).fetchAll(controller.signal);

  assert.deepEqual(renderedUrls, [`${config.baseUrl}/`, detailUrl]);
  assert.deepEqual(renderedSignals, [controller.signal, controller.signal]);
  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.sourceId, "win-12000-for-12p-50000-prize-pool");
  assert.equal(comps[0]?.url, detailUrl);
  assert.equal(comps[0]?.name, "Win £12,000 For 12p – £50,000 Prize Pool!");
  assert.equal(comps[0]?.entryPrice, 0.12);
  assert.equal(comps[0]?.ticketsSold, 10583);
  assert.equal(comps[0]?.maxTickets, 709999);
  assert.equal(comps[0]?.maxEntriesPerUser, 70999);
  assert.equal(comps[0]?.maxEntriesPerUserSource, "site");
  assert.equal(comps[0]?.cashAlternative, 12000);
  assert.equal(comps[0]?.drawDate, "2026-08-03T11:00:00.000Z");
});

test("Static list adapter accepts UComps' colonless sold counter", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "ucomps",
    displayName: "UComps",
    baseUrl: "https://www.ucomps.co.uk",
    listPath: "/competitions",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.ucomps.co.uk/competition/181/ps500-cash-low-price-competition";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">£500 Cash</a>`);
    }
    if (String(input) === detailUrl) {
      return new Response(`
        <main class="product">
          <h1>#181 - £500 Cash - Low Price Competition</h1>
          <div class="summary entry-summary">
            <p>£0.39 per entry</p>
            <p>Tickets Sold 765 of 10000</p>
            <p>Draw 20 Jul 2099 19:30</p>
          </div>
        </main>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 765);
    assert.equal(comps[0]?.maxTickets, 10000);
    assert.equal(comps[0]?.entryPrice, 0.39);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter scopes Ultimate Tool ARIA inventory to the primary product", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "ultimatetool",
    displayName: "Ultimate Tool Competitions",
    baseUrl: "https://www.ultimatetoolcompetitions.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.ultimatetoolcompetitions.co.uk/competition/stabila-96-2-level-pack/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">Stabila 96-2 Level Pack</a>`);
    }
    if (String(input) === detailUrl) {
      return new Response(`
        <div id="product-50970" class="product competition-open">
          <h1>Stabila 96-2 Level Pack</h1>
          <div class="summary entry-summary">
            <p>£0.35 Per Entry</p>
            <div class="zapc-refresh-progress-50970"
                 aria-valuenow="492" aria-valuemax="1999"></div>
            <script>DateTime.fromISO("2099-07-23T18:30:00+00:00")</script>
          </div>
        </div>
        <section class="related products">
          <div aria-valuenow="999" aria-valuemax="1000">Related product</div>
        </section>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 492);
    assert.equal(comps[0]?.maxTickets, 1999);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter derives Your UK inventory from its validated entry list", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "yourukcompetitions",
    displayName: "Your UK Competitions",
    baseUrl: "https://www.yourukcompetitions.co.uk",
    listPath: "/competitions",
    userAgent: "test",
  };
  const liveUrl =
    "https://www.yourukcompetitions.co.uk/competitions/131/25p-for-100-cash";
  const badUrl =
    "https://www.yourukcompetitions.co.uk/competitions/132/mismatched-entry-list";
  const featuredUrl =
    "https://www.yourukcompetitions.co.uk/competitions/99/featured-old-draw";
  const fetched: string[] = [];

  globalThis.fetch = async (input) => {
    const url = String(input);
    fetched.push(url);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`
        <div id="competitions-page">
          <article class="competition"><a href="${liveUrl}">Enter</a></article>
          <article class="competition"><a href="${badUrl}">Enter</a></article>
        </div>
        <article class="competition-card"><a href="${featuredUrl}">Featured</a></article>
      `);
    }
    if (url === liveUrl || url === badUrl) {
      const available = url === liveUrl ? 3 : 2;
      return new Response(`
        <h1>${url === liveUrl ? "25P For £100 Cash" : "Mismatched Entry List"}</h1>
        <section class="cd-hero">
          <p>£0.25 per ticket</p>
          <p>Draw 2099-10-24 16:15</p>
        </section>
        <section class="cd-body">
          <p>Price £0.25</p>
          <p>Available ${available}</p>
          <p>Category Live Draws</p>
        </section>
        <aside>Featured competition: 99 / 100 tickets sold</aside>
      `);
    }
    if (url === `${liveUrl}/entry-list` || url === `${badUrl}/entry-list`) {
      return new Response(`
        <script>
          const tickets = [
            {"ticket_number":1,"include_in_draw":true},
            {"ticket_number":2,"include_in_draw":false},
            {"ticket_number":3,"include_in_draw":false},
            {"ticket_number":4,"include_in_draw":false}
          ];
        </script>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "25p-for-100-cash");
    assert.equal(comps[0]?.ticketsSold, 1);
    assert.equal(comps[0]?.maxTickets, 4);
    assert.equal(comps[0]?.entryPrice, 0.25);
    assert.equal(comps[0]?.cashAlternative, 100);
    assert.equal(fetched.includes(featuredUrl), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter enriches Donkey rows even without a parsed cash alternative", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "donkeycomps",
    displayName: "Donkey Comps",
    baseUrl: "https://www.donkeycomps.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl = "https://www.donkeycomps.co.uk/product/garden-bundle/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}/`) {
      return new Response(`
        <div>
          <img alt="Garden Bundle">
          <span>£0.49 per Entry</span>
          <a href="${detailUrl}">Enter Now</a>
        </div>
      `);
    }
    if (String(input) === detailUrl) {
      return new Response(`
        <div class="lottery-time-countdown" data-time="4070908800"></div>
        <p>This Draw is limited to 3100 tickets</p>
        <progress max="3100" value="159"></progress>
        <input class="qty" max="100">
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.cashAlternative, null);
    assert.equal(comps[0]?.ticketsSold, 159);
    assert.equal(comps[0]?.maxTickets, 3100);
    assert.equal(comps[0]?.maxEntriesPerUser, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter enriches Jammy from exact primary detail inventory", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "jammy",
    displayName: "Jammy",
    baseUrl: "https://www.jammy.co.uk",
    listPath: "/auto-draws/",
    userAgent: "test",
  };
  const detailUrl =
    "https://www.jammy.co.uk/shop/apple-ipad-11th-gen-128gb-or-410-cash/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`
        <li class="product">
          <a href="${detailUrl}"><img alt="Apple iPad 11th Gen or £410 Cash"></a>
          <span class="price">£0.99</span>
          <div class="clockdiv" data-date="2099-07-21T22:00:00Z"></div>
        </li>
      `);
    }
    if (String(input) === detailUrl) {
      return new Response(`
        <div id="product-123" class="product">
          <div class="summary entry-summary">
            <div class="tps-split-wrapper">
              <div class="tps-split-sold"><span class="big">145</span> sold</div>
              <div class="tps-split-remaining"><span class="big">654</span> left</div>
            </div>
            <div class="jqs-wrapper">
              <span class="jqs-total-tickets">Total: 799 Tickets</span>
              <form class="jqs-form" data-max="10"></form>
            </div>
          </div>
        </div>
        <section class="related products">
          <div class="tps-split-wrapper">
            <div class="tps-split-sold"><span class="big">999</span> sold</div>
            <div class="tps-split-remaining"><span class="big">1</span> left</div>
          </div>
        </section>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 145);
    assert.equal(comps[0]?.maxTickets, 799);
    assert.equal(comps[0]?.maxEntriesPerUser, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter replaces Marine listing guesses with exact detail economics", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "marinecomps",
    displayName: "Marine Competitions",
    baseUrl: "https://marinecomps.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl =
    "https://marinecomps.co.uk/raffles/spectrum-480p-with-suzuki-60hp/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}/`) {
      return new Response(`
        <li class="product">
          <a href="${detailUrl}">From £4.80 Spectrum 480P With Suzuki 60HP LIVE - 12% SOLD</a>
        </li>
      `);
    }
    if (String(input) === detailUrl) {
      return new Response(`
        <div id="product-5530" class="product product-type-raffle">
          <h1>Spectrum 480P With Suzuki 60HP</h1>
          <div class="summary entry-summary">
            <p>Spectrum 480p or £8000 cash alternative.</p>
            <div class="marine-raffle-urgency">2,215 left 285 of 2,500 tickets sold</div>
            <div class="asp-rfw-raffle-duration-timer" data-duration="2099/08/16 18:00:00"></div>
            <div class="marine-ticket-bundles" data-unit-price="9.99"></div>
            <input class="qty" name="quantity" max="500">
          </div>
        </div>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 9.99);
    assert.equal(comps[0]?.ticketsSold, 285);
    assert.equal(comps[0]?.maxTickets, 2500);
    assert.equal(comps[0]?.maxEntriesPerUser, 500);
    assert.equal(comps[0]?.cashAlternative, 8000);
    assert.equal(comps[0]?.drawDate, "2099-08-16T17:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter isolates Winning Waze pence price from the prize title", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "winningwaze",
    displayName: "Winning Waze",
    baseUrl: "https://winningwaze.co.uk",
    listPath: "/competitions/",
    userAgent: "test",
  };
  const detailUrl =
    "https://winningwaze.co.uk/product/samsung-55-crystal-uhd-4k-hdr-smart-tv-or-250/";

  globalThis.fetch = async (input) => {
    if (String(input) === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">Samsung TV</a>`);
    }
    if (String(input) === detailUrl) {
      return new Response(`
        <div id="product-123" class="product">
          <div class="summary entry-summary">
            <h1>SAMSUNG 55″ Crystal UHD 4K HDR Smart TV or £250</h1><p class="price">39p to play</p>
            <p>19 of 1199 tickets sold</p>
            <script>DateTime.fromISO("2099-07-22T18:30:00+00:00")</script>
          </div>
        </div>
      `);
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new StaticListAdapter(config).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.39);
    assert.equal(comps[0]?.ticketsSold, 19);
    assert.equal(comps[0]?.maxTickets, 1199);
    assert.equal(comps[0]?.cashAlternative, 250);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses the new direct operator detail formats", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      siteName: "prizerunner",
      baseUrl: "https://prizerunner.com",
      path: "/competition/100-cash/",
      html: `<h1>£100 CASH RAFFLE</h1><div>£1.00 per ticket</div><div>Tickets Sold: 2 of 100</div><div>Live Draw 30 Aug 2026, 19:00</div>`,
      expected: { entryPrice: 1, ticketsSold: 2, maxTickets: 100 },
    },
    {
      siteName: "gimmegiveaways",
      baseUrl: "https://gimmegiveaways.co.uk",
      path: "/competitions/taylormade-p790-irons/",
      html: `<h1>Taylormade P790 Irons</h1><div>1 tickets sold0% · 9,999 remaining</div><div data-deadline="1790798400000"></div><script>const basePrice: 1.29;</script>`,
      expected: { entryPrice: 1.29, ticketsSold: 1, maxTickets: 10000 },
    },
    {
      siteName: "truedreamcompetitions",
      baseUrl: "https://truedreamcompetitions.co.uk",
      path: "/product/over-500-worth-of-instant-wins-25-main-prize-only-10p-a-go/",
      html: `<h1>Over £500 Worth Of Instant Wins</h1><div>£0.10 Per Entry</div><div data-lottery-participant-count="86" data-max-ticket="10601" data-time="1789243200"></div>`,
      expected: { entryPrice: 0.1, ticketsSold: 86, maxTickets: 10601 },
    },
    {
      siteName: "imperiumwheels",
      baseUrl: "https://imperiumwheels.co.uk",
      path: "/competition/quad-suzuki-ltr450-r-4x4/",
      html: `<h1>Quad Suzuki Ltr450 r 4x4</h1><div>£0.99 Per Entry</div><div>Tickets sold: 2,256 24,743 remaining</div><div>Lottery ends: 05/09/2026 00:00</div>`,
      expected: { entryPrice: 0.99, ticketsSold: 2256, maxTickets: 26999 },
    },
    {
      siteName: "lemonpig",
      baseUrl: "https://www.lemonpig.co.uk",
      path: "/product/holidays-pack-garden-pack-six-pack/",
      html: `<h1>Monthly Winner's Choice</h1><div>£0.50 Per Entry</div><div>7 / 10000 tickets sold</div><div>Competition ends 17 September 2026 21:00</div>`,
      expected: { entryPrice: 0.5, ticketsSold: 7, maxTickets: 10000 },
    },
    {
      siteName: "luckybucks",
      baseUrl: "https://luckybucksgiveaways.co.uk",
      path: "/product/keplin-9l-dual-zone-air-fryer-6/",
      html: `<h1>Keplin 9L Dual Zone Air Fryer</h1><div>£0.99 per ticket</div><div class="wcl-progress-meter"><span class="current"><strong>59/180 Sold</strong></span><progress max="180" value="59"></progress></div><div>Competition Ends 6th September 2099 9:00 pm</div>`,
      expected: { entryPrice: 0.99, ticketsSold: 59, maxTickets: 180 },
    },
    {
      siteName: "area52",
      baseUrl: "https://area52.win",
      path: "/mission/fairway-signal/",
      html: `<h1>Operation Fairway Signal Golf Membership & £500 Vouchers</h1><div>£1.99 per entry</div><div>Tickets Sold: 78 Tickets Remaining: 1,921 Max entries: 25</div><div>Draw: 11 September 2026 17:30</div>`,
      expected: { entryPrice: 1.99, ticketsSold: 78, maxTickets: 1999 },
    },
    {
      siteName: "monkylondon",
      baseUrl: "https://monkylondoncomps.com",
      path: "/product/500hp-mazda-rx7-zimax-racing-works-demo-car/",
      html: `<h2 class="product_title">500HP Mazda RX7 Zimax Racing Works Demo Car</h2><p class="price">£29.99</p><div>0 Tickets available: 1,836 2,999</div><div>Closes 29th August 2026</div>`,
      expected: { entryPrice: 29.99, ticketsSold: 1163, maxTickets: 2999 },
    },
    {
      siteName: "rarecandy",
      baseUrl: "https://www.rarecandyraffles.com",
      path: "/competitions/pitch-black-etb-booster-box",
      html: `<h1>Pitch Black ETB &amp; Booster Box!</h1><div x-data="{ endDate: '2026-08-28T20:30:00+00:00' }">Competition Ends In</div><div>£0.98 per entry</div><div>Sales Progress 127 / 500 (25%)</div>`,
      expected: { entryPrice: 0.98, ticketsSold: 127, maxTickets: 500 },
    },
    {
      siteName: "costacomps",
      baseUrl: "https://costacomps.com",
      path: "/competition/61",
      html: `<h1>Win a 7-Night Winter Sun Escape to Morocco!</h1><div>Worth up to £2,750</div><div>£2.00 Per Ticket</div><div>Tickets Sold 1% Sold 32 Entries</div><div data-page="{&quot;sold_count&quot;:32,&quot;ticket_price&quot;:2,&quot;total_tickets&quot;:2750,&quot;ends_at&quot;:&quot;2026-09-27 23:59:00&quot;}"></div>`,
      expected: { entryPrice: 2, ticketsSold: 32, maxTickets: 2750 },
    },
    {
      siteName: "ultimatetrailer",
      baseUrl: "https://ultimatetrailercompetitions.co.uk",
      path: "/product/utv-products-light-it-up-instant-win-500-cash-draw/",
      html: `<h1>UTV Products - Light It Up - Instant Win</h1><div>£0.99 per entry</div><div>0 Tickets Sold: 6056 50000 12%</div><div>Closes 27/09/2026 9:00 pm</div>`,
      expected: { entryPrice: 0.99, ticketsSold: 6056, maxTickets: 50000 },
    },
    {
      siteName: "rrwins",
      baseUrl: "https://www.rrwins.co.uk",
      path: "/product/mruk-bunker-box-hundreds-of-instant-wins/",
      html: `<h1>MRUK BunkerBox</h1><div>£0.35 Per Entry</div><div>9,076 tickets sold 10.553% 9076 86,000</div><div>Ends on 30th August 2026 at 11:00pm</div>`,
      expected: { entryPrice: 0.35, ticketsSold: 9076, maxTickets: 86000 },
    },
    {
      siteName: "carphunter",
      baseUrl: "https://carphuntergiveaways.co.uk",
      path: "/product/%E2%AD%90%EF%B8%8Fnew-release%E2%AD%90%EF%B8%8F-ridgemonkey-combi-chilla-18ltr-or-cash-3/",
      html: `<h1>RidgeMonkey Combi Chilla 18LTR or Cash</h1><div>£3.75 Per Entry</div><div>0% Sold 0/70</div><div>Draw 25/08 @ 20:00</div>`,
      expected: { entryPrice: 3.75, ticketsSold: 0, maxTickets: 70 },
    },
  ] as const;

  globalThis.fetch = async (input) => {
    const url = String(input);
    const current = cases.find((item) => url === `${item.baseUrl}${item.path}`);
    if (current) return new Response(current.html.replaceAll("><", "> <"), { status: 200 });
    const list = cases.find((item) => url === `${item.baseUrl}/`);
    if (list) return new Response(`<a href="${list.baseUrl}${list.path}">Current competition</a>`, { status: 200 });
    return new Response("not found", { status: 404 });
  };

  const renderedPageFetcher = async (url: string) => {
    const current = cases.find((item) => url === `${item.baseUrl}${item.path}`);
    if (current) return current.html.replaceAll("><", "> <");
    const list = cases.find((item) => url === `${item.baseUrl}/`);
    return list ? `<a href="${list.baseUrl}${list.path}"> Current competition </a>` : "";
  };

  try {
    for (const current of cases) {
      const [competition] = await new StaticListAdapter({
        siteName: current.siteName,
        displayName: current.siteName,
        baseUrl: current.baseUrl,
        listPath: "/",
        userAgent: "test",
      }, renderedPageFetcher).fetchAll();
      assert.deepEqual(
        {
          entryPrice: competition?.entryPrice,
          ticketsSold: competition?.ticketsSold,
          maxTickets: competition?.maxTickets,
        },
        current.expected,
      );
      if (current.siteName === "monkylondon") {
        assert.deepEqual(competition?.categories, ["car"]);
      }
      assert.ok(competition?.drawDate, current.siteName);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Static list adapter parses Flash cash rows and marks instant rows", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "flashcompetitions",
    displayName: "Flash Competitions",
    baseUrl: "https://www.flashcompetitions.co.uk",
    listPath: "/",
    userAgent: "test",
  };

  globalThis.fetch = async () => new Response("unused");

  try {
    const competitions = await new StaticListAdapter(config, async () => `
      <div id="question_step1">
        <div class="home__question_inner-quiz">
          <h3>£500 CASH FRIDAY 30th October @ 8pm</h3>
          <div class="home__question_inner-quiz_bar-text">0 / 500</div>
          <div class="home__question_inner-quiz_closing">Closes: 30/10/2026 19:55</div>
          <div class="home__question_inner-quiz_prize">£500 MAIN PRIZE!</div>
          <div class="home__question_inner-quiz_cost">£2.99</div>
          <button class="enter_quiz" data-id="271">Enter Now</button>
        </div>
        <div class="home__question_inner-quiz">
          <h3>£10,500 CASH FRIDAY 27th November @ 8pm</h3>
          <div class="home__question_inner-quiz_bar-text">4 / 7900</div>
          <div class="home__question_inner-quiz_closing">Closes: 27/11/2026 19:55</div>
          <div class="home__question_inner-quiz_prize">£10,000 OF INSTANT WINS, £500 END PRIZE!</div>
          <div class="home__question_inner-quiz_cost">£2.99</div>
          <button class="enter_quiz" data-id="272">Enter Now</button>
        </div>
      </div>
    `).fetchAll();

    assert.equal(competitions.length, 2);
    assert.deepEqual(
      competitions.map(({ sourceId, ticketsSold, maxTickets, entryPrice, cashAlternative, categories, drawDate }) => ({
        sourceId,
        ticketsSold,
        maxTickets,
        entryPrice,
        cashAlternative,
        categories,
        drawDate,
      })),
      [
        {
          sourceId: "flash-271",
          ticketsSold: 0,
          maxTickets: 500,
          entryPrice: 2.99,
          cashAlternative: 500,
          categories: ["cash"],
          drawDate: "2026-10-30T19:55:00.000Z",
        },
        {
          sourceId: "flash-272",
          ticketsSold: 4,
          maxTickets: 7900,
          entryPrice: 2.99,
          cashAlternative: null,
          categories: ["instant-win"],
          drawDate: "2026-11-27T19:55:00.000Z",
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cash suffixes cannot consume the start of KuKirin or Kitchen", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [copy, expected] of [["380 KuKirin G2 Electric Scooter", 380], ["250 Kitchen Bundle", 250], ["1.5k cash", 1500]] as const) {
      globalThis.fetch = async input => new Response(String(input).includes("/competition/scooter")
        ? `<h1>KuKirin G2 Electric Scooter</h1><div>£0.99 Per Entry</div><div>Tickets Sold: 327 of 699</div><div>Max 100 Tickets Per User</div><div>Cash Alternative: ${copy}</div><div id="tab-description">One KuKirin G2 800W scooter</div><script>DateTime.fromISO("2099-10-24T18:00:00+00:00")</script>`
        : '<a href="/competition/scooter/">Scooter</a>');
      const rows = await new StaticListAdapter({siteName:"lxry",displayName:"Lxry",baseUrl:"https://lxrycomps.co.uk",listPath:"/",userAgent:"test"}).fetchAll();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.cashAlternative, expected);
      assert.match(rows[0]?.prizeDescription ?? "", /800W scooter/);
      assert.match(rows[0]?.prizeEvidence ?? "", /Cash Alternative/);
    }
  } finally { globalThis.fetch = originalFetch; }
});
