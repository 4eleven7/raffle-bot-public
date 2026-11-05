import test from "node:test";
import assert from "node:assert/strict";
import { parseLexeraHtml } from "../src/adapters/lexera/lexera-adapter.js";
import { parseRoyalWinHtml } from "../src/adapters/royalwin/royalwin-adapter.js";

function nextFlightHtml(value: unknown): string {
  const payload = JSON.stringify(value);
  return `<script>self.__next_f.push([1,${payload}])</script>`;
}

test("Lexera parser reads live Next payload economics and ignores closed rows", () => {
  const competitions = [
    {
      slug: "cash",
      title: "Win £2,000 Cash Tax Free",
      category: "Cash",
      prizeValue: "£2,000",
      entryPrice: "£0.70",
      totalTickets: 5800,
      soldTickets: 369,
      status: "Live",
      drawDate: "2026-08-15T17:00:00+00:00",
      maxEntriesPerUser: 1000,
      cashAlternativeEnabled: true,
      cashAlternativeValuePence: 200000,
      freeEntryAvailable: true,
    },
    {
      slug: "closed",
      title: "Closed Prize",
      category: "Tech",
      prizeValue: "£500",
      entryPrice: "£0.20",
      totalTickets: 1000,
      soldTickets: 5,
      status: "Closed",
      drawDate: "2026-08-15T17:00:00+00:00",
    },
  ];
  const html = nextFlightHtml(
    `1:["$","$L1",null,{"competitions":${JSON.stringify(competitions)}}]`,
  );

  const [competition] = parseLexeraHtml(html, new Date("2026-07-27T09:00:00.000Z"));
  assert.ok(competition);
  assert.equal(competition.sourceId, "cash");
  assert.equal(competition.url, "https://www.lexera.co.uk/competitions/cash");
  assert.equal(competition.entryPrice, 0.7);
  assert.equal(competition.ticketsSold, 369);
  assert.equal(competition.maxTickets, 5800);
  assert.equal(competition.cashAlternative, 2000);
  assert.equal(competition.drawDate, "2026-08-15T17:00:00.000Z");
});

test("Royal Win parser reads active GBP draws from the SSR payload", () => {
  const html = nextFlightHtml(
    `7:["$","$L12",null,{"initialDraws":[
      {"id":"draw-1","title":"Win a trip to Tel Aviv!","category":"TRAVEL","estimatedValue":18000,"ticketPrice":50,"currency":"GBP","totalTickets":500,"soldTickets":25,"maxTicketsPerUser":50,"endDate":"2026-08-02T19:00:00.000Z","drawDate":"2026-08-02T19:00:00.000Z","status":"ACTIVE"},
      {"id":"closed","title":"Closed draw","estimatedValue":100,"ticketPrice":1,"currency":"GBP","totalTickets":100,"soldTickets":5,"drawDate":"2026-07-01T19:00:00.000Z","status":"CLOSED"}
    ]}]`,
  );

  const [competition] = parseRoyalWinHtml(html, new Date("2026-07-27T09:00:00.000Z"));
  assert.ok(competition);
  assert.equal(competition.sourceId, "draw-1");
  assert.equal(competition.url, "https://royalwin.co.uk/draws/draw-1");
  assert.equal(competition.entryPrice, 50);
  assert.equal(competition.ticketsSold, 25);
  assert.equal(competition.maxTickets, 500);
  assert.equal(competition.maxEntriesPerUser, 50);
  assert.equal(competition.estimatedPrizeValue, 18000);
  assert.equal(competition.drawDate, "2026-08-02T19:00:00.000Z");
});
