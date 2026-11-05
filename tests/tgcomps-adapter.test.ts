import assert from "node:assert/strict";
import test from "node:test";
import { parseTGCompsPack } from "../src/adapters/tgcomps/tgcomps-adapter.js";

test("TGComps maps the public raffle pack economics without guessing", () => {
  const row = parseTGCompsPack(
    {
      id: "8c249617-e5fd-40b8-bed4-d96b46dd5f06",
      code: "GAMINGPC",
      pack_name: "Custom Gaming PC — HYTE Y60 Snow · RTX 5060 Ti",
      pack_value: 1599,
      ticket_price: 4,
      total_entry_limit: 999,
      paid_entries: 0,
      free_entries: 0,
      status: "active",
      draw_date: "2099-08-16T19:00:00+00:00",
      cash_prize_cap: 1250,
      max_paid_per_user: 99,
      category: "Gaming",
    },
    "2099-01-01T00:00:00.000Z",
  );

  assert.ok(row);
  assert.equal(row.siteName, "tgcomps");
  assert.equal(row.url, "https://tgcomps.com/raffle/gamingpc");
  assert.equal(row.entryPrice, 4);
  assert.equal(row.ticketsSold, 0);
  assert.equal(row.maxTickets, 999);
  assert.equal(row.cashAlternative, 1250);
  assert.equal(row.estimatedPrizeValue, 1599);
  assert.equal(row.maxEntriesPerUser, 99);
  assert.equal(row.maxEntriesPerUserSource, "site");
  assert.equal(row.drawDate, "2099-08-16T19:00:00.000Z");
  assert.deepEqual(row.categories, ["gaming"]);
});

test("TGComps rejects active records without a future deterministic draw", () => {
  const row = parseTGCompsPack({
    code: "MISSING-DATE",
    pack_name: "Incomplete giveaway",
    pack_value: 100,
    ticket_price: 1,
    total_entry_limit: 100,
    paid_entries: 0,
    free_entries: 0,
    status: "active",
  });

  assert.equal(row, null);
});

test("TGComps retains conditional payout terms and rejects missing inventory", () => {
  const input={code:"LOT-004",pack_name:"The Rocket Ripper",pack_value:250,ticket_price:.19,total_entry_limit:6580,paid_entries:298,free_entries:91,status:"active",draw_date:"2099-10-26T19:00:00Z",min_sellout:2631,alt_prize_description:"50% of competition revenue if reserve is not met",cash_prize_cap:200};
  const row=parseTGCompsPack(input);
  assert.ok(row);
  assert.equal(row.ticketsSold,389);
  assert.equal(row.prizePayout?.kind,"conditional");
  assert.match(row.prizeEvidence ?? "",/50% of competition revenue/);
  assert.equal(parseTGCompsPack({...input,paid_entries:undefined}),null);
  assert.equal(parseTGCompsPack({...input,free_entries:-1}),null);
});
