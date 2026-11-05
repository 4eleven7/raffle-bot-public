import test from "node:test";
import assert from "node:assert/strict";
import * as cheerio from "cheerio";
import * as browserRafflexModule from "../src/adapters/browser/browser-rafflex-adapter.js";
import type { RawCompetition } from "../src/types.js";

const { BrowserRafflexAdapter } = browserRafflexModule;

type EnrichRafflexCompetitionDetails = (
  competitions: RawCompetition[],
  fetchDetailHtml: (url: string) => Promise<string>,
) => Promise<void>;

function competition(overrides: Partial<RawCompetition>): RawCompetition {
  return {
    sourceId: "example-prize",
    siteName: "example",
    url: "https://example.test/competition/example-prize",
    name: "Example Prize",
    entryPrice: 0.25,
    ticketsSold: 100,
    maxTickets: 1_000,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    drawDate: "2026-08-31T20:00:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("browser Rafflex detail dates ignore JavaScript examples", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-28T20:11:00Z") });

  for (const drawLabel of ["Draw On Sun Nov 1st 10:00pm", ""]) {
    const row = competition({
      siteName: "kickoff",
      sourceId: "win-ps1000-tax-free-cash-low-odds",
      url: "https://kickoffcomps.com/competition/win-ps1000-tax-free-cash-low-odds",
      name: "WIN £1,000 TAX FREE CASH | LOW ODDS",
      entryPrice: 20,
      ticketsSold: 0,
      maxTickets: 0,
      drawDate: null,
    });

    await browserRafflexModule.enrichRafflexCompetitionDetails([row], async () => `
      <body>
        <script>// "Today 10:00pm" / "Tomorrow 9:00am"</script>
        <h1>WIN £1,000 TAX FREE CASH | LOW ODDS</h1>
        <p>£20.00 per ticket</p>
        <p>${drawLabel}</p>
        <p>0/99 Online</p>
        <button>Free Postal Entry</button>
      </body>
    `);

    assert.equal(row.maxTickets, 99);
    assert.equal(row.drawDate, drawLabel ? new Date(2026, 10, 1, 22).toISOString() : null);
  }
});

test("browser Rafflex adapter parses hero cards that rely on detail enrichment", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "quest",
    displayName: "Quest Competitions",
    baseUrl: "https://questcompetitions.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseHeroPriceCards = (adapter as unknown as {
    parseHeroPriceCards: ($: cheerio.CheerioAPI) => Array<{
      name: string;
      entryPrice: number;
      maxTickets: number;
      url: string;
    }>;
  }).parseHeroPriceCards.bind(adapter);

  const $ = cheerio.load(`
    <a href="https://questcompetitions.co.uk/competition/whack-win">
      <div class="border rounded-lg">
        <span>£0.17</span>
        <p>Per Ticket</p>
        <p class="text-center">Whack &amp; Win</p>
      </div>
    </a>
  `);

  const competitions = parseHeroPriceCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.name, "Whack & Win");
  assert.equal(competitions[0]?.entryPrice, 0.17);
  assert.equal(competitions[0]?.maxTickets, 0);
  assert.equal(
    competitions[0]?.url,
    "https://questcompetitions.co.uk/competition/whack-win",
  );
});

test("deduplicates repeated Northern competition cards", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "northern",
    displayName: "Northern Competitions",
    baseUrl: "https://northern-competitions.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseNorthernLayout = (adapter as unknown as {
    parseNorthernLayout: ($: cheerio.CheerioAPI) => RawCompetition[];
  }).parseNorthernLayout.bind(adapter);
  const $ = cheerio.load(`
    <article><h3 class="comp-title">£100 Cash</h3>
      <span class="prog-count-label">5 / 100</span>
      <span class="comp-price">£1</span>
      <a href="/competition/cash"></a>
    </article>
    <article><h3 class="comp-title">£100 Cash</h3>
      <span class="prog-count-label">5 / 100</span>
      <span class="comp-price">£1</span>
      <a href="/competition/cash"></a>
    </article>
  `);

  const competitions = parseNorthernLayout($);

  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.sourceId, "cash");
});

test("browser Rafflex adapter parses Prize Flow's exact featured-card economics", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "prizeflow",
    displayName: "Prize Flow",
    baseUrl: "https://prizeflow.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parsePrizeFlowCards = (adapter as unknown as {
    parsePrizeFlowCards: ($: cheerio.CheerioAPI) => RawCompetition[];
  }).parsePrizeFlowCards.bind(adapter);

  const $ = cheerio.load(`
    <section class="pf-fc">
      <a class="pf-fc__image-link" href="https://prizeflow.co.uk/competition/instant-win-cash-drop">
        <img alt="Instant Win Cash Drop">
      </a>
      <h3 class="pf-fc__title">Instant Win Cash Drop</h3>
      <div class="pf-fc__stat">
        <span class="pf-fc__stat-value">£0.99</span>
        <span class="pf-fc__stat-label">Entry Price</span>
      </div>
      <div class="pf-fc__progress-bottom">
        <span><strong>141</strong> entries sold</span>
        <span><strong>359</strong> remaining</span>
      </div>
      <div class="pf-fc__end" data-pf-end="Thu Jul 30th 6:00pm"></div>
    </section>
  `);

  const competitions = parsePrizeFlowCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.name, "Instant Win Cash Drop");
  assert.equal(competitions[0]?.entryPrice, 0.99);
  assert.equal(competitions[0]?.ticketsSold, 141);
  assert.equal(competitions[0]?.maxTickets, 500);
  assert.equal(competitions[0]?.cashAlternative, null);
  assert.ok(competitions[0]?.drawDate);
});

