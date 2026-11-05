import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import { mkdtempSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startMonitor } from "../src/monitor/monitor.js";
import { CONFIG } from "../src/config.js";
import {
  closeDatabaseForTests,
  getAlertDecisions,
  getCompetition,
  getSiteHealthIncidentStates,
  getSiteScanHealth,
  getSnapshots,
  insertSnapshot,
  observeSiteHealthForAlerts,
  upsertCompetition,
  upsertSiteScanHealth,
  useDatabaseForTests,
} from "../src/storage/database.js";
import type { SiteAdapter } from "../src/adapters/adapter.js";
import type { RawCompetition } from "../src/types.js";

const hour = 60 * 60 * 1000;

function useTempDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "raffle-bot-monitor-"));
  useDatabaseForTests(join(dir, "test.db"));
  CONFIG.alerts.decisionLogDir = join(dir, "alert-reviews");
  CONFIG.alerts.siteHealthLogDir = join(dir, "site-health-reviews");
  CONFIG.alerts.raffleObservationLogDir = join(dir, "raffle-observations");
  CONFIG.alerts.telegramFeedbackLogDir = join(dir, "telegram-feedback");
}

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "watch-comp-1",
    siteName: "watch-test",
    url: "https://example.test/watch-comp-1",
    name: "Watch Mode Competition",
    entryPrice: 2,
    ticketsSold: 20,
    maxTickets: 100,
    maxEntriesPerUser: 20,
    maxEntriesPerUserSource: "site",
    inventorySource: "exact",
    cashAlternative: 1000,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: new Date(Date.now() + 2 * hour).toISOString(),
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

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("watch mode runs an immediate cycle, persists data, and exits when maxCycles is set", async () => {
  useTempDb();
  let fetches = 0;
  const adapter: SiteAdapter = {
    siteName: "watch-test",
    async fetchAll() {
      fetches += 1;
      return [competition()];
    },
  };

  try {
    const output = await captureStdout(async () => {
      await startMonitor([adapter], {
        intervalMs: hour,
        concurrency: 3,
        showTable: true,
        maxCycles: 1,
        tickMs: 1,
      });
    });

    assert.equal(fetches, 1);
    assert.match(output, /Raffle Bot/);
    assert.match(output, /watch mode/);
    assert.match(output, /1 sites/);
    assert.match(output, /Scanning 1 sites/);
    assert.match(output, /watch-test 1 comps/);
    assert.equal(getCompetition("watch-comp-1", "watch-test")?.name, "Watch Mode Competition");
    assert.equal(getSnapshots("watch-comp-1", "watch-test").length, 1);
    assert.equal(getSiteScanHealth()[0]?.status, "success");
    const observationFile = readdirSync(
      CONFIG.alerts.raffleObservationLogDir,
    )[0]!;
    const observation = JSON.parse(
      readFileSync(
        join(CONFIG.alerts.raffleObservationLogDir, observationFile),
        "utf8",
      ).trim(),
    ) as {
      phase: string;
      evaluationId: string;
      competitions: Array<{
        sourceId: string;
        drawDate: string;
        decisionCoverageExpected: boolean;
      }>;
    };
    assert.equal(observation.phase, "raffle_observation");
    assert.equal(typeof observation.evaluationId, "string");
    assert.deepEqual(observation.competitions.map((entry) => ({
      sourceId: entry.sourceId,
      decisionCoverageExpected: entry.decisionCoverageExpected,
    })), [{
      sourceId: "watch-comp-1",
      decisionCoverageExpected: false,
    }]);
  } finally {
    closeDatabaseForTests();
  }
});

