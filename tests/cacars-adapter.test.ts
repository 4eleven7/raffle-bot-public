import test from "node:test";
import assert from "node:assert/strict";
import { parseCaCarsPage } from "../src/adapters/cacars/cacars-adapter.js";

test("CA Cars parser reads table and progress economics", () => {
  const competition = parseCaCarsPage(
    `
      <h1>40th Birthday Raffle</h1>
      <table>
        <tr><th>Prize</th><td>Hyundai i20 Blackline in Vibrant Blue with dual controls fitted.</td></tr>
        <tr><th>Competition ends</th><td>19/08/2026 23:00:00</td></tr>
        <tr><th>Total tickets</th><td>3000</td></tr>
        <tr><th>Ticket price</th><td>&#xA3;9.99</td></tr>
        <tr><th>Max. tickets per entry</th><td>50</td></tr>
      </table>
      <progress max="3000" value="264"></progress>
      <span>264 sold</span>
      <span>2736 remaining</span>
    `,
    "https://competition-cacars.dotnetcloud.co.uk",
  );

  assert.equal(competition?.siteName, "cacars");
  assert.equal(competition?.name, "40th Birthday Raffle");
  assert.equal(competition?.entryPrice, 9.99);
  assert.equal(competition?.ticketsSold, 264);
  assert.equal(competition?.maxTickets, 3000);
  assert.equal(competition?.maxEntriesPerUser, 50);
  assert.equal(competition?.maxEntriesPerUserSource, "site");
  assert.equal(competition?.estimatedPrizeValue, 20800);
  assert.equal(competition?.valuationSource, "manual_estimate");
  assert.equal(competition?.drawDate, "2026-08-19T22:00:00.000Z");
});

test("CA Cars parser marks a missing labelled cap as fallback", () => {
  const competition = parseCaCarsPage(
    `
      <h1>40th Birthday Raffle</h1>
      <table>
        <tr><th>Prize</th><td>Hyundai i20 Blackline</td></tr>
        <tr><th>Competition ends</th><td>19/08/2026 23:00:00</td></tr>
        <tr><th>Total tickets</th><td>3000</td></tr>
        <tr><th>Ticket price</th><td>&#xA3;9.99</td></tr>
      </table>
      <progress max="3000" value="264"></progress>
    `,
    "https://competition-cacars.dotnetcloud.co.uk",
  );

  assert.equal(competition?.maxEntriesPerUser, 0);
  assert.equal(competition?.maxEntriesPerUserSource, "fallback");
});