test("browser Rafflex detail parser uses exact Klaviyo product economics", () => {
  const parseKlaviyoViewedProduct = (browserRafflexModule as unknown as {
    parseKlaviyoViewedProduct?: (
      html: string,
      siteName: string,
      url: string,
    ) => RawCompetition | null;
  }).parseKlaviyoViewedProduct;

  assert.equal(typeof parseKlaviyoViewedProduct, "function");
  const competition = parseKlaviyoViewedProduct!(
    `<script>
      klaviyo.track('Viewed Product', {
        "ProductName":"Every Whack Wins - Win Upto \\u00a31,000 Cash Instantly",
        "URL":"https:\\/\\/ryscompetitions.com\\/competition\\/every-whack-wins",
        "Price":2.99,
        "MaxTickets":10000,
        "TicketsSold":9900,
        "DrawDate":"2026-07-21T20:00:00.000000Z",
        "CashAlternative":1000,
        "GameType":"whack-a-mole",
        "IsActive":true
      });
    </script>`,
    "ryscompetitions",
    "https://ryscompetitions.com/competition/every-whack-wins",
  );

  assert.ok(competition);
  assert.equal(competition.name, "Every Whack Wins - Win Upto £1,000 Cash Instantly");
  assert.equal(competition.entryPrice, 2.99);
  assert.equal(competition.ticketsSold, 9900);
  assert.equal(competition.maxTickets, 10000);
  assert.equal(competition.cashAlternative, 1000);
  assert.equal(competition.drawDate, "2026-07-21T20:00:00.000Z");
});

test("browser Rafflex marks an exact zero Klaviyo price as free-entry provenance", () => {
  const parseKlaviyoViewedProduct = (browserRafflexModule as unknown as {
    parseKlaviyoViewedProduct?: (
      html: string,
      siteName: string,
      url: string,
    ) => RawCompetition | null;
  }).parseKlaviyoViewedProduct;

  const competition = parseKlaviyoViewedProduct!(
    `<script>klaviyo.track('Viewed Product', {
      "ProductName":"£250 FREE SCHOOL VOUCHER",
      "Price":0,
      "MaxTickets":10000,
      "TicketsSold":25,
      "DrawDate":"2026-07-21T20:00:00.000Z",
      "IsActive":true
    });</script>`,
    "ryscompetitions",
    "https://ryscompetitions.com/competition/free-school-voucher",
  );

  assert.deepEqual(competition?.categories, ["free"]);
});

test("browser Rafflex does not treat a paid Klaviyo product's free tag as entry provenance", () => {
  const parseKlaviyoViewedProduct = (browserRafflexModule as unknown as {
    parseKlaviyoViewedProduct?: (
      html: string,
      siteName: string,
      url: string,
    ) => RawCompetition | null;
  }).parseKlaviyoViewedProduct;

  const competition = parseKlaviyoViewedProduct!(
    `<script>klaviyo.track('Viewed Product', {
      "ProductName":"Daily Player Freebie",
      "Price":0.99,
      "MaxTickets":10000,
      "TicketsSold":25,
      "DrawDate":"2026-07-21T20:00:00.000Z",
      "ProductTags":["free", "daily"],
      "IsActive":true
    });</script>`,
    "spin2win",
    "https://spin2wincompetitions.co.uk/competition/daily-player-freebie",
  );

  assert.ok(competition);
  assert.equal(competition.entryPrice, 0.99);
  assert.deepEqual(competition.categories, ["daily"]);
});

test("browser Rafflex adapter does not invent Skyline ticket totals from rounded sold percentage", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "skyline",
    displayName: "Skyline Competitions",
    baseUrl: "https://skylinecomps.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseSkylineCards = (adapter as unknown as {
    parseSkylineCards: ($: cheerio.CheerioAPI) => Array<{
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      url: string;
    }>;
  }).parseSkylineCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="sky-exact-card">
      <div class="sky-exact-img-wrap" onclick="window.location.href='https://skylinecomps.co.uk/competition/fast-cash'"></div>
      <h3 class="sky-exact-title">Fast Cash</h3>
      <span class="sky-exact-price">£0.01</span>
      <span class="sky-exact-tickets">17,284</span>
      <span class="sky-exact-progress-text">53.9% SOLD</span>
    </div>
  `);

  const competitions = parseSkylineCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.name, "Fast Cash");
  assert.equal(competitions[0]?.entryPrice, 0.01);
  assert.equal(competitions[0]?.maxTickets, 0);
  assert.equal(competitions[0]?.ticketsSold, 0);
});

test("browser Rafflex adapter does not derive line-card sold counts from rounded percentages", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "gallowaygiveaways",
    displayName: "Galloway Giveaways",
    baseUrl: "https://gallowaygiveaways.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseLineCards = (adapter as unknown as {
    parseLineCards: ($: cheerio.CheerioAPI) => Array<{
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      maxEntriesPerUserSource?: "site" | "fallback" | null;
      cashAlternative: number | null;
      drawDate: string | null;
    }>;
  }).parseLineCards.bind(adapter);

  const $ = cheerio.load(`
    <a href="https://gallowaygiveaways.co.uk/competition/ps5000-prize-pot"></a>
    <main>
      <p>Sun Jul 12th 8:30pm</p>
      <h2>£5000 Prize Pot</h2>
      <p>29p PER TICKET</p>
      <p>Entry</p>
      <p>29p</p>
      <p>Max Tickets</p>
      <p>35,000</p>
      <p>Instant Wins</p>
      <p>220</p>
      <p>36.9% Sold</p>
      <p>Enter</p>
    </main>
  `);

  const competitions = parseLineCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.name, "£5000 Prize Pot");
  assert.equal(competitions[0]?.entryPrice, 0.29);
  assert.equal(competitions[0]?.ticketsSold, 0);
  assert.equal(competitions[0]?.maxTickets, 0);
  assert.equal(competitions[0]?.maxEntriesPerUserSource, "fallback");
  assert.equal(competitions[0]?.cashAlternative, 5000);
  assert.ok(competitions[0]?.drawDate);
});

test("browser Rafflex adapter routes Prize Circle line cards to detail enrichment", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "prizecircleuk",
    displayName: "Prize Circle UK",
    baseUrl: "https://prizecircleuk.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseLineCards = (adapter as unknown as {
    parseLineCards: ($: cheerio.CheerioAPI) => Array<{
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      url: string;
    }>;
  }).parseLineCards.bind(adapter);

  const $ = cheerio.load(`
    <a href="https://prizecircleuk.co.uk/competition/plouise-bundle"></a>
    <main>
      <p>Today 7:00pm</p>
      <h2>Plouise Bundle</h2>
      <p>50p PER TICKET</p>
      <p>Entry</p>
      <p>50p</p>
      <p>Max Tickets</p>
      <p>200</p>
      <p>12.0% Sold</p>
      <p>Enter</p>
    </main>
  `);

  const competitions = parseLineCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.name, "Plouise Bundle");
  assert.equal(competitions[0]?.entryPrice, 0.5);
  assert.equal(competitions[0]?.ticketsSold, 0);
  assert.equal(competitions[0]?.maxTickets, 0);
  assert.equal(
    competitions[0]?.url,
    "https://prizecircleuk.co.uk/competition/plouise-bundle",
  );
});

test("browser Rafflex adapter does not derive Tailwind sold counts from rounded percentages", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "cosmiccomps",
    displayName: "Cosmic Comps",
    baseUrl: "https://cosmiccomps.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseTailwindCards = (adapter as unknown as {
    parseTailwindCards: ($: cheerio.CheerioAPI) => Array<{
      ticketsSold: number;
      maxTickets: number;
    }>;
  }).parseTailwindCards.bind(adapter);

  const $ = cheerio.load(`
    <a href="https://cosmiccomps.co.uk/competition/rounded-progress">
      <div class="rounded-lg">
        <h2>Rounded Progress</h2>
        <p>Fri Aug 28th 8:30pm</p>
        <span>50p Per Ticket</span>
        <span>35,000</span>
        <p>36.9% Sold</p>
      </div>
    </a>
  `);

  const competitions = parseTailwindCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.ticketsSold, 0);
  assert.equal(competitions[0]?.maxTickets, 0);
});

test("browser Rafflex adapter preserves Epic sold count without inventing a total from percentage", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "epic",
    displayName: "Epic Competitions",
    baseUrl: "https://epiccompetitions.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseEpicCards = (adapter as unknown as {
    parseEpicCards: ($: cheerio.CheerioAPI) => Array<{
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      cashAlternative: number | null;
      drawDate: string | null;
    }>;
  }).parseEpicCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="pc-card">
      <a href="https://epiccompetitions.co.uk/competition/bmw-x6m-competition" class="pc-btn">Enter Now</a>
      <span class="pc-img-price">£1.99</span>
      <h3 class="pc-title">BMW X6M COMPETITION</h3>
      <div class="pc-countdown" x-data="raffleCountdown(3600)"></div>
      <span class="pc-progress-lbl">2,866 sold</span>
      <span class="pc-progress-pct">3.2%</span>
      <p class="pc-cash">Cash alt: <strong>£40,000</strong></p>
    </div>
  `);

  const competitions = parseEpicCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.entryPrice, 1.99);
  assert.equal(competitions[0]?.ticketsSold, 2866);
  assert.equal(competitions[0]?.maxTickets, 0);
  assert.equal(competitions[0]?.cashAlternative, 40000);
  assert.ok(competitions[0]?.drawDate);
});

