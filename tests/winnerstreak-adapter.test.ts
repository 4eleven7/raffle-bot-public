import assert from "node:assert/strict";
import test from "node:test";
import { WinnerStreakAdapter, toCompetition } from "../src/adapters/winnerstreak/winnerstreak-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

test("WinnerStreak mapper converts pence API values and keeps cash alternative conservative", () => {
  const row = toCompetition(
    {
      title: "£150 Curry's Giftcard",
      slug: "ps150-currys-giftcard",
      status: "live",
      price: 50,
      ticketsSold: 25,
      numberOfTickets: 600,
      maxTicketsPerUser: 100,
      endDate: "2026-07-26T22:59:00.000000Z",
      prizeValue: 15000,
      cashAlternative: 10000,
      instantWinsCount: 0,
      categories: [{ name: "Gift Cards" }],
    },
    "2026-07-06T11:00:00.000Z",
  );

  assert.ok(row);
  assert.equal(row.sourceId, "ps150-currys-giftcard");
  assert.equal(row.url, "https://www.thewinnerstreak.com/raffles/ps150-currys-giftcard");
  assert.equal(row.entryPrice, 0.5);
  assert.equal(row.ticketsSold, 25);
  assert.equal(row.maxTickets, 600);
  assert.equal(row.maxEntriesPerUser, 100);
  assert.equal(row.maxEntriesPerUserSource, "site");
  assert.equal(row.cashAlternative, 100);
  assert.equal(row.estimatedPrizeValue, undefined);
  assert.equal(row.drawDate, "2026-07-26T22:59:00.000Z");
  assert.deepEqual(row.categories, ["gift cards"]);
});

test("WinnerStreak mapper uses API prize value when no cash alternative exists", () => {
  const row = toCompetition(
    {
      title: "The Players 2026",
      slug: "the-players-2026",
      status: "live",
      price: 50,
      ticketsSold: 5,
      numberOfTickets: 3000,
      maxTicketsPerUser: 500,
      endDate: "2026-07-26T09:32:00.000000Z",
      prizeValue: 7500,
      cashAlternative: null,
      instantWinsCount: 6,
    },
    "2026-07-06T11:00:00.000Z",
  );

  assert.ok(row);
  assert.equal(row.entryPrice, 0.5);
  assert.equal(row.cashAlternative, null);
  assert.equal(row.estimatedPrizeValue, 75);
  assert.equal(row.valuationSource, "site_estimate");
  assert.equal(row.valuationConfidence, "medium");
  assert.deepEqual(row.categories, ["instant wins"]);

  const fallbackCap = toCompetition(
    {
      title: "Fallback cap",
      slug: "fallback-cap",
      status: "live",
      price: 50,
      ticketsSold: 5,
      numberOfTickets: 100,
      maxTicketsPerUser: null,
      endDate: "2026-07-26T09:32:00.000000Z",
    },
    "2026-07-06T11:00:00.000Z",
  );
  assert.equal(fallbackCap?.maxEntriesPerUser, 100);
  assert.equal(fallbackCap?.maxEntriesPerUserSource, "fallback");
});

test("WinnerStreak adapter walks paginated API results", async () => {
  const originalFetch = globalThis.fetch;
  const responses = new Map<string, unknown>([
    [
      "https://www.thewinnerstreak.com/api/raffles?status=live&perPage=25&orderBy=end_date&page=1",
      {
        data: [
          {
            title: "£100 ASOS voucher",
            slug: "ps100-asos-voucher",
            status: "live",
            price: 20,
            ticketsSold: 0,
            numberOfTickets: 1000,
            maxTicketsPerUser: 100,
            endDate: "2026-07-26T22:59:00.000000Z",
            prizeValue: 10000,
            cashAlternative: 7500,
            instantWinsCount: 0,
          },
        ],
        meta: { current_page: 1, last_page: 2 },
      },
    ],
    [
      "https://www.thewinnerstreak.com/api/raffles?status=live&perPage=25&orderBy=end_date&page=2",
      {
        data: [
          {
            title: "Closed",
            slug: "closed",
            status: "completed",
            price: 20,
            ticketsSold: 10,
            numberOfTickets: 1000,
            endDate: "2026-07-26T22:59:00.000000Z",
            prizeValue: 10000,
          },
        ],
        meta: { current_page: 2, last_page: 2 },
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
    const rows = await new WinnerStreakAdapter().fetchAll();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceId, "ps100-asos-voucher");
    assert.equal(rows[0]?.cashAlternative, 75);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("WinnerStreak adapter is registered", () => {
  assert.ok(getAdapter("winnerstreak") instanceof WinnerStreakAdapter);
});
