import assert from "node:assert/strict";
import test from "node:test";
import { AurumCompetitionsAdapter } from "../src/adapters/aurum/aurum-adapter.js";

test("Aurum adapter maps the public competitions API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://aurumcomps.uk/api/competitions");
    return Response.json([
      {
        id: 26,
        title: "5g GOLD PAMP BUDDHA",
        category: "bullion",
        price: 99,
        totalTickets: 1250,
        ticketsSold: 123,
        endDate: "2026-08-01T19:00:00.000Z",
        isActive: true,
        type: "draw",
        maxTicketsPerPerson: 250,
      },
      {
        id: 27,
        title: "Closed prize",
        price: 99,
        totalTickets: 10,
        ticketsSold: 10,
        endDate: "2026-08-01T19:00:00.000Z",
        isActive: true,
      },
    ]);
  };

  try {
    const [competition] = await new AurumCompetitionsAdapter().fetchAll();
    assert.equal(competition?.sourceId, "26");
    assert.equal(competition?.entryPrice, 0.99);
    assert.equal(competition?.ticketsSold, 123);
    assert.equal(competition?.maxTickets, 1250);
    assert.equal(competition?.cashAlternative, null);
    assert.equal(competition?.estimatedPrizeValue, 560);
    assert.equal(competition?.drawDate, "2026-08-01T19:00:00.000Z");
    assert.equal(competition?.maxEntriesPerUser, 250);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
