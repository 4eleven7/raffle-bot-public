import assert from "node:assert/strict";
import test from "node:test";
import { MaxGiveawaysAdapter, toCompetition } from "../src/adapters/maxgiveaways/maxgiveaways-adapter.js";

test("Max Giveaways mapper keeps normal active competitions and skips instant wins", () => {
  const scrapedAt = "2026-06-28T09:00:00.000Z";
  const normal = toCompetition(
    {
      id: "299",
      title: "Win This Ninja Scoop & Swirl Bundle Or £240 Cash",
      slug: "win-this-ninja-scoop-swirl-bundle-or-240-cash",
      status: "active",
      is_giveaway: "0",
      has_instant_prizes: false,
      ticket_price: "1.58",
      max_entries: "499",
      ticket_limit_per_user: "35",
      end_date: "2026-07-02 19:45:00",
      has_cash_alternative: "1",
      cash_alternative_amount: "240.00",
      main_prize_cost: "379.98",
      tickets_sold: 10,
      category: { name: "Kitchen" },
    },
    scrapedAt,
  );

  assert.ok(normal);
  assert.equal(normal.url, "https://maxgiveaways.co.uk/competition-detail.php?competition=win-this-ninja-scoop-swirl-bundle-or-240-cash");
  assert.equal(normal.entryPrice, 1.58);
  assert.equal(normal.ticketsSold, 10);
  assert.equal(normal.maxTickets, 499);
  assert.equal(normal.maxEntriesPerUser, 35);
  assert.equal(normal.maxEntriesPerUserSource, "site");
  assert.equal(normal.cashAlternative, 240);
  assert.equal(normal.estimatedPrizeValue, 379.98);
  assert.equal(normal.valuationSource, "site_estimate");
  assert.deepEqual(normal.categories, ["kitchen"]);
  assert.equal(normal.drawDate, "2026-07-02T18:45:00.000Z");

  const instantWin = toCompetition(
    {
      id: "301",
      title: "Instant Win",
      slug: "instant-win",
      status: "active",
      is_giveaway: "0",
      has_instant_prizes: true,
      ticket_price: "0.28",
      max_entries: "32660",
      ticket_limit_per_user: "2000",
      end_date: "2026-07-12 19:45:00",
      tickets_sold: 144,
    },
    scrapedAt,
  );

  assert.equal(instantWin, null);

  const fallbackCap = toCompetition(
    {
      id: "fallback",
      title: "Fallback cap",
      slug: "fallback-cap",
      status: "active",
      ticket_price: "1",
      max_entries: "100",
      end_date: "2026-07-02 19:45:00",
      tickets_sold: 10,
    },
    scrapedAt,
  );
  assert.equal(fallbackCap?.maxEntriesPerUser, 100);
  assert.equal(fallbackCap?.maxEntriesPerUserSource, "fallback");
});

test("Max Giveaways adapter walks paginated API results", async () => {
  const originalFetch = globalThis.fetch;
  const responses = new Map<string, unknown>([
    [
      "https://maxgiveaways.co.uk/api/competitions?status=active&sort=end_date_asc&limit=50&page=1",
      {
        success: true,
        data: {
          competitions: [
            {
              id: "299",
              title: "Win This Ninja Scoop & Swirl Bundle Or £240 Cash",
              slug: "win-this-ninja-scoop-swirl-bundle-or-240-cash",
              status: "active",
              is_giveaway: "0",
              has_instant_prizes: false,
              ticket_price: "1.58",
              max_entries: "499",
              ticket_limit_per_user: "35",
              end_date: "2026-07-02 19:45:00",
              has_cash_alternative: "1",
              cash_alternative_amount: "240.00",
              main_prize_cost: "379.98",
              tickets_sold: 10,
            },
          ],
          pagination: { current_page: 1, total_pages: 2, has_next_page: true },
        },
      },
    ],
    [
      "https://maxgiveaways.co.uk/api/competitions?status=active&sort=end_date_asc&limit=50&page=2",
      {
        success: true,
        data: {
          competitions: [
            {
              id: "301",
              title: "Instant Win",
              slug: "instant-win",
              status: "active",
              is_giveaway: "0",
              has_instant_prizes: true,
              ticket_price: "0.28",
              max_entries: "32660",
              ticket_limit_per_user: "2000",
              end_date: "2026-07-12 19:45:00",
              tickets_sold: 144,
            },
          ],
          pagination: { current_page: 2, total_pages: 2, has_next_page: false },
        },
      },
    ],
  ]);

  globalThis.fetch = async (input) => {
    const url = String(input);
    const body = responses.get(url);
    assert.ok(body, `Unexpected URL ${url}`);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const rows = await new MaxGiveawaysAdapter().fetchAll();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceId, "win-this-ninja-scoop-swirl-bundle-or-240-cash");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
