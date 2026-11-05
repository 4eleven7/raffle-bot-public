import test from "node:test";
import assert from "node:assert/strict";
import {
  mapWithConcurrency,
  normalizeConcurrency,
} from "../src/utils/concurrency.js";

test("normalizeConcurrency falls back for invalid values and floors valid values", () => {
  assert.equal(normalizeConcurrency(undefined, 6), 6);
  assert.equal(normalizeConcurrency(Number.NaN, 6), 6);
  assert.equal(normalizeConcurrency(0, 6), 1);
  assert.equal(normalizeConcurrency(-3, 6), 1);
  assert.equal(normalizeConcurrency(2.9, 6), 2);
});

test("mapWithConcurrency preserves input order while bounding active workers", async () => {
  let active = 0;
  let maxActive = 0;

  const results = await mapWithConcurrency([3, 1, 2, 4], 2, async (value) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, value));
    active -= 1;
    return value * 10;
  });

  assert.deepEqual(results, [30, 10, 20, 40]);
  assert.equal(maxActive, 2);
});

test("mapWithConcurrency returns an empty array for empty input", async () => {
  assert.deepEqual(await mapWithConcurrency([], 3, async () => "unused"), []);
});
