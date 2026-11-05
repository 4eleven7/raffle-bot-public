import assert from "node:assert/strict";
import test from "node:test";
import { EmpireCompetitionsUkAdapter } from "../src/adapters/empirecompetitionsuk/empirecompetitionsuk-adapter.js";

test("Empire Competitions UK parses exact live rows from the public payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://empirecompetitionsuk.com/");
    return new Response(
      `<script>
        self.$R={matches:$R[1]=[$R[2]={id:"live-1",slug:"2000-tui-holiday-evoucher",title:"£2,000 TUI Holiday E-Voucher",description:"Win a £2,000 TUI Holiday E-Voucher.",ticket_price:20,total_tickets:189,tickets_sold:0,tickets_remaining:189,draw_date:"2099-08-31T22:59:00+00:00",end_date:"2099-08-31T22:59:00+00:00",status:"live",prize_value:"£2,000",category:"Holiday",badge:"Low Odds"},$R[3]={id:"closed-1",slug:"old",title:"Old draw",ticket_price:1,total_tickets:10,tickets_sold:2,tickets_remaining:8,draw_date:"2026-08-01T22:59:00+00:00",end_date:"2026-08-01T22:59:00+00:00",status:"closed",prize_value:"£10",category:"Cash"}]};
      </script>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const competitions = await new EmpireCompetitionsUkAdapter().fetchAll();

    assert.equal(competitions.length, 1);
    assert.deepEqual(competitions[0], {
      sourceId: "live-1",
      siteName: "empirecompetitionsuk",
      url: "https://empirecompetitionsuk.com/competitions/2000-tui-holiday-evoucher",
      name: "£2,000 TUI Holiday E-Voucher",
      entryPrice: 20,
      ticketsSold: 0,
      maxTickets: 189,
      inventorySource: "exact",
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      estimatedPrizeValue: 2000,
      valuationSource: "site_estimate",
      valuationConfidence: "high",
      valuationNotes: "Empire Competitions UK public prize value.",
      drawDate: "2099-08-31T22:59:00.000Z",
      isAutoDraw: false,
      categories: ["holiday"],
      scrapedAt: competitions[0]?.scrapedAt,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
