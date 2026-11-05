import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { registerAdapter } from "../src/adapters/registry.js";
import { runScan } from "../src/cli/scan.js";
import {
  closeDatabaseForTests,
  getCompetition,
  useDatabaseForTests,
} from "../src/storage/database.js";
import type { RawCompetition } from "../src/types.js";

function useTempDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "raffle-bot-scan-"));
  useDatabaseForTests(join(dir, "test.db"));
}

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "comp-1",
    siteName: "json-test",
    url: "https://example.test/comp-1",
    name: "JSON Test Competition",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "site",
    cashAlternative: 500,
    drawDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += chunk.toString();
    const callback = args.find((arg): arg is (error?: Error | null) => void => typeof arg === "function");
    callback?.();
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

test("scan JSON output is parseable stdout without progress text", async () => {
  useTempDb();
  registerAdapter({
    siteName: "json-test",
    async fetchAll() {
      return [competition()];
    },
  }, "https://json-test.example");

  try {
    const output = await captureStdout(async () => {
      await runScan({ site: "json-test", json: true });
    });

    const parsed = JSON.parse(output) as RawCompetition[];
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.sourceId, "comp-1");
  } finally {
    closeDatabaseForTests();
  }
});

test("single-site scan persists results and renders summary/table output", async () => {
  useTempDb();
  registerAdapter({
    siteName: "single-scan-test",
    async fetchAll() {
      return [competition({
        siteName: "single-scan-test",
        name: "Single Site Competition",
      })];
    },
  }, "https://single-scan-test.example");

  try {
    const output = await captureStdout(async () => {
      await runScan({ site: "single-scan-test", limit: 5 });
    });

    assert.match(output, /Scanning 1 sites \(1 parallel\)/);
    assert.match(output, /single-scan-test/);
    assert.match(output, /Site health/);
    assert.match(output, /Scan Complete/);
    assert.match(output, /Single Site Competition/);
    assert.equal(
      getCompetition("comp-1", "single-scan-test")?.name,
      "Single Site Competition",
    );
  } finally {
    closeDatabaseForTests();
  }
});

test("scan sorting, EV filter, and limit shape visible output", async () => {
  useTempDb();
  registerAdapter({
    siteName: "filter-scan-test",
    async fetchAll() {
      return [
        competition({
          sourceId: "low",
          siteName: "filter-scan-test",
          name: "Low EV Competition",
          cashAlternative: 100,
          ticketsSold: 90,
        }),
        competition({
          sourceId: "high",
          siteName: "filter-scan-test",
          name: "High EV Competition",
          cashAlternative: 1000,
          ticketsSold: 10,
        }),
      ];
    },
  }, "https://filter-scan-test.example");

  try {
    const output = await captureStdout(async () => {
      await runScan({
        site: "filter-scan-test",
        sort: "ev",
        minEv: 50,
        limit: 1,
      });
    });

    assert.match(output, /High EV Competition/);
    assert.doesNotMatch(output, /Low EV Competition/);
  } finally {
    closeDatabaseForTests();
  }
});

test("scan reports a missing requested site without throwing", async () => {
  useTempDb();
  const originalError = console.error;
  let errorOutput = "";
  console.error = (...args: unknown[]) => {
    errorOutput += `${args.join(" ")}\n`;
  };

  try {
    const output = await captureStdout(async () => {
      await runScan({ site: "missing-scan-test" });
    });

    assert.equal(output, "");
    assert.match(errorOutput, /No adapter found for site: missing-scan-test/);
  } finally {
    console.error = originalError;
    closeDatabaseForTests();
  }
});
