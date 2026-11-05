import test from "node:test";
import assert from "node:assert/strict";
import { parseOddsUpHtml } from "../src/adapters/oddsup/oddsup-adapter.js";

function nextFlightHtml(value: unknown): string {
  const payload = JSON.stringify(value);
  return `<script>self.__next_f.push([1,${payload}])</script>`;
}

test("Odds Up parser reads exact active inventory and ignores closed rows", () => {
  const html = nextFlightHtml(
    `1:["$","$L1c",null,{"competitions":${JSON.stringify([
      {
        id: "ps5-id",
        title: "Win a PS5 Disc Console",
        category: "tech",
        prize_value: 569.99,
        ticket_price: 2.99,
        total_tickets: 320,
        tickets_sold: 3,
        status: "active",
        max_tickets_per_user: 15,
        max_entries_per_user: null,
        prize_type: "physical",
        is_free_entry: false,
        draw_date: null,
        scheduled_draw_at: null,
        ends_at: "2026-10-31T23:59:00+00:00",
      },
      {
        id: "cash-id",
        title: "Win £500 Cash",
        category: "cash",
        prize_value: 500,
        ticket_price: 2.49,
        total_tickets: 330,
        tickets_sold: 35,
        status: "active",
        max_tickets_per_user: 15,
        ends_at: "2026-10-31T23:59:00+00:00",
      },
      {
        id: "closed-id",
        title: "Closed prize",
        category: "tech",
        prize_value: 100,
        ticket_price: 1,
        total_tickets: 100,
        tickets_sold: 10,
        status: "completed",
        ends_at: "2026-10-01T23:59:00+00:00",
      },
    ])}}]`,
  );

  const competitions = parseOddsUpHtml(html, new Date("2026-10-10T08:00:00.000Z"));

  assert.equal(competitions.length, 2);
  assert.equal(competitions[0]?.sourceId, "ps5-id");
  assert.equal(competitions[0]?.url, "https://www.oddsup.co.uk/competitions/ps5-id");
  assert.equal(competitions[0]?.inventorySource, "exact");
  assert.equal(competitions[0]?.ticketsSold, 3);
  assert.equal(competitions[0]?.maxTickets, 320);
  assert.equal(competitions[0]?.maxEntriesPerUser, 15);
  assert.equal(competitions[0]?.drawDate, "2026-10-31T23:59:00.000Z");
  assert.equal(competitions[0]?.isAutoDraw, true);
  assert.equal(competitions[1]?.cashAlternative, 500);
  assert.equal(competitions[1]?.valuationSource, "cash");
});
