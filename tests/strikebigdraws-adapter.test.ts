import test from "node:test";
import assert from "node:assert/strict";
import { parseStrikeBigDrawDetail } from "../src/adapters/strikebigdraws/strikebigdraws-adapter.js";

test("Strike Big Draws marks only its explicit per-user label as site-proven", () => {
  const site = parseStrikeBigDrawDetail(detail("Max 10 per user"), "https://strikebigdraws.com/competition/site-cap");
  const fallback = parseStrikeBigDrawDetail(detail(""), "https://strikebigdraws.com/competition/fallback-cap");

  assert.equal(site?.maxEntriesPerUser, 10);
  assert.equal(site?.maxEntriesPerUserSource, "site");
  assert.equal(fallback?.maxEntriesPerUser, 100);
  assert.equal(fallback?.maxEntriesPerUserSource, "fallback");
});

function detail(cap: string): string {
  return `<h1>£500 Cash</h1> <p>Sold 1 / 100 £1 per entry Draw On Mon Jul 27th 8:30pm ${cap}</p>`;
}
