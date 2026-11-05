import assert from "node:assert/strict";
import test from "node:test";
import { WeeklyWinAdapter, parseWeeklyWinCompetition } from "../src/adapters/weeklywin/weeklywin-adapter.js";

const detail = `
  <html><body>
    <h1>Chanel Classic Flap Bag</h1>
    <p>Draw closes in: 06 Days 17 Hours 59 Mins 59 Secs</p>
    <p>Tickets remaining47 / 200</p>
    <p>Price per ticket£0.99</p>
    <p>Max 10 per order</p>
    <p>RRP £8,500+</p>
  </body></html>
`;

test("Weekly Win parser maps countdown and exact ticket inventory", () => {
  const scrapedAt = new Date("2026-07-26T09:00:00.000Z");
  const competition = parseWeeklyWinCompetition(
    detail,
    "https://www.theweeklywin.co.uk/competitions/chanel-classic-flap-bag",
    scrapedAt,
  );

  assert.equal(competition?.sourceId, "chanel-classic-flap-bag");
  assert.equal(competition?.entryPrice, 0.99);
  assert.equal(competition?.ticketsSold, 153);
  assert.equal(competition?.maxTickets, 200);
  assert.equal(competition?.maxEntriesPerUser, 10);
  assert.equal(competition?.estimatedPrizeValue, 7225);
  assert.equal(competition?.drawDate, "2026-08-02T02:59:59.000Z");
});

test("Weekly Win adapter fetches the homepage and linked detail page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://www.theweeklywin.co.uk/") {
      return new Response('<a href="/competitions/chanel-classic-flap-bag">Enter</a>', { status: 200 });
    }
    assert.equal(url, "https://www.theweeklywin.co.uk/competitions/chanel-classic-flap-bag");
    return new Response(detail, { status: 200 });
  };

  try {
    const competitions = await new WeeklyWinAdapter().fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.name, "Chanel Classic Flap Bag");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
