import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { DEFAULT_CONFIG, loadConfigFromPath } from "../src/config.js";

test("local config overrides nested defaults without replacing whole sections", () => {
  const dir = mkdtempSync(join(tmpdir(), "raffle-bot-config-"));
  const configPath = join(dir, "raffle-bot.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      monitor: {
        scanConcurrency: 2,
        siteIntervalMultipliers: {
          heavy: 3,
        },
      },
      filters: {
        maxSpend: 250,
      },
      storage: {
        snapshotRetentionMs: 14 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  const config = loadConfigFromPath(configPath);

  assert.equal(config.monitor.scanConcurrency, 2);
  assert.equal(config.monitor.defaultIntervalMs, DEFAULT_CONFIG.monitor.defaultIntervalMs);
  assert.equal(config.monitor.siteIntervalMultipliers.heavy, 3);
  assert.equal(config.filters.maxSpend, 250);
  assert.equal(config.filters.minWinProbability, DEFAULT_CONFIG.filters.minWinProbability);
  assert.equal(config.storage.snapshotRetentionMs, 14 * 24 * 60 * 60 * 1000);
  assert.equal(config.storage.snapshotPruneBatchSize, DEFAULT_CONFIG.storage.snapshotPruneBatchSize);
});
