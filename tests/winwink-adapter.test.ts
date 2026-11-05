import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCompetitionLinks,
  parseWinWinkDetail,
  WinWinkAdapter,
} from "../src/adapters/winwink/winwink-adapter.js";

test("WinWink parser extracts direct detail economics", () => {
  const row = parseWinWinkDetail(
    `
      <html>
        <body>
          <nav>Competitions › Gaming › GTA VI Pre-Order & Console Bundle! £10,000 Gaming Prizes</nav>
          <h1>GTA VI Pre-Order & Console Bundle! £10,000 Gaming Prizes</h1>
          <section>
            Draws Friday, July 3, 2026 at 11:59 PM
            Sales progress 157 / 550 (29%)
            Ticket price £1.98
            Maximum 82 tickets per person
            ★ GRAND PRIZE ★
            GTA VI Digital Pre-Order + Xbox Series X OR PlayStation 5
            Prize value £530
            Instant wins 10 Instant Wins Remaining
          </section>
        </body>
      </html>
    `,
    "https://winwink.co.uk/competitions/gta-vi-pre-order-console-bundle-ps10000-gaming-prizes",
    "2026-07-02T08:00:00.000Z",
  );

  assert.ok(row);
  assert.equal(row.sourceId, "gta-vi-pre-order-console-bundle-ps10000-gaming-prizes");
  assert.equal(row.siteName, "winwink");
  assert.equal(row.entryPrice, 1.98);
  assert.equal(row.ticketsSold, 157);
  assert.equal(row.maxTickets, 550);
  assert.equal(row.maxEntriesPerUser, 82);
  assert.equal(row.maxEntriesPerUserSource, "site");
  assert.equal(row.cashAlternative, null);
  assert.equal(row.estimatedPrizeValue, 530);
  assert.equal(row.valuationSource, "site_estimate");
  assert.equal(row.drawDate, "2026-07-03T22:59:00.000Z");
  assert.equal(row.isAutoDraw, true);
  assert.deepEqual(row.categories, ["gaming"]);
});

test("WinWink parser rejects closed sales", () => {
  const row = parseWinWinkDetail(
    `
      <body>
        <h1>Closed Draw</h1>
        Sales progress 4,989 / 40,000 (12%)
        Ticket price £0.50
        Sales closed · Awaiting draw
        Draws Wednesday, July 1, 2026 at 8:00 PM
        Prize value £530
      </body>
    `,
    "https://winwink.co.uk/competitions/closed-draw",
    "2026-07-02T08:00:00.000Z",
  );

  assert.equal(row, null);
});

test("WinWink parser does not treat instant-win cash text as main cash prize", () => {
  const row = parseWinWinkDetail(
    `
      <body>
        <nav>Competitions › Featured › PIKACHU RTX 5070Ti GAMING PC! £100,000 Gaming & Cash Instant Wins!</nav>
        <h1>PIKACHU RTX 5070Ti GAMING PC! £100,000 Gaming & Cash Instant Wins!</h1>
        Draws Sunday, August 2, 2026 at 8:00 PM
        Sales progress 3,117 / 200,000 (2%)
        Ticket price £0.99
        Prize value £2,000
      </body>
    `,
    "https://winwink.co.uk/competitions/pikachu-rtx-5070ti-gaming-pc-ps100000-gaming-cash-instant-wins",
    "2026-07-02T08:00:00.000Z",
  );

  assert.ok(row);
  assert.equal(row.maxEntriesPerUser, 100);
  assert.equal(row.maxEntriesPerUserSource, "fallback");
  assert.equal(row.cashAlternative, null);
  assert.equal(row.estimatedPrizeValue, 2000);
  assert.equal(row.valuationSource, "site_estimate");
});

test("WinWink adapter follows unique competition links from homepage", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://winwink.co.uk/competitions/warhammer-armageddon-bundle";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://winwink.co.uk") {
      return new Response(
        `
          <a href="${detailUrl}">Warhammer</a>
          <a href="/competitions/warhammer-armageddon-bundle">Warhammer duplicate</a>
          <a href="/competitions">All competitions</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === detailUrl) {
      return new Response(
        `
          <body>
            <nav>Competitions › Warhammer › Warhammer ARMAGEDDON Bundle</nav>
            <h1>Warhammer ARMAGEDDON Bundle! £10,000 Warhammer Prizes</h1>
            Draws Friday, July 3, 2026 at 11:59 PM
            Sales progress 6,299 / 40,000 (16%)
            Ticket price £0.50
            Maximum 6,000 tickets per person
            Prize value £1,000
          </body>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    assert.deepEqual(parseCompetitionLinks(`<a href="${detailUrl}">A</a><a href="${detailUrl}">B</a>`), [detailUrl]);
    const rows = await new WinWinkAdapter().fetchAll();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceId, "warhammer-armageddon-bundle");
    assert.equal(rows[0]?.entryPrice, 0.5);
    assert.equal(rows[0]?.cashAlternative, null);
    assert.equal(rows[0]?.estimatedPrizeValue, 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
