import test from "node:test";
import assert from "node:assert/strict";

import { InItToWinItAdapter, parseExactCount } from "../src/adapters/inittowinit/inittowinit-adapter.ts";

test("parseExactCount reads Supabase content-range totals", () => {
  assert.equal(parseExactCount("0-0/4460"), 4460);
  assert.equal(parseExactCount("*/39"), 39);
});

test("parseExactCount falls back to zero for missing or invalid headers", () => {
  assert.equal(parseExactCount(null), 0);
  assert.equal(parseExactCount("invalid"), 0);
});

test("In It To Win It marks only an explicit customer cap as site-proven", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/rest/v1/competitions?")) {
      return Response.json([
        {
          id: "site-cap",
          title: "Site cap",
          slug: "site-cap",
          ticket_price: 1,
          total_tickets: 100,
          max_tickets_per_customer: 20,
          end_date: "2026-07-31T20:00:00.000Z",
          prize_value: 100,
          cash_alternative: null,
          draw_type: "manual",
          vip_only: false,
          app_only: false,
          status: "live",
        },
        {
          id: "fallback-cap",
          title: "Fallback cap",
          slug: "fallback-cap",
          ticket_price: 1,
          total_tickets: 100,
          max_tickets_per_customer: null,
          end_date: "2026-07-31T20:00:00.000Z",
          prize_value: 100,
          cash_alternative: null,
          draw_type: "manual",
          vip_only: false,
          app_only: false,
          status: "live",
        },
      ]);
    }
    if (url.includes("/rest/v1/tickets?")) {
      return new Response("[]", { status: 200, headers: { "content-range": "0-0/5" } });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new InItToWinItAdapter().fetchAll();
    assert.equal(competitions[0]?.maxEntriesPerUser, 20);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.equal(competitions[1]?.maxEntriesPerUser, 100);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
