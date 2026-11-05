import test from "node:test";
import assert from "node:assert/strict";
import {
  CrownEagleAdapter,
  SixForGoldAdapter,
  parseJackpotzDetail,
  parseJustOneMoreTicketDetail,
  parseLegionDetail,
  parsePremiumWatchClubDetail,
} from "../src/adapters/direct/direct-adapter.js";
import {
  enrichCompetitionFromDetail,
  parsePage,
} from "../src/adapters/wclottery/wclottery-parser.js";
import type { RawCompetition } from "../src/types.js";

test("ELOV8 cards read the wxg countdown timestamp", () => {
  const [competition] = parsePage(
    `
      <div data-elementor-type="loop-item" class="elementor-element product post-12">
        <a href="/product/cash-draw/">Cash Draw</a>
        <span class="elementor-progress-text">5 / 500</span>
        <span class="price">£1.00</span>
        <div data-wxg-countdown data-end="1787342400"></div>
      </div>
    `,
    {
      siteName: "elov8comps",
      displayName: "ELOV8",
      baseUrl: "https://elov8comps.com",
      listPath: "/product-category/auto-draws/",
      userAgent: "Mozilla/5.0",
      fetchDelayMs: 0,
    },
  );

  assert.equal(competition?.ticketsSold, 5);
  assert.equal(competition?.maxTickets, 500);
  assert.equal(competition?.drawDate, "2026-08-21T20:00:00.000Z");
});

test("676 detail fields replace the incomplete generic listing row", () => {
  const base: RawCompetition = {
    sourceId: "pw50",
    siteName: "676competitions",
    url: "https://676competitions.co.uk/product/brand-new-pw50/",
    name: "YAMAHA PW50",
    entryPrice: 20,
    ticketsSold: 0,
    maxTickets: 0,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    drawDate: null,
    isAutoDraw: false,
    categories: [],
    scrapedAt: "2026-08-19T00:00:00.000Z",
  };

  const competition = enrichCompetitionFromDetail(
    base,
    `
      <article class="product">
        <h1>YAMAHA PW50</h1>
        <div>DRAW / END DATE Wed, 19 August 2026 at 19:00</div>
        <div>TICKETS SOLD 136 sold 64 of 200 remaining</div>
        <div>Max 10 tickets per person</div>
      </article>
    `,
  );

  assert.equal(competition.ticketsSold, 136);
  assert.equal(competition.maxTickets, 200);
  assert.equal(competition.maxEntriesPerUser, 10);
  assert.equal(competition.drawDate, "2026-08-19T18:00:00.000Z");
});

test("Watches of Whitby detail fields replace the listing counters", () => {
  const base: RawCompetition = {
    sourceId: "omega-seamaster-aqua-terra",
    siteName: "watchesofwhitby",
    url: "https://competitions.watchesofwhitby.com/competitions/omega-seamaster-aqua-terra/",
    name: "Omega Seamaster Aqua Terra",
    entryPrice: 25,
    ticketsSold: 0,
    maxTickets: 0,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    drawDate: null,
    isAutoDraw: false,
    categories: [],
    scrapedAt: "2026-08-19T00:00:00.000Z",
  };

  const competition = enrichCompetitionFromDetail(
    base,
    `<article class="product"><h1>Omega Seamaster Aqua Terra</h1><div class="lty-progress-bar-notice">Tickets Sold: 131</div><div class="lty-progress-bar-end">699</div><div>Competition ends 20th August 2026 at 9pm or when all tickets have sold.</div><div>MAXIMUM TICKETS PER CUSTOMER: 5</div></article>`,
  );

  assert.equal(competition.ticketsSold, 131);
  assert.equal(competition.maxTickets, 699);
  assert.equal(competition.maxEntriesPerUser, 5);
  assert.equal(competition.drawDate, "2026-08-20T20:00:00.000Z");

  const unopened = enrichCompetitionFromDetail(
    base,
    `<article class="product"><h1>Omega Seamaster Aqua Terra</h1><div class="lty-lottery-date-ranges"><p class="lty-lottery-time-left-label">Starting in:</p><div class="lty-lottery-countdown-timer" data-time="2026/08/31 07:00:00"></div></div></article>`,
  );

  assert.equal(unopened.drawDate, null);
});

