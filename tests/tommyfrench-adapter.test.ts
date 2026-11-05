import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { parseTommyFrenchDetail } from "../src/adapters/tommyfrench/tommyfrench-adapter.js";

test("Tommy French detail parser reads deterministic raffle economics", () => {
  const row = parseTommyFrenchDetail(
    `
      <body>
        <data id="jsDataRafflePage" data-id="19702" data-price="0.18"></data>
        <h1>July Jumbo Cash</h1>
        <span>ENTRY CLOSES</span>
        <div>Jul 12th <span>|</span> <span>21:30</span></div>
        <span class="font-bold">36099</span> / 749999 Tickets Sold
        Maximum tickets per customer: 500
        <div>Main Prize</div>
        <div>£ 20,000 £20,000</div>
      </body>
    `,
    "https://www.tommyfrenchcompetitions.com/raffle/19702/",
  );

  assert.ok(row);
  assert.equal(row.sourceId, "19702");
  assert.equal(row.name, "July Jumbo Cash");
  assert.equal(row.entryPrice, 0.18);
  assert.equal(row.ticketsSold, 36099);
  assert.equal(row.maxTickets, 749999);
  assert.equal(row.maxEntriesPerUser, 500);
  assert.equal(row.maxEntriesPerUserSource, "site");
  assert.equal(row.cashAlternative, 20000);

  const now = DateTime.now().setZone("Europe/London");
  let expectedDrawDate = DateTime.fromObject(
    { year: now.year, month: 7, day: 12, hour: 21, minute: 30 },
    { zone: "Europe/London" },
  );
  if (expectedDrawDate < now.minus({ days: 1 })) {
    expectedDrawDate = expectedDrawDate.plus({ years: 1 });
  }
  assert.equal(row.drawDate, expectedDrawDate.toUTC().toISO());
});

test("Tommy French detail parser skips already drawn raffles", () => {
  const row = parseTommyFrenchDetail(
    `
      <body>
        <data id="jsDataRafflePage" data-id="18613" data-price="0.39"></data>
        <h1>£25,000 Pay Day Cash</h1>
        RAFFLE NOW DRAWN!
        <span>95857</span> / 110999 Tickets Sold
      </body>
    `,
    "https://www.tommyfrenchcompetitions.com/raffle/18613/",
  );

  assert.equal(row, null);
});

test("Tommy French detail parser keeps non-cash prizes with complete economics", () => {
  const row = parseTommyFrenchDetail(
    `
      <body>
        <data id="jsDataRafflePage" data-id="21386" data-price="0.39"></data>
        <h1>Walking Pad</h1>
        <span>ENTRY CLOSES</span>
        <div>Today <span>|</span> <span>23:45</span></div>
        <div id="raffle-draw-date" data-draw-date="2026-08-12T23:45:00+01:00"></div>
        <span>19</span> / 1499 Tickets Sold
        <aside>Other competitions with Instant Wins</aside>
      </body>
    `,
    "https://www.tommyfrenchcompetitions.com/raffle/21386/",
  );

  assert.ok(row);
  assert.equal(row.sourceId, "21386");
  assert.equal(row.name, "Walking Pad");
  assert.equal(row.entryPrice, 0.39);
  assert.equal(row.ticketsSold, 19);
  assert.equal(row.maxTickets, 1499);
  assert.equal(row.cashAlternative, null);
  assert.equal(row.drawDate, "2026-08-12T22:45:00.000Z");
  assert.deepEqual(row.categories, []);
});

test("Tommy French detail parser prefers the labeled main prize over an aggregate title value", () => {
  const row = parseTommyFrenchDetail(
    `
      <body>
        <data id="jsDataRafflePage" data-id="19867" data-price="0.59"></data>
        <h1>£15,000 Space Race</h1>
        <span>AUTO DRAW</span>
        <div>Jul 9th <span>|</span> <span>23:45</span></div>
        <span>581</span> / 47999 Tickets Sold
        <div>Main Prize</div>
        <div>£ 200 £200</div>
      </body>
    `,
    "https://www.tommyfrenchcompetitions.com/raffle/19867/",
  );

  assert.ok(row);
  assert.equal(row.cashAlternative, 200);
});

test("Tommy French scratch games keep the main prize separate from the instant prize pool", () => {
  const row = parseTommyFrenchDetail(
    `
      <body>
        <data id="jsDataRafflePage" data-id="20593" data-price="1.79"></data>
        <h1>£8000 Cinema Scratch</h1>
        <span>AUTO DRAW</span>
        <div>Jul 20th <span>|</span> <span>23:45</span></div>
        <span>222</span> / 7299 Tickets Sold
        <div>Main Prize</div>
        <div>£ 100</div>
        <div id="howitworks-popup"><h4>Instant Wins</h4></div>
        <div>Instant Prize Pool</div><div>£8,008</div>
      </body>
    `,
    "https://www.tommyfrenchcompetitions.com/raffle/20593/",
  );

  assert.ok(row);
  assert.equal(row.cashAlternative, 100);
  assert.ok(row.categories.includes("instant-win"));
});
