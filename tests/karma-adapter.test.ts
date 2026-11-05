import assert from "node:assert/strict";
import test from "node:test";
import { KarmaAdapter } from "../src/adapters/karma/karma-adapter.js";

test("Karma adapter parses active competitions from the Inertia page payload", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    if (String(input) !== "https://karmacompetitions.co.uk/") {
      return new Response("not found", { status: 404 });
    }

    return new Response(
      `
        <div id="app" data-page='${JSON.stringify({
          props: {
            competitions: {
              data: [
                {
                  id: 91,
                  name: "Rattan set",
                  slug: "rattan-set",
                  status: "Active",
                  price: "2.99",
                  sale_price: "0.00",
                  cash_alt: "0.00",
                  is_cash_alt: true,
                  main_prize_type: "cash_and_physical",
                  end_prize_value: "100.00",
                  total_tickets: 50,
                  available_tickets: 35,
                  sold: 15,
                  sold_live: 15,
                  max_tickets: 6,
                  max_tickets_per_order: null,
                  draw: "2026-06-22 20:30:00",
                  end: "2026-06-22 20:00:00",
                  auto_draw: false,
                  categories: { data: [{ name: "Prizes" }] },
                  game_type_name: null,
                },
                {
                  id: 89,
                  name: "£500 CASH",
                  slug: "500-cash",
                  status: "Active",
                  price: "0.05",
                  sale_price: "0.00",
                  cash_alt: "0.00",
                  is_cash_alt: false,
                  main_prize_type: "physical_only",
                  end_prize_value: "500.00",
                  total_tickets: 17599,
                  available_tickets: 14848,
                  sold: 2751,
                  sold_live: 2751,
                  max_tickets: 2000,
                  max_tickets_per_order: 2000,
                  draw: "2026-06-29 20:30:00",
                  end: "2026-06-29 20:00:00",
                  auto_draw: false,
                  categories: { data: [{ name: "Cash" }] },
                  game_type_name: null,
                },
                {
                  id: 1,
                  name: "Closed comp",
                  slug: "closed-comp",
                  status: "Closed",
                  price: "1.00",
                  total_tickets: 100,
                  sold_live: 100,
                  draw: "2026-06-01 20:30:00",
                  categories: { data: [] },
                },
              ],
            },
          },
        }).replace(/'/g, "&apos;")}'></div>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const competitions = await new KarmaAdapter().fetchAll();

    assert.equal(competitions.length, 2);
    assert.equal(competitions[0]?.sourceId, "rattan-set");
    assert.equal(competitions[0]?.entryPrice, 2.99);
    assert.equal(competitions[0]?.ticketsSold, 15);
    assert.equal(competitions[0]?.maxTickets, 50);
    assert.equal(competitions[0]?.cashAlternative, 100);
    assert.equal(competitions[0]?.maxEntriesPerUser, 6);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "fallback");
    assert.equal(
      competitions[0]?.url,
      "https://karmacompetitions.co.uk/competitions/rattan-set",
    );
    assert.deepEqual(competitions[0]?.categories, ["prizes"]);

    assert.equal(competitions[1]?.sourceId, "500-cash");
    assert.equal(competitions[1]?.entryPrice, 0.05);
    assert.equal(competitions[1]?.ticketsSold, 2751);
    assert.equal(competitions[1]?.maxTickets, 17599);
    assert.equal(competitions[1]?.cashAlternative, null);
    assert.equal(competitions[1]?.estimatedPrizeValue, 500);
    assert.equal(competitions[1]?.maxEntriesPerUser, 2000);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "site");
    assert.deepEqual(competitions[1]?.categories, ["cash"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
