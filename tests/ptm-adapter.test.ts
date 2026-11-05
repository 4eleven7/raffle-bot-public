import assert from "node:assert/strict";
import test from "node:test";
import { PtmAdapter } from "../src/adapters/ptm/ptm-adapter.js";

test("PTM adapter pages past stale rows and maps live competition economics", async () => {
  const originalFetch = globalThis.fetch;
  const nowSeconds = Math.floor(Date.now() / 1000);

  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const page = url.searchParams.get("page");

    if (url.origin !== "https://api.ptmprizes.co.uk" || url.pathname !== "/competitions") {
      return new Response("not found", { status: 404 });
    }

    if (page === "1") {
      return Response.json({
        data: [
          {
            id: 1,
            title: "ENDED VAN OR £25K",
            url: "ended-van",
            price: 0.99,
            ticket_sold: 10,
            ticket_maximum: 100,
            draw_date: nowSeconds - 60,
            has_ended: true,
          },
        ],
        total_pages: 2,
      });
    }

    return Response.json({
      data: [
        {
          id: 5745,
          title: "MILWAUKEE MADNESS OVER 2000 INSTANT WINS!",
          url: "milwaukee-madness--5745",
          price: 0.37,
          ticket_sold: 106073,
          ticket_maximum: 750000,
          purchase_qty_maximum: 5000,
          draw_date: nowSeconds + 3600,
          has_ended: false,
          is_sold_out: false,
          auto_draw: false,
        },
        {
          id: 5723,
          title: "ULTIMATE VAN AND TOOLS OR £60K",
          url: "ultimate-van-tools",
          price: "0.99",
          ticket_sold: "319460",
          ticket_maximum: "497500",
          purchase_qty_maximum: "4000",
          draw_date: String(nowSeconds + 7200),
          has_ended: false,
          is_sold_out: false,
        },
      ],
      total_pages: 2,
    });
  };

  try {
    const competitions = await new PtmAdapter().fetchAll();

    assert.equal(competitions.length, 2);
    assert.equal(competitions[0]?.sourceId, "5745");
    assert.equal(competitions[0]?.url, "https://ptmprizes.co.uk/milwaukee-madness--5745.htm");
    assert.equal(competitions[0]?.entryPrice, 0.37);
    assert.equal(competitions[0]?.ticketsSold, 106073);
    assert.equal(competitions[0]?.maxTickets, 750000);
    assert.equal(competitions[0]?.maxEntriesPerUser, 5000);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.deepEqual(competitions[0]?.categories, ["api", "tools", "instant-win"]);
    assert.equal(competitions[1]?.cashAlternative, 60000);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "site");
    assert.deepEqual(competitions[1]?.categories, ["api", "vehicle", "tools", "cash"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
