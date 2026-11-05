import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  runHistory,
  runList,
  runScenario,
} from "../src/cli/list.js";
import { runTrends } from "../src/cli/trends.js";
import {
  closeDatabaseForTests,
  insertSnapshot,
  upsertCompetition,
  useDatabaseForTests,
} from "../src/storage/database.js";
import type { RawCompetition } from "../src/types.js";

const hour = 60 * 60 * 1000;

function useTempDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "raffle-bot-cli-"));
  useDatabaseForTests(join(dir, "test.db"));
}

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "comp-1",
    siteName: "stored-test",
    url: "https://example.test/comp-1",
    name: "Stored Test Competition",
    entryPrice: 2,
    ticketsSold: 20,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 20,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1000,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: new Date(Date.now() + 2 * hour).toISOString(),
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date(Date.now() - hour).toISOString(),
    ...overrides,
  };
}

function captureStdout(fn: () => void): string {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += chunk.toString();
    const callback = args.find((arg): arg is (error?: Error | null) => void => typeof arg === "function");
    callback?.();
    return true;
  }) as typeof process.stdout.write;

  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return output;
}

function seedCompetitionWithHistory(): void {
  const now = Date.now();
  const drawDate = new Date(now + 2 * hour).toISOString();
  const snapshots = [
    competition({
      drawDate,
      ticketsSold: 10,
      scrapedAt: new Date(now - 2 * hour).toISOString(),
    }),
    competition({
      drawDate,
      ticketsSold: 15,
      scrapedAt: new Date(now - hour).toISOString(),
    }),
    competition({
      drawDate,
      ticketsSold: 20,
      scrapedAt: new Date(now).toISOString(),
    }),
  ];

  upsertCompetition(snapshots[2]);
  for (const snapshot of snapshots) {
    insertSnapshot(snapshot);
  }
}

test("list reads stored competitions without network access and applies filters", () => {
  useTempDb();
  try {
    upsertCompetition(competition({ maxTickets: 60, maxEntriesPerUser: 40, scrapedAt: new Date().toISOString() }));
    upsertCompetition(competition({
      sourceId: "stale-high-value", name: "Stale High Value", maxTickets: 60,
      maxEntriesPerUser: 40, cashAlternative: 100_000,
    }));
    upsertCompetition(competition({
      sourceId: "zero-value",
      name: "No Prize Value",
      cashAlternative: null,
      estimatedPrizeValue: null,
    }));
    upsertCompetition(competition({
      sourceId: "other-site",
      siteName: "other-site",
      name: "Other Site Competition",
    }));

    const output = captureStdout(() => {
      runList({ site: "stored-test", closingWithin: "3h", limit: 1 });
    });

    assert.match(output, /1 competitions/);
    assert.match(output, /Stored Test Competition/);
    assert.doesNotMatch(output, /No Prize Value/);
    assert.doesNotMatch(output, /Other Site Competition/);
  } finally {
    closeDatabaseForTests();
  }
});

test("scenario shows requested ticket-count economics for a stored competition", () => {
  useTempDb();
  try {
    upsertCompetition(competition());

    const output = captureStdout(() => {
      runScenario("comp-1", [1, 5, 10], "stored-test");
    });

    assert.match(output, /Stored Test Competition/);
    assert.match(output, /Tickets/);
    assert.match(output, /P\(Win\)/);
    assert.match(output, /Net EV/);
    assert.match(output, /\b10\b/);
  } finally {
    closeDatabaseForTests();
  }
});

test("scenario reports a missing stored competition", () => {
  useTempDb();
  try {
    const output = captureStdout(() => {
      runScenario("missing", [1], "stored-test");
    });

    assert.match(output, /Competition missing not found/);
    assert.match(output, /Run 'scan' first/);
  } finally {
    closeDatabaseForTests();
  }
});

test("history renders ticket-sale snapshots for a stored competition", () => {
  useTempDb();
  try {
    seedCompetitionWithHistory();

    const output = captureStdout(() => {
      runHistory("comp-1", "stored-test");
    });

    assert.match(output, /Stored Test Competition/);
    assert.match(output, /Snapshots:/);
    assert.match(output, /Sold:/);
    assert.match(output, /\+10 tickets/);
  } finally {
    closeDatabaseForTests();
  }
});

test("trends ranks closing stored competitions by velocity-backed opportunity", () => {
  useTempDb();
  try {
    seedCompetitionWithHistory();

    const output = captureStdout(() => {
      runTrends({ site: "stored-test", closingWithin: "3h", limit: 5 });
    });

    assert.match(output, /Trend Analysis/);
    assert.match(output, /Stored Test Competition/);
    assert.match(output, /Project|Project…/);
    assert.match(output, /30%/);
    assert.match(output, /stalled|\/hr/);
  } finally {
    closeDatabaseForTests();
  }
});