test("a failed scan shows a fresh stored entry without dispatching it", async () => {
  useTempDb();
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalChatId = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  upsertCompetition(competition({
    sourceId: "stored-entry",
    maxTickets: 60,
    maxEntriesPerUser: 40,
    siteName: "failed-stored-test",
    url: "https://example.test/stored-entry",
    name: "Stored Entry",
    inventorySource: "exact",
    maxEntriesPerUserSource: "site",
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  }));
  const adapter: SiteAdapter = {
    siteName: "failed-stored-test",
    async fetchAll() {
      throw new Error("403 forbidden");
    },
  };

  try {
    const output = await captureStdout(async () => {
      await startMonitor([adapter], {
        intervalMs: hour,
        concurrency: 1,
        showTable: true,
        maxCycles: 1,
        tickMs: 1,
      });
    });

    assert.match(output, /Stored Entry/);
    assert.equal(getAlertDecisions().length, 0);
  } finally {
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = originalToken;
    if (originalChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = originalChatId;
    closeDatabaseForTests();
  }
});

test("watch mode refreshes an expired entry once without a repeated immediate retry loop", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
  try {
    for (const staysStale of [false, true]) {
      useTempDb();
      let entryFetches = 0;
      let otherFetches = 0;
      const entry: SiteAdapter = {
        siteName: "watch-test",
        async fetchAll() {
          entryFetches++;
          return [competition({
            entryPrice: 1, ticketsSold: 5, maxEntriesPerUser: 70,
            drawDate: new Date(Date.now() + 45 * 60_000).toISOString(),
            scrapedAt: new Date(Date.now() - (entryFetches === 1 || staysStale ? 180_000 : 0)).toISOString(),
          })];
        },
      };
      const other: SiteAdapter = { siteName: "other-test", async fetchAll() { otherFetches++; return []; } };
      await startMonitor([entry, other], {
        intervalMs: hour, concurrency: 1, showTable: false, maxCycles: 3, tickMs: 1,
      });
      assert.equal(entryFetches, 2);
      assert.equal(otherFetches, 1);
      assert.deepEqual(getAlertDecisions().map((record) => record.outcome), [
        "suppressed_stale_inventory", staysStale ? "suppressed_stale_inventory" : "suppressed_telegram_disabled",
      ]);
      closeDatabaseForTests();
    }
  } finally {
    closeDatabaseForTests();
    if (oldToken !== undefined) process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat !== undefined) process.env.TELEGRAM_CHAT_ID = oldChat;
  }
});

test("watch mode startup prunes health state for adapters that are no longer registered", async () => {
  useTempDb();
  for (const siteName of ["removed-site", "inactive-registered-site"] as const) {
    const storedHealth = {
      siteName,
      status: "blocked" as const,
      competitionsFound: 0,
      cashCompetitionsFound: 0,
      partialCompetitionsFound: 0,
      errorMessage: "blocked",
      scannedAt: "2026-07-20T12:00:00.000Z",
    };
    upsertSiteScanHealth(storedHealth);
    observeSiteHealthForAlerts(storedHealth, new Date(storedHealth.scannedAt));
    observeSiteHealthForAlerts(
      { ...storedHealth, scannedAt: "2026-07-20T12:05:00.000Z" },
      new Date("2026-07-20T12:05:00.000Z"),
    );
  }

  const adapter: SiteAdapter = {
    siteName: "registered-site",
    async fetchAll() {
      return [];
    },
  };

  try {
    await captureStdout(() => startMonitor([adapter], {
      intervalMs: hour,
      concurrency: 1,
      showTable: false,
      maxCycles: 1,
      tickMs: 1,
      registeredSiteNames: ["registered-site", "inactive-registered-site"],
    }));

    assert.deepEqual(getSiteScanHealth().map((row) => row.siteName), [
      "inactive-registered-site",
      "registered-site",
    ]);
    assert.deepEqual(getSiteHealthIncidentStates().map((row) => row.siteName), [
      "inactive-registered-site",
      "registered-site",
    ]);
  } finally {
    closeDatabaseForTests();
  }
});

test("watch mode writes persistent site failures to the daily health ledger without Telegram", async () => {
  useTempDb();
  const oldThreshold = CONFIG.alerts.siteHealthConsecutiveThreshold;
  const oldSlowInterval = CONFIG.smartSchedule.slowIntervalMs;
  CONFIG.alerts.siteHealthConsecutiveThreshold = 2;
  CONFIG.smartSchedule.slowIntervalMs = 1;
  const adapter: SiteAdapter = {
    siteName: "broken-parser-test",
    async fetchAll() {
      return [competition({
        sourceId: "broken-parser",
        siteName: "broken-parser-test",
        url: "https://example.test/broken-parser",
        maxTickets: 0,
      })];
    },
  };

  try {
    await captureStdout(() => startMonitor([adapter], {
      intervalMs: 1,
      concurrency: 1,
      showTable: false,
      maxCycles: 2,
      tickMs: 1,
    }));

    const files = readdirSync(CONFIG.alerts.siteHealthLogDir);
    assert.equal(files.length, 1);
    const records = readFileSync(join(CONFIG.alerts.siteHealthLogDir, files[0]), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as {
        phase: string;
        events: Array<{ kind: string; siteName: string; status: string }>;
      });
    assert.deepEqual(
      records.flatMap((record) => record.events).map(({ kind, siteName, status }) => ({
        kind,
        siteName,
        status,
      })),
      [{
        kind: "incident",
        siteName: "broken-parser-test",
        status: "partial",
      }],
    );
    assert.ok(getSiteHealthIncidentStates()[0]?.incidentAlertedAt);
  } finally {
    CONFIG.alerts.siteHealthConsecutiveThreshold = oldThreshold;
    CONFIG.smartSchedule.slowIntervalMs = oldSlowInterval;
    closeDatabaseForTests();
  }
});

