import assert from "node:assert/strict";
import test from "node:test";
import { parseTopDrawDetail } from "../src/adapters/topdraw/topdraw-adapter.js";

test("TopDraw parser reads current RSC competition economics", () => {
  const competition = parseTopDrawDetail(
    String.raw`<script>{"competition":{"id":"abc","title":"Win a Dyson Airwrap","prize_value":399,"ticket_price":0.99,"cash_alternative":350,"max_entries":800,"current_entries":21,"per_user_entry_limit":0,"status":"live","category":"Beauty","draw_method":"Server-side cryptographic draw","draw_at":"2026-07-25T19:30:00+00:00"},"tiers":[]}</script>`,
    "https://topdrawcompetitions.co.uk/competitions/win-a-dyson-airwrap-for-just-99p",
    "2026-07-22T09:00:00.000Z",
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "abc");
  assert.equal(competition.entryPrice, 0.99);
  assert.equal(competition.ticketsSold, 21);
  assert.equal(competition.maxTickets, 800);
  assert.equal(competition.cashAlternative, 350);
  assert.equal(competition.drawDate, "2026-07-25T19:30:00.000Z");
});
