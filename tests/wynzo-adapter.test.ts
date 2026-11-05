import assert from "node:assert/strict";
import test from "node:test";
import { parseWynzoCompetition } from "../src/adapters/wynzo/wynzo-adapter.js";

test("Wynzo maps the public Supabase record without guessing required economics", () => {
    const row = parseWynzoCompetition(
      {
        id: "competition-1",
        slug: "apple-iphone-17-pro-test",
        title: "Apple iPhone 17 Pro",
        category: "Tech",
        ticket_price_pence: 299,
        cash_alternative_pence: 700,
        total_tickets: 999,
        tickets_sold: 129,
        max_tickets_per_user: 100,
        status: "live",
        draw_at: "2099-07-23T19:00:00+00:00",
      },
      "2099-01-01T00:00:00.000Z",
    );

    assert.ok(row);
    assert.equal(row.siteName, "wynzo");
    assert.equal(row.url, "https://wynzo.co.uk/competition/apple-iphone-17-pro-test");
    assert.equal(row.entryPrice, 2.99);
    assert.equal(row.ticketsSold, 129);
    assert.equal(row.maxTickets, 999);
    assert.equal(row.cashAlternative, 700);
    assert.equal(row.estimatedPrizeValue, 700);
    assert.equal(row.maxEntriesPerUser, 100);
    assert.equal(row.drawDate, "2099-07-23T19:00:00.000Z");
});
