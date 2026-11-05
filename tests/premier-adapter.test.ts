import test from "node:test";
import assert from "node:assert/strict";
import { PremierPrizeAdapter } from "../src/adapters/premier/premier-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

const SUPABASE_URL = "https://example.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example_public_payload.example_public_signature";

test("Premier Prize adapter maps public Supabase competitions", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);

    if (url === "https://premierprizecompetitions.co.uk/") {
      return response(`
        <script type="module" crossorigin src="/assets/index-test.js"></script>
      `);
    }

    if (url === "https://premierprizecompetitions.co.uk/assets/index-test.js") {
      return response(`
        const Z0="${SUPABASE_URL}";
        const ew="${SUPABASE_KEY}";
      `);
    }

    if (url.startsWith(`${SUPABASE_URL}/rest/v1/competitions`)) {
      return response([
        {
          id: "c48f57d4-111c-4a8d-a4eb-a76fa6f9cd29",
          title: "£3,000 Ninja Instant Win Haul and Cash + Guaranteed End Draw for the Ninja PRO XL BBQ RRP £1,000",
          slug: "-3-000-ninja-instant-win-haul-and-cash-guaranteed-end-draw-for-the-ninja-pro-xl-bbq-rrp-1-000",
          prize_value: 500,
          ticket_price: 4.99,
          sale_price: null,
          is_on_sale: false,
          total_tickets: 1499,
          tickets_sold: 204,
          status: "ending_soon",
          category: "Lifestyle",
          is_instant_win: true,
          draw_date: "2026-06-18T20:00:00+00:00",
          end_date: "2026-06-18T20:00:00+00:00",
          max_tickets_per_user: 25,
          admin_only: false,
          is_competition_game: false,
          type: "standard",
          format: "end_draw_headline",
          draw_mode: "manual",
        },
      ]);
    }

    return response({ message: "not found" }, 404);
  }) as typeof fetch;

  try {
    const comps = await new PremierPrizeAdapter().fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(
      requests.some((url) => url.includes("status=in.%28live%2Cending_soon%29")),
      true,
    );

    assert.deepEqual(comps[0], {
      sourceId: "c48f57d4-111c-4a8d-a4eb-a76fa6f9cd29",
      siteName: "premierprize",
      url: "https://premierprizecompetitions.co.uk/competitions/c48f57d4-111c-4a8d-a4eb-a76fa6f9cd29",
      name: "£3,000 Ninja Instant Win Haul and Cash + Guaranteed End Draw for the Ninja PRO XL BBQ RRP £1,000",
      entryPrice: 4.99,
      ticketsSold: 204,
      maxTickets: 1499,
      maxEntriesPerUser: 25,
      maxEntriesPerUserSource: "site",
      cashAlternative: null,
      estimatedPrizeValue: 500,
      valuationSource: "site_estimate",
      valuationConfidence: "medium",
      valuationNotes: "Premier Prize public prize_value",
      drawDate: "2026-06-18T20:00:00+00:00",
      isAutoDraw: true,
      categories: ["lifestyle", "instant-win", "standard", "end_draw_headline"],
      scrapedAt: comps[0]?.scrapedAt,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Premier Prize adapter keeps clear cash prizes as cash alternatives", () => {
  const adapter = new PremierPrizeAdapter();
  const mapCompetition = (adapter as unknown as {
    mapCompetition(comp: Record<string, unknown>, now: string): unknown;
  }).mapCompetition.bind(adapter);

  const comp = mapCompetition(
    {
      id: "cash-1",
      title: "£500 Cash",
      prize_value: 500,
      ticket_price: 1,
      total_tickets: 1000,
      tickets_sold: 100,
      status: "live",
      category: "Cash",
      is_instant_win: false,
      draw_date: "2026-06-18T20:00:00+00:00",
      admin_only: false,
      is_competition_game: false,
    },
    "2026-06-18T09:00:00.000Z",
  ) as {
    cashAlternative: number | null;
    estimatedPrizeValue?: number | null;
    maxEntriesPerUserSource?: string;
  };

  assert.equal(comp.cashAlternative, 500);
  assert.equal(comp.estimatedPrizeValue, undefined);
  assert.equal(comp.maxEntriesPerUserSource, "fallback");
});

test("Premier Prize adapter is registered", () => {
  assert.ok(getAdapter("premierprize"));
});

function response(body: unknown, status = 200): Response {
  return new Response(
    typeof body === "string" ? body : JSON.stringify(body),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}
