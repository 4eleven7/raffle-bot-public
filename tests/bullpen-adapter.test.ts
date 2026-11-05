import assert from "node:assert/strict";
import test from "node:test";
import { BullpenAdapter } from "../src/adapters/bullpen/bullpen-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

test("Bullpen adapter maps the public competitions API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://bullpencompetitions.com/api/comps");
    return new Response(JSON.stringify({
      comps: [
        {
          id: "comp_test",
          name: "Ninja Blender",
          price: 0.2,
          salePrice: 0.15,
          soldCount: 12,
          totalTickets: 500,
          closeAt: 1785182400,
          drawAt: 1785183300,
          cashAlt: "£173",
          maxPerUser: 232,
          status: "open",
          drawType: "auto",
          categories: ["Kitchen"],
        },
        {
          id: "comp_hidden",
          name: "Hidden prize",
          price: 1,
          soldCount: 0,
          totalTickets: 10,
          closeAt: 1785182400,
          status: "open",
          hidden: true,
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const competitions = await new BullpenAdapter().fetchAll();
    assert.equal(competitions.length, 1);
    assert.deepEqual(competitions[0], {
      sourceId: "comp_test",
      siteName: "bullpen",
      url: "https://bullpencompetitions.com/comp?id=comp_test",
      name: "Ninja Blender",
      entryPrice: 0.15,
      ticketsSold: 12,
      maxTickets: 500,
      drawUsesFullTicketRange: true,
      maxEntriesPerUser: 232,
      maxEntriesPerUserSource: "site",
      cashAlternative: 173,
      drawDate: "2026-07-27T20:00:00.000Z",
      isAutoDraw: true,
      categories: ["kitchen", "auto"],
      scrapedAt: competitions[0]?.scrapedAt,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Bullpen adapter is registered as the direct adapter", () => {
  assert.ok(getAdapter("bullpen"));
  assert.equal(getAdapter("bullpencompetitions"), undefined);
});
