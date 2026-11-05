import test from "node:test";
import assert from "node:assert/strict";
import { EliteAdapter } from "../src/adapters/elite/elite-adapter.js";

test("Elite marks only maxTicketsPerUser API values as site-proven", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(`
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: {
        pageProps: {
          dehydratedState: {
            queries: [{}, { state: { data: { data: {
              first: competition(1, 25),
              second: competition(2, null),
            } } } }],
          },
        },
      },
    })}</script>
  `);

  try {
    const competitions = await new EliteAdapter().fetchAll();
    assert.equal(competitions[0]?.maxEntriesPerUser, 25);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.equal(competitions[1]?.maxEntriesPerUser, 100000);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function competition(id: number, cap: number | null): Record<string, unknown> {
  return {
    id,
    name: `Competition ${id}`,
    ticketPrice: 1,
    saleTicketPrice: null,
    soldTicketsPercentage: 10,
    mainPrizePrice: 100,
    drawTime: "2026-07-31T20:00:00.000Z",
    endDate: null,
    isAutoDraw: false,
    maxTicketsPerUser: cap,
    slugUrl: `competition-${id}`,
    type: "standard",
    isFree: false,
    isSoldOut: false,
    status: "live",
    categories: [],
  };
}
