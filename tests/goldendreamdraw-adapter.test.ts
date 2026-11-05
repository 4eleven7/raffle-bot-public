import assert from "node:assert/strict";
import test from "node:test";
import {
  GoldenDreamDrawAdapter,
  parseGoldenDreamDrawListing,
} from "../src/adapters/goldendreamdraw/goldendreamdraw-adapter.js";

const listingPayload = JSON.stringify(
  `1:["$","$L39",null,{"slug":"apple-airpods-pro-3-white","title":"AirPods Pro 3 - White","description":"Win AirPods Pro 3 for £0.99 a ticket.","category":"electronics","imageUrl":"https://example.test/airpods.jpg","ticketsSold":55,"maxTickets":1000,"drawDate":"$D2026-07-24T19:00:00.000Z","pricePounds":0.99,"locale":"en"}]`,
);
const listingHtml = `<script>self.__next_f.push([1,${listingPayload}])</script>`;

test("Golden Dream Draw parses deterministic Next.js listing economics", () => {
  const [competition] = parseGoldenDreamDrawListing(
    listingHtml,
    "2026-07-24T08:00:00.000Z",
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "apple-airpods-pro-3-white");
  assert.equal(competition.entryPrice, 0.99);
  assert.equal(competition.ticketsSold, 55);
  assert.equal(competition.maxTickets, 1000);
  assert.equal(competition.drawDate, "2026-07-24T19:00:00.000Z");
  assert.equal(competition.url, "https://goldendreamdraw.uk/en/competitions/apple-airpods-pro-3-white");
});

test("Golden Dream Draw enriches site RRP and max-per-person from the detail page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://goldendreamdraw.uk/en/competitions") {
      return new Response(listingHtml, { status: 200 });
    }
    if (url.endsWith("/apple-airpods-pro-3-white")) {
      return new Response(
        "<body><span>RRP £219</span><div>Max per person</div><div>50</div></body>",
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new GoldenDreamDrawAdapter().fetchAll();
    assert.equal(competition?.estimatedPrizeValue, 219);
    assert.equal(competition?.valuationSource, "site_estimate");
    assert.equal(competition?.maxEntriesPerUser, 50);
    assert.equal(competition?.maxEntriesPerUserSource, "site");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
