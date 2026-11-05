import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { parseAshleyRaffle } from "../src/adapters/ashley/ashley-adapter.js";
import { parseDiamondDraw } from "../src/adapters/diamond/diamond-adapter.js";
import { parseLowCostCompetition } from "../src/adapters/lowcost/lowcost-adapter.js";
import { parseLuxeroCompetition } from "../src/adapters/luxero/luxero-adapter.js";
import { parseMatrixCompetition } from "../src/adapters/matrix/matrix-adapter.js";

const FUTURE_DRAW_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const FUTURE_DRAW_DATE_ISO = FUTURE_DRAW_DATE.toISOString();
const FUTURE_DRAW_DATE_ONLY = DateTime.fromJSDate(FUTURE_DRAW_DATE, { zone: "Europe/London" }).toISODate()!;
const FUTURE_DRAW_DATE_LABEL = DateTime.fromISO(FUTURE_DRAW_DATE_ONLY, { zone: "Europe/London" })
  .toFormat("d LLL")
  .toUpperCase();

test("Ashley Automotive parser extracts the embedded draw date and ticket pool", () => {
  const competition = parseAshleyRaffle(
    `<main><h1>WIN - Synch Super Monkey Pro - Electric Bike</h1>
      <p>697 / 2,500</p><p>£2.49/ticket</p><p>Max 500 tickets per person</p>
      <script>"${FUTURE_DRAW_DATE_ISO.replace("Z", "000Z")}"</script></main>`,
    "https://www.ashleyautomotivecomps.co.uk/raffles/electric-bike",
  );

  assert.equal(competition?.name, "WIN - Synch Super Monkey Pro - Electric Bike");
  assert.equal(competition?.ticketsSold, 697);
  assert.equal(competition?.maxTickets, 2500);
  assert.equal(competition?.entryPrice, 2.49);
  assert.equal(competition?.maxEntriesPerUser, 500);
  assert.equal(competition?.drawDate, FUTURE_DRAW_DATE_ISO);
});

test("Diamond Draws parser combines the page date with the displayed end time", () => {
  const competition = parseDiamondDraw(
    `<main><h1>Canonball Cash</h1>
      <p>£0.59 per ticket</p><p>ENDS ${FUTURE_DRAW_DATE_LABEL} • 8:30PM</p>
      <p>117,361 / 299,999 ONLINE</p><p>MAX 14,999 TICKETS PER PLAYER</p>
      <p>INSTANT WINS up to £5,000</p><div>${FUTURE_DRAW_DATE_ONLY}</div></main>`,
    "https://diamonddraws.com/competitions/canonball-cash",
  );

  assert.equal(competition?.ticketsSold, 117361);
  assert.equal(competition?.maxTickets, 299999);
  assert.equal(competition?.entryPrice, 0.59);
  assert.equal(competition?.maxEntriesPerUser, 14999);
  assert.equal(
    competition?.drawDate,
    DateTime.fromISO(FUTURE_DRAW_DATE_ONLY, { zone: "Europe/London" })
      .set({ hour: 20, minute: 30, second: 0, millisecond: 0 })
      .toUTC()
      .toISO(),
  );
  assert.equal(competition?.estimatedPrizeValue, 5000);
});

test("Low Cost parser extracts the explicit end date and credit limit", () => {
  const competition = parseLowCostCompetition(
    `<main><h1>Mega MTG 10k Mash up! v2</h1>
      <p>TICKETS SOLD 2,797 / 20,000</p><p>TICKET PRICE £0.99</p>
      <p>END DATE 7 August 2026 at 19:30</p><p>MAX PER USER 500</p>
      <p>END PRIZE Hobbit Bundle box</p><p>£60 Credit Alt</p></main>`,
    "https://lowcostcompetitions.co.uk/competitions/mega-mtg-10k-mash-up-v2",
  );

  assert.equal(competition?.ticketsSold, 2797);
  assert.equal(competition?.maxTickets, 20000);
  assert.equal(competition?.entryPrice, 0.99);
  assert.equal(competition?.maxEntriesPerUser, 500);
  assert.equal(competition?.estimatedPrizeValue, 42);
  assert.equal(competition?.drawDate, "2026-08-07T18:30:00.000Z");
});

test("Luxero parser extracts cash alternatives and explicit draw dates", () => {
  const competition = parseLuxeroCompetition(
    `<main><h1>Cupra Formentor 2022 + £20,000 Cash Alternative</h1>
      <p>£0.99 / Ticket</p><p>Tickets sold 94 / 59,900</p>
      <p>Up to 1,000 tickets per person</p><p>Draw on 14 August 2026 at 09:59</p></main>`,
    "https://www.luxero.win/en/competitions/cupra-formentor-2022-1500-cash",
  );

  assert.equal(competition?.ticketsSold, 94);
  assert.equal(competition?.maxTickets, 59900);
  assert.equal(competition?.entryPrice, 0.99);
  assert.equal(competition?.maxEntriesPerUser, 1000);
  assert.equal(competition?.cashAlternative, 20000);
  assert.equal(competition?.drawDate, "2026-08-14T08:59:00.000Z");
});

test("Matrix parser extracts operator prize value and scheduled draw", () => {
  const competition = parseMatrixCompetition(
    `<main><h1>Spa Break for 2</h1><p>177 / 1,000</p><p>18% sold</p>
      <p>Max Per Person:250</p><p>Prize Value:£500</p><p>£1 PER ENTRY</p>
      <p>Draw scheduled for 31st July 2026 at 8:00 PM</p></main>`,
    "https://matrixcompetitions.co.uk/competition/spa-break-for-2-mripm2l2",
  );

  assert.equal(competition?.ticketsSold, 177);
  assert.equal(competition?.maxTickets, 1000);
  assert.equal(competition?.entryPrice, 1);
  assert.equal(competition?.maxEntriesPerUser, 250);
  assert.equal(competition?.estimatedPrizeValue, 500);
  assert.equal(competition?.drawDate, "2026-07-31T19:00:00.000Z");
});
