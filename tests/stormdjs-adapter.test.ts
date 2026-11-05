import assert from "node:assert/strict";
import test from "node:test";
import { parseStormDjsGiveaway } from "../src/adapters/stormdjs/stormdjs-adapter.js";

test("Storm DJs parser maps the current capped giveaway", () => {
  const html = `
    <div class="giveaway-hero-status" aria-label="Competition status">
      <span>Entries open</span>
      <span>Competition #43</span>
      <span>Ends 31/08/2026</span>
      <span>700 max entrants</span>
    </div>
    <h1><span>Win your dream</span><strong>DJ setup</strong></h1>
    <p>Choose between high-end DJ bundles or £5,000 tax-free cash.</p>
    <div class="giveaway-hero-progress">
      <strong>26% full</strong>
      <span>179 of 700 max entrants</span>
    </div>
    <div class="giveaway-prize-card"><strong>Worth £7,500</strong><span>Win The Ultimate Pro 2026 CDJ DJ Setup</span></div>
    <div class="giveaway-pack"><strong>Bronze £7</strong><span>1 entry in the main draw</span></div>
  `;

  const rows = parseStormDjsGiveaway(html, new Date("2026-08-26T12:00:00.000Z"));

  assert.deepEqual(rows.map((row) => ({
    sourceId: row.sourceId,
    name: row.name,
    entryPrice: row.entryPrice,
    ticketsSold: row.ticketsSold,
    maxTickets: row.maxTickets,
    cashAlternative: row.cashAlternative,
    estimatedPrizeValue: row.estimatedPrizeValue,
    drawDate: row.drawDate,
  })), [{
    sourceId: "stormdjs-43",
    name: "Win your dream DJ setup",
    entryPrice: 7,
    ticketsSold: 179,
    maxTickets: 700,
    cashAlternative: 5000,
    estimatedPrizeValue: 7500,
    drawDate: "2026-08-31T22:59:59.000Z",
  }]);
});

test("Storm DJs parser ignores closed or incomplete markup", () => {
  assert.deepEqual(parseStormDjsGiveaway(`
    <span>Competition #43</span><span>Ends 31/08/2026</span>
    <span>700 max entrants</span><span>179 of 700 max entrants</span>
    <h1>Win your dream DJ setup</h1>
  `, new Date("2026-09-01T12:00:00.000Z")), []);
});