test("browser Rafflex adapter parses Dream Cash cards for detail enrichment", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "dreamcash",
    displayName: "Dream Cash Giveaways",
    baseUrl: "https://dreamcashgiveaways.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseDreamCashCards = (adapter as unknown as {
    parseDreamCashCards: ($: cheerio.CheerioAPI) => Array<{
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      maxEntriesPerUserSource?: "site" | "fallback" | null;
      cashAlternative: number | null;
      drawDate: string | null;
    }>;
  }).parseDreamCashCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="dcg-product-card">
      <a href="https://dreamcashgiveaways.co.uk/competition/rodeo-riches-win-ps200-cash-for-just-25p-with-300-instant-wins"></a>
      <div class="dcg-date">Wed Jun 24th 8:00pm</div>
      <div class="dcg-price">£0.25</div>
      <div class="dcg-game-mode">instant-reveal</div>
      <div class="dcg-percent">3.8% SOLD</div>
    </div>
  `);

  const competitions = parseDreamCashCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.entryPrice, 0.25);
  assert.equal(competitions[0]?.ticketsSold, 0);
  assert.equal(competitions[0]?.maxTickets, 0);
  assert.equal(competitions[0]?.maxEntriesPerUserSource, "fallback");
  assert.equal(competitions[0]?.cashAlternative, 200);
  assert.equal(competitions[0]?.name, "rodeo riches win £200 cash for just 25p with 300 instant wins");
  assert.ok(competitions[0]?.drawDate);
});

test("browser Rafflex cap provenance is site-only for explicit detail limits", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const explicit = competition({
    sourceId: "explicit-cap-prize",
    url: "https://example.test/competition/explicit-cap-prize",
    name: "Explicit Cap Prize",
    maxTickets: 0,
  });
  const fallback = competition({
    sourceId: "fallback-cap-prize",
    url: "https://example.test/competition/fallback-cap-prize",
    name: "Fallback Cap Prize",
    maxTickets: 0,
  });

  await enrich!([explicit, fallback], async (url) => {
    const name = url.includes("explicit") ? "Explicit Cap Prize" : "Fallback Cap Prize";
    const cap = url.includes("explicit") ? "<p>Max 29 tickets per person</p>" : "";
    return `
      <html><head><title>${name} | Example</title></head><body>
        <h1>${name}</h1>
        <p>Sold 10 / 1,000 Online</p>
        <p>£0.25 per ticket</p>
        ${cap}
        <p>Wed Jul 29th 8:00pm</p>
      </body></html>
    `;
  });

  assert.equal(explicit.maxEntriesPerUser, 29);
  assert.equal(explicit.maxEntriesPerUserSource, "site");
  assert.equal(fallback.maxEntriesPerUser, 100);
  assert.equal(fallback.maxEntriesPerUserSource, "fallback");
});

test("browser Rafflex embedded and Dream Cash limits carry exact provenance", () => {
  const parseEmbeddedProducts = (browserRafflexModule as unknown as {
    parseEmbeddedProducts?: (html: string, siteName: string) => RawCompetition[];
  }).parseEmbeddedProducts;
  const parseDreamCashDetail = (browserRafflexModule as unknown as {
    parseDreamCashDetail?: (html: string, siteName: string, url: string) => RawCompetition | null;
  }).parseDreamCashDetail;
  assert.equal(typeof parseEmbeddedProducts, "function");
  assert.equal(typeof parseDreamCashDetail, "function");

  const embedded = parseEmbeddedProducts!(
    `
      {"title":"Exact Cap","url":"https:\\/\\/example.test\\/competition\\/exact-cap","price_raw":0.25,"cash_alt":"","draw_date_raw":"2026-08-01 20:00:00","max_tickets":1000,"max_per_user":15,"sold_tickets":10}
      {"title":"Fallback Cap","url":"https:\\/\\/example.test\\/competition\\/fallback-cap","price_raw":0.25,"cash_alt":"","draw_date_raw":"2026-08-01 20:00:00","max_tickets":1000,"max_per_user":null,"sold_tickets":10}
    `,
    "embedded-test",
  );
  assert.equal(embedded[0]?.maxEntriesPerUser, 15);
  assert.equal(embedded[0]?.maxEntriesPerUserSource, "site");
  assert.equal(embedded[1]?.maxEntriesPerUser, 100);
  assert.equal(embedded[1]?.maxEntriesPerUserSource, "fallback");

  const dreamCash = parseDreamCashDetail!(
    `
      <h1>£200 Cash</h1>
      <div>10 / 1,000</div>
      <div>£200 Cash £0.25</div>
      <div>1 - 35 Plus</div>
      <div>Wed Jul 29th 8:00pm</div>
    `,
    "dreamcash",
    "https://dreamcashgiveaways.co.uk/competition/ps200-cash",
  );
  assert.equal(dreamCash?.maxEntriesPerUser, 35);
  assert.equal(dreamCash?.maxEntriesPerUserSource, "site");
});

test("browser Rafflex uses Ruby's exact hidden card prices for pence and free entries", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "ruby",
    displayName: "Ruby Competitions",
    baseUrl: "https://rubycompetitions.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseTailwindCards = (adapter as unknown as {
    parseTailwindCards: ($: cheerio.CheerioAPI) => RawCompetition[];
  }).parseTailwindCards.bind(adapter);
  const $ = cheerio.load(`
    <div class="rbLuckyItem"
      data-url="https://rubycompetitions.co.uk/competition/ps25-for-25p-low-odds-autodraw-15"
      data-title="£25 for 25p LOW ODDS AUTODRAW"
      data-price="0.25"></div>
    <div class="rbLuckyItem"
      data-url="https://rubycompetitions.co.uk/competition/free-draw-ps30-tesco-voucher"
      data-title="Free Draw - £30 Tesco Voucher"
      data-price="0"></div>

    <div class="rounded-lg">
      <a href="https://rubycompetitions.co.uk/competition/ps25-for-25p-low-odds-autodraw-15">
        <p class="spring-title">ps25 for 25p low odds autodraw 15</p>
        <span class="spring-price-current">£25</span>
        <span>56 / 150 sold</span>
        <span>Tue Jul 21st 8:00pm</span>
      </a>
    </div>
    <div class="rounded-lg">
      <a href="https://rubycompetitions.co.uk/competition/free-draw-ps30-tesco-voucher">
        <p class="spring-title">free draw ps30 tesco voucher</p>
        <span class="spring-price-current">£30</span>
        <span>115 / 300 sold</span>
        <span>Tue Jul 28th 8:00pm</span>
      </a>
    </div>
    <div class="rounded-lg">
      <a href="https://rubycompetitions.co.uk/competition/free-draw-ps25-electric-top-up">
        <p class="spring-title">Free Draw - £25 Electric Top Up</p>
        <span class="spring-price-current">£25</span>
        <span>85 / 300 sold</span>
        <span>Tue Jul 28th 8:00pm</span>
      </a>
    </div>
  `);

  const rows = parseTailwindCards($);
  const paid = rows.find((row) => row.sourceId === "ps25-for-25p-low-odds-autodraw-15");
  const free = rows.find((row) => row.sourceId === "free-draw-ps30-tesco-voucher");
  const freeWithoutHiddenData = rows.find(
    (row) => row.sourceId === "free-draw-ps25-electric-top-up",
  );

  assert.equal(paid?.name, "£25 for 25p LOW ODDS AUTODRAW");
  assert.equal(paid?.entryPrice, 0.25);
  assert.deepEqual(paid?.categories, []);
  assert.equal(free?.name, "Free Draw - £30 Tesco Voucher");
  assert.equal(free?.entryPrice, 0);
  assert.deepEqual(free?.categories, ["free"]);
  assert.equal(freeWithoutHiddenData?.entryPrice, 0);
  assert.deepEqual(freeWithoutHiddenData?.categories, ["free"]);
});

test("browser Rafflex detail enrichment preserves Ruby's exact free-entry provenance", async () => {
  const enrichRafflexCompetitionDetails = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrichRafflexCompetitionDetails, "function");

  const row = competition({
    siteName: "ruby",
    sourceId: "free-draw-ps30-tesco-voucher",
    url: "https://rubycompetitions.co.uk/competition/free-draw-ps30-tesco-voucher",
    name: "Free Draw - £30 Tesco Voucher",
    entryPrice: 0,
    ticketsSold: 115,
    maxTickets: 300,
    drawDate: "2026-07-28T20:00:00.000Z",
    categories: ["free"],
  });

  await enrichRafflexCompetitionDetails!([row], async () => `
    <html><head><title>Free Draw - £30 Tesco Voucher | Ruby</title></head>
      <body><h1>Free Draw - £30 Tesco Voucher</h1><span>£15</span></body>
    </html>
  `);

  assert.equal(row.entryPrice, 0);
  assert.deepEqual(row.categories, ["free"]);
});

test("browser Rafflex drops WinnersClubNI eligibility-only bonus draws with prize-sized prices", () => {
  const parseEmbeddedProducts = (browserRafflexModule as unknown as {
    parseEmbeddedProducts?: (html: string, siteName: string) => RawCompetition[];
  }).parseEmbeddedProducts;
  assert.equal(typeof parseEmbeddedProducts, "function");

  const snapshot = {
    data: {
      products: [
        {
          title: "ADAM'S GOLDEN TICKET - £1,000 MAIN DRAW",
          url: "https://winnersclubni.com/competition/adams-golden-ticket",
          price_raw: 0.06,
          cash_alt: "£0",
          draw_date_raw: "2026-08-21 20:00:00",
          max_tickets: 932_000,
          max_per_user: 100,
          sold_tickets: 19_182,
        },
        {
          title: "GOLDEN TICKET BONUS DRAW | £5,000 CASH | ONLY 10 GOLDEN TICKET HOLDERS",
          url: "https://winnersclubni.com/competition/golden-ticket-bonus-draw-ps5000-cash-only-10-golden-ticket-holders",
          price_raw: 5_000,
          cash_alt: "£0",
          draw_date_raw: "2026-08-21 20:00:00",
          max_tickets: 10,
          max_per_user: 10,
          sold_tickets: 0,
        },
      ],
    },
  };

  const rows = parseEmbeddedProducts!(
    `<div wire:snapshot="${JSON.stringify(snapshot).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div>`,
    "winnersclubni",
  );

  assert.deepEqual(rows.map((row) => row.sourceId), ["adams-golden-ticket"]);
  assert.equal(rows[0]?.entryPrice, 0.06);
});

