import test from "node:test";
import assert from "node:assert/strict";
import { WCLotteryAdapter } from "../src/adapters/wclottery/wclottery-adapter.js";
import {
  enrichCompetitionFromDetail,
  parseDetailPage,
  parseLpeDetailPage,
  parsePage,
} from "../src/adapters/wclottery/wclottery-parser.js";
import type { WCLotterySiteConfig } from "../src/adapters/wclottery/wclottery-site-config.js";

test("WC Lottery parser reads Golf Gear Raffles main prize value", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-75472 product_cat-live">
        <h1 class="product_title">MYSTERY BOX MEGA SCRATCHCARD</h1>
        <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
        <p>Prize Draw ends: 13 September 2026 9:00 pm</p>
        <p>This Prize Draw is limited to 250000 tickets</p>
        <p>Tickets sold: 48443</p>
        <p>A MAIN PRIZE OF A £3000 MYSTERY BOX</p>
      </div>
    `,
    {
      ...config,
      siteName: "golfgearraffles",
      displayName: "Golf Gear Raffles",
      baseUrl: "https://golfgearraffles.co.uk",
      listPath: "/raffles/",
    },
    "https://golfgearraffles.co.uk/raffles/mystery-box-mega-scratchcard/",
  );

  assert.equal(competition?.estimatedPrizeValue, 2550);
  assert.equal(competition?.valuationSource, "site_estimate");
});

test("WC Lottery parser does not treat scratch-card bundles as cash", () => {
  const [competition] = parsePage(
    `
      <li class="product post-8507448 product_cat-live">
        <a href="https://www.jammy.co.uk/shop/100-scratch-card-bundle-4/">
          <h2>£100 SCRATCH CARD BUNDLE!</h2>
        </a>
        <span class="price">£1.99</span>
        <div class="progress-sold">7 / 99</div>
        <div class="clockdiv" data-date="2026-08-21 13:30"></div>
      </li>
    `,
    {
      ...config,
      siteName: "jammy",
      displayName: "Jammy",
      baseUrl: "https://www.jammy.co.uk",
      listPath: "/shop/",
    },
  );

  assert.equal(competition?.cashAlternative, null);
});

test("WC Lottery parser does not treat retail worth as cash", () => {
  const [competition] = parsePage(
    `
      <li class="product post-8507449 product_cat-live">
        <a href="https://rendallscompetitions.co.uk/product/p-louise-cheetah-full-collection/">
          <h2>WIN THE P.Louise Cheetah Full Collection – WORTH £804!</h2>
        </a>
        <span class="price">£0.99</span>
        <div class="progress-sold">12 / 999</div>
        <div class="clockdiv" data-date="2026-08-25 20:00"></div>
      </li>
    `,
    {
      ...config,
      siteName: "rendalls",
      displayName: "Rendalls Competitions",
      baseUrl: "https://rendallscompetitions.co.uk",
      listPath: "/shop/",
    },
  );

  assert.equal(competition?.cashAlternative, null);
});

test("WC Lottery detail parser reads month-first competition end dates", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-12065 product_cat-cash">
        <h1 class="product_title">Instant Wins £1</h1>
        <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
        <p class="lottery-end">Competition ends: October 1, 2026 12:00 am</p>
        <p>This competition is limited to 999 tickets</p>
        <p class="cureent-participating">Tickets sold: 226</p>
        <progress max="999" value="226"></progress>
      </div>
    `,
    config,
    "https://justonemoreticket.co.uk/competitions/instant-wins-1/",
  );

  assert.equal(competition?.drawDate, "2026-09-30T23:00:00.000Z");
  assert.equal(competition?.ticketsSold, 226);
  assert.equal(competition?.maxTickets, 999);
});

test("WC Lottery parser accepts raffle URLs from Woo Lottery listings", () => {
  const [competition] = parsePage(
    `
      <li class="product type-product post-83267 product_cat-live">
        <a href="https://golfgearraffles.co.uk/raffles/your-choice-of-golf-bag-3/">
          <h2>YOUR CHOICE OF GOLF BAG</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
        <div class="progress-sold">77 / 599</div>
        <div class="countdown-timer" data-enddate="2026-07-24 21:00"></div>
      </li>
    `,
    {
      ...config,
      siteName: "golfgearraffles",
      displayName: "Golf Gear Raffles",
      baseUrl: "https://golfgearraffles.co.uk",
      listPath: "/raffles/",
    },
  );

  assert.equal(competition?.url, "https://golfgearraffles.co.uk/raffles/your-choice-of-golf-bag-3/");
  assert.equal(competition?.entryPrice, 0.99);
  assert.equal(competition?.ticketsSold, 77);
  assert.equal(competition?.maxTickets, 599);
});

const config: WCLotterySiteConfig = {
  siteName: "clubhouse",
  displayName: "Clubhouse Competitions",
  baseUrl: "https://clubhousecompetitions.co.uk",
  listPath: "/competitions/",
  userAgent: "test",
};

test("WC Lottery parser does not treat a Woo free taxonomy as free-entry provenance for a paid row", () => {
  const [competition] = parsePage(
    `
      <li class="product type-product post-123 product_cat-free product_cat-cash">
        <a href="https://clubhousecompetitions.co.uk/product/daily-paid-freebie/">
          <h2 class="woocommerce-loop-product__title">Daily Player Freebie</h2>
        </a>
        <span class="price"><span class="woocommerce-Price-amount">£2.75</span></span>
        <div class="progress-sold">10 / 100</div>
        <input class="qty" max="20" />
        <div class="countdown-timer" data-enddate="2026-07-21 20:00"></div>
      </li>
    `,
    config,
  );

  assert.ok(competition);
  assert.equal(competition.entryPrice, 2.75);
  assert.equal(competition.categories.includes("free"), false);
  assert.equal(competition.categories.includes("cash"), true);
});

