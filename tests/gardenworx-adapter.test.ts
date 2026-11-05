import assert from "node:assert/strict";
import test from "node:test";
import { GardenWorxAdapter } from "../src/adapters/gardenworx/gardenworx-adapter.js";

test("Garden Worx adapter parses the public competition config from the Next.js payload", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    if (String(input) !== "https://gardenworx.co.uk/competition") {
      return new Response("not found", { status: 404 });
    }

    return new Response(
      `
        <meta property="og:title" content="Win a £25,000 Garden Makeover" />
        <script>self.__next_f.push([1,"6:[\\"$\\",\\"$L1a\\",null,{\\"config\\":{\\"total_tickets_available\\":3500,\\"tickets_sold\\":33,\\"ticket_price\\":10,\\"draw_date\\":\\"2026-07-01T18:00:00+00:00\\",\\"is_active\\":true,\\"prize_value\\":25000,\\"prize_description\\":\\"The Ultimate £25,000 Garden Makeover\\"},\\"squareAppId\\":\\"sq0idp-test\\",\\"squareLocationId\\":\\"LEHT0D3N7SEY0\\",\\"configLoadError\\":null}]"])</script>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const competitions = await new GardenWorxAdapter().fetchAll();

    assert.equal(competitions.length, 1);
    assert.deepEqual(competitions[0], {
      sourceId: "competition",
      siteName: "gardenworx",
      url: "https://gardenworx.co.uk/competition",
      name: "The Ultimate £25,000 Garden Makeover",
      entryPrice: 10,
      ticketsSold: 33,
      maxTickets: 3500,
      maxEntriesPerUser: 100,
      cashAlternative: null,
      estimatedPrizeValue: 25000,
      valuationSource: "site_estimate",
      valuationConfidence: "high",
      valuationNotes: "Garden Worx public competition config prize value.",
      drawDate: "2026-07-01T18:00:00.000Z",
      isAutoDraw: false,
      categories: ["home & garden", "garden makeover"],
      scrapedAt: competitions[0]?.scrapedAt,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
