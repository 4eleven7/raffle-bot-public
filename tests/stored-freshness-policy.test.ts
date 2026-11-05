import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { isFreshStoredCompetition } from "../src/cli/freshness.js";

const now = new Date("2026-07-20T10:00:00.000Z").getTime();

test("stored opportunity output excludes stale and invalid scrape timestamps", () => {
  assert.equal(isFreshStoredCompetition({
    scrapedAt: new Date(now - CONFIG.filters.maxStoredCompetitionAgeMs).toISOString(),
  }, now), true);
  assert.equal(isFreshStoredCompetition({
    scrapedAt: new Date(now - CONFIG.filters.maxStoredCompetitionAgeMs - 1).toISOString(),
  }, now), false);
  assert.equal(isFreshStoredCompetition({ scrapedAt: "not-a-date" }, now), false);
  assert.equal(isFreshStoredCompetition({
    scrapedAt: new Date(now + 6 * 60 * 1000).toISOString(),
  }, now), false);
});