test("WC Lottery adapter renders opted-in blocked list pages", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requested: Array<{
    url: string;
    selector: string | undefined;
    signal: AbortSignal | undefined;
  }> = [];

  globalThis.fetch = async () => new Response("blocked", { status: 403 });

  try {
    const competitions = await new WCLotteryAdapter(
      {
        ...config,
        siteName: "dartgear",
        displayName: "Dart Gear Competitions",
        baseUrl: "https://dartgearcompetitions.co.uk",
        listPath: "/all-comps/",
        renderListPage: true,
        fetchDelayMs: 0,
      },
      async (url, selector, signal) => {
        requested.push({ url, selector, signal });
        return `
          <li class="product post-529959 product_cat-competition">
            <a href="https://dartgearcompetitions.co.uk/product/75-l-style-bundle/">
              <h2 class="loop-title">£75 L-STYLE BUNDLE</h2>
            </a>
            <span class="loop-price"><span class="woocommerce-Price-amount">£0.59</span></span>
            <div class="progress-sold">15/350</div>
            <input class="qty" max="50" />
            <div class="countdown-timer" data-enddate="2026-07-20 22:00"></div>
          </li>
        `;
      },
    ).fetchAll(controller.signal);

    assert.deepEqual(requested, [
      {
        url: "https://dartgearcompetitions.co.uk/all-comps/",
        selector: 'a[href*="/product/"]',
        signal: controller.signal,
      },
    ]);
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.name, "£75 L-STYLE BUNDLE");
    assert.equal(competitions[0]?.entryPrice, 0.59);
    assert.equal(competitions[0]?.ticketsSold, 15);
    assert.equal(competitions[0]?.maxTickets, 350);
    assert.equal(competitions[0]?.cashAlternative, 75);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery adapter renders opted-in detail pages after a blocked list fallback", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const requested: Array<{ url: string; selector: string | undefined }> = [];

  globalThis.fetch = async () => new Response("blocked", { status: 403 });

  try {
    const competitions = await new WCLotteryAdapter(
      {
        ...config,
        siteName: "nextlife",
        displayName: "Next Life Competitions",
        baseUrl: "https://nextlifecompetitions.com",
        listPath: "/shop/",
        renderListPage: true,
        renderDetailPages: true,
        fetchDelayMs: 0,
      },
      async (url, selector) => {
        requested.push({ url, selector });
        if (selector !== "body") {
          return `
            <li class="product post-18357 product_cat-live">
              <a href="https://nextlifecompetitions.com/product/win-600-a-week-for-a-year/"><h2>Win £600 a week for a year</h2></a>
              <span class="price">£1.00</span>
            </li>
          `;
        }
        return `
          <div class="product post-18357 product_cat-live">
            <h1 class="product_title">Win £600 a week for a year</h1>
            <span class="price">£1.00</span>
            <p>Competition ends on: July 31, 2026 9:00 pm</p>
            <div class="lty-progress-bar"><span class="lty-progress-bar-start">16</span><span class="lty-progress-bar-end">100000</span></div>
          </div>
        `;
      },
    ).fetchAll(controller.signal);

    assert.deepEqual(requested, [
      {
        url: "https://nextlifecompetitions.com/shop/",
        selector: 'a[href*="/product/"]',
      },
      {
        url: "https://nextlifecompetitions.com/product/win-600-a-week-for-a-year/",
        selector: "body",
      },
    ]);
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.ticketsSold, 16);
    assert.equal(competitions[0]?.maxTickets, 100000);
    assert.equal(competitions[0]?.drawDate, "2026-07-31T20:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery parser expands abbreviated K cash values", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-123 product_cat-live">
          <a href="https://clubhousecompetitions.co.uk/competition/world-cup-penalty/">
            <h2>£50K WORLD CUP PENALTY SHOOT OUT</h2>
          </a>
          <span class="woocommerce-Price-amount">£2.00</span>
          <progress value="1385" max="54999"></progress>
        </li>
      </ul>
    `,
    config,
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 50000);
});

test("WC Lottery parser reads Classy homepage progress blocks", () => {
  const competitions = parsePage(
    `
      <h2>Win the TAG Heuer Professional 1000</h2>
      <h2>Ticket Price: £20</h2>
      <h2>Value: £3,000</h2>
      <div class="e-con-inner">
        <div class="lty-lottery-countdown-timer" data-time="2026/07/12 19:00:00"></div>
        <div class="lty-lottery-progress-bar">
          <span class="lty-progress-bar-notice">Tickets Sold: 49</span>
          <span class="lty-progress-bar-end">349</span>
          <p>300 Tickets remaining</p>
        </div>
      </div>
      <h2>ODDS BOOSTER WIN 15 TICKETS TO MAIN DRAW £1.99 ENTRY PRICE</h2>
      <div class="lty-lottery-progress-bar">
        <span class="lty-progress-bar-notice">Tickets Sold: 69</span>
        <span class="lty-progress-bar-end">200</span>
        <p>131 Tickets remaining</p>
      </div>
      <a href="https://classycompetitions.co.uk/product/tag-heuer-professional-1000-vintage/?wcct_selector=1&amp;product_id=2132">Enter Now</a>
      <a href="https://classycompetitions.co.uk/product/oddsbooster-wolf-of-wall-street-package-win-15-tickets/?wcct_selector=1&amp;product_id=2792">Enter Now</a>
    `,
    {
      ...config,
      siteName: "classy",
      displayName: "Classy Competitions",
      baseUrl: "https://classycompetitions.co.uk",
      listPath: "/",
    },
  );

  assert.equal(competitions.length, 2);
  assert.equal(competitions[0]?.sourceId, "tag-heuer-professional-1000-vintage");
  assert.equal(competitions[0]?.ticketsSold, 49);
  assert.equal(competitions[0]?.maxTickets, 349);
  assert.equal(competitions[0]?.entryPrice, 20);
  assert.equal(competitions[0]?.estimatedPrizeValue, 3000);
  assert.equal(competitions[0]?.valuationSource, "site_estimate");
  assert.equal(competitions[0]?.drawDate, new Date(2026, 6, 12, 19).toISOString());
  assert.equal(competitions[1]?.sourceId, "oddsbooster-wolf-of-wall-street-package-win-15-tickets");
  assert.equal(competitions[1]?.ticketsSold, 69);
  assert.equal(competitions[1]?.maxTickets, 200);
  assert.equal(competitions[1]?.entryPrice, 1.99);
});

test("WC Lottery parser handles Lottery for WooCommerce cards with query-string product links", () => {
  const [competition] = parsePage(
    `
      <ul class="products">
        <li class="product type-product post-301833">
          <a href="https://gardenroomcomps.com/product/win-the-ultimate-garden-cabin/?tickets=50">
            <h2>Win the Ultimate Garden Cabin</h2>
          </a>
          <span class="lty-shop-timer-container" data-time="2026/08/09 21:00:00"></span>
          <div class="lty-progress-count-loop">
            <span class="lty-progress-bar-notice">Tickets Sold: 42415</span>
            <span class="lty-progress-bar-end">500000</span>
          </div>
          <span class="price">£0.20</span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "gardenroomcomps",
      displayName: "Garden Room Competitions",
      baseUrl: "https://gardenroomcomps.com",
    },
  );

  assert.equal(competition?.sourceId, "301833");
  assert.equal(competition?.ticketsSold, 42415);
  assert.equal(competition?.maxTickets, 500000);
  assert.equal(competition?.entryPrice, 0.2);
  assert.equal(competition?.drawDate, "2026-08-09T20:00:00.000Z");
});

test("WC Lottery parser does not value ticket-bundle titles as direct cash", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-124 product_cat-live">
          <a href="https://clubhousecompetitions.co.uk/competition/penalty-payday-tickets/">
            <h2>400 Tickets - Penalty Payday (£5000 Main Prize + £40,000 Of Instants)</h2>
          </a>
          <span class="woocommerce-Price-amount">£2.00</span>
          <progress value="177" max="300"></progress>
        </li>
      </ul>
    `,
    config,
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, null);
});

test("WC Lottery parser does not value voucher titles as direct cash", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-125 product_cat-live">
          <a href="https://clubhousecompetitions.co.uk/competition/center-parcs/">
            <h2>£500 Center Parcs Voucher</h2>
          </a>
          <span class="woocommerce-Price-amount">£2.00</span>
          <progress value="10" max="300"></progress>
        </li>
      </ul>
    `,
    config,
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, null);
});

test("WC Lottery parser reads The Car Competition operator cards", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product type-product post-6780570 product_cat-autodraws product_cat-tech-luxury">
          <a href="https://thecarcompetition.co.uk/competition/ps5-or-xbox-4/">
            <h2>Win This PlayStation 5 Or Xbox Series X</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
          <span>Tickets Sold: 94 of 999</span>
          <span class="lty-lottery-countdown-timer" data-time="2026/07/01 23:00:00"></span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "thecarcompetition",
      displayName: "The Car Competition",
      baseUrl: "https://thecarcompetition.co.uk",
      listPath: "/competitions/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.sourceId, "6780570");
  assert.equal(comps[0]?.url, "https://thecarcompetition.co.uk/competition/ps5-or-xbox-4/");
  assert.equal(comps[0]?.entryPrice, 0.99);
  assert.equal(comps[0]?.ticketsSold, 94);
  assert.equal(comps[0]?.maxTickets, 999);
  assert.equal(comps[0]?.cashAlternative, null);
  assert.equal(comps[0]?.drawDate, new Date(2026, 6, 1, 23, 0, 0, 0).toISOString());
});

test("WC Lottery detail enrichment reads progress start and end values", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "48465",
      siteName: config.siteName,
      url: "https://timevault.ltd/competitions/rado-captain-cook/",
      name: "RADO Captain Cook",
      entryPrice: 3.5,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: 1000,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title">RADO Captain Cook</h1>
        <div class="lty-lottery-countdown-timer" data-time="2026/07/19 19:00:00"></div>
        <div class="lty-lottery-progress-bar">
          <span class="lty-progress-bar-start">26</span>
          <span class="lty-progress-bar-notice">Tickets Sold</span>
          <span class="lty-progress-bar-end">1500</span>
        </div>
      </div>
    `,
  );

  assert.equal(enriched.ticketsSold, 26);
  assert.equal(enriched.maxTickets, 1500);
  assert.equal(enriched.drawDate, new Date(2026, 6, 19, 19).toISOString());
});

test("WC Lottery detail enrichment reads numeric progress notices", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "52017063",
      siteName: "carpatic",
      url: "https://carpatic.co/product/iphone-17-pro-max-158/",
      name: "iPhone 17 Pro Max #158",
      entryPrice: 0.1,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: 1000,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title">iPhone 17 Pro Max #158</h1>
        <div class="lty-lottery-countdown-timer" data-time="2026/08/12 17:00:00"></div>
        <div class="lty-lottery-progress-bar">
          <span class="lty-progress-bar-start">0</span>
          <span class="lty-progress-bar-notice">10,430</span>
          <span class="lty-progress-bar-end">22,500</span>
        </div>
      </div>
    `,
  );

  assert.equal(enriched.ticketsSold, 10430);
  assert.equal(enriched.maxTickets, 22500);
  assert.equal(enriched.drawDate, new Date(2026, 7, 12, 17).toISOString());
});

test("WC Lottery detail enrichment lets the current product's explicit zero price override a related paid-card price", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "27618",
      siteName: "goldcompetitions",
      url: "https://goldcompetitions.com/product/500-cash-giveaway-100-free-entry/",
      name: "£500 Cash Giveaway – 100% FREE ENTRY!",
      entryPrice: 2.75,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title">£500 Cash Giveaway – 100% FREE ENTRY!</h1>
        <span class="price"><span class="woocommerce-Price-amount">£0.00</span></span>
        <div>Competition ends: 31 July 2026 18:00</div>
        <div>This competition is limited to 10000 tickets</div>
        <div>Tickets sold: 66/10000</div>
        <div class="related"><div class="product"><span class="price"><span class="woocommerce-Price-amount">£1.20</span></span></div></div>
      </div>
    `,
  );

  assert.equal(enriched.entryPrice, 0);
  assert.equal(enriched.ticketsSold, 66);
  assert.equal(enriched.maxTickets, 10000);
  assert.equal(enriched.cashAlternative, 500);
  assert.match(enriched.drawDate ?? "", /^2026-07-31T/);
});

test("WC Lottery detail enrichment reads Plum remaining tickets and tab range", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "1293164",
      siteName: "plum",
      url: "https://www.plumcompetitions.co.uk/competition/larch-green-lodges-for-4-people-400-cash-alternative-10/",
      name: "Larch Green lodges for 4 people (£400 cash alternative) #10",
      entryPrice: 0,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title">Larch Green lodges for 4 people (£400 cash alternative) #10</h1>
        <div class="price-with-progress">£4.50 <div class="loop-progress-bar">193 Left</div></div>
        <button class="lty-lottery-ticket-tab">1-100</button>
        <button class="lty-lottery-ticket-tab">101-200</button>
        <div>Closing Date: August 2, 2026 7:30 pm</div>
      </div>
    `,
  );

  assert.equal(enriched.entryPrice, 4.5);
  assert.equal(enriched.ticketsSold, 7);
  assert.equal(enriched.maxTickets, 200);
  assert.equal(enriched.cashAlternative, 400);
  assert.match(enriched.drawDate ?? "", /^2026-08-02T/);
});

