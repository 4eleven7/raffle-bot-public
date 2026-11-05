import test from "node:test";
import assert from "node:assert/strict";
import { ReffleAdapter } from "../src/adapters/reffle/reffle-adapter.js";

const adapter = new ReffleAdapter({
  siteName: "example",
  displayName: "Example",
  baseUrl: "https://example.test",
  listPath: "/",
  userAgent: "test",
  fetchDelayMs: 0,
});

const parse = (adapter as unknown as {
  parse(html: string): Array<{
    sourceId: string;
    name: string;
    entryPrice: number;
    ticketsSold: number;
  maxTickets: number;
  cashAlternative: number | null;
  drawDate: string | null;
  url: string;
}>;
}).parse.bind(adapter);

test("Reffle adapter parses slash ticket totals before generic sold text", () => {
  const comps = parse(`
    <div class="rounded-lg">
      <a href="/raffles/example-draw">
        <h3>Example Draw</h3>
        £1.00/ per entry
        19,754/200,000 tickets sold
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.ticketsSold, 19754);
  assert.equal(comps[0]?.maxTickets, 200000);
});

test("Reffle adapter ignores raffle status navigation links", () => {
  const comps = parse(`
    <a href="/raffles/active">Active Draws</a>
    <a href="/raffles/coming-soon">Coming Soon</a>
    <a href="/raffles/real-draw">
      <div class="rounded-lg">
        <h3>Real Draw</h3>
        £0.99/ per entry
        12 tickets sold
        88 remaining
      </div>
    </a>
  `);

  assert.deepEqual(comps.map((comp) => comp.sourceId), ["real-draw"]);
});

test("Reffle adapter leaves rounded percent sold and tickets left inventory incomplete", () => {
  const comps = parse(`
    <a href="/competition/glorious-draw">
      <div class="rounded-lg">
        <h3>WIN A NINJA SLUSHI FROZEN DRINK MAKER</h3>
        57 % Sold
        215 tickets remaining
        £1.49 PER ENTRY
      </div>
    </a>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.ticketsSold, 0);
  assert.equal(comps[0]?.maxTickets, 0);
});

test("Reffle adapter ignores countdown numbers before slash ticket totals", () => {
  const comps = parse(`
    <div class="rounded-lg">
      <a href="/raffles/countdown-draw">
        <h3>Countdown Draw</h3>
        34 days
        188/35,300 tickets sold
        <span data-test="tickets-sold">188 tickets sold</span>
        <span data-test="tickets-remaining">35,112 remaining</span>
        £1.25 / entry
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.ticketsSold, 188);
  assert.equal(comps[0]?.maxTickets, 35300);
});

test("Reffle adapter parses hosted marquee cards tightly", () => {
  const comps = parse(`
    <div class="cursor-grab">
      <a href="/raffles/ps5000-golden-ticket-reveal-only-50p-abc" class="featured-card-border">
        <img alt="£5000 GOLDEN TICKET REVEAL! ONLY 50P">
        <h4>£5000 GOLDEN TICKET REVEAL! ONLY 50P</h4>
      </a>
      <a href="/raffles/ps30000-other">
        <h3>£30,000 Other Draw</h3>
        £2 / per entry
      </a>
    </div>
  `);

  assert.equal(comps.length, 2);
  assert.equal(comps[0]?.name, "£5000 GOLDEN TICKET REVEAL! ONLY 50P");
  assert.equal(comps[0]?.entryPrice, 0.5);
  assert.equal(comps[0]?.cashAlternative, 5000);
});

test("Reffle adapter parses structured slash ticket totals", () => {
  const comps = parse(`
    <a href="/raffles/structured-slash">
      <div class="rounded-lg">
        <h3>£30,000 LUXURY WATCH & CASH INSTANT WIN !!!</h3>
        <span data-test="tickets-sold">396/25000 tickets sold</span>
        £2 / per entry
      </div>
    </a>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.ticketsSold, 396);
  assert.equal(comps[0]?.maxTickets, 25000);
});

