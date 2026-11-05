import test from "node:test";
import assert from "node:assert/strict";
import { PodiumPrizeAdapter } from "../src/adapters/podium/podium-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

test("Podium Prize adapter maps active Inertia competitions", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const drawDate = new Date(2026, 6, 8, 17, 12, 0).toISOString();

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);

    if (url === "https://podiumprize.co.uk/competitions/ninja-instant-wins") {
      return response(`
        <html>
          <body>
            <div id="app" data-page="${escapeHtml(JSON.stringify({
              props: {
                competitions: [
                  {
                    id: 159,
                    name: "Ninja Instant Wins!",
                    slug: "ninja-instant-wins",
                    status: "Active",
                    price: "0.39",
                    sale_price: "0.00",
                    cash_alt: "0.00",
                    is_cash_alt: false,
                    main_prize_type: "physical_only",
                    end_prize_value: "0.00",
                    total_tickets: 29847,
                    max_tickets: 5000,
                    max_tickets_per_order: 5000,
                    sold: 83,
                    sold_live: 84,
                    draw: "2026-07-08 17:12:00",
                    auto_draw: false,
                    categories: {
                      data: [{ id: 4, name: "Instant Wins" }],
                    },
                    game_type_name: "Scratchy",
                  },
                  {
                    id: 160,
                    name: "Closed Comp",
                    slug: "closed-comp",
                    status: "Closed",
                    price: "1.00",
                    total_tickets: 100,
                    sold: 100,
                  },
                ],
              },
            }))}"></div>
          </body>
        </html>
      `);
    }

    return response("Not found", 404);
  }) as typeof fetch;

  try {
    const comps = await new PodiumPrizeAdapter({
      now: () => new Date("2026-06-18T10:00:00.000Z"),
    }).fetchAll();

    assert.deepEqual(requests, [
      "https://podiumprize.co.uk/competitions/ninja-instant-wins",
    ]);
    assert.deepEqual(comps, [
      {
        sourceId: "ninja-instant-wins",
        siteName: "podiumprize",
        url: "https://podiumprize.co.uk/competitions/ninja-instant-wins",
        name: "Ninja Instant Wins!",
        entryPrice: 0.39,
        ticketsSold: 84,
        maxTickets: 29847,
        maxEntriesPerUser: 5000,
        maxEntriesPerUserSource: "site",
        cashAlternative: null,
        drawDate,
        isAutoDraw: false,
        categories: ["instant wins", "scratchy"],
        scrapedAt: "2026-06-18T10:00:00.000Z",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Podium Prize adapter is registered", () => {
  assert.ok(getAdapter("podiumprize"));
});

function response(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