test("browser Rafflex values a vault from its explicit end draw, not its total prize pool", () => {
  const parseEmbeddedProducts = (browserRafflexModule as unknown as {
    parseEmbeddedProducts?: (html: string, siteName: string) => RawCompetition[];
  }).parseEmbeddedProducts;

  assert.equal(typeof parseEmbeddedProducts, "function");
  const snapshot = {
    data: {
      products: [{
        title: "£50k FELIX'S VAULT",
        url: "https://luckytigercompetitions.com/competition/felixs-vault",
        price_raw: 2.5,
        cash_alt: "£0",
        draw_date_raw: "2026-08-09 21:00:00",
        max_tickets: 35_000,
        max_per_user: 0,
        sold_tickets: 2_069,
        description: "There is £50k worth of prizes in this game. Entry into £1000 CASH END DRAW for every ticket purchased.",
      }],
    },
  };

  const competitions = parseEmbeddedProducts!(
    `<div wire:snapshot="${JSON.stringify(snapshot).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></div>`,
    "luckytiger",
  );

  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.cashAlternative, 1000);
});

test("browser Rafflex refreshes a complete prize-pool row to find its explicit end draw", async () => {
  const enrichRafflexCompetitionDetails = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrichRafflexCompetitionDetails, "function");

  const row = competition({
    siteName: "luckytiger",
    sourceId: "felixs-vault",
    url: "https://luckytigercompetitions.com/competition/felixs-vault",
    name: "£50k FELIX'S VAULT",
    entryPrice: 2.5,
    ticketsSold: 2069,
    maxTickets: 35000,
    cashAlternative: null,
  });
  let fetches = 0;
  await enrichRafflexCompetitionDetails!([row], async () => {
    fetches += 1;
    return `
      <html>
        <head><meta name="description" content="There is £50k worth of prizes. Entry into £1000 CASH END DRAW for every ticket purchased."></head>
        <body>
          <h1>£50k FELIX'S VAULT</h1>
          <p>£2.50 per ticket</p>
          <p>2069 / 35000 Tickets Sold</p>
          <p>Sun Aug 9th 9:00pm</p>
        </body>
      </html>
    `;
  });

  assert.equal(fetches, 1);
  assert.equal(row.cashAlternative, 1000);
});