test("WC Lottery adapter enriches HotComps custom cards from direct detail pages", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://hotcomps.com/shop/") {
      return new Response(
        `
          <ul class="woocommerce-loop products columns-4">
            <li class="hotcomps-qb-container product type-product post-1257176 status-publish instock product_cat-autodraw product_cat-cash product-type-lottery">
              <a class="woocommerce-LoopProduct-link woocommerce-loop-product__link" href="https://hotcomps.com/product/100-midday-cash-131/"></a>
              <a class="product-category" href="https://hotcomps.com/product/100-teatime-cash-477/"></a>
              <a class="product-category product-info" href="https://hotcomps.com/product/100-teatime-cash-477/">£100 Teatime Cash</a>
              <span class="card-img-badge price">£2.00each</span>
              <div class="countdown-timer" data-enddate="2026-07-06 18:00"></div>
            </li>
            <li class="hotcomps-qb-container product type-product post-1260956 product_cat-app-only product-type-lottery">
              <a class="product-category product-info" href="https://hotcomps.com/product/app-exclusive-win-up-to-100-site-credit-42/">APP EXCLUSIVE! Win up to £100 Site Credit</a>
              <div class="countdown-timer" data-enddate="2026-07-06 22:00"></div>
            </li>
          </ul>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://hotcomps.com/product/100-teatime-cash-477/") {
      return new Response(
        `
          <div class="product post-1257176 product_cat-autodraw product_cat-cash">
            <h1 class="product_title entry-title">£100 Teatime Cash</h1>
            <span class="price">£2.00 per ticket</span>
            <progress value="2" max="100"></progress>
            <div class="countdown-timer" data-enddate="2026-07-06 18:00"></div>
            <div>Sold: 2% Tickets remaining: 98 Total Entries: 100</div>
          </div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new WCLotteryAdapter({
      siteName: "hotcomps",
      displayName: "Hot Comps",
      baseUrl: "https://hotcomps.com",
      listPath: "/shop/",
      userAgent: "test",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "1257176");
    assert.equal(competitions[0]?.url, "https://hotcomps.com/product/100-teatime-cash-477/");
    assert.equal(competitions[0]?.name, "£100 Teatime Cash");
    assert.equal(competitions[0]?.entryPrice, 2);
    assert.equal(competitions[0]?.ticketsSold, 2);
    assert.equal(competitions[0]?.maxTickets, 100);
    assert.equal(competitions[0]?.cashAlternative, 100);
    assert.equal(competitions[0]?.drawDate, new Date(2026, 6, 6, 18, 0, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery parser reads Dart Gear loop cash alternatives and countdowns", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product type-product post-507582 product_cat-competition product_cat-featured">
          <a href="https://dartgearcompetitions.co.uk/product/makita-18v-lxt-cordless-12-piece-power-tool-kit-with-4-x-5ah-batteries/">
            <div id="countdown-timer-507582" class="countdown-timer" data-enddate="2026-06-20 21:59"></div>
            <div class="progress-sold">93/675</div>
            <h2 class="loop-title">Makita 18V LXT Cordless 12 Piece Power Tool Kit with 4 x 5Ah Batteries</h2>
            <span class="cash-alt-loop">Cash Alternative: 1250</span>
            <span class="loop-price">
              <span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">&pound;</span>4.99</bdi></span>
              <span class="per-entry-loop">PER ENTRY</span>
            </span>
          </a>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "dartgear",
      displayName: "Dart Gear Competitions",
      baseUrl: "https://dartgearcompetitions.co.uk",
      listPath: "/all-comps/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.name, "Makita 18V LXT Cordless 12 Piece Power Tool Kit with 4 x 5Ah Batteries");
  assert.equal(comps[0]?.entryPrice, 4.99);
  assert.equal(comps[0]?.ticketsSold, 93);
  assert.equal(comps[0]?.maxTickets, 675);
  assert.equal(comps[0]?.cashAlternative, 1250);
  assert.equal(comps[0]?.drawDate, new Date(2026, 5, 20, 21, 59, 0, 0).toISOString());
});

test("WC Lottery parser prefers current sale prices in product loops", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-504448 product_cat-competition sale">
          <a href="https://dartgearcompetitions.co.uk/product/mystery-oche/">
            <h2 class="loop-title">Marks The Mystery Oche</h2>
            <div class="progress-sold">2144/58995</div>
            <span class="loop-price">
              <del><span class="woocommerce-Price-amount amount">&pound;0.79</span></del>
              <ins><span class="woocommerce-Price-amount amount">&pound;0.59</span></ins>
              <span class="per-entry-loop">PER ENTRY</span>
            </span>
          </a>
        </li>
      </ul>
    `,
    config,
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.entryPrice, 0.59);
});

test("WC Lottery parser reads div-based Woo product cards", () => {
  const comps = parsePage(
    `
      <div class="product type-product post-29574 product_cat-golf product-type-lottery">
        <a href="https://forecomps.co.uk/product/garmin-approach-s44-golf-gps-watch-19/">
          <h3>GARMIN APPROACH S44 GOLF GPS WATCH #19</h3>
        </a>
        <div>Draws Tomorrow</div>
        <div>6% SOLD</div>
        <span class="price"><span class="woocommerce-Price-amount">£0.33</span></span>
      </div>
    `,
    {
      ...config,
      siteName: "forecomps",
      displayName: "Fore Comps",
      baseUrl: "https://forecomps.co.uk",
      listPath: "/competitions/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.name, "GARMIN APPROACH S44 GOLF GPS WATCH #19");
  assert.equal(comps[0]?.entryPrice, 0.33);
  assert.equal(comps[0]?.url, "https://forecomps.co.uk/product/garmin-approach-s44-golf-gps-watch-19/");
});

test("WC Lottery detail enrichment reads Fore Comps entries and cash text", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "29574",
      siteName: "forecomps",
      url: "https://forecomps.co.uk/product/garmin-approach-s44-golf-gps-watch-19/",
      name: "GARMIN APPROACH S44 GOLF GPS WATCH #19",
      entryPrice: 0.33,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: ["golf"],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title entry-title">GARMIN APPROACH S44 GOLF GPS WATCH #19</h1>
        <div>Entries 484/9,499 Max/Person 425 Draw Date 1 Jul</div>
        <div>&pound;0.33 5% SOLD 9,015 left</div>
        <p>Draw Date: 1 July 2026</p>
        <p>Cash Alternative - &pound;200</p>
      </div>
    `,
  );

  assert.equal(enriched.ticketsSold, 484);
  assert.equal(enriched.maxTickets, 9499);
  assert.equal(enriched.cashAlternative, 200);
  assert.equal(enriched.drawDate, new Date(2026, 6, 1, 20, 0, 0, 0).toISOString());
});

test("WC Lottery adapter enriches detail countdown end dates", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://clubhousecompetitions.co.uk/product/world-cup-penalty/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://clubhousecompetitions.co.uk/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-123 product_cat-live">
              <a href="${detailUrl}">
                <h2>£50K WORLD CUP PENALTY SHOOT OUT</h2>
              </a>
              <span class="woocommerce-Price-amount">£2.00</span>
              <progress value="1385" max="54999"></progress>
            </li>
          </ul>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<div class="countdown-timer" data-enddate="2026-07-17 20:00"></div>`,
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const adapter = new WCLotteryAdapter(config);
    const comps = await adapter.fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 6, 17, 20, 0, 0, 0).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery adapter enriches zero-price cards from detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://sullysgames.co.uk/product/sully-prize-or-300-cash/";
  const sullyConfig: WCLotterySiteConfig = {
    siteName: "sullysgames",
    displayName: "Sully's Games",
    baseUrl: "https://sullysgames.co.uk",
    listPath: "/live-competitions/",
    userAgent: "test",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://sullysgames.co.uk/live-competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-999 product_cat-live product-type-lottery">
              <a href="${detailUrl}">
                <h2>Sully Prize or £300 Cash</h2>
              </a>
              <div class="lty-lottery-date-ranges">
                <span><b>Competition ends on:</b> September 4, 2026 9:00 pm (UTC +01:00)</span>
              </div>
            </li>
          </ul>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div class="product">
            <h1 class="product_title entry-title">Sully Prize or £300 Cash</h1>
            <p class="price">Only <span class="woocommerce-Price-amount">£0.99</span> a ticket</p>
            <p class="lty-lottery-end-time-label">
              <span><b>Competition ends on:</b> September 4, 2026 9:00 pm (UTC +01:00)</span>
            </p>
            <p class="lty-tickets-sold">Tickets Sold : <b>1,200</b></p>
            <p class="lty-progress-remaining-count">10,800 Tickets remaining</p>
            <p>Winner will get the Products mentioned in £300 Cash</p>
          </div>
        `,
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const adapter = new WCLotteryAdapter(sullyConfig);
    const comps = await adapter.fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.99);
    assert.equal(comps[0]?.ticketsSold, 1200);
    assert.equal(comps[0]?.maxTickets, 12000);
    assert.equal(comps[0]?.cashAlternative, 300);
    assert.equal(
      comps[0]?.drawDate,
      new Date(2026, 8, 4, 21, 0, 0, 0).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery detail enrichment reads LTY ticket economics", () => {
  const [competition] = parsePage(
    `
      <ul>
        <li class="product post-735089 product_cat-all product-type-lottery">
          <a href="https://www.hobbycomps.co.uk/product/tamiya-lunch-box-evo-or-140/">
            <h2>Tamiya Lunch Box EVO or £140!</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£2.29</span></span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "hobbycomps",
      displayName: "Hobby Comps",
      baseUrl: "https://www.hobbycomps.co.uk",
      listPath: "/",
    },
  );

  assert.ok(competition);
  const enriched = enrichCompetitionFromDetail(
    competition,
    `
      <div class="product">
        <h1 class="product_title entry-title">Tamiya Lunch Box EVO or £140!</h1>
        <p class="price">Only <span class="woocommerce-Price-amount">£2.29</span> a ticket</p>
        <div class="lty-lottery-countdown-timer" data-time="2026/07/02 19:00:00"></div>
        <p class="lty-tickets-sold">Tickets Sold : <b>60</b></p>
        <span class="lty-progress-bar-end">120</span>
        <p class="lty-progress-remaining-count">60 Tickets remaining</p>
      </div>
    `,
  );

  assert.equal(enriched.entryPrice, 2.29);
  assert.equal(enriched.ticketsSold, 60);
  assert.equal(enriched.maxTickets, 120);
  assert.equal(enriched.cashAlternative, 140);
  assert.equal(enriched.drawDate, new Date(2026, 6, 2, 19, 0, 0, 0).toISOString());
});

test("WC Lottery detail enrichment reads per-ticket prices outside price elements", () => {
  const [competition] = parsePage(
    `
      <ul>
        <li class="product post-8123 product_cat-uncategorized product-type-lottery">
          <a href="https://readyteddygocompetitions.co.uk/product/win-a-holiday-to-lanzarote-or-3000-cash/">
            <h2>WIN A HOLIDAY TO LANZAROTE OR £3000 CASH</h2>
          </a>
          <div class="single-progressBar">TICKETS SOLD: 1,099 / 25,000</div>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "readyteddygo",
      displayName: "Ready Teddy Go Competitions",
      baseUrl: "https://readyteddygocompetitions.co.uk",
      listPath: "/competitions/",
    },
  );

  assert.ok(competition);
  const enriched = enrichCompetitionFromDetail(
    competition,
    `
      <div class="product">
        <h1 class="product_title entry-title">WIN A HOLIDAY TO LANZAROTE OR £3000 CASH</h1>
        <div>&pound;2.55 /PER TICKET</div>
        <div class="lty-lottery-countdown-timer" data-time="2026/08/10 00:00:00"></div>
        <p>Tickets Sold: 1,099 / 25,000</p>
      </div>
    `,
  );

  assert.equal(enriched.entryPrice, 2.55);
  assert.equal(enriched.cashAlternative, 3000);
  assert.equal(enriched.drawDate, new Date(2026, 7, 10, 0, 0, 0, 0).toISOString());
});

