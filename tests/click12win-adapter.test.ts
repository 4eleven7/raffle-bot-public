import test from "node:test";
import assert from "node:assert/strict";
import { Click12WinAdapter } from "../src/adapters/click12win/click12win-adapter.js";

test("Click12Win marks only explicit API order or user caps as site-proven", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    success: true,
    data: [competition("site-cap", 25), competition("fallback-cap", null)],
  });

  try {
    const competitions = await new Click12WinAdapter({
      siteName: "test-click12",
      displayName: "Test Click12",
      baseUrl: "https://example.test",
      apiBaseUrl: "https://api.example.test",
      userAgent: "test",
    }).fetchAll();
    assert.equal(competitions[0]?.maxEntriesPerUser, 25);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.equal(competitions[1]?.maxEntriesPerUser, 100);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function competition(slug: string, cap: number | null): Record<string, unknown> {
  return {
    slug,
    title: slug,
    status: "ACTIVE",
    pricePerTicket: 1,
    endDate: "2026-07-31T20:00:00.000Z",
    maxTickets: 100,
    ticketsSold: 1,
    maxTicketsPerOrder: cap,
  };
}
