import test from "node:test";
import assert from "node:assert/strict";
import { CashGiveawayAdapter } from "../src/adapters/cashgiveaway/cashgiveaway-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

test("Cash Giveaway adapter maps public API competitions", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    assert.equal(String(input), "https://www.cashgiveaway.co.uk/api/competitions");
    return new Response(
      JSON.stringify({
        success: true,
        data: [
          {
            id: "89e979de-9879-46cd-ac1c-2026b18a4dbd",
            title: "BMW X4 2021 SI £20,000",
            title_en: "BMW X4 2021 AND £20,000",
            description_en: "OR CASH ALTERNATIVE £45,000",
            ticketPrice: 2,
            discountPrice: 1,
            discountTickets: 10000,
            totalTickets: 60000,
            soldTickets: 852,
            maxTicketsPerPerson: 3000,
            drawDate: "2026-07-18T21:00:00+00:00",
            isFreeCompetition: false,
            status: "active",
            category: "cars",
          },
          {
            id: "fallback-cap",
            title: "£100 Cash",
            ticketPrice: 1,
            totalTickets: 100,
            soldTickets: 1,
            drawDate: "2026-07-19T21:00:00+00:00",
            isFreeCompetition: false,
            status: "active",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const comps = await new CashGiveawayAdapter().fetchAll();

    assert.equal(comps.length, 2);
    assert.deepEqual(comps[0], {
      sourceId: "89e979de-9879-46cd-ac1c-2026b18a4dbd",
      siteName: "cashgiveaway",
      url: "https://www.cashgiveaway.co.uk/competition/89e979de-9879-46cd-ac1c-2026b18a4dbd",
      name: "BMW X4 2021 AND £20,000",
      entryPrice: 1,
      ticketsSold: 852,
      maxTickets: 60000,
      maxEntriesPerUser: 3000,
      maxEntriesPerUserSource: "site",
      cashAlternative: 45000,
      drawDate: "2026-07-18T21:00:00+00:00",
      isAutoDraw: false,
      categories: ["cars"],
      scrapedAt: comps[0]?.scrapedAt,
    });
    assert.equal(comps[1]?.maxEntriesPerUser, 100);
    assert.equal(comps[1]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cash Giveaway adapter is registered", () => {
  assert.ok(getAdapter("cashgiveaway"));
});