test("Bounty detail cash ignores a page-wide winner ticker", async () => {
  const enrichRafflexCompetitionDetails = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrichRafflexCompetitionDetails, "function");

  const row = competition({
    siteName: "bounty",
    sourceId: "samsung-series-9-ai-home-ai-energy-9kg-1400-spin-smart-washing-machine",
    url: "https://bountycompetitions.co.uk/competition/samsung-series-9-ai-home-ai-energy-9kg-1400-spin-smart-washing-machine",
    name: "SAMSUNG Series 9 AI Home AI Energy 9kg 1400 Spin Smart Washing Machine - Dark Silver",
    entryPrice: 0.99,
    ticketsSold: 1256,
    maxTickets: 2000,
    drawDate: "2026-08-24T19:00:00.000Z",
    cashAlternative: 28000,
  });
  let fetches = 0;
  await enrichRafflexCompetitionDetails!([row], async () => {
    fetches += 1;
    return `
      <html>
        <body>
          <header><h1>💰£28K CASH ALT OR 2019 BMW X5 30D M Sport X Drive💰</h1></header>
          <main>
            <div id="competition-detail">
              <h1>SAMSUNG Series 9 AI Home AI Energy 9kg 1400 Spin Smart Washing Machine - Dark Silver</h1>
              <p>99p</p>
              <p>Tickets Sold 1,256 / 2,000</p>
              <p>Draw On Mon Aug 24th 8:00pm</p>
            </div>
          </main>
        </body>
      </html>
    `;
  });

  assert.equal(fetches, 1);
  assert.equal(row.cashAlternative, null);
});

test("browser Rafflex preserves complete Carsino product titles instead of using instant-win headings", async () => {
  const enrichRafflexCompetitionDetails = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrichRafflexCompetitionDetails, "function");

  const row = competition({
    siteName: "carsino",
    sourceId: "bars-2",
    url: "https://carsino.uk/competition/bars-2",
    name: "BARS",
    entryPrice: 0.99,
    ticketsSold: 529,
    maxTickets: 14000,
    drawDate: "2026-07-31T20:00:00.000Z",
    cashAlternative: null,
  });
  let fetches = 0;
  await enrichRafflexCompetitionDetails!([row], async () => {
    fetches += 1;
    return `<h2>x2 - 10g Gold Bar or £1,000 Cash</h2>`;
  });

  assert.equal(fetches, 0);
  assert.equal(row.name, "BARS");
  assert.equal(row.cashAlternative, null);
});

test("browser Rafflex adapter reads ps cash values from Rafflex slugs", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "proprizes",
    displayName: "Pro Prizes",
    baseUrl: "https://proprizes.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseTailwindCards = (adapter as unknown as {
    parseTailwindCards: ($: cheerio.CheerioAPI) => Array<{
      cashAlternative: number | null;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
    }>;
  }).parseTailwindCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="rounded-lg">
      <a href="https://proprizes.co.uk/competition/ps10000-cash-plus-ps20000-instant-wins">
        <h2>ps10000 cash plus ps20000 instant wins</h2>
        <p>Fri Jun 26th 8:30pm</p>
        <span>£0.50 Per Ticket</span>
        <span>10,622 / 120,000 sold</span>
      </a>
    </div>
  `);

  const competitions = parseTailwindCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.cashAlternative, 10000);
  assert.equal(competitions[0]?.entryPrice, 0.5);
  assert.equal(competitions[0]?.ticketsSold, 10622);
  assert.equal(competitions[0]?.maxTickets, 120000);
});

test("browser Rafflex adapter preserves decimal cash prize amounts", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "jbcompetitions",
    displayName: "JB Competitions",
    baseUrl: "https://jbcompetitions.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseTailwindCards = (adapter as unknown as {
    parseTailwindCards: ($: cheerio.CheerioAPI) => Array<{
      cashAlternative: number | null;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
    }>;
  }).parseTailwindCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="rounded-lg">
      <a href="https://jbcompetitions.co.uk/competition/angel-numbers-ps555555-end-prize">
        <h2>ANGEL NUMBERS! £5,555.55 END PRIZE!</h2>
        <p>Fri Aug 28th 8:30pm</p>
        <span>20p Per Ticket</span>
        <span>27,004 / 250,000 sold</span>
      </a>
    </div>
  `);

  const competitions = parseTailwindCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.cashAlternative, 5555.55);
  assert.equal(competitions[0]?.entryPrice, 0.2);
  assert.equal(competitions[0]?.ticketsSold, 27004);
  assert.equal(competitions[0]?.maxTickets, 250000);
});

