import test from "node:test";
import assert from "node:assert/strict";
import { parseRaffleRevolutionDetail } from "../src/adapters/rafflerevolution/rafflerevolution-adapter.js";

test("Raffle Revolution marks only its per-player label as site-proven", () => {
  const site = parseRaffleRevolutionDetail(detail("Max 10 tickets per player"), "https://rafflerevolution.com/competitions/site-cap");
  const fallback = parseRaffleRevolutionDetail(detail(""), "https://rafflerevolution.com/competitions/fallback-cap");

  assert.equal(site?.maxEntriesPerUser, 10);
  assert.equal(site?.maxEntriesPerUserSource, "site");
  assert.equal(fallback?.maxEntriesPerUser, 100);
  assert.equal(fallback?.maxEntriesPerUserSource, "fallback");
});

function detail(cap: string): string {
  return `<h1 class="rr-product-title">£500 Cash</h1><p>1 / 100 SOLD Entry £1 Live Draw 31/07/2026 ${cap}</p>`;
}
