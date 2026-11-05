import test from "node:test";
import assert from "node:assert/strict";
import { TechDropAdapter } from "../src/adapters/techdrop/techdrop-adapter.js";

test("TechDrop keeps distinct canonical URLs and non-cash value provenance", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([
    {
      id: "drop-airpods",
      name: "AirPods Pro 2",
      value: 219,
      ticket_price: 1,
      ticket_limit: 25,
      closing_date: "2099-07-21T19:00:00.000Z",
      raffle_type: "normal",
      ticket_pools: [{ assigned_count: 5, total_tickets: 500 }],
    },
    {
      id: "drop-ninja",
      name: "Ninja Outdoor Oven",
      value: 300,
      ticket_price: 1.5,
      ticket_limit: 30,
      closing_date: "2099-07-22T19:00:00.000Z",
      raffle_type: "normal",
      ticket_pools: [{ assigned_count: 10, total_tickets: 600 }],
    },
    {
      id: "drop-cash",
      name: "£500 Cash",
      value: 500,
      ticket_price: 2,
      ticket_limit: 40,
      closing_date: "2099-07-23T19:00:00.000Z",
      raffle_type: "normal",
      ticket_pools: [{ assigned_count: 20, total_tickets: 700 }],
    },
  ]), { status: 200, headers: { "content-type": "application/json" } });

  try {
    const competitions = await new TechDropAdapter().fetchAll();
    assert.deepEqual(
      competitions.map((competition) => competition.url),
      [
        "https://tech-drop.com/enter/drop-airpods",
        "https://tech-drop.com/enter/drop-ninja",
        "https://tech-drop.com/enter/drop-cash",
      ],
    );
    assert.equal(new Set(competitions.map((competition) => competition.url)).size, 3);

    assert.equal(competitions[0]?.cashAlternative, null);
    assert.equal(competitions[0]?.estimatedPrizeValue, 219);
    assert.equal(competitions[0]?.valuationSource, "site_estimate");
    assert.equal(competitions[0]?.valuationConfidence, "medium");
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");

    assert.equal(competitions[1]?.cashAlternative, null);
    assert.equal(competitions[1]?.estimatedPrizeValue, 300);

    assert.equal(competitions[2]?.cashAlternative, 500);
    assert.equal(competitions[2]?.estimatedPrizeValue, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