test("WC Lottery detail enrichment reads progress ticket economics", () => {
  const [competition] = parsePage(
    `
      <ul>
        <li class="product post-1447211 product_cat-competitions product-type-lottery">
          <a href="https://bridgeclassiccars.co.uk/product/2007-porsche-cayman-s-2/">
            <h2>2007 Porsche Cayman S</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£7.50</span></span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "bridgeclassiccars",
      displayName: "Bridge Classic Cars",
      baseUrl: "https://bridgeclassiccars.co.uk",
      listPath: "/competitions/",
    },
  );

  assert.ok(competition);
  const enriched = enrichCompetitionFromDetail(
    competition,
    `
      <div class="product">
        <h1 class="product_title entry-title">2007 Porsche Cayman S</h1>
        <p class="clear p-margin draw-date">Guaranteed draw: 9th July, 4:30pm</p>
        <progress max="5500" value="3603"></progress>
        <span class="enterprice price"><span class="woocommerce-Price-amount">£7.50</span></span>
        <p>The scheduled draw date for this competition is 9/07/2026 at 4:30 pm.</p>
        <p class="p-margin max-per-order">50 tickets per order limit</p>
      </div>
      <ul class="products">
        <li class="product">
          <h2>1972 Rover P5B Coupe</h2>
          <div class="alt_prize">or £10,000</div>
        </li>
      </ul>
    `,
  );

  assert.equal(enriched.entryPrice, 7.5);
  assert.equal(enriched.ticketsSold, 3603);
  assert.equal(enriched.maxTickets, 5500);
  assert.equal(enriched.maxEntriesPerUser, 50);
  assert.equal(enriched.cashAlternative, null);
  assert.equal(enriched.drawDate, new Date(2026, 6, 9, 16, 30, 0, 0).toISOString());
});

test("WC Lottery detail enrichment reads stated retail worth as site estimate", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "5729",
      siteName: "dunescomps",
      url: "https://dunescomps.co.uk/competition/winners-choice-custom-driver/",
      name: "Winners Choice of Custom Fit Driver for 99p",
      entryPrice: 0.99,
      ticketsSold: 358,
      maxTickets: 1270,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: "2026-06-30T19:00:00.000Z",
      isAutoDraw: false,
      categories: ["uncategorized"],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title entry-title">Winners Choice of Custom Fit Driver for 99p</h1>
        <p>The prize is worth up to <strong>£629</strong>.</p>
        <p>If the winner would prefer not to take a driver, they can choose <strong>£450 Dunes Golf Centre shop credit</strong> instead.</p>
      </div>
    `,
  );

  assert.equal(enriched.cashAlternative, null);
  assert.equal(enriched.estimatedPrizeValue, 535);
  assert.equal(enriched.valuationSource, "site_estimate");
  assert.equal(enriched.valuationConfidence, "medium");
});

test("WC Lottery detail enrichment reads value stated before worth", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "132339",
      siteName: "xtremecompetitions",
      url: "https://xtreme-competitions.co.uk/product/win-this-brand-new-road-legal-surron-ultra-bee/",
      name: "WIN THIS BRAND NEW ROAD LEGAL SURRON ULTRA BEE",
      entryPrice: 20,
      ticketsSold: 83,
      maxTickets: 999,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: "2026-08-02T20:15:00.000Z",
      isAutoDraw: false,
      categories: ["uncategorised"],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title entry-title">WIN THIS BRAND NEW ROAD LEGAL SURRON ULTRA BEE</h1>
        <p>OVER £4,000 WORTH OF UPGRADES</p>
      </div>
    `,
  );

  assert.equal(enriched.estimatedPrizeValue, 3400);
  assert.equal(enriched.valuationSource, "site_estimate");
  assert.equal(enriched.valuationConfidence, "medium");
});

test("WC Lottery detail enrichment reads max-per-person limits", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "123",
      siteName: "enchantedwishes",
      url: "https://enchantedwishes.co.uk/competition/cash/",
      name: "£100 Cash Jackpot",
      entryPrice: 1,
      ticketsSold: 13,
      maxTickets: 150,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: 100,
      drawDate: "2026-07-16T21:45:00.000Z",
      isAutoDraw: true,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title entry-title">£100 Cash Jackpot</h1>
        <p>Tickets Sold: 13 of 150</p>
        <p>150 Total Entries 15 Max Per Person Auto Drawn 16/07/2026</p>
      </div>
    `,
  );

  assert.equal(enriched.maxEntriesPerUser, 15);
  assert.equal(enriched.maxEntriesPerUserSource, "site");
});

