import test from "node:test";
import assert from "node:assert/strict";
import { GoWinzoAdapter } from "../src/adapters/gowinzo/gowinzo-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

const SUPABASE_URL = "https://example.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.example_public_payload.example_public_signature";

test("GoWinzo adapter maps public Supabase competitions", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: new Headers(init?.headers) });

    if (url === "https://gowinzo.uk/") {
      return response(`
        <script type="module" crossorigin src="/assets/index-test.js"></script>
      `);
    }

    if (url === "https://gowinzo.uk/assets/index-test.js") {
      return response(`
        const MM="${SUPABASE_URL}";
        const DM="${SUPABASE_KEY}";
      `);
    }

    if (url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/get_public_competitions`)) {
      return response([
        {
          id: "744fa320-922c-4b99-a279-061d540e45a2",
          title: "Keep It Cool This Summer - Win a Ninja FrostVault or take £200 Cash Alternative",
          description: "Ninja FrostVault cooler with £200 cash alternative.",
          short_description: "Win a cooler or cash.",
          prize_value: 249.99,
          ticket_price: 0.89,
          max_entries: 700,
          current_entries: 332,
          category: "other",
          end_date: "2026-06-21T22:59:00+00:00",
          status: "active",
          instant_wins_only: false,
          instant_wins_enabled: true,
          instant_win_prize_type: "bonus_tickets",
          random_ticket_allocation: true,
          flash_sale_active: true,
          flash_sale_discount_percent: 50,
          flash_sale_duration_minutes: 120,
          flash_sale_started_at: "2026-06-18T10:30:00.000Z",
        },
        {
          id: "56b30765-786a-4808-97c9-4255eba71dfb",
          title: "Instant Cash Wins - 20 Lucky Winners!",
          prize_value: 200,
          ticket_price: 1,
          max_entries: 600,
          current_entries: 161,
          category: "cash",
          end_date: "2026-06-19T21:59:00+00:00",
          status: "active",
          instant_wins_only: true,
          instant_win_prize_type: "cash",
        },
      ]);
    }

    return response({ message: "not found" }, 404);
  }) as typeof fetch;

  try {
    const comps = await new GoWinzoAdapter({
      now: () => new Date("2026-06-18T11:00:00.000Z"),
    }).fetchAll();

    assert.equal(comps.length, 1);
    assert.equal(
      requests.some((request) =>
        request.url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/get_public_competitions`) &&
        request.url.includes("status=eq.active") &&
        request.url.includes("order=end_date.asc"),
      ),
      true,
    );
    const apiRequest = requests.find((request) =>
      request.url.startsWith(`${SUPABASE_URL}/rest/v1/rpc/get_public_competitions`),
    );
    assert.equal(apiRequest?.headers.get("apikey"), SUPABASE_KEY);

    assert.deepEqual(comps[0], {
      sourceId: "744fa320-922c-4b99-a279-061d540e45a2",
      siteName: "gowinzo",
      url: "https://gowinzo.uk/competitions/744fa320-922c-4b99-a279-061d540e45a2",
      name: "Keep It Cool This Summer - Win a Ninja FrostVault or take £200 Cash Alternative",
      entryPrice: 0.45,
      ticketsSold: 332,
      maxTickets: 700,
      maxEntriesPerUser: 100,
      cashAlternative: 200,
      drawDate: "2026-06-21T22:59:00+00:00",
      isAutoDraw: false,
      categories: ["other", "instant-wins", "bonus-tickets", "random-ticket-allocation"],
      scrapedAt: "2026-06-18T11:00:00.000Z",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GoWinzo adapter is registered", () => {
  assert.ok(getAdapter("gowinzo"));
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
