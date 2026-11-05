import assert from "node:assert/strict";
import test from "node:test";
import { StaticListAdapter } from "../src/adapters/static-list/static-list-adapter.js";

test("Boony parser reads exact data attributes, close time, and conflict-safe prize value", async () => {
  const originalFetch = globalThis.fetch;
  const config = {
    siteName: "boonycompetitions",
    displayName: "Boony Competitions",
    baseUrl: "https://boonycompetitions.co.uk",
    listPath: "/",
    userAgent: "test",
  };
  const detailUrl = `${config.baseUrl}/competitions/pokemon/pitch-black-etb-booster-box-100-tickets`;

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === `${config.baseUrl}${config.listPath}`) {
      return new Response(`<a href="${detailUrl}">Enter</a>`, { status: 200 });
    }
    if (url === detailUrl) {
      return new Response(
        `<h1>Win a Pitch Black ETB + Booster Box - Only 100 Tickets</h1>
          <div>£2.99 per entry</div>
          <time datetime="2026-09-09T19:00:00+00:00">9 Sep 2026, 20:00</time>
          <form data-ticket-limit="100" data-tickets-sold="51"></form>
          <p>£180 cash alternative</p>
          <p>Prize value <strong>£221.00</strong></p>
          <p>Cash alternative <strong>£1.80</strong></p>`,
        { status: 200 },
      );
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const [competition] = await new StaticListAdapter(config).fetchAll();
    assert.deepEqual(
      {
        entryPrice: competition?.entryPrice,
        ticketsSold: competition?.ticketsSold,
        maxTickets: competition?.maxTickets,
        estimatedPrizeValue: competition?.estimatedPrizeValue,
        cashAlternative: competition?.cashAlternative,
        drawDate: competition?.drawDate,
      },
      {
        entryPrice: 2.99,
        ticketsSold: 51,
        maxTickets: 100,
        estimatedPrizeValue: 188,
        cashAlternative: null,
        drawDate: "2026-09-09T19:00:00.000Z",
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
