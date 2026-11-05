import test from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "../src/adapters/registry.js";
import { parseLakeDistrictDetail } from "../src/adapters/static-list/static-list-adapter.js";

test("Lake District adapter is registered", () => {
  assert.ok(getAdapter("lakedistrict"));
});

test("Lake District parser reads detail-page ticket and draw fields", () => {
  const competition = parseLakeDistrictDetail(
    `
      <h1>Ford Focus RS or £15,000</h1>
      <h2 class="text-primary">£2.50</h2>
      <input class="go_live_date" value="2026-07-26 22:15:00">
      <div>3,154 of 18,999 tickets sold</div>
      <input id="ticketRange" max="250">
    `,
    {
      siteName: "lakedistrict",
      displayName: "Lake District Giveaways",
      baseUrl: "https://lakedistrictgiveaways.co.uk",
      listPath: "/",
      userAgent: "",
    },
    "https://lakedistrictgiveaways.co.uk/competition/ford-focus-rs-or-15-000",
  );

  assert.ok(competition);
  assert.equal(competition.entryPrice, 2.5);
  assert.equal(competition.ticketsSold, 3154);
  assert.equal(competition.maxTickets, 18999);
  assert.equal(competition.cashAlternative, 15000);
  assert.equal(competition.maxEntriesPerUser, 250);
  assert.equal(competition.maxEntriesPerUserSource, "site");
  assert.equal(competition.drawDate, "2026-07-26T21:15:00.000Z");
});
