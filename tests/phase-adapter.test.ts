import test from "node:test";
import assert from "node:assert/strict";
import { PhaseAdapter } from "../src/adapters/phase/phase-adapter.js";

test("Phase marks only its explicit max_per_user field as site-proven", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([
    competition("site-cap", 25),
    competition("fallback-cap", null),
  ]);

  try {
    const competitions = await new PhaseAdapter().fetchAll();
    assert.equal(competitions[0]?.maxEntriesPerUser, 25);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.equal(competitions[1]?.maxEntriesPerUser, 100);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function competition(slug: string, maxPerUser: number | null): Record<string, unknown> {
  return {
    id: slug,
    title: slug,
    slug,
    status: "live",
    ticket_price: 1,
    tickets_sold: 1,
    total_tickets: 100,
    max_per_user: maxPerUser,
    close_date: "2026-07-31T20:00:00.000Z",
    prize_value: 100,
    auto_draw: false,
  };
}