test("direct detail parsers keep deterministic ticket economics", () => {
  const now = new Date("2026-08-19T10:00:00.000Z");
  const legion = parseLegionDetail(
    `<meta property="article:expiration_time" content="2026-08-25T20:00:00+01:00"><h1>Painted Warhammer Force</h1><div>TICKETS SOLD 1 / 299</div><div>£1.49 PER TICKET</div>`,
    "https://www.legioncomps.co.uk/competition/painted-force/",
    now,
  );
  const jackpotz = parseJackpotzDetail(
    `<h1>SAFE HUNT</h1><a href="/shop/live/safe-hunt/"><span class="woocommerce-Price-amount">£0.49</span></a><div>Competition ends: August 30, 2026 10:00 pm</div><div>limited to 120000 tickets</div><div>Tickets sold: 2919</div>`,
    "https://jackpotzcompetitions.com/shop/live/safe-hunt/",
    now,
  );
  const jomt = parseJustOneMoreTicketDetail(
    `<h1>Instant Wins £1</h1><div class="price">£1.00</div><div>Competition ends: October 1, 2026 12:00 am</div><div>limited to 999 tickets</div><div>Tickets sold: 230</div>`,
    "https://justonemoreticket.co.uk/competitions/instant-wins-1/",
    now,
  );
  const watch = parsePremiumWatchClubDetail(
    `<h1>Rolex Datejust 41</h1><div>Entry Price</div><div>From £65.00</div><div>Total Entries</div><div>900 max</div><div>Entries Remaining</div><div>700 left</div><div>Draw Date</div><div>20 August 2026, 12:00 UTC</div><div>Cash Alternative</div><div>£9,900</div>`,
    "https://premiumwatchclub.com/competitions/weekly",
    now,
  );

  assert.deepEqual(
    [legion?.entryPrice, legion?.ticketsSold, legion?.maxTickets],
    [1.49, 1, 299],
  );
  assert.deepEqual(
    [jackpotz?.entryPrice, jackpotz?.ticketsSold, jackpotz?.maxTickets],
    [0.49, 2919, 120000],
  );
  assert.deepEqual(
    [jomt?.entryPrice, jomt?.ticketsSold, jomt?.maxTickets],
    [1, 230, 999],
  );
  assert.deepEqual(
    [watch?.entryPrice, watch?.ticketsSold, watch?.maxTickets, watch?.cashAlternative],
    [65, 200, 900, 9900],
  );
});

test("Crown and Eagle list cards preserve explicit cash prizes", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    `<article class="competition-live-card" data-competition-id="277" data-closes-at="2099-08-31T20:00:00Z" href="/competition-home/277/quiz"><h2 class="text-2xl">£100 cash prize</h2><div><div class="text-2xl">£1.00</div><div>Per Entry</div></div><span data-live-tickets-sold>0</span><span data-live-max-tickets>500</span></article>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );

  try {
    const [competition] = await new CrownEagleAdapter().fetchAll();
    assert.equal(competition?.cashAlternative, 100);
    assert.equal(competition?.entryPrice, 1);
    assert.equal(competition?.ticketsSold, 0);
    assert.equal(competition?.maxTickets, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("6 For Gold joins the card ticket price with the product date", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://6forgold.co.uk/") {
      return new Response(
        `<a class="ai-competition-card-atwkyvnmyl1m5dthybaigenblock38a522fikhfbe" href="/products/crazy-cash"><h3>Crazy Cash £2,000</h3><div class="ai-competition-card__price-atwkyvnmyl1m5dthybaigenblock38a522fikhfbe">£5.00</div><span>7 / 5,461 tickets sold</span></a>`,
        { status: 200 },
      );
    }
    return new Response(
      `<h1>Crazy Cash £2,000</h1><div>Draw Date: 30 August 2099</div>`,
      { status: 200 },
    );
  };

  try {
    const [competition] = await new SixForGoldAdapter().fetchAll();
    assert.equal(competition?.entryPrice, 5);
    assert.equal(competition?.ticketsSold, 7);
    assert.equal(competition?.maxTickets, 5461);
    assert.equal(competition?.drawDate, "2099-08-29T23:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