test("watch mode runs bounded snapshot maintenance before scanning", async () => {
  useTempDb();
  const originalStorage = { ...CONFIG.storage };
  CONFIG.storage.snapshotRetentionMs = 30 * 24 * 60 * 60 * 1000;
  CONFIG.storage.snapshotPruneBatchSize = 1;
  CONFIG.storage.snapshotPruneMaxBatches = 1;
  insertSnapshot(competition({
    sourceId: "old-1",
    scrapedAt: "2026-01-01T00:00:00.000Z",
  }));
  insertSnapshot(competition({
    sourceId: "old-2",
    scrapedAt: "2026-01-02T00:00:00.000Z",
  }));
  insertSnapshot(competition({
    sourceId: "recent",
    scrapedAt: new Date().toISOString(),
  }));

  const adapter: SiteAdapter = {
    siteName: "maintenance-test",
    async fetchAll() {
      return [];
    },
  };

  try {
    await captureStdout(() => startMonitor([adapter], {
      intervalMs: hour,
      concurrency: 1,
      showTable: false,
      maxCycles: 1,
      tickMs: 1,
    }));

    assert.equal(getSnapshots("old-1", "watch-test").length, 0);
    assert.equal(getSnapshots("old-2", "watch-test").length, 1);
    assert.equal(getSnapshots("recent", "watch-test").length, 1);
  } finally {
    Object.assign(CONFIG.storage, originalStorage);
    closeDatabaseForTests();
  }
});

test("watch mode persists and evaluates the fast lane before a browser scan finishes", async () => {
  useTempDb();
  let releaseBrowser: (() => void) | undefined;
  const browserResult = new Promise<RawCompetition[]>((resolve) => {
    releaseBrowser = () => resolve([]);
  });
  const fastAdapter: SiteAdapter = {
    siteName: "watch-test",
    async fetchAll() {
      return [competition({ drawDate: new Date(Date.now() + 45 * 60 * 1000).toISOString() })];
    },
  };
  const browserAdapter: SiteAdapter = {
    siteName: "slow-browser-test",
    scanCost: "browser",
    async fetchAll() {
      return browserResult;
    },
  };

  const monitor = startMonitor([fastAdapter, browserAdapter], {
    intervalMs: hour,
    concurrency: 2,
    showTable: false,
    maxCycles: 1,
    tickMs: 1,
  });

  try {
    await waitFor(() => {
      const persisted = getCompetition("watch-comp-1", "watch-test") !== null;
      const evaluated = getAlertDecisions().some((record) =>
        (record.candidate as { sourceId?: string } | undefined)?.sourceId === "watch-comp-1"
      );
      return persisted && evaluated;
    }, 500);
  } finally {
    releaseBrowser?.();
    await monitor;
    closeDatabaseForTests();
  }
});

test("watch mode evaluates a ready site while another scan in the same lane is pending", async () => {
  useTempDb();
  let releaseSlowScan: (() => void) | undefined;
  const slowResult = new Promise<RawCompetition[]>((resolve) => {
    releaseSlowScan = () => resolve([]);
  });
  const fastAdapter: SiteAdapter = {
    siteName: "watch-test",
    async fetchAll() {
      return [competition({ drawDate: new Date(Date.now() + 45 * 60 * 1000).toISOString() })];
    },
  };
  const slowAdapter: SiteAdapter = {
    siteName: "slow-normal-test",
    async fetchAll() {
      return slowResult;
    },
  };

  const monitor = startMonitor([fastAdapter, slowAdapter], {
    intervalMs: hour,
    concurrency: 2,
    showTable: false,
    maxCycles: 1,
    tickMs: 1,
  });

  try {
    await waitFor(() =>
      getCompetition("watch-comp-1", "watch-test") !== null &&
      getAlertDecisions().some((record) =>
        (record.candidate as { sourceId?: string } | undefined)?.sourceId === "watch-comp-1"
      ), 500);
  } finally {
    releaseSlowScan?.();
    await monitor;
    closeDatabaseForTests();
  }
});