test("Hot Comps parses its max-entries-per-person wording", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "1290555",
      siteName: "hotcomps",
      url: "https://hotcomps.com/product/dewalt-xr-9pc-brushless-bundle-plus-2000-of-instant-wins/",
      name: "DeWalt XR 7pc Brushless Bundle plus £2,000 of Instant Wins",
      entryPrice: 3,
      ticketsSold: 101,
      maxTickets: 1999,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: 1000,
      drawDate: "2026-10-11T19:00:00.000Z",
      isAutoDraw: true,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title">DeWalt XR 7pc Brushless Bundle plus £2,000 of Instant Wins</h1>
        <p>Total Entries: 1999</p>
        <p>Max Entries per person: 200</p>
      </div>
    `,
  );

  assert.equal(enriched.maxEntriesPerUser, 200);
  assert.equal(enriched.maxEntriesPerUserSource, "site");
});

test("WC Lottery parser reads You Could Win cash alternative cards", () => {
  const [competition] = parsePage(
    `
      <li class="product type-product competition-open">
        <a href="https://youcouldwin.co.uk/competition/40k-combat-patrol-winners-choice-14/"><h2>40K Combat Patrol: Winner's Choice #14</h2></a>
        <span class="price">£0.99</span>
        <span>Cash Alternative: Alt £85.00</span>
        <div>1 / 250</div>
        <p>Draw Sun 27th Sep 21:06pm</p>
      </li>
    `,
    {
      ...config,
      siteName: "youcouldwin",
      displayName: "You Could Win",
      baseUrl: "https://youcouldwin.co.uk",
      listPath: "/competitions/",
    },
  );

  assert.equal(competition?.cashAlternative, 85);
});

test("WC Lottery detail enrichment reads You Could Win ticket labels", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "97301",
      siteName: "youcouldwin",
      url: "https://youcouldwin.co.uk/competition/40k-combat-patrol-winners-choice-14/",
      name: "40k Combat Patrol: Winner’s Choice #14",
      entryPrice: 0.99,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 25,
      maxEntriesPerUserSource: "site",
      cashAlternative: 85,
      drawDate: "2026-09-27T20:06:00.000Z",
      isAutoDraw: true,
      categories: ["auto draw"],
      scrapedAt: new Date().toISOString(),
    },
    "<main><div class=\"product type-product\"><h1>40k Combat Patrol</h1><p>250 Tickets £0.99 Entry</p><p>2 Sold</p></div></main>",
  );

  assert.equal(competition.ticketsSold, 2);
  assert.equal(competition.maxTickets, 250);
});

test("2JS parses the rendered ticket cap", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-9075">
        <h1 class="product_title">£250 Tax Free Cash – Only 69p</h1>
        <span class="price"><span class="woocommerce-Price-amount">£0.69</span></span>
        <div class="progress-sold">84/599</div>
        <input data-rangeslider type="range" max="75" value="1">
        <p>Cash Alternative: £250</p>
        <div class="countdown-timer" data-enddate="2026-09-13 22:10"></div>
      </div>
      <p>75 Max Per Person</p>
    `,
    {
      ...config,
      siteName: "twojs",
      displayName: "2Js Competitions",
      baseUrl: "https://2jscompetitions.com",
      listPath: "/competitions/",
    },
    "https://2jscompetitions.com/product/250-tax-free-cash-only-69p/",
  );

  assert.equal(competition?.maxEntriesPerUser, 75);
  assert.equal(competition?.maxEntriesPerUserSource, "site");
});

test("WC Lottery detail enrichment reads Supreem Life maximum ticket wording", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "673189",
      siteName: "supreemlife",
      url: "https://supreemlife.co.uk/product/ninja-creami-scoop-swirl/",
      name: "Ninja CREAMi Scoop & Swirl",
      entryPrice: 2,
      ticketsSold: 27,
      maxTickets: 599,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: 250,
      drawDate: "2026-07-27T20:00:00.000Z",
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title entry-title">Ninja CREAMi Scoop &amp; Swirl</h1>
        <p>
          The maximum tickets for this competition is 599. To ensure the competition
          is fair for all players, the maximum amount of tickets per person is 79.
        </p>
      </div>
    `,
  );

  assert.equal(enriched.maxEntriesPerUser, 79);
  assert.equal(enriched.maxEntriesPerUserSource, "site");
});

test("WC Lottery parser reads Bridge alternate-prize cash text", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-1443885 product_cat-competitions product-type-lottery">
          <a href="https://bridgeclassiccars.co.uk/product/1972-rover-p5b-coupe/">
            <h2>1972 Rover P5B Coupe</h2>
            <div class="alt_prize">or £10,000</div>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£9.00</span></span>
          <progress max="4750" value="2853"></progress>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "bridgeclassiccars",
      displayName: "Bridge Classic Cars",
      baseUrl: "https://bridgeclassiccars.co.uk",
      listPath: "/competitions/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 10000);
});

test("WC Lottery parser reads Cotswold grid cash alternatives", () => {
  const comps = parsePage(
    `
      <article class="w-grid-item post-76053 product type-product product_cat-live product-type-lottery">
        <h4 class="woocommerce-loop-product__title">
          <a href="https://www.cotswoldcompetitions.co.uk/product/fortnum-mason-the-cheese-wine-hamper/">Fortnum &amp; Mason The Cheese &amp; Wine Hamper</a>
        </h4>
        <div class="w-post-elm post_custom_field usg_post_custom_field_1 type_text prize">
          <span class="w-post-elm-value">Cash Alt: £160</span>
        </div>
        <div class="product-card-info"><p>Entry</p><p>&pound;0.47</p></div>
        <div class="product-card-info"><p>Max</p><p>1175</p></div>
        <div class="wc-comps-tickets-progress">
          <span class="wc-comps-tickets-progress-sold">4%</span>
          <div class="wc-comps-tickets-progress-bar" role="progressbar" aria-valuenow="43" aria-valuemax="1175"></div>
        </div>
        <div class="wc-comps-tickets-progress-labels">
          <span class="ticket-counter-label wc-comps-tickets-sold">Sold: 43</span>
        </div>
        <div class="main-lottery lottery-time-countdown" data-enddate="2026-07-05 22:00" data-format="dHMS"></div>
        <p class="product_field price"><span class="woocommerce-Price-amount amount">&pound;0.47</span> Per Ticket</p>
      </article>
    `,
    {
      ...config,
      siteName: "cotswold",
      displayName: "Cotswold Competitions",
      baseUrl: "https://www.cotswoldcompetitions.co.uk",
      listPath: "/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.entryPrice, 0.47);
  assert.equal(comps[0]?.cashAlternative, 160);
  assert.equal(comps[0]?.drawDate, new Date(2026, 6, 5, 22, 0, 0, 0).toISOString());
});

test("WC Lottery parser reads Elementor loop product economics", () => {
  const comps = parsePage(
    `
      <div data-elementor-type="loop-item" class="elementor e-loop-item post-176306 product type-product product_cat-all product_cat-competitions product-type-lottery">
        <a href="https://cumbriajewellerycashcompetitions.co.uk/product/9ct-gold-18-curb-necklace-with-14ct-gold-jade-cross-pendant/">
          <img alt="">
        </a>
        <div class="elementor-countdown-wrapper" data-date="1785517200"></div>
        <div class="elementor-progress-wrapper" aria-valuetext="0.40% (10/2499)">
          <div class="elementor-progress-bar">
            <span class="elementor-progress-text">10/2499</span>
          </div>
        </div>
        <p class="elementor-heading-title elementor-size-default">
          <span class="woocommerce-Price-amount amount">
            <span class="woocommerce-Price-currencySymbol">&pound;</span>0.29
          </span>
        </p>
        <div class="elementor-element-d58edd4">
          <p class="elementor-heading-title elementor-size-default">9ct Gold 18&quot; Curb Necklace with 14ct Gold Jade Cross pendant</p>
        </div>
        <p>CASH ALT:</p>
        <p>375</p>
      </div>
    `,
    {
      ...config,
      siteName: "cumbriajewellerycash",
      displayName: "Cumbria Jewellery Cash Competitions",
      baseUrl: "https://cumbriajewellerycashcompetitions.co.uk",
      listPath: "/competitions/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.sourceId, "176306");
  assert.equal(
    comps[0]?.name,
    '9ct Gold 18" Curb Necklace with 14ct Gold Jade Cross pendant',
  );
  assert.equal(comps[0]?.entryPrice, 0.29);
  assert.equal(comps[0]?.ticketsSold, 10);
  assert.equal(comps[0]?.maxTickets, 2499);
  assert.equal(comps[0]?.cashAlternative, 375);
  assert.equal(comps[0]?.drawDate, new Date(1785517200 * 1000).toISOString());
});

test("WC Lottery parser reads Absolute Comps card formats", () => {
  const [competition] = parsePage(
    `
      <li class="product type-product post-123 product_cat-live product-type-lottery">
        <a href="https://absolute-comps.co.uk/product/win-100-tax-free-cash/"><h2>Win £100 Tax Free Cash</h2></a>
        <span class="price"><span class="woocommerce-Price-amount">£0.49</span></span>
        <p>Sold: 43/499</p>
        <p>ENDS: August 31, 2026</p>
      </li>
    `,
    {
      ...config,
      siteName: "absolute",
      displayName: "Absolute Comps",
      baseUrl: "https://absolute-comps.co.uk",
      listPath: "/",
    },
  );

  assert.ok(competition);
  assert.equal(competition.url, "https://absolute-comps.co.uk/product/win-100-tax-free-cash/");
  assert.equal(competition.entryPrice, 0.49);
  assert.equal(competition.ticketsSold, 43);
  assert.equal(competition.maxTickets, 499);
  assert.equal(competition.drawDate, new Date(2026, 7, 31, 20, 0, 0, 0).toISOString());
});

test("WC Lottery detail enrichment reads Absolute Comps sold text and end date", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "win-100-tax-free-cash",
      siteName: "absolute",
      url: "https://absolute-comps.co.uk/product/win-100-tax-free-cash/",
      name: "Win £100 Tax Free Cash",
      entryPrice: 0,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: "2026-08-21T00:00:00.000Z",
    },
    `
      <div class="product type-product post-123">
        <h1 class="product_title">Win £100 Tax Free Cash</h1>
        <span class="price"><span class="woocommerce-Price-amount">£0.49</span></span>
        <p>43 Of 499 Tickets Sold!</p>
        <p>ENDS: August 31, 2026</p>
      </div>
    `,
  );

  assert.equal(competition.entryPrice, 0.49);
  assert.equal(competition.ticketsSold, 43);
  assert.equal(competition.maxTickets, 499);
  assert.equal(competition.drawDate, new Date(2026, 7, 31, 20, 0, 0, 0).toISOString());
});

test("WC Lottery detail enrichment does not use a start time as the draw date", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "119293",
      siteName: "absolute",
      url: "https://absolute-comps.co.uk/product/win-100-tax-free-cash-2/",
      name: "Win – £100 Tax free cash!",
      entryPrice: 0.49,
      ticketsSold: 0,
      maxTickets: 888,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: 100,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: "2026-08-31T21:42:02.914Z",
    },
    `
      <div class="product type-product post-119293">
        <div class="lty-lottery-date-ranges">
          <p class="lty-lottery-start-time-label"><span><b>STARTS:</b> September 1, 2026</span></p>
          <p class="lty-lottery-time-left-label">STARTS</p>
          <div class="lty-lottery-countdown-timer" data-time="2026/08/31 23:00:00"></div>
        </div>
      </div>
    `,
  );

  assert.equal(competition.drawDate, null);
});

test("WC Lottery detail cash stays scoped to the current product", () => {
  const baseCompetition = {
    sourceId: "current-product",
    siteName: "rendalls",
    url: "https://example.test/product/current-product/",
    name: "Shark FlexBreeze – Enter for Just 49p!",
    entryPrice: 0.49,
    ticketsSold: 10,
    maxTickets: 100,
    maxEntriesPerUser: 100,
    cashAlternative: null,
    drawDate: null,
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
  };

  const unrelated = enrichCompetitionFromDetail(
    baseCompetition,
    `
      <div class="product post-current">
        <div class="summary entry-summary">
          <h1 class="product_title">Shark FlexBreeze – Enter for Just 49p!</h1>
          <div class="woocommerce-product-details__short-description">
            Cash alternative available. See the competition page for details.
          </div>
        </div>
        <section class="jet-listing-grid__item" data-post-id="133121">
          <h2>Inflatable Water Park or £280 Cash Alternative</h2>
          <div class="alternate_prize">Cash Alternative: £280</div>
        </section>
      </div>
    `,
  );
  assert.equal(unrelated.cashAlternative, null);

  const bridgeUnrelated = enrichCompetitionFromDetail(
    {
      ...baseCompetition,
      siteName: "bridgeclassiccars",
      name: "1995 Aston Martin DB7",
    },
    `
      <div class="product post-current">
        <h1 class="product_title">1995 Aston Martin DB7</h1>
        <section class="live-comps">
          <ul class="products">
            <li class="product post-1458890">
              <h2>1990 Yamaha FZR1000</h2>
              <div class="alt_prize">or £3,000</div>
            </li>
          </ul>
        </section>
      </div>
    `,
  );
  assert.equal(bridgeUnrelated.cashAlternative, null);

  const bridgeCurrent = enrichCompetitionFromDetail(
    {
      ...baseCompetition,
      siteName: "bridgeclassiccars",
      name: "1990 Yamaha FZR1000",
    },
    `
      <div class="product post-current">
        <div class="column">
          <h1 class="product_title">1990 Yamaha FZR1000</h1>
          <h2 class="alternate_prize">or £3,000</h2>
        </div>
      </div>
    `,
  );
  assert.equal(bridgeCurrent.cashAlternative, 3_000);
});

test("WC Lottery parser reads Football Prizes LPE detail payloads", () => {
  const comp = parseLpeDetailPage(
    `
      <div class="lpe-widget" data-settings='{"product_id":1282868,"product_name":"Any Official Club or International Shirt","ticket_price":2.95,"competition_end":"2026-06-27 19:30","max_tickets":65,"max_tickets_per_user":8,"sold_tickets":28,"total_tickets":65}'></div>
    `,
    {
      ...config,
      siteName: "footballprizes",
      displayName: "Football Prizes",
      baseUrl: "https://footballprizes.co.uk",
      listPath: "/",
    },
    "https://footballprizes.co.uk/product/anyshirt/",
  );

  assert.ok(comp);
  assert.equal(comp.name, "Any Official Club or International Shirt");
  assert.equal(comp.entryPrice, 2.95);
  assert.equal(comp.ticketsSold, 28);
  assert.equal(comp.maxTickets, 65);
  assert.equal(comp.maxEntriesPerUser, 8);
  assert.equal(comp.drawDate, new Date(2026, 5, 27, 19, 30, 0, 0).toISOString());
});

test("WC Lottery adapter enriches epoch countdown times", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://clubhousecompetitions.co.uk/product/world-cup-penalty/";
  const epochSeconds = 1_784_316_000;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://clubhousecompetitions.co.uk/competitions/") {
      return new Response(
        `
          <ul>
            <li class="product post-123 product_cat-live">
              <a href="${detailUrl}">
                <h2>£50K WORLD CUP PENALTY SHOOT OUT</h2>
              </a>
              <span class="woocommerce-Price-amount">£2.00</span>
              <progress value="1385" max="54999"></progress>
            </li>
          </ul>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `<div class="lottery-time-countdown" data-time="${epochSeconds}"></div>`,
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const adapter = new WCLotteryAdapter(config);
    const comps = await adapter.fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(
      comps[0]?.drawDate,
      new Date(epochSeconds * 1000).toISOString(),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery parser ignores winner articles", () => {
  const comps = parsePage(
    `
      <article class="post-45644">
        <a href="https://www.cotswoldcompetitions.co.uk/winner/paul-hayes-won-the-bmw-m4-or-18000/">
          <h2>Paul Hayes Won the BMW M4 or £18,000</h2>
        </a>
      </article>
    `,
    config,
  );

  assert.equal(comps.length, 0);
});