test("Reffle adapter keeps the richest duplicate raffle card", () => {
  const comps = parse(`
    <div>
      <a href="/raffles/ps30000-luxury-watch-cash-instant-win-abc" class="no-underline">
        <h2>£30,000 LUXURY WATCH & CASH INSTANT WIN !!!</h2>
      </a>
    </div>
    <div class="flex-1 flex flex-col gap-8 align-center max-w-lg">
      <a href="/raffles/ps30000-luxury-watch-cash-instant-win-abc" class="no-underline">
        <h2>£30,000 LUXURY WATCH & CASH INSTANT WIN !!!</h2>
      </a>
      <p>£2.00/ per entry</p>
      <span data-test="tickets-sold">396/25000 tickets sold</span>
      <button>Buy tickets</button>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.entryPrice, 2);
  assert.equal(comps[0]?.ticketsSold, 396);
  assert.equal(comps[0]?.maxTickets, 25000);
  assert.equal(comps[0]?.cashAlternative, 30000);
});

test("Reffle adapter does not treat voucher slug values as cash", () => {
  const comps = parse(`
    <a href="/raffles/ps250-voucher-for-jr-repairs">
      <div class="rounded-lg">
        <h3>£250 Voucher for JR Repairs</h3>
        <span data-test="tickets-sold">98/1125 tickets sold</span>
        £0.50 / per entry
      </div>
    </a>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, null);
});

test("Reffle adapter extracts cash prize values from cash titles", () => {
  const comps = parse(`
    <div class="raffle-card">
      <a href="/raffles/low-odds-cash">
        <h3>THE REAPER'S RUSH | £500 Cash | Only 850 Tickets! | 99p</h3>
        67 tickets sold
        783 remaining
        £0.99 /per entry
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 500);
});

test("Reffle adapter extracts tax-free cash prize values from titles", () => {
  const comps = parse(`
    <div class="raffle-card">
      <a href="/raffles/quick-fire">
        <h3>QUICK FIRE CASH DROP - WIN £250 TAX FREE</h3>
        1 tickets sold
        74 remaining
        £4.99 /per entry
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 250);
});

test("Reffle adapter parses slash entry prices without per wording", () => {
  const comps = parse(`
    <div class="raffle-card">
      <a href="/raffles/reward-club-bbq">
        <h3>BIG GREEN EGG BBQ</h3>
        £2.50 /entry10 / 1000 sold
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.entryPrice, 2.5);
  assert.equal(comps[0]?.ticketsSold, 10);
  assert.equal(comps[0]?.maxTickets, 1000);
});

test("Reffle adapter extracts hyphenated tax-free cash prize values", () => {
  const comps = parse(`
    <div class="raffle-card">
      <a href="/raffles/tax-free-cash">
        <h3>Win £500 Tax‑Free Cash</h3>
        25 tickets sold
        1,975 remaining
        £0.50 /per entry
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 500);
});

test("Reffle adapter extracts abbreviated K cash values", () => {
  const comps = parse(`
    <div class="raffle-card">
      <a href="/raffles/cash-drop">
        <h3>£50K Cash Drop</h3>
        100 tickets sold
        9,900 remaining
        £1 /per entry
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 50000);
});

test("Reffle adapter extracts instant-win cash prize values from titles", () => {
  const comps = parse(`
    <div class="raffle-card">
      <a href="/raffles/huge-cash-instant-win">
        <h3>HUGE £17,500 INSTANT WIN - £1.79 A TICKET</h3>
        <span data-test="tickets-sold">3,302/14,000 tickets sold</span>
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.entryPrice, 1.79);
  assert.equal(comps[0]?.cashAlternative, 17500);
});

test("Reffle adapter extracts cash alternative values before entry prices", () => {
  const comps = parse(`
    <div class="raffle-card">
      <a href="/raffles/yamaha-cash-alt">
        <h3>WIN this brand new Yamaha PW50 + £1250 cash alternative</h3>
        57 tickets sold
        292 remaining
        £9.99 /per entry
      </a>
    </div>
  `);

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.cashAlternative, 1250);
});