test("browser Rafflex adapter reads tax-free cash and win cash for just titles", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "therafflekid",
    displayName: "The Raffle Kid",
    baseUrl: "https://therafflekid.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseTailwindCards = (adapter as unknown as {
    parseTailwindCards: ($: cheerio.CheerioAPI) => Array<{
      cashAlternative: number | null;
    }>;
  }).parseTailwindCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="rounded-lg">
      <a href="https://therafflekid.co.uk/competition/ps1000-tax-free-cash-0507">
        <h2>£1,000 Tax-Free Cash</h2>
        <p>Sun Jul 5th 9:00pm</p>
        <span>99p Per Ticket</span>
        <span>123 / 2,999 sold</span>
      </a>
    </div>
    <div class="rounded-lg">
      <a href="https://houseofcomps.com/competition/penny-punch-1p-instant-win-win-ps250-for-just-1p">
        <h2>Penny Punch 1p INSTANT WIN! Win £250 for just 1p!</h2>
        <p>Fri Jul 31st 10:30pm</p>
        <span>1p Per Ticket</span>
        <span>17,850 / 525,000 sold</span>
      </a>
    </div>
  `);

  const competitions = parseTailwindCards($);
  assert.equal(competitions[0]?.cashAlternative, 1000);
  assert.equal(competitions[1]?.cashAlternative, 250);
});

test("browser Rafflex detail parser expands abbreviated cash alternatives", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const row = competition({
    siteName: "lockos",
    sourceId: "holiday-voucher",
    url: "https://lockoscompetitions.com/competition/holiday-voucher",
    name: "WIN A HOLIDAY VOUCHER OR TAKE THE £3K CASH ALTERNATIVE",
    ticketsSold: 1,
    maxTickets: 10,
  });

  await enrich!([row], async () => `
    <html><head><title>${row.name}</title></head>
    <body><h1>${row.name}</h1><p>£3K cash alternative</p></body></html>
  `);

  assert.equal(row.cashAlternative, 3000);
});

test("browser Rafflex adapter treats free-to-enter Rafflex titles as free entries", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "theprizevault",
    displayName: "The Prize Vault",
    baseUrl: "https://theprizevault.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseTailwindCards = (adapter as unknown as {
    parseTailwindCards: ($: cheerio.CheerioAPI) => Array<{
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
    }>;
  }).parseTailwindCards.bind(adapter);

  const $ = cheerio.load(`
    <a href="https://theprizevault.co.uk/competition/free-to-enter-ps50-site-credit-booster">
      <div class="rounded-lg">
        <h2>free to enter ps50 site credit booster</h2>
        <p>Sun Jul 5th 8:00pm</p>
        <p>107 / 1,000 sold</p>
      </div>
    </a>
  `);

  const competitions = parseTailwindCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.entryPrice, 0);
  assert.equal(competitions[0]?.ticketsSold, 107);
  assert.equal(competitions[0]?.maxTickets, 1000);
});

test("browser Rafflex adapter records explicit non-cash prize values from titles", async () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "securecomps",
    displayName: "Secure Comps",
    baseUrl: "https://securecomps.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const withExtraCompetitionPaths = (adapter as unknown as {
    withExtraCompetitionPaths: (competitions: Array<{
      sourceId: string;
      siteName: string;
      url: string;
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      maxEntriesPerUser: number;
      cashAlternative: number | null;
      drawDate: string | null;
      isAutoDraw: boolean;
      categories: string[];
      scrapedAt: string;
    }>) => Promise<Array<{ estimatedPrizeValue?: number | null; valuationSource?: string | null }>>;
  }).withExtraCompetitionPaths.bind(adapter);

  const competitions = await withExtraCompetitionPaths([
    {
      sourceId: "shark-cryoglow-face-mask-tickets-only-ps1",
      siteName: "securecomps",
      url: "https://securecomps.co.uk/competition/shark-cryoglow-face-mask-tickets-only-ps1",
      name: "£300 Shark CryoGlow Face Mask-Tickets only £1- Drawn once all tickets sold",
      entryPrice: 1,
      ticketsSold: 103,
      maxTickets: 550,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      drawDate: "2026-08-31T20:00:00.000Z",
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    },
  ]);

  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.estimatedPrizeValue, 300);
  assert.equal(competitions[0]?.valuationSource, "site_estimate");
});

test("browser Rafflex adapter parses countdown duration draw dates", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "bounty",
    displayName: "Bounty Competitions",
    baseUrl: "https://bountycompetitions.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseTailwindCards = (adapter as unknown as {
    parseTailwindCards: ($: cheerio.CheerioAPI) => Array<{
      drawDate: string | null;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
    }>;
  }).parseTailwindCards.bind(adapter);

  const $ = cheerio.load(`
    <a href="https://bountycompetitions.co.uk/competition/smeg-bundle-choose-your-colour">
      <div class="rounded-lg">
        <h2>Smeg Bundle - Choose Your Colour!</h2>
        <p>0 Day 23 Hrs 42 Mins 52 Secs</p>
        <p>40.0% Sold</p>
        <p>879 / 2,195</p>
        <p>40p Per Entry</p>
      </div>
    </a>
  `);

  const competitions = parseTailwindCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.entryPrice, 0.4);
  assert.equal(competitions[0]?.ticketsSold, 879);
  assert.equal(competitions[0]?.maxTickets, 2195);
  assert.ok(competitions[0]?.drawDate);
});

test("browser Rafflex adapter parses Chaotic homepage cards", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "chaotic",
    displayName: "Chaotic",
    baseUrl: "https://chaotic.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseChaoticCards = (adapter as unknown as {
    parseChaoticCards: ($: cheerio.CheerioAPI) => Array<{
      sourceId: string;
      name: string;
      entryPrice: number;
      cashAlternative: number | null;
      isAutoDraw: boolean;
    }>;
  }).parseChaoticCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="relative rounded-xl h-full flex flex-col border-2 border-red-600 bg-white">
      <a class="cursor-pointer relative" href="https://chaotic.co.uk/competition/ninja-creami-or-cash-2617">
        <span>£180 Cash Alternative</span>
        <div class="bg-red-600">
          <p class="text-white">6p</p>
        </div>
      </a>
      <div>scratch</div>
    </div>
  `);

  const competitions = parseChaoticCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.sourceId, "ninja-creami-or-cash-2617");
  assert.equal(competitions[0]?.name, "ninja creami or cash 2617");
  assert.equal(competitions[0]?.entryPrice, 0.06);
  assert.equal(competitions[0]?.cashAlternative, 180);
  assert.equal(competitions[0]?.isAutoDraw, true);
});

