import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseHighlandVaultDetail } from "../src/adapters/direct/highland-vault.js";
import { applyEstimatedValuation } from "../src/valuation/estimate.js";
import { triageRows } from "../src/cli/site-discovery.js";

const html = readFileSync(new URL("../fixtures/highlandvault/talisker.html", import.meta.url), "utf8");
const url = "https://highlandvault.com/product/talisker-skye-talisker-bag-vault-raid/";
const now = new Date("2026-10-30T14:00:00Z");

test("Highland Vault standalone draw retains exact economics and one-ticket potential", () => {
  const raw = parseHighlandVaultDetail(html, url, now);
  assert.ok(raw);
  assert.equal(raw.sourceId, "378275");
  assert.equal(raw.entryPrice, 3);
  assert.equal(parseHighlandVaultDetail(html.replace('data-price-amount="3"', 'data-price-amount="4"'), url, now)?.entryPrice, 4);
  assert.equal(raw.ticketsSold, 2);
  assert.equal(raw.maxTickets, 32);
  assert.equal(raw.inventorySource, "exact");
  assert.equal(raw.drawDate, "2026-10-30T21:21:00.000Z");
  assert.equal(raw.maxEntriesPerUserSource, "fallback");
  assert.equal(raw.maxEntriesPerUser, 1);
  const row = triageRows([applyEstimatedValuation(raw)], now).rows[0];
  assert.equal(row.current.recommendation.stars, 0);
  assert.equal(row.potential.recommendation.stars, 1);
  assert.equal(row.potential.recommendation.currentScenario.tickets, 1);
});

test("Highland Vault refuses incomplete counts, closed draws and mixed prize formats", () => {
  assert.equal(parseHighlandVaultDetail(html.replace("32 total", "94% remaining"), url, now), null);
  assert.equal(parseHighlandVaultDetail(html.replace('data-price-amount="3"', 'data-price-amount=""'), url, now), null);
  assert.equal(parseHighlandVaultDetail(html.replace("Tickets sold: 2", "Tickets sold: 33"), url, now), null);
  assert.equal(parseHighlandVaultDetail(html.replace(/NO INSTANT WINS/gi, "INSTANT WINS"), url, now), null);
  assert.equal(parseHighlandVaultDetail(html.replace(/GUARANTEED WINNER/gi, "Draw subject to sales"), url, now), null);
  assert.equal(parseHighlandVaultDetail(html, url, new Date("2026-10-30T21:22:00Z")), null);
});
