import test from "node:test";
import assert from "node:assert/strict";
import { HighPeakAdapter } from "../src/adapters/highpeak/highpeak-adapter.js";

test("High Peak trusts a labelled cap but not the ambiguous number_of_tickets field", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([
    competition("site-cap", "999", "Maximum 12 tickets per person"),
    competition("fallback-cap", "30", null),
  ]);

  try {
    const competitions = await new HighPeakAdapter().fetchAll();
    assert.equal(competitions[0]?.maxEntriesPerUser, 12);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.equal(competitions[1]?.maxEntriesPerUser, 30);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("High Peak preserves explicit free-entry provenance from its public API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([
    { ...competition("free-draw", "30", null), title: "Free Coffee Machine", free: "1" },
  ]);

  try {
    const [competition] = await new HighPeakAdapter().fetchAll();
    assert.equal(competition?.entryPrice, 0);
    assert.deepEqual(competition?.categories, ["free"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function competition(id: string, numberOfTickets: string, text: string | null): Record<string, unknown> {
  return {
    id,
    title: id,
    text,
    slug: id,
    new_price: "1",
    ticket_counter: "1",
    ticket_end: "100",
    end_date: "2026-07-31 20:00:00",
    is_instant_win: "0",
    number_of_tickets: numberOfTickets,
    active: "1",
    free: "0",
  };
}