test("browser Rafflex surfaces current Chaotic cards without inventing a ticket total", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "chaotic",
    displayName: "Chaotic",
    baseUrl: "https://chaotic.co.uk",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseChaoticCards = (adapter as unknown as {
    parseChaoticCards: ($: cheerio.CheerioAPI) => Array<{
      sourceId: string;
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      drawDate: string | null;
    }>;
  }).parseChaoticCards.bind(adapter);

  const $ = cheerio.load(`
    <div class="flex flex-col items-center justify-start relative bg-black">
      <a href="https://chaotic.co.uk/competition/flash-cash-6186" class="w-full relative">
        <img alt="Flash Cash" />
      </a>
      <div><span>3p</span> Per Ticket</div>
      <p>60.4% Sold</p>
    </div>
  `);

  const competitions = parseChaoticCards($);
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.sourceId, "flash-cash-6186");
  assert.equal(competitions[0]?.name, "Flash Cash");
  assert.equal(competitions[0]?.entryPrice, 0.03);
  assert.equal(competitions[0]?.ticketsSold, 0);
  assert.equal(competitions[0]?.maxTickets, 0);
  assert.equal(competitions[0]?.drawDate, null);
});

test("browser Rafflex adapter parses Feelgood Obsidian cards with per-card titles", () => {
  const adapter = new BrowserRafflexAdapter({
    siteName: "feelgoodcompetitions",
    displayName: "Feelgood Competitions",
    baseUrl: "https://feelgoodcompetitions.com",
    listPath: "/",
    userAgent: "",
    fetchDelayMs: 500,
  });
  const parseObsidianCards = (adapter as unknown as {
    parseObsidianCards: ($: cheerio.CheerioAPI) => Array<{
      sourceId: string;
      name: string;
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
      cashAlternative: number | null;
      drawDate: string | null;
      url: string;
    }>;
  }).parseObsidianCards.bind(adapter);

  const $ = cheerio.load(`
    <a id="obsidian-card" href="https://feelgoodcompetitions.com/competition/win-a-dji-mini-4k-drone-2">
      <img alt="Win A DJI Mini 4k Drone">
      <div>Wed Jul 8th 9:00pm</div>
      <div>46% Sold</div>
      <div>2768/6000</div>
      <div>10p per ticket</div>
      <h2>Win A DJI Mini 4k Drone</h2>
      <p>Take To The Skies</p>
    </a>
    <a id="obsidian-card" href="https://feelgoodcompetitions.com/competition/golf-gti-tcr">
      <div>Fri Jul 10th 6:30pm</div>
      <div>41% Sold</div>
      <div>£0.20 16p per ticket</div>
      <h2>Win A Volkswagen Golf GTI TCR OR £15,000 CASH!</h2>
    </a>
  `);

  const competitions = parseObsidianCards($);
  assert.equal(competitions.length, 2);
  assert.equal(competitions[0]?.sourceId, "win-a-dji-mini-4k-drone-2");
  assert.equal(competitions[0]?.name, "Win A DJI Mini 4k Drone");
  assert.equal(competitions[0]?.entryPrice, 0.1);
  assert.equal(competitions[0]?.ticketsSold, 2768);
  assert.equal(competitions[0]?.maxTickets, 6000);
  assert.ok(competitions[0]?.drawDate);
  assert.equal(competitions[1]?.entryPrice, 0.16);
  assert.equal(competitions[1]?.cashAlternative, 15000);
  assert.equal(
    competitions[1]?.url,
    "https://feelgoodcompetitions.com/competition/golf-gti-tcr",
  );
});

test("browser Rafflex detail repair fixes repeated stale embedded titles and cash without crawling healthy rows", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const staleTitle = "WIN A LUXURY DUBAI HOLIDAY WITH SPENDING MONEY OR £1,500 CASH";
  const rows = [
    competition({
      sourceId: "ninja-creami-deluxe",
      url: "https://example.test/competition/ninja-creami-deluxe",
      name: staleTitle,
      cashAlternative: 1_500,
    }),
    competition({
      sourceId: "playstation-5-pro",
      url: "https://example.test/competition/playstation-5-pro",
      name: staleTitle,
      cashAlternative: 1_500,
    }),
    competition({
      sourceId: "apple-watch-ultra",
      url: "https://example.test/competition/apple-watch-ultra",
      name: "Apple Watch Ultra",
    }),
  ];
  const detailHtml = new Map([
    [
      rows[0]!.url,
      `<html><head><title>Ninja Creami Deluxe | Example</title></head>
       <body><h1>Ninja Creami Deluxe</h1><p>£200 Cash Alternative</p></body></html>`,
    ],
    [
      rows[1]!.url,
      `<html><head><title>PlayStation 5 Pro | Example</title></head>
       <body><h1>PlayStation 5 Pro</h1><p>No cash alternative is offered.</p></body></html>`,
    ],
  ]);
  const fetched: string[] = [];

  await enrich!(rows, async (url) => {
    fetched.push(url);
    const html = detailHtml.get(url);
    assert.ok(html, `unexpected detail fetch: ${url}`);
    return html;
  });

  assert.deepEqual(fetched.sort(), [rows[0]!.url, rows[1]!.url].sort());
  assert.equal(rows[0]?.name, "Ninja Creami Deluxe");
  assert.equal(rows[0]?.cashAlternative, 200);
  assert.equal(rows[1]?.name, "PlayStation 5 Pro");
  assert.equal(rows[1]?.cashAlternative, null);
  assert.equal(rows[2]?.name, "Apple Watch Ultra");
  assert.equal(rows[2]?.cashAlternative, null);
});