test("watch mode processes a fast browser batch before blocked normal and heavy lanes finish", async () => {
  useTempDb();
  let releaseBlockedScans: (() => void) | undefined;
  const blockedResult = new Promise<RawCompetition[]>((resolve) => {
    releaseBlockedScans = () => resolve([]);
  });
  const blockedNormal: SiteAdapter = {
    siteName: "blocked-normal-test",
    async fetchAll() {
      return blockedResult;
    },
  };
  const blockedHeavy: SiteAdapter = {
    siteName: "blocked-heavy-test",
    scanCost: "heavy",
    async fetchAll() {
      return blockedResult;
    },
  };
  const fastBrowser: SiteAdapter = {
    siteName: "fast-browser-test",
    scanCost: "browser",
    async fetchAll() {
      return [competition({
        sourceId: "browser-comp-1",
        siteName: "fast-browser-test",
        url: "https://example.test/browser-comp-1",
        drawDate: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      })];
    },
  };

  const monitor = startMonitor([blockedNormal, blockedHeavy, fastBrowser], {
    intervalMs: hour,
    concurrency: 1,
    showTable: false,
    maxCycles: 1,
    tickMs: 1,
  });

  try {
    await waitFor(() =>
      getCompetition("browser-comp-1", "fast-browser-test") !== null &&
      getAlertDecisions().some((record) =>
        (record.candidate as { sourceId?: string } | undefined)?.sourceId === "browser-comp-1"
      ), 500);
  } finally {
    releaseBlockedScans?.();
    await monitor;
    closeDatabaseForTests();
  }
});

test("watch mode rescans an urgent site before the cold-start backlog drains", async () => {
  useTempDb();
  const originalUrgentIntervalMs = CONFIG.smartSchedule.urgentIntervalMs;
  CONFIG.smartSchedule.urgentIntervalMs = 5;
  const coldSiteCount = 6;
  let urgentFetches = 0;
  let coldFetches = 0;
  let coldFetchesAtSecondUrgent: number | null = null;

  const urgentAdapter: SiteAdapter = {
    siteName: "urgent-rescan-test",
    async fetchAll() {
      urgentFetches += 1;
      if (urgentFetches === 2) {
        coldFetchesAtSecondUrgent = coldFetches;
      }
      return [competition({
        sourceId: "urgent-rescan-comp",
        maxTickets: 70,
        maxEntriesPerUser: 80,
        siteName: "urgent-rescan-test",
        url: "https://example.test/urgent-rescan-comp",
        drawDate: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      })];
    },
  };
  const coldAdapters = Array.from({ length: coldSiteCount }, (_, index): SiteAdapter => ({
    siteName: `cold-start-${index}`,
    async fetchAll() {
      coldFetches += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return [];
    },
  }));

  try {
    await captureStdout(() => startMonitor([urgentAdapter, ...coldAdapters], {
      intervalMs: hour,
      concurrency: 1,
      showTable: false,
      maxCycles: 3,
      tickMs: 1,
    }));

    assert.ok(urgentFetches >= 2, "expected the urgent adapter to be rescanned");
    assert.ok(coldFetches > 0, "expected cold-start work to keep making progress");
    assert.ok(
      coldFetchesAtSecondUrgent !== null && coldFetchesAtSecondUrgent < coldSiteCount,
      `expected urgent rescan before all ${coldSiteCount} cold sites, observed ${coldFetchesAtSecondUrgent}`,
    );
  } finally {
    CONFIG.smartSchedule.urgentIntervalMs = originalUrgentIntervalMs;
    closeDatabaseForTests();
  }
});

