import assert from "node:assert/strict";
import test from "node:test";
import { CompetitionEngineAdapter } from "../src/adapters/competitionengine/competitionengine-adapter.js";

test("Competition Engine adapter parses active competitions from list pages", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://s2acompetitions.co.uk/competitions") {
      return new Response(
        `
          <div id="app" data-page='${JSON.stringify({
            props: {
              competitions: [
                {
                  id: 67,
                  name: "PerfectDraft Black Starter Bundle",
                  slug: "perfectdraft-black-starter-bundle",
                  status: "Active",
                  price: "0.25",
                  sale_price: "0.00",
                  cash_alt: "100.00",
                  is_cash_alt: true,
                  main_prize_type: "cash_and_physical",
                  end_prize_value: "250.00",
                  total_tickets: 2000,
                  remaining_tickets: 1754,
                  sold: 246,
                  sold_live: 246,
                  max_tickets: 800,
                  max_tickets_per_order: 800,
                  draw: "2026-06-24 20:00:00",
                  end: "2026-06-24 20:00:00",
                  auto_draw: true,
                  categories: [{ name: "Tech" }],
                  game_type_name: null,
                },
              ],
            },
          }).replace(/'/g, "&apos;")}'></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new CompetitionEngineAdapter({
      siteName: "s2acompetitions",
      displayName: "S2A Competitions",
      baseUrl: "https://s2acompetitions.co.uk",
      listPath: "/competitions",
      userAgent: "test",
    }).fetchAll();

    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "perfectdraft-black-starter-bundle");
    assert.equal(competitions[0]?.entryPrice, 0.25);
    assert.equal(competitions[0]?.ticketsSold, 246);
    assert.equal(competitions[0]?.maxTickets, 2000);
    assert.equal(competitions[0]?.cashAlternative, 100);
    assert.equal(competitions[0]?.maxEntriesPerUser, 800);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.equal(
      competitions[0]?.url,
      "https://s2acompetitions.co.uk/competitions/perfectdraft-black-starter-bundle",
    );
    assert.deepEqual(competitions[0]?.categories, ["tech"]);
    assert.equal(competitions[0]?.isAutoDraw, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Competition Engine adapter handles collection-wrapped competitions", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://winnerwinnercompetitions.co.uk/competitions") {
      return new Response(
        `
          <div id="app" data-page='${JSON.stringify({
            props: {
              competitions: {
                data: [
                  {
                    id: 310,
                    name: "Daily Deal - Thursday",
                    slug: "daily-deal-25th",
                    status: "Active",
                    price: "0.50",
                    sale_price: "0.00",
                    cash_alt: "100.00",
                    is_cash_alt: true,
                    main_prize_type: "cash_only",
                    end_prize_value: "100.00",
                    total_tickets: 300,
                    available_tickets: 259,
                    sold: 41,
                    sold_live: 41,
                    max_tickets: 30,
                    max_tickets_per_order: null,
                    draw: "2026-06-25 23:00:00",
                    end: "2026-06-25 23:00:00",
                    auto_draw: true,
                    categories: { data: [{ name: "Cash" }, { name: "Daily Deals" }] },
                    game_type_name: null,
                  },
                ],
              },
            },
          }).replace(/'/g, "&apos;")}'></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new CompetitionEngineAdapter({
      siteName: "winnerwinnercompetitions",
      displayName: "Winner Winner Competitions",
      baseUrl: "https://winnerwinnercompetitions.co.uk",
      listPath: "/competitions",
      userAgent: "test",
    }).fetchAll();

    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "daily-deal-25th");
    assert.equal(competitions[0]?.entryPrice, 0.5);
    assert.equal(competitions[0]?.ticketsSold, 41);
    assert.equal(competitions[0]?.maxTickets, 300);
    assert.equal(competitions[0]?.cashAlternative, 100);
    assert.equal(competitions[0]?.maxEntriesPerUser, 30);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.deepEqual(competitions[0]?.categories, ["cash", "daily deals"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Competition Engine adapter maps WinThisNow site prize values", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://winthisnowcompetitions.co.uk/competitions") {
      return new Response(
        `
          <div id="app" data-page='${JSON.stringify({
            props: {
              competitions: {
                data: [
                  {
                    id: 148,
                    name: "WIN THIS GARDEN BUNDLE + CASH INSTANT WINS",
                    slug: "win-this-garden-bundle-cash-instant-wins",
                    status: "Active",
                    price: "0.20",
                    sale_price: "0.00",
                    cash_alt: "0.00",
                    is_cash_alt: false,
                    main_prize_type: "physical_only",
                    end_prize_value: "700.00",
                    total_tickets: 25999,
                    remaining_tickets: 19160,
                    sold: 6839,
                    sold_live: 6839,
                    max_tickets: 1000,
                    max_tickets_per_order: 1000,
                    draw: "2026-07-02 20:00:00",
                    end: "2026-07-02 20:00:00",
                    auto_draw: true,
                    categories: { data: [{ name: "Tech" }, { name: "Instant Wins" }] },
                    game_type_name: "Scratchy",
                  },
                ],
              },
            },
          }).replace(/'/g, "&apos;")}'></div>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new CompetitionEngineAdapter({
      siteName: "winthisnow",
      displayName: "Win this Now Competitions",
      baseUrl: "https://winthisnowcompetitions.co.uk",
      listPath: "/competitions",
      userAgent: "test",
    }).fetchAll();

    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "win-this-garden-bundle-cash-instant-wins");
    assert.equal(competitions[0]?.entryPrice, 0.2);
    assert.equal(competitions[0]?.ticketsSold, 6839);
    assert.equal(competitions[0]?.maxTickets, 25999);
    assert.equal(competitions[0]?.maxEntriesPerUser, 1000);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.equal(competitions[0]?.cashAlternative, null);
    assert.equal(competitions[0]?.estimatedPrizeValue, 700);
    assert.equal(competitions[0]?.valuationSource, "site_estimate");
    assert.deepEqual(competitions[0]?.categories, ["tech", "instant wins", "scratchy"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Competition Engine does not mark ordinary Scratchy cash draws as instant wins", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`
    <div id="app" data-page='${JSON.stringify({
      props: {
        competitions: [{
          name: "Nifty Fifty!",
          slug: "nifty-fifty",
          status: "Active",
          price: "3.00",
          cash_alt: "50.00",
          total_tickets: 30,
          sold: 6,
          max_tickets: 6,
          draw: "2026-09-21 20:00:00",
          has_instant_wins: false,
          instant_wins: false,
          categories: [{ name: "Cash" }],
          game_type_name: "Scratchy",
        }],
      },
    }).replace(/'/g, "&apos;")}'></div>
  `);

  try {
    const [competition] = await new CompetitionEngineAdapter({
      siteName: "houseofhopecomps",
      displayName: "House of Hope Comps",
      baseUrl: "https://www.houseofhopecomps.co.uk",
      listPath: "/",
      userAgent: "test",
    }).fetchAll();

    assert.deepEqual(competition?.categories, ["cash"]);
    assert.equal(competition?.cashAlternative, 50);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Competition Engine preserves explicit zero-price free provenance", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`
    <div id="app" data-page='${JSON.stringify({
      props: {
        competitions: [{
          id: 1,
          name: "APP ONLY - £50 Free Cash",
          slug: "app-only-free-cash",
          status: "Active",
          price: "0.00",
          sale_price: "0.00",
          cash_alt: "50.00",
          total_tickets: 300,
          sold: 211,
          max_tickets_per_order: 10,
          draw: "2026-07-21 22:00:00",
          categories: [{ name: "Cash" }],
        }],
      },
    }).replace(/'/g, "&apos;")}'></div>
  `);

  try {
    const [competition] = await new CompetitionEngineAdapter({
      siteName: "example",
      displayName: "Example",
      baseUrl: "https://example.test",
      listPath: "/competitions",
      userAgent: "test",
    }).fetchAll();

    assert.equal(competition?.entryPrice, 0);
    assert.deepEqual(competition?.categories, ["cash", "free"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