test("browser Rafflex detail repair refreshes a single clear title and slug mismatch", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const row = competition({
    sourceId: "dyson-airwrap-complete",
    url: "https://example.test/competition/dyson-airwrap-complete",
    name: "Luxury Holiday to Dubai",
    cashAlternative: 2_500,
  });
  const fetched: string[] = [];

  await enrich!([row], async (url) => {
    fetched.push(url);
    return `<html><head><title>Dyson Airwrap Complete | Example</title></head>
      <body><h1>Dyson Airwrap Complete</h1></body></html>`;
  });

  assert.deepEqual(fetched, [row.url]);
  assert.equal(row.name, "Dyson Airwrap Complete");
  assert.equal(row.cashAlternative, null);
});

test("browser Rafflex detail repair rejects unrelated stale detail identity and cash", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const rows = [
    competition({
      sourceId: "ninja-creami-deluxe",
      url: "https://example.test/competition/ninja-creami-deluxe",
      name: "Ninja Creami Deluxe",
      cashAlternative: 200,
    }),
    competition({
      sourceId: "ninja-creami-deluxe-second-draw",
      url: "https://example.test/competition/ninja-creami-deluxe-second-draw",
      name: "Ninja Creami Deluxe",
    }),
  ];
  const fetched: string[] = [];
  const expectedUrls = rows.map((row) => row.url).sort();

  await enrich!(rows, async (url) => {
    fetched.push(url);
    return `<html><head><title>Win A Luxury Dubai Holiday With Spending Money Or £1,500 Cash | Example</title></head>
      <body><h1>Win A Luxury Dubai Holiday With Spending Money Or £1,500 Cash</h1>
      <p>£1,500 Cash Alternative</p></body></html>`;
  });

  assert.deepEqual(fetched.sort(), expectedUrls);
  assert.deepEqual(rows, []);
});

test("browser Rafflex keeps Clutch card-wide instant-win cash out of current prizes", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const rows = [
    competition({
      sourceId: "diamond-hunt-ps200-end-draw",
      siteName: "clutchcomps",
      name: "DIAMOND HUNT 💎 £200 END DRAW 💰",
      cashAlternative: 75,
    }),
    competition({
      sourceId: "win-a-trip-to-gillhams-thailand-for-2-people-plus-flights",
      siteName: "clutchcomps",
      name: "WIN A TRIP TO GILLHAMS THAILAND FOR 2 PEOPLE + PLUS FLIGHTS! 🎣✈️",
      cashAlternative: 75,
    }),
    competition({
      sourceId: "itchy-and-scratchy-ps1000-end-draw",
      siteName: "clutchcomps",
      name: "ITCHY AND SCRATCHY + £1000 END DRAW! 💰",
      cashAlternative: 75,
    }),
  ];
  const fetched: string[] = [];

  await enrich!(rows, async (url) => {
    fetched.push(url);
    throw new Error(`unexpected detail fetch: ${url}`);
  });

  assert.deepEqual(fetched, []);
  assert.equal(rows[0]?.cashAlternative, 200);
  assert.equal(rows[1]?.cashAlternative, null);
  assert.equal(rows[2]?.cashAlternative, 1_000);
});

test("browser Rafflex detail repair clears EXP cross-row cash from an authoritative voucher detail", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const row = competition({
    sourceId: "win-a-ps100-amazon-voucher",
    siteName: "expcomps",
    url: "https://expcomps.com/competition/win-a-ps100-amazon-voucher",
    name: "WIN A £100 Amazon Voucher",
    cashAlternative: 5_000,
  });
  const fetched: string[] = [];

  await enrich!([row], async (url) => {
    fetched.push(url);
    return `<html><head><title>WIN A £100 Amazon Voucher | EXP COMPETITIONS</title></head>
      <body>
        <aside>WIN £5,000 TAX FREE CASH!</aside>
        <section>
          <div><h1>WIN A £100 Amazon Voucher</h1><span>Cash Alt: £75</span></div>
        </section>
      </body></html>`;
  });

  assert.deepEqual(fetched, [row.url]);
  assert.equal(row.name, "WIN A £100 Amazon Voucher");
  assert.equal(row.cashAlternative, 75);
});

test("browser Rafflex detail repair accepts monetary identity for Luxurious cash slugs", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const row = competition({
    sourceId: "ps250-cash-11",
    siteName: "luxurious",
    url: "https://luxuriousgiveaways.com/competition/ps250-cash-11",
    name: "WIN X10 ENTRIES TO £25,000 COMP (MONDAY)",
    cashAlternative: 25_000,
  });

  await enrich!([row], async () =>
    `<html><head><title>£250 Cash | Luxurious Giveaways</title></head>
      <body><div><h1>£250 Cash</h1></div></body></html>`
  );

  assert.equal(row.name, "£250 Cash");
  assert.equal(row.cashAlternative, 250);
});

test("browser Rafflex detail repair ignores review ratios and available-only inventory", async () => {
  const enrich = (browserRafflexModule as unknown as {
    enrichRafflexCompetitionDetails?: EnrichRafflexCompetitionDetails;
  }).enrichRafflexCompetitionDetails;
  assert.equal(typeof enrich, "function");

  const rows = [
    competition({
      sourceId: "review-proof-prize",
      url: "https://example.test/competition/review-proof-prize",
      name: "Review Proof Prize",
      ticketsSold: 0,
      maxTickets: 0,
    }),
    competition({
      sourceId: "available-only-prize",
      url: "https://example.test/competition/available-only-prize",
      name: "Available Only Prize",
      ticketsSold: 0,
      maxTickets: 0,
    }),
  ];

  await enrich!(rows, async (url) =>
    url === rows[0]?.url
      ? `<html><head><title>Review Proof Prize | Example</title></head>
          <body><h1>Review Proof Prize</h1><p>Customer reviews 4 / 5</p></body></html>`
      : `<html><head><title>Available Only Prize | Example</title></head>
          <body><h1>Available Only Prize</h1><p><strong>100</strong> tickets available</p></body></html>`
  );

  assert.equal(rows[0]?.ticketsSold, 0);
  assert.equal(rows[0]?.maxTickets, 0);
  assert.equal(rows[1]?.ticketsSold, 0);
  assert.equal(rows[1]?.maxTickets, 0);
});