test("watch mode bounds cold-start lane tranches without starving normal or heavy scans", async () => {
  useTempDb();
  const scanOrder: string[] = [];
  const adapter = (
    siteName: string,
    scanCost?: SiteAdapter["scanCost"],
  ): SiteAdapter => ({
    siteName,
    scanCost,
    async fetchAll() {
      scanOrder.push(siteName);
      return [];
    },
  });
  const adapters = [
    ...Array.from({ length: 5 }, (_, index) => adapter(`browser-backlog-${index}`, "browser")),
    adapter("normal-progress"),
    adapter("heavy-progress", "heavy"),
  ];

  try {
    await captureStdout(() => startMonitor(adapters, {
      intervalMs: hour,
      concurrency: 1,
      showTable: false,
      maxCycles: 3,
      tickMs: 1,
    }));

    assert.deepEqual(scanOrder, [
      "browser-backlog-0",
      "normal-progress",
      "heavy-progress",
    ]);
  } finally {
    closeDatabaseForTests();
  }
});

test("watch mode never exceeds the configured global scan concurrency across lanes", async () => {
  useTempDb();
  let active = 0;
  let maxActive = 0;
  let activeBrowser = 0;
  let maxActiveBrowser = 0;
  let started = 0;
  let releaseScans: (() => void) | undefined;
  const blockedResult = new Promise<RawCompetition[]>((resolve) => {
    releaseScans = () => resolve([]);
  });

  const adapter = (siteName: string, scanCost?: SiteAdapter["scanCost"]): SiteAdapter => ({
    siteName,
    scanCost,
    async fetchAll() {
      active += 1;
      if (scanCost === "browser") activeBrowser += 1;
      started += 1;
      maxActive = Math.max(maxActive, active);
      maxActiveBrowser = Math.max(maxActiveBrowser, activeBrowser);
      try {
        return await blockedResult;
      } finally {
        active -= 1;
        if (scanCost === "browser") activeBrowser -= 1;
      }
    },
  });

  const adapters = [
    ...Array.from({ length: 6 }, (_, index) => adapter(`normal-${index}`)),
    ...Array.from({ length: 6 }, (_, index) => adapter(`heavy-${index}`, "heavy")),
    ...Array.from({ length: 3 }, (_, index) => adapter(`browser-${index}`, "browser")),
  ];
  const monitor = startMonitor(adapters, {
    intervalMs: hour,
    concurrency: 6,
    showTable: false,
    maxCycles: 1,
    tickMs: 1,
  });

  try {
    await waitFor(() => started >= 6, 500);
    releaseScans?.();
    await monitor;
    assert.ok(maxActive <= 6, `expected at most 6 active scans, observed ${maxActive}`);
    assert.ok(
      maxActiveBrowser <= CONFIG.monitor.browserScanConcurrency,
      `expected at most ${CONFIG.monitor.browserScanConcurrency} active browser scans, observed ${maxActiveBrowser}`,
    );
  } finally {
    releaseScans?.();
    await monitor;
    closeDatabaseForTests();
  }
});

for (const shutdownSignal of ["SIGINT", "SIGTERM"] as const) test(`watch mode handles ${shutdownSignal} by printing shutdown and exiting cleanly`, async () => {
  const dbPath = join(
    mkdtempSync(join(tmpdir(), `raffle-bot-monitor-${shutdownSignal.toLowerCase()}-`)),
    "test.db",
  );
  const script = `
    import { startMonitor } from "./src/monitor/monitor.ts";
    import { CONFIG } from "./src/config.ts";
    if (CONFIG.dbPath !== ${JSON.stringify(dbPath)}) {
      throw new Error("signal test did not load its isolated database path");
    }
    const adapter = { siteName: "signal-test", async fetchAll() { return []; } };
    await startMonitor([adapter], { intervalMs: 60 * 60 * 1000, showTable: false, tickMs: 10_000 });
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "-e", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RAFFLE_BOT_DB_PATH: dbPath,
      RAFFLE_BOT_ALERT_REVIEW_DIR: join(dbPath, "..", "alert-reviews"),
      RAFFLE_BOT_SITE_HEALTH_REVIEW_DIR: join(dbPath, "..", "site-health-reviews"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
    if (output.includes("Ctrl+C to stop")) {
      child.kill(shutdownSignal);
    }
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`watch subprocess did not exit. Output:\n${output}`));
    }, 5_000);

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

  assert.equal(exit.code, 0);
  assert.equal(exit.signal, null);
  assert.match(output, /Stopping monitor/);
});