test("WC Lottery parser reads slash-formatted card data-time values", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-222 product_cat-live">
          <a href="https://boboncomps.co.uk/product/slushi/">
            <div class="lty-shop-timer-wrapper" data-time="2026/06/22 20:00:00"></div>
            <h2>Instant Wins SLUSHi</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£0.25</span></span>
          <span class="progress-sold">107/700</span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "boboncomps",
      displayName: "Bob On Comps",
      baseUrl: "https://boboncomps.co.uk",
      listPath: "/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.drawDate, new Date(2026, 5, 22, 20, 0, 0, 0).toISOString());
});

test("WC Lottery parser reads simple ends text from product cards", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-333 product_cat-live">
          <a href="https://reverecompetitions.co.uk/product/bottle-blast/">
            <h2>£10K BOTTLE BLAST! INTERACTIVE GAME!</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£1.00</span></span>
          <span>SOLD: 0.19% 37 / 19999</span>
          <span>ENDS 24th Jun at 8:00 PM</span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "revere",
      displayName: "Revere Competitions",
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

test("WC Lottery parser uses exact sold plus remaining instead of inverting rounded percentages", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-334 product_cat-live" data-popularity="214" data-percentage-sold="0">
          <a href="https://www.highspeedcomps.com/competition/lego-ferrari/">
            <h2>WIN A LEGO TECHNIC FERRARI SF-24 F1 CAR OR £140 TAX FREE CASH</h2>
          </a>
          <span>1 days 986 remaining Max 100 p/p 17 %</span>
          <span class="price"><span class="woocommerce-Price-amount">£0.25</span></span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "highspeedcomps",
      displayName: "High Speed Competitions",
      baseUrl: "https://www.highspeedcomps.com",
      listPath: "/competitions/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.ticketsSold, 214);
  assert.equal(comps[0]?.maxTickets, 1200);
});

test("WC Lottery parser reads draw date text from product cards", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-335 product_cat-live">
          <a href="https://dunescomps.co.uk/competition/custom-driver/">
            <h2>Winners Choice of Custom Fit Driver for 99p</h2>
          </a>
          <span>Draw Sun 19th Jul 484 / 9999 4 %</span>
          <span class="price"><span class="woocommerce-Price-amount">£1.99</span></span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "dunescomps",
      displayName: "Dunes Competitions",
      baseUrl: "https://dunescomps.co.uk",
      listPath: "/competitions/",
    },
  );

  const expectedDrawDate = new Date(new Date().getFullYear(), 6, 19, 20, 0, 0, 0);
  if (expectedDrawDate.getTime() < Date.now() - (24 * 60 * 60 * 1000)) {
    expectedDrawDate.setFullYear(expectedDrawDate.getFullYear() + 1);
  }

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.drawDate, expectedDrawDate.toISOString());
});