test("Reffle adapter enriches WordPress detail countdown draw dates", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "example",
    displayName: "Example",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <div class="raffle">
          <a href="/raffle/cash-draw/">
            <h3>£750 Cash Draw</h3>
            10 Tickets Sold
            90 remaining
            £5.00 per entry
          </a>
        </div>
      `);
    }

    return new Response(`
      <span class="lty-lottery-countdown-timer" data-time="2026/06/12 19:15:00"></span>
    `);
  };

  try {
    const comps = await enrichAdapter.fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.drawDate, new Date(2026, 5, 12, 19, 15, 0, 0).toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle adapter enriches hosted detail fields without a cash alternative", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <a href="/raffles/huge-cash-drop">
          <div class="rounded-lg">
            <h3>Huge Cash Drop</h3>
            £1.79 / per entry
            <span data-test="tickets-sold">3,302/14,000 tickets sold</span>
          </div>
        </a>
      `);
    }

    if (url === "https://example.test/raffles/huge-cash-drop") {
      return new Response(`
        <div data-test="tickets-sold">3,302/14,000</div>
        <div data-test="tickets-remaining">Jul 16 at 11:30 PM</div>
        <div>Max 4,000 tickets per person</div>
      `);
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const comps = await new ReffleAdapter({
      siteName: "example",
      displayName: "Example",
      baseUrl: "https://example.test",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 3302);
    assert.equal(comps[0]?.maxTickets, 14000);
    assert.equal(comps[0]?.maxEntriesPerUser, 4000);
    assert.equal(comps[0]?.drawDate?.includes("07-16T22:30:00.000Z"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parses FootyComps total tickets and remaining inventory", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <a href="/raffles/footy-cash">
          <div class="rounded-lg">
            <h3>£100 Match Day Cash</h3>
            £0.25 per ticket
          </div>
        </a>
      `);
    }

    return new Response(`
      <main>
        <div>4% sold</div>
        <div>1,199 left</div>
        <div>Competition Details: £1Total Tickets Available - 1,249</div>
      </main>
      <script>"activity":"497 tickets sold"</script>
      <script>"inventory":"497 sold / 488 remaining"</script>
      <script>"endDate":"2030-11-04T20:00:00.000000Z"</script>
    `);
  };

  try {
    const comps = await new ReffleAdapter({
      siteName: "footycomps",
      displayName: "FootyComps",
      baseUrl: "https://example.test",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.ticketsSold, 50);
    assert.equal(comps[0]?.maxTickets, 1249);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle adapter enriches hosted Reffle ISO end dates", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "example",
    displayName: "Example",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <div class="raffle-card">
          <a href="/raffles/cash-drop">
            <h3>£500 Cash Drop</h3>
            25 tickets sold
            475 remaining
            £0.50 /per entry
          </a>
        </div>
      `);
    }

    return new Response(`
      [null,500,100,"auto","2026-05-17T16:00:00.000000Z","2030-07-15T18:30:00.000000Z",50,25]
    `);
  };

  try {
    const comps = await enrichAdapter.fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.drawDate, "2030-07-15T18:30:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle adapter enriches hosted marquee card economics from detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "example",
    displayName: "Example",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <a href="/raffles/ps5000-golden-ticket-reveal-only-50p" class="featured-card-border">
          <img alt="£5000 GOLDEN TICKET REVEAL! ONLY 50P">
          <h4>£5000 GOLDEN TICKET REVEAL! ONLY 50P</h4>
          <span>11,517 sold</span>
        </a>
      `);
    }

    return new Response(`
      <div>
        <span data-test="tickets-sold">11,517/20,000</span>
        <span data-test="tickets-remaining">Jun 28 at 10:00 PM</span>
        <span>Max <strong>2,000</strong> tickets per person</span>
        <button><span>1 tickets</span><span>|</span><span>£0.50</span></button>
      </div>
      <script>"endDate":"2035-06-28T22:00:29.000000Z"</script>
    `);
  };

  try {
    const comps = await enrichAdapter.fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 0.5);
    assert.equal(comps[0]?.ticketsSold, 11517);
    assert.equal(comps[0]?.maxTickets, 20000);
    assert.equal(comps[0]?.maxEntriesPerUser, 2000);
    assert.equal(comps[0]?.drawDate, "2035-06-28T22:00:29.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle adapter enriches exact economics from the public Nuxt raffle payload", async () => {
  const originalFetch = globalThis.fetch;
  const nuxtData = Array.from({ length: 40 }, () => null) as unknown[];
  nuxtData[4] = {
    ticketGenerationType: 21,
    numberOfTickets: 17,
    maxTicketsPerUser: 18,
    endDate: 24,
    price: 25,
    ticketsSold: 26,
    prizeValue: 27,
    description: 28,
    instantWinsCount: 29,
  };
  nuxtData[17] = 428999;
  nuxtData[18] = 85000;
  nuxtData[24] = "2026-08-09T20:00:00.000000Z";
  nuxtData[25] = 7;
  nuxtData[26] = 18347;
  nuxtData[27] = 19000;
  nuxtData[28] = "<p>Cash and site credit instant wins</p>";
  nuxtData[29] = 10;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <a href="/raffles/target-japan">
          <div class="rounded-lg">
            <h3>Target Japan</h3>
            <span data-test="tickets-sold">18,347/428,999 tickets sold</span>
          </div>
        </a>
      `);
    }

    return new Response(
      `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(nuxtData)}</script>`,
    );
  };

  try {
    const comps = await new ReffleAdapter({
      siteName: "example",
      displayName: "Example",
      baseUrl: "https://example.test",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.sourceId, "target-japan");
    assert.equal(comps[0]?.entryPrice, 0.07);
    assert.equal(comps[0]?.ticketsSold, 18347);
    assert.equal(comps[0]?.maxTickets, 428999);
    assert.equal(comps[0]?.maxEntriesPerUser, 85000);
    assert.equal(comps[0]?.maxEntriesPerUserSource, "site");
    assert.equal(comps[0]?.drawDate, "2026-08-09T20:00:00.000Z");
    assert.equal(comps[0]?.estimatedPrizeValue, 190);
    assert.equal(comps[0]?.prizeDescription, "Cash and site credit instant wins");
    assert.ok(comps[0]?.categories.includes("instant-win"));
    assert.equal(comps[0]?.valuationSource, "site_estimate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("preserves structured cash-alternative evidence for a physical prize", async () => {
  const originalFetch = globalThis.fetch;
  const nuxtData = Array.from({ length: 40 }, () => null) as unknown[];
  nuxtData[4] = {
    id: 5,
    title: 6,
    ticketGenerationType: 7,
    numberOfTickets: 8,
    maxTicketsPerUser: 9,
    endDate: 10,
    price: 11,
    ticketsSold: 12,
    cashAlternative: 13,
  };
  nuxtData[5] = 12345;
  nuxtData[6] = "Win an iPhone 17 and Airpods";
  nuxtData[7] = "standard";
  nuxtData[8] = 1308;
  nuxtData[9] = 100;
  nuxtData[10] = "2026-08-25T17:00:00.000Z";
  nuxtData[11] = 99;
  nuxtData[12] = 36;
  nuxtData[13] = 60000;

  globalThis.fetch = async (input) => {
    if (String(input) === "https://example.test/") {
      return new Response(`
        <a href="/raffles/iphone-airpods">
          <div class="rounded-lg">
            <h3>Win an iPhone 17 and Airpods</h3>
            <span data-test="tickets-sold">36/1308 tickets sold</span>
            £0.99 / per entry
          </div>
        </a>
      `);
    }

    return new Response(
      `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(nuxtData)}</script>`,
    );
  };

  try {
    const competitions = await new ReffleAdapter({
      siteName: "olbgprizes",
      displayName: "OLBG Prizes",
      baseUrl: "https://example.test",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(competitions[0]?.cashAlternative, 600);
    assert.equal(
      competitions[0]?.valuationNotes,
      "Explicit cash alternative in current detail payload",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle adapter uses the public Nuxt raffle id and title when a route slug is reused", async () => {
  const originalFetch = globalThis.fetch;
  const nuxtData = Array.from({ length: 40 }, () => null) as unknown[];
  nuxtData[4] = {
    id: 27,
    title: 28,
    slug: 29,
    ticketGenerationType: 21,
    numberOfTickets: 17,
    maxTicketsPerUser: 18,
    endDate: 24,
    price: 25,
    ticketsSold: 26,
  };
  nuxtData[17] = 400;
  nuxtData[18] = 81;
  nuxtData[24] = "2026-08-02T20:00:00.000000Z";
  nuxtData[25] = 250;
  nuxtData[26] = 105;
  nuxtData[27] = 71555;
  nuxtData[28] = "LIVE DRAW · RARE GERWYN PRICE PANINI 1ST EDITION WORLD CHAMPION /25 CARD - PSA 9";
  nuxtData[29] = "live-draw-pokemon-chaos-rising-mega-greninja-ex-premium-collection-old-route";

  globalThis.fetch = async (input) => {
    if (String(input) === "https://example.test/") {
      return new Response(`
        <a href="/raffles/live-draw-pokemon-chaos-rising-mega-greninja-ex-premium-collection-old-route">
          <div class="rounded-lg">
            <h3>Pokemon Chaos Rising Mega Greninja</h3>
            <span data-test="tickets-sold">105/400 tickets sold</span>
          </div>
        </a>
      `);
    }

    return new Response(
      `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(nuxtData)}</script>`,
    );
  };

  try {
    const competitions = await new ReffleAdapter({
      siteName: "dartsdraw",
      displayName: "Example",
      baseUrl: "https://example.test",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "71555");
    assert.equal(
      competitions[0]?.name,
      "LIVE DRAW · RARE GERWYN PRICE PANINI 1ST EDITION WORLD CHAMPION /25 CARD - PSA 9",
    );
    assert.equal(
      competitions[0]?.url,
      "https://example.test/raffles/live-draw-pokemon-chaos-rising-mega-greninja-ex-premium-collection-old-route",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle adapter enriches hosted one-ticket price and current cash alternative", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "example",
    displayName: "Example",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <a href="/raffles/1981-honda-xl500s">
          <h3>1981 Honda XL500S</h3>
          <span data-test="tickets-sold">28/3,000</span>
        </a>
      `);
    }

    return new Response(`
      <div>
        <span data-test="tickets-sold">28/3,000</span>
        Jul 30 at 7:00 PM
        Max 250 tickets per person
        Current 70% cash alternative: £58.60.
        <button><span>Total</span><span>1 tickets</span><span>|</span><span>£2.99</span></button>
      </div>
      <script>"endDate":"2099-07-30T19:00:00.000000Z"</script>
    `);
  };

  try {
    const comps = await enrichAdapter.fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.entryPrice, 2.99);
    assert.equal(comps[0]?.ticketsSold, 28);
    assert.equal(comps[0]?.maxTickets, 3000);
    assert.equal(comps[0]?.maxEntriesPerUser, 250);
    assert.equal(comps[0]?.cashAlternative, 58.6);
    assert.equal(comps[0]?.drawDate, "2099-07-30T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("prefers the detail cash alternative over a list-page value", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "footycomps",
    displayName: "FootyComps",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <a href="/raffles/fpro-complete-kit-3-month-premium-app-subscription">
          <div class="rounded-lg">
            <h3>FPRO Complete Kit + 3 Month Premium App Subscription</h3>
            or £140 cash alternative
            <span data-test="tickets-sold">0/399 tickets sold</span>
          </div>
        </a>
      `);
    }

    return new Response(`
      <main>
        <div data-test="tickets-sold">0/399</div>
        <div>Max 100 tickets per person</div>
        <div>Cash Alternative: £100.00</div>
        <div>£1.001 per entry</div>
      </main>
      <script>"endDate":"2026-11-04T20:00:00.000000Z"</script>
    `);
  };

  try {
    const competitions = await enrichAdapter.fetchAll();

    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.cashAlternative, 100);
    assert.match(
      competitions[0]?.prizeEvidence ?? "",
      /cash alternative GBP 100/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle detail parsing ignores odds and date ratios as ticket inventory", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "example",
    displayName: "Example",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <div class="rounded-lg">
          <a href="/raffles/odds-only">
            <h3>Odds Only</h3>
            £1 / per entry
          </a>
        </div>
        <div class="rounded-lg">
          <a href="/raffles/date-only">
            <h3>Date Only</h3>
            £1 / per entry
          </a>
        </div>
      `);
    }

    if (url === "https://example.test/raffles/odds-only") {
      return new Response(`
        <div>Odds: 1 / 500</div>
        <script>"endDate":"2030-07-24T20:00:00.000000Z"</script>
      `);
    }

    if (url === "https://example.test/raffles/date-only") {
      return new Response(`
        <div>Draw date: 07 / 24 / 2030</div>
        <script>"endDate":"2030-07-24T20:00:00.000000Z"</script>
      `);
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await enrichAdapter.fetchAll();

    assert.equal(competitions.length, 2);
    assert.deepEqual(
      competitions.map(({ sourceId, ticketsSold, maxTickets }) => ({
        sourceId,
        ticketsSold,
        maxTickets,
      })),
      [
        { sourceId: "odds-only", ticketsSold: 0, maxTickets: 0 },
        { sourceId: "date-only", ticketsSold: 0, maxTickets: 0 },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle adapter repairs impossible list inventory from authoritative detail counts", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "example",
    displayName: "Example",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://example.test/") {
      return new Response(`
        <a href="/raffles/750-cash-draw">
          <div class="rounded-lg">
            <h3>£750 Cash Draw</h3>
            £5 / per entry
            <span data-test="tickets-sold">2026/299 tickets sold</span>
          </div>
        </a>
      `);
    }

    return new Response(`
      <div data-test="tickets-sold">0/299</div>
      <div data-test="tickets-remaining">Jul 31 at 8:00 PM</div>
      <div>Max 20 tickets per person</div>
    `);
  };

  try {
    const competitions = await enrichAdapter.fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.ticketsSold, 0);
    assert.equal(competitions[0]?.maxTickets, 299);
    assert.equal(competitions[0]?.maxEntriesPerUser, 20);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle detail parsing never treats a per-person cap as total inventory", async () => {
  const originalFetch = globalThis.fetch;
  const enrichAdapter = new ReffleAdapter({
    siteName: "example",
    displayName: "Example",
    baseUrl: "https://example.test",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    if (String(input) === "https://example.test/") {
      return new Response(`
        <a href="/raffles/charity-draw">
          <div class="rounded-lg">
            <h3>Charity Draw</h3>
            £1 / per entry
          </div>
        </a>
      `);
    }

    return new Response(`
      <div>478 entries support the charity.</div>
      <div>Max 500 tickets per person</div>
      <div data-test="tickets-remaining">Jul 31 at 8:00 PM</div>
    `);
  };

  try {
    const competitions = await enrichAdapter.fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.ticketsSold, 0);
    assert.equal(competitions[0]?.maxTickets, 0);
    assert.equal(competitions[0]?.maxEntriesPerUser, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Devon Cash uses the explicit final prize and marks aggregate instant-win draws", async () => {
  const originalFetch = globalThis.fetch;
  const devonAdapter = new ReffleAdapter({
    siteName: "devoncash",
    displayName: "Devon Cash Comps",
    baseUrl: "https://www.devoncashcomps.co.uk",
    listPath: "/active-draws/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/active-draws/")) {
      return new Response(`
        <div class="raffle">
          <a href="/raffle/cash-man/">
            <h3>CASH-MAN 2K OF INSTANT WINS LOW ODDS JUST 99p</h3>
            156 Tickets Sold
            5,843 remaining
            £0.99 per entry
            £200 CASH WINNER
          </a>
        </div>
      `);
    }

    return new Response(`
      <main>
        <h1>CASH-MAN 2K OF INSTANT WINS LOW ODDS JUST 99p</h1>
        <section class="description-section">
          <p>WELCOME TO CASH-MAN INSTANT WIN COMPETITION</p>
          <p>20 x £50 CASH WINS</p>
          <p>6 x £100 CASH WINS</p>
          <p>2 x £200 CASH WINS</p>
          <p>1 x £50 FINAL CASH PRIZE WHEN THE COMPETITION CLOSES</p>
        </section>
        <section id="instant-wins-tab-pane">Instant Wins</section>
        <p>Tickets sold: 156 / 5,999</p>
        <p>Max 599 tickets per person</p>
        <span data-time="2030/07/31 22:59:00"></span>
      </main>
    `);
  };

  try {
    const [competition] = await devonAdapter.fetchAll();

    assert.ok(competition);
    assert.equal(competition.cashAlternative, 50);
    assert.equal(competition.isAutoDraw, true);
    assert.deepEqual(competition.categories, ["instant-win"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Devon Cash keeps ordinary cash and event draws out of the instant-win category", async () => {
  const originalFetch = globalThis.fetch;
  const devonAdapter = new ReffleAdapter({
    siteName: "devoncash",
    displayName: "Devon Cash Comps",
    baseUrl: "https://www.devoncashcomps.co.uk",
    listPath: "/active-draws/",
    userAgent: "test",
    fetchDelayMs: 0,
  });

  globalThis.fetch = async (input) => {
    if (String(input).endsWith("/active-draws/")) {
      return new Response(`
        <div class="raffle">
          <a href="/raffle/cash-draw/">
            <h3>£750 Cash Draw</h3>
            10 Tickets Sold
            289 remaining
            £5 per entry
          </a>
        </div>
        <div class="raffle">
          <a href="/raffle/vip-event-tickets/">
            <h3>VIP Event Tickets</h3>
            20 Tickets Sold
            180 remaining
            £1 per entry
          </a>
        </div>
      `);
    }

    const isCashDraw = String(input).endsWith("/cash-draw/");
    return new Response(`
      <main>
        <h1>${isCashDraw ? "£750 Cash Draw" : "VIP Event Tickets"}</h1>
        ${isCashDraw ? "<p>Win £750 tax-free cash</p>" : "<p>Win two VIP admission tickets</p>"}
        <p>Tickets sold: ${isCashDraw ? "10 / 299" : "20 / 200"}</p>
        <p>Max 20 tickets per person</p>
        <span data-time="2030/07/31 22:59:00"></span>
      </main>
    `);
  };

  try {
    const competitions = await devonAdapter.fetchAll();
    const cashDraw = competitions.find((competition) => competition.sourceId === "cash-draw");
    const eventDraw = competitions.find((competition) => competition.sourceId === "vip-event-tickets");

    assert.equal(cashDraw?.cashAlternative, 750);
    assert.equal(cashDraw?.isAutoDraw, false);
    assert.deepEqual(cashDraw?.categories, []);
    assert.equal(eventDraw?.cashAlternative, null);
    assert.equal(eventDraw?.isAutoDraw, false);
    assert.deepEqual(eventDraw?.categories, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Reffle normalises a three-ticket spin price", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    if (String(input) === "https://example.test/") {
      return new Response(`
        <div class="raffle">
          <a href="/product/instant-win-slots-7/"><h3>INSTANT WIN SLOTS</h3></a>
          7,416 Tickets Sold
          7,584 remaining
          £1.50 /per spin
        </div>
      `);
    }

    return new Response(`
      <main>
        <h1>INSTANT WIN SLOTS</h1>
        <span data-time="2026/09/27 20:00:00"></span>
        <p>£1.50 /per spin</p>
        <p>1 spin = 3 tickets</p>
      </main>
    `);
  };

  try {
    const [competition] = await new ReffleAdapter({
      siteName: "northcoast",
      displayName: "North Coast Competitions",
      baseUrl: "https://example.test",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    }).fetchAll();

    assert.equal(competition?.entryPrice, 0.5);
    assert.equal(competition?.ticketsSold, 7416);
    assert.equal(competition?.maxTickets, 15000);
    assert.equal(competition?.drawDate, "2026-09-27T19:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
