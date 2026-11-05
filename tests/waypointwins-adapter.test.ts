import assert from "node:assert/strict";
import test from "node:test";
import { parseWaypointWinsDetail, WaypointWinsAdapter } from "../src/adapters/waypointwins/waypointwins-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

const detailHtml = `
  <main>
    <h1>Win £100 Cash</h1>
    <dl>
      <div><dt>Prize</dt><dd>Win £100 Cash</dd></div>
      <div><dt>Ticket price</dt><dd>£1 each · 10 for £9</dd></div>
      <div><dt>Maximum tickets</dt><dd>199 online</dd></div>
      <div><dt>Entry limit</dt><dd>No per-person limit</dd></div>
      <div><dt>Closes</dt><dd>Thursday, 3 December 2026 at 20:30 (UK time)</dd></div>
    </dl>
    <div>0% sold 0/199</div>
  </main>
`;

test("Waypoint Wins parser reads exact cash draw economics", () => {
  const competition = parseWaypointWinsDetail(
    detailHtml,
    "https://waypointwins.co.uk/competition/win-100-cash",
    new Date("2026-11-04T09:00:00.000Z"),
  );

  assert.deepEqual(
    {
      sourceId: competition?.sourceId,
      name: competition?.name,
      entryPrice: competition?.entryPrice,
      ticketsSold: competition?.ticketsSold,
      maxTickets: competition?.maxTickets,
      inventorySource: competition?.inventorySource,
      maxEntriesPerUser: competition?.maxEntriesPerUser,
      maxEntriesPerUserSource: competition?.maxEntriesPerUserSource,
      cashAlternative: competition?.cashAlternative,
      valuationSource: competition?.valuationSource,
      drawDate: competition?.drawDate,
      categories: competition?.categories,
    },
    {
      sourceId: "win-100-cash",
      name: "Win £100 Cash",
      entryPrice: 1,
      ticketsSold: 0,
      maxTickets: 199,
      inventorySource: "exact",
      maxEntriesPerUser: 1,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: 100,
      valuationSource: "cash",
      drawDate: "2026-12-03T20:30:00.000Z",
      categories: ["cash"],
    },
  );
});

test("Waypoint Wins adapter discovers live detail links", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://waypointwins.co.uk/competitions") {
      return new Response(
        `<a href="/competition/win-100-cash">Enter</a><a href="/competition/win-100-cash#top">Duplicate</a>`,
        { status: 200 },
      );
    }
    if (url === "https://waypointwins.co.uk/competition/win-100-cash") {
      return new Response(detailHtml, { status: 200 });
    }
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const competitions = await new WaypointWinsAdapter().fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "win-100-cash");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Waypoint Wins adapter is registered", () => {
  assert.ok(getAdapter("waypointwins"));
});