test("WC Lottery detail enrichment does not replace sold counts with percentage-derived totals", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "334",
      siteName: "highspeedcomps",
      url: "https://www.highspeedcomps.com/competition/lego-ferrari/",
      name: "WIN A LEGO TECHNIC FERRARI SF-24 F1 CAR OR £140 TAX FREE CASH",
      entryPrice: 0.25,
      ticketsSold: 214,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: 140,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1>WIN A LEGO TECHNIC FERRARI SF-24 F1 CAR OR £140 TAX FREE CASH</h1>
        <span>1 days 986 remaining Max 100 p/p 17 %</span>
        <span>Draw Thu 2nd Jul</span>
      </div>
    `,
  );

  const expectedDrawDate = new Date(new Date().getFullYear(), 6, 2, 20, 0, 0, 0);
  if (expectedDrawDate.getTime() < Date.now() - (24 * 60 * 60 * 1000)) {
    expectedDrawDate.setFullYear(expectedDrawDate.getFullYear() + 1);
  }

  assert.equal(enriched.ticketsSold, 214);
  assert.equal(enriched.maxTickets, 1200);
  assert.equal(enriched.drawDate, expectedDrawDate.toISOString());
});

test("WC Lottery parser reads Ragnarok grid cards", () => {
  const epochSeconds = 1_782_237_540;

  const comps = parsePage(
    `
      <article class="w-grid-item type-product post-97569 product type-product status-publish has-post-thumbnail product_cat-live product_cat-home-garden product_cat-prizes">
        <div class="w-grid-item-h">
          <h2 class="w-post-elm post_title usg_post_title_1">
            <a href="https://ragnarokcompetitions.co.uk/product/lay-z-spa-cancun-airjet-inflatable-hot-tub-2-2/">LAY-Z-SPA Cancun AirJet Inflatable Hot Tub #2</a>
          </h2>
          <div class="wcl-progress-meter"><span class="current">83 / 135 Sold</span></div>
          <progress max="135" value="83"></progress>
          <div class="main-lottery lottery-time-countdown is-countdown" data-time="${epochSeconds}"></div>
          <span class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">&pound;</span>0.99</bdi></span></span>
        </div>
      </article>
    `,
    {
      ...config,
      siteName: "ragnarok",
      displayName: "Ragnarok Competitions",
      baseUrl: "https://ragnarokcompetitions.co.uk",
      listPath: "/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.name, "LAY-Z-SPA Cancun AirJet Inflatable Hot Tub #2");
  assert.equal(comps[0]?.entryPrice, 0.99);
  assert.equal(comps[0]?.ticketsSold, 83);
  assert.equal(comps[0]?.maxTickets, 135);
  assert.equal(comps[0]?.drawDate, new Date(epochSeconds * 1000).toISOString());
});

test("WC Lottery detail enrichment reads Game Changing sold/max counters", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "71293",
      siteName: "gamechanginggiveaways",
      url: "https://gamechanginggiveaways.com/product/dji-air-3s-fly-more-combo-dji-rc-2-or-1100-cash-alt-06-09-2026/",
      name: "DJI Air 3S Fly More Combo (DJI RC 2) or £1,100 Cash alt",
      entryPrice: 1.49,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title entry-title">DJI Air 3S Fly More Combo (DJI RC 2) or £1,100 Cash alt</h1>
        <p class="price"><span class="woocommerce-Price-amount">&pound;1.49</span></p>
        <table class="comp-detail">
          <tr><td><strong>Competition Ends</strong></td><td>06/09/2026 22:30</td></tr>
          <tr><td><strong>Ticket Limit</strong></td><td>1499</td></tr>
          <tr><td><strong>User Ticket Limit</strong></td><td>500</td></tr>
        </table>
        <div class="wc-comps-tickets-progress">
          <div class="ticket-progress-percentage-sold">2%<span>sold</span></div>
          <div class="wc-comps-tickets-progress-bar" aria-valuemax="1499"></div>
        </div>
        <span class="ticket-counter-label wc-comps-tickets-sold">
          Tickets sold: <span>39</span>/1499
        </span>
        <span class="ticket-counter-label wc-comps-tickets-remaining">
          Tickets remaining: 1460
        </span>
        <p>If you don't want this prize, a <strong>&pound;1,100 cash alternative</strong> is available.</p>
      </div>
    `,
  );

  assert.equal(enriched.entryPrice, 1.49);
  assert.equal(enriched.ticketsSold, 39);
  assert.equal(enriched.maxTickets, 1499);
  assert.equal(enriched.maxEntriesPerUser, 500);
  assert.equal(enriched.maxEntriesPerUserSource, "site");
  assert.equal(enriched.cashAlternative, 1100);
  assert.equal(enriched.drawDate, new Date(2026, 8, 6, 22, 30, 0, 0).toISOString());
});

test("WC Lottery detail enrichment reads explicit prize cash text", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "813",
      siteName: "goldstarcomps",
      url: "https://goldstarcomps.co.uk/competitions/nifty-50-2/",
      name: "Nifty 50",
      entryPrice: 0.5,
      ticketsSold: 28,
      maxTickets: 200,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: "2026-07-12T18:00:00.000Z",
      isAutoDraw: false,
      categories: ["cash competitions"],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div class="product">
        <h1 class="product_title entry-title">Nifty 50</h1>
        <p>For just <strong>50p per entry</strong>, you could win <strong>£50 CASH</strong></p>
        <p>Prize: <strong>£50 Cash</strong></p>
        <p>Ticket Price: <strong>50p</strong></p>
        <p>Limited Tickets Available : <strong>200</strong></p>
      </div>
    `,
  );

  assert.equal(enriched.cashAlternative, 50);
});

test("WC Lottery parser creates competitions from Game Changing detail pages", () => {
  const comp = parseDetailPage(
    `
      <script>var wc_lottery_data = {"page_id":"68684"};</script>
      <div class="product type-product post-68684 product_cat-live">
        <h1 class="product_title entry-title">ProForm 750 R Rowing Machine or £600 Cash alt</h1>
        <p class="price"><span class="woocommerce-Price-amount">&pound;0.99</span></p>
        <table class="comp-detail">
          <tr><td><strong>Competition Ends</strong></td><td>05/07/2026 22:30</td></tr>
        </table>
        <span class="ticket-counter-label wc-comps-tickets-sold">
          Tickets sold: <span>237</span>/1299
        </span>
        <p>If you don't want this prize, a <strong>&pound;600 cash alternative</strong> is available.</p>
      </div>
    `,
    {
      ...config,
      siteName: "gamechanginggiveaways",
      displayName: "Game Changing Giveaways",
      baseUrl: "https://gamechanginggiveaways.com",
      listPath: "/product-category/live/",
    },
    "https://gamechanginggiveaways.com/product/proform-750-r-rowing-machine-or-600-cash-alt-05-07-2026/",
  );

  assert.ok(comp);
  assert.equal(comp.sourceId, "68684");
  assert.equal(comp.entryPrice, 0.99);
  assert.equal(comp.ticketsSold, 237);
  assert.equal(comp.maxTickets, 1299);
  assert.equal(comp.cashAlternative, 600);
  assert.equal(comp.drawDate, new Date(2026, 6, 5, 22, 30, 0, 0).toISOString());
});

test("WC Lottery parser values final prizes instead of instant-win prize pools", () => {
  const comps = parsePage(
    `
      <ul>
        <li class="product post-68600 product_cat-live">
          <a href="https://gamechanginggiveaways.com/product/hongbao-42500-prize-pool-888-final-prize/">
            <h2>Hongbao – £42,500 Prize Pool + £888 Final Prize</h2>
          </a>
          <span class="price"><span class="woocommerce-Price-amount">£0.08</span></span>
          <span class="wc-comps-tickets-sold">Tickets sold: 68,812/957,700</span>
        </li>
      </ul>
    `,
    {
      ...config,
      siteName: "gamechanginggiveaways",
      displayName: "Game Changing Giveaways",
      baseUrl: "https://gamechanginggiveaways.com",
      listPath: "/product-category/live/",
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.ticketsSold, 68812);
  assert.equal(comps[0]?.maxTickets, 957700);
  assert.equal(comps[0]?.cashAlternative, 888);
});

test("WC Lottery detail enrichment reads source-scoped Zap aria inventory", () => {
  const enriched = enrichCompetitionFromDetail(
    {
      sourceId: "40818",
      siteName: "mashedpotatogolf",
      url: "https://mashedpotatogolfcomps.co.uk/competition/example/",
      name: "Golf prize",
      entryPrice: 0,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: "2026-07-23T18:30:00.000Z",
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
    `
      <div id="product-40818" class="product type-product post-40818 competition-open">
        <span class="zapc-refresh-sold-40818">219</span>
        <div
          class="progress-bar zapc-refresh-progress-40818"
          role="progressbar"
          aria-valuenow="219"
          aria-valuemax="10000"
        ></div>
        <section class="related products">
          <div
            class="progress-bar zapc-refresh-progress-99999"
            role="progressbar"
            aria-valuenow="9"
            aria-valuemax="10"
          ></div>
        </section>
      </div>
    `,
  );

  assert.equal(enriched.ticketsSold, 219);
  assert.equal(enriched.maxTickets, 10000);
});

test("WC Lottery parser skips Ragnarok completed products", () => {
  const competitions = parsePage(
    `
      <article class="w-grid-item post-76636 product type-product product_cat-complete instock product-type-lottery">
        <h4 class="woocommerce-loop-product__title">
          <a href="https://ragnarokcompetitions.co.uk/product/150-amazon-voucher-13/">£150 Amazon Voucher #13</a>
        </h4>
        <span class="price"><span class="woocommerce-Price-amount">£1.79</span></span>
        <a href="https://ragnarokcompetitions.co.uk/product/150-amazon-voucher-13/">View Winner</a>
      </article>
    `,
    {
      ...config,
      siteName: "ragnarok",
      displayName: "Ragnarok Competitions",
      baseUrl: "https://ragnarokcompetitions.co.uk",
      listPath: "/",
    },
  );

  assert.deepEqual(competitions, []);
});

test("WC Lottery adapter drops listing rows whose detail page is waiting for results", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl =
    "https://www.plumcompetitions.co.uk/competition/20-100-supermarket-gift-card/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://www.plumcompetitions.co.uk/shop/") {
      return new Response(
        `
          <div class="product type-product post-1288661 product-type-lottery">
            <a href="${detailUrl}"><h2>#20 £100 Supermarket Gift Card</h2></a>
            <span class="price"><span class="woocommerce-Price-amount">£0.99</span></span>
          </div>
        `,
        { status: 200 },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <div id="product-1288661" class="product type-product post-1288661 product-type-lottery">
            <h1>#20 £100 Supermarket Gift Card</h1>
            <p class="lty-waiting-result-message">Please wait for the result</p>
            <h4>112 Tickets Sold</h4>
          </div>
        `,
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new WCLotteryAdapter({
      ...config,
      siteName: "plum",
      displayName: "Plum Competitions",
      baseUrl: "https://www.plumcompetitions.co.uk",
      listPath: "/shop/",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.deepEqual(competitions, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery adapter bounds parallel detail enrichment and attaches request signals", async () => {
  const originalFetch = globalThis.fetch;
  const detailSignals: Array<AbortSignal | undefined> = [];
  let activeDetails = 0;
  let maxActiveDetails = 0;
  const cards = Array.from({ length: 8 }, (_, index) => {
    const sourceId = 9300 + index;
    return `
      <li class="product type-product post-${sourceId} product_cat-live product-type-lottery">
        <a href="https://sullysgames.co.uk/product/prize-${sourceId}/">
          <h2>Prize ${sourceId} or £100 Cash</h2>
        </a>
        <div class="lty-lottery-date-ranges">
          <span><b>Competition ends on:</b> September 4, 2026 9:00 pm (UTC +01:00)</span>
        </div>
      </li>
    `;
  }).join("");

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://sullysgames.co.uk/live-competitions/") {
      return new Response(`<ul>${cards}</ul>`, { status: 200 });
    }

    if (url.startsWith("https://sullysgames.co.uk/product/prize-")) {
      detailSignals.push(init?.signal ?? undefined);
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      try {
        await new Promise((resolve) => setTimeout(resolve, 20));
      } finally {
        activeDetails -= 1;
      }
      return new Response(
        `
          <div class="product">
            <p class="price"><span class="woocommerce-Price-amount">£1.00</span></p>
            <p class="lty-tickets-sold">Tickets Sold : <b>10</b></p>
            <p class="lty-progress-remaining-count">90 Tickets remaining</p>
          </div>
        `,
        { status: 200 },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new WCLotteryAdapter({
      ...config,
      siteName: "sullysgames",
      displayName: "Sully's Games",
      baseUrl: "https://sullysgames.co.uk",
      listPath: "/live-competitions/",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(competitions.length, 8);
    assert.ok(maxActiveDetails > 1);
    assert.ok(maxActiveDetails <= 6);
    assert.equal(detailSignals.length, 8);
    assert.ok(detailSignals.every((signal) => signal instanceof AbortSignal));
    assert.ok(competitions.every((competition) => competition.maxTickets === 100));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WC Lottery adapter times out a stalled detail request without losing listing data", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = AbortSignal.timeout;
  let detailSignalSeen = false;

  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value: () => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("detail request timeout", "TimeoutError")),
        10,
      );
      return controller.signal;
    },
  });

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://sullysgames.co.uk/live-competitions/") {
      return new Response(
        `
          <li class="product type-product post-9400 product_cat-live product-type-lottery">
            <a href="https://sullysgames.co.uk/product/prize-9400/">
              <h2>Prize 9400 or £100 Cash</h2>
            </a>
            <div class="lty-lottery-date-ranges">
              <span><b>Competition ends on:</b> September 4, 2026 9:00 pm (UTC +01:00)</span>
            </div>
          </li>
        `,
        { status: 200 },
      );
    }

    if (url === "https://sullysgames.co.uk/product/prize-9400/") {
      const signal = init?.signal;
      detailSignalSeen = signal instanceof AbortSignal;
      if (!signal) throw new Error("detail fetch missing timeout signal");
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
    const competitions = await new WCLotteryAdapter({
      ...config,
      siteName: "sullysgames",
      displayName: "Sully's Games",
      baseUrl: "https://sullysgames.co.uk",
      listPath: "/live-competitions/",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(detailSignalSeen, true);
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "9400");
    assert.equal(competitions[0]?.maxTickets, 0);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: originalTimeout,
    });
  }
});

test("WC Lottery detail enrichment parses Tackle's explicit sold label", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "walkie-talkies",
      siteName: "tackle",
      url: "https://tacklecompetitions.co.uk/product/walkie-talkies/",
      name: "2X Walkie Talkies",
      entryPrice: 0.99,
      ticketsSold: 0,
      maxTickets: 69,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: "2026-07-28T00:00:00.000Z",
    },
    `<div class="product"><h1>2X Walkie Talkies</h1>
      <p>Competition ends on: August 2, 2026 7:00 pm</p>
      <p>This competition is limited to 69 tickets</p>
      <p>Tickets Sold : 18</p><p>51 Available</p></div>`,
  );

  assert.equal(competition.ticketsSold, 18);
  assert.equal(competition.maxTickets, 69);
});

test("WC Lottery parser handles nested Punter Prizes product details", () => {
  const competition = parseDetailPage(
    `
      <main class="l-main product post-210134">
        <div class="product type-product post-210134">
          <h1 class="product_title">ANGEL NUMBERS</h1>
          <p class="price"><span class="woocommerce-Price-amount">£0.22</span></p>
          <table class="comp-detail"><tr><td>Competition Ends</td><td>6th August 2026 8:00 pm</td></tr></table>
          <span class="wc-comps-tickets-sold">Tickets sold: <span>87701</span>/222222</span>
          <span class="wc-comps-tickets-remaining">Tickets remaining: 134521</span>
          <p>All tickets are entered into the end prize draw for £333.33.</p>
        </div>
      </main>
    `,
    {
      ...config,
      siteName: "punterprizes",
      baseUrl: "https://punterprizes.com",
    },
    "https://punterprizes.com/product/angel-numbers/",
  );

  assert.equal(competition?.entryPrice, 0.22);
  assert.equal(competition?.ticketsSold, 87701);
  assert.equal(competition?.maxTickets, 222222);
  assert.equal(competition?.estimatedPrizeValue, 333.33);
  assert.equal(competition?.drawDate, "2026-08-06T19:00:00.000Z");
});

test("WC Lottery parser handles Proper Wins cards and detail data attributes", () => {
  const [card] = parsePage(
    `
      <article class="pwv43-card pwv43-card--instant-card">
        <a href="https://properwins.co.uk/product/sweet-treats/"><h3>Sweet Treats</h3></a>
        <div class="pwv43-card__meta"><strong><span class="woocommerce-Price-amount">£0.28</span></strong><span>Sold: 0%</span></div>
      </article>
    `,
    {
      ...config,
      siteName: "properwins",
      baseUrl: "https://properwins.co.uk",
    },
  );
  assert.equal(card?.name, "Sweet Treats");
  assert.equal(card?.entryPrice, 0.28);

  const competition = parseDetailPage(
    `
      <head><meta name="description" content="Ticket price: £0.28 • Draw date: August 16, 2026 8:00 pm • End draw amount: £50.00" /></head>
      <body class="product type-product post-3597">
        <div class="product type-product post-3597">
          <h1>Sweet Treats</h1>
          <div class="pw-pk3" data-pw-picker data-unit-price="0.28" data-effective-max="892" data-remaining="119674" data-total="120000"></div>
        </div>
      </body>
    `,
    {
      ...config,
      siteName: "properwins",
      baseUrl: "https://properwins.co.uk",
    },
    "https://properwins.co.uk/product/sweet-treats/",
  );

  assert.equal(competition?.entryPrice, 0.28);
  assert.equal(competition?.ticketsSold, 326);
  assert.equal(competition?.maxTickets, 120000);
  assert.equal(competition?.maxEntriesPerUser, 892);
  assert.equal(competition?.estimatedPrizeValue, 50);
  assert.equal(competition?.drawDate, "2026-08-16T19:00:00.000Z");
});
