import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  closeDatabaseForTests,
  completeTelegramReminder,
  createTelegramReminder,
  getCachedPrizeValuation,
  getRecentSnapshots,
  getSiteHealthIncidentStates,
  getSiteScanHealth,
  getPendingTelegramReminders,
  getSnapshots,
  getCompetition,
  insertSnapshot,
  pruneOldSnapshots,
  pruneSiteHealthForRegisteredSites,
  recordAlertSent,
  recordTelegramSentMessage,
  observeSiteHealthForAlerts,
  upsertCachedPrizeValuation,
  upsertCompetition,
  upsertSiteScanHealth,
  useDatabaseForTests,
  wasAlertSentRecently,
} from "../src/storage/database.js";
import type { RawCompetition } from "../src/types.js";

function useTempDb(): void {
  const dir = mkdtempSync(join(tmpdir(), "raffle-bot-"));
  useDatabaseForTests(join(dir, "test.db"));
}

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "comp-1",
    siteName: "example",
    url: "https://example.com/comp-1",
    name: "Example Competition",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    maxEntriesPerUser: 100,
    cashAlternative: 1000,
    drawDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isAutoDraw: true,
    categories: [],
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("snapshots retain bounded quiet heartbeats without writing every unchanged scan", () => {
  useTempDb();
  try {
    const drawDate = "2026-07-21T12:00:00.000Z";
    assert.equal(insertSnapshot(competition({ drawDate, ticketsSold: 10, scrapedAt: "2026-07-20T12:00:00.000Z" })), true);
    assert.equal(insertSnapshot(competition({ drawDate, ticketsSold: 10, scrapedAt: "2026-07-20T12:14:59.000Z" })), false);
    assert.equal(insertSnapshot(competition({ drawDate, ticketsSold: 10, scrapedAt: "2026-07-20T12:15:00.000Z" })), true);
    assert.equal(insertSnapshot(competition({ drawDate, ticketsSold: 11, scrapedAt: "2026-07-20T12:16:00.000Z" })), true);

    const snapshots = getSnapshots("comp-1", "example");
    assert.equal(snapshots.length, 3);
    assert.deepEqual(snapshots.map((s) => s.ticketsSold), [10, 10, 11]);
    assert.ok(snapshots.every((snapshot) => snapshot.drawDate === drawDate));
    assert.ok(snapshots.every((snapshot) => snapshot.maxTickets === 100));
  } finally {
    closeDatabaseForTests();
  }
});

test("snapshots keep final-hour scan cadence and separate draw rounds", () => {
  useTempDb();
  try {
    const firstDraw = "2026-07-20T12:30:00.000Z";
    const secondDraw = "2026-07-21T12:30:00.000Z";
    const exact = { inventorySource: "exact" as const };
    assert.equal(insertSnapshot(competition({ ...exact, drawDate: firstDraw, scrapedAt: "2026-07-20T12:00:00.000Z" })), true);
    assert.equal(insertSnapshot(competition({ ...exact, drawDate: firstDraw, scrapedAt: "2026-07-20T12:01:59.000Z" })), false);
    assert.equal(insertSnapshot(competition({ ...exact, drawDate: firstDraw, scrapedAt: "2026-07-20T12:02:00.000Z" })), true);
    assert.equal(insertSnapshot(competition({ ...exact, drawDate: secondDraw, scrapedAt: "2026-07-20T12:03:00.000Z" })), true);

    const currentRound = getRecentSnapshots("comp-1", "example", secondDraw, 100, 10);
    assert.equal(currentRound.length, 1);
    assert.equal(currentRound[0]?.drawDate, secondDraw);
  } finally {
    closeDatabaseForTests();
  }
});

test("snapshot retention deletes only old rows in bounded batches", () => {
  useTempDb();
  try {
    for (const [sourceId, scrapedAt] of [
      ["old-1", "2026-05-01T00:00:00.000Z"],
      ["old-2", "2026-05-02T00:00:00.000Z"],
      ["old-3", "2026-05-03T00:00:00.000Z"],
      ["recent", "2026-07-10T00:00:00.000Z"],
    ] as const) {
      assert.equal(insertSnapshot(competition({ sourceId, scrapedAt })), true);
    }

    const first = pruneOldSnapshots({
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      batchSize: 2,
      maxBatches: 1,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.deepEqual(first, {
      cutoff: "2026-06-20T00:00:00.000Z",
      deleted: 2,
      hasMore: true,
    });

    const second = pruneOldSnapshots({
      retentionMs: 30 * 24 * 60 * 60 * 1000,
      batchSize: 2,
      maxBatches: 1,
      now: new Date("2026-07-20T00:00:00.000Z"),
    });
    assert.deepEqual(second, {
      cutoff: "2026-06-20T00:00:00.000Z",
      deleted: 1,
      hasMore: false,
    });
    assert.equal(getSnapshots("recent", "example").length, 1);
  } finally {
    closeDatabaseForTests();
  }
});

test("estimated prize valuation persists with competitions", () => {
  useTempDb();
  try {
    const comp = competition({
      cashAlternative: null,
      estimatedPrizeValue: 270,
      valuationSource: "manual_estimate",
      valuationConfidence: "medium",
      valuationNotes: "Ninja retail estimate",
    });
    upsertCompetition(comp);

    const stored = getCompetition("comp-1", "example");
    assert.equal(stored?.cashAlternative, null);
    assert.equal(stored?.estimatedPrizeValue, 270);
    assert.equal(stored?.valuationSource, "manual_estimate");
    assert.equal(stored?.valuationConfidence, "medium");
    assert.equal(stored?.valuationNotes, "Ninja retail estimate");
  } finally {
    closeDatabaseForTests();
  }
});

test("LLM prize valuation cache stores valued and no-estimate results", () => {
  useTempDb();
  try {
    const now = new Date("2026-06-17T10:00:00.000Z");
    upsertCachedPrizeValuation({
      cacheKey: "example:comp-1:abc",
      siteName: "example",
      sourceId: "comp-1",
      prizeName: "Ninja Pizza Oven",
      url: "https://example.com/comp-1",
      estimatedPrizeValue: 240,
      valuationConfidence: "medium",
      valuationNotes: "LLM retail estimate",
      status: "valued",
    }, now);
    upsertCachedPrizeValuation({
      cacheKey: "example:comp-2:def",
      siteName: "example",
      sourceId: "comp-2",
      prizeName: "Mystery Bundle",
      url: "https://example.com/comp-2",
      estimatedPrizeValue: null,
      valuationConfidence: null,
      valuationNotes: null,
      status: "no_estimate",
    }, now);

    const valued = getCachedPrizeValuation(
      "example:comp-1:abc",
      60 * 60 * 1000,
      new Date("2026-06-17T10:30:00.000Z"),
    );
    const missing = getCachedPrizeValuation(
      "example:comp-2:def",
      60 * 60 * 1000,
      new Date("2026-06-17T10:30:00.000Z"),
    );
    const expired = getCachedPrizeValuation(
      "example:comp-1:abc",
      60 * 60 * 1000,
      new Date("2026-06-17T12:00:01.000Z"),
    );

    assert.equal(valued?.estimatedPrizeValue, 240);
    assert.equal(valued?.valuationConfidence, "medium");
    assert.equal(valued?.status, "valued");
    assert.equal(missing?.status, "no_estimate");
    assert.equal(expired, null);
  } finally {
    closeDatabaseForTests();
  }
});

test("alert send history persists cooldown checks", () => {
  useTempDb();
  try {
    const now = new Date("2026-06-07T00:00:00.000Z");
    recordAlertSent("trend:example:comp-1", now);

    assert.equal(
      wasAlertSentRecently(
        "trend:example:comp-1",
        30 * 60 * 1000,
        new Date("2026-06-07T00:10:00.000Z"),
      ),
      true,
    );
    assert.equal(
      wasAlertSentRecently(
        "trend:example:comp-1",
        30 * 60 * 1000,
        new Date("2026-06-07T00:31:00.000Z"),
      ),
      false,
    );
  } finally {
    closeDatabaseForTests();
  }
});

test("Telegram reminder requests are durable and complete once", () => {
  useTempDb();
  try {
    const message = {
      chatId: "123",
      messageId: 42,
      alertKey: "entry:2026-09-06:abc",
      canonicalUrl: "https://example.com/comp-1",
      siteName: "example",
      sourceId: "comp-1",
      raffleName: "Example Competition",
      sentAt: "2026-09-06T18:00:00.000Z",
    };
    recordTelegramSentMessage(message);

    assert.equal(
      createTelegramReminder(message, new Date("2026-09-06T18:05:00.000Z")),
      true,
    );
    assert.equal(
      createTelegramReminder(message, new Date("2026-09-06T18:06:00.000Z")),
      false,
    );
    assert.equal(getPendingTelegramReminders()[0]?.sourceId, "comp-1");
    assert.equal(
      completeTelegramReminder(
        "123",
        message.alertKey,
        "sent",
        new Date("2026-09-06T18:45:00.000Z"),
      ),
      true,
    );
    assert.deepEqual(getPendingTelegramReminders(), []);
  } finally {
    closeDatabaseForTests();
  }
});

test("a short cooldown check does not prune keys needed by longer alert stages", () => {
  useTempDb();
  try {
    const sentAt = new Date("2026-06-07T00:00:00.000Z");
    const checkedAt = new Date("2026-06-07T01:00:00.000Z");
    recordAlertSent("trend:final-window:long-lived", sentAt);

    assert.equal(wasAlertSentRecently("missing-short-key", 30 * 60 * 1000, checkedAt), false);
    assert.equal(
      wasAlertSentRecently("trend:final-window:long-lived", 24 * 60 * 60 * 1000, checkedAt),
      true,
    );
  } finally {
    closeDatabaseForTests();
  }
});

test("operator entry-limit provenance persists with a competition", () => {
  useTempDb();
  try {
    upsertCompetition(competition({
      maxEntriesPerUser: 25,
      maxEntriesPerUserSource: "site",
      drawUsesFullTicketRange: true,
    }));
    const stored = getCompetition("comp-1", "example");
    assert.equal(stored?.maxEntriesPerUserSource, "site");
    assert.equal(stored?.drawUsesFullTicketRange, true);
  } finally {
    closeDatabaseForTests();
  }
});

test("site scan health upserts latest status", () => {
  useTempDb();
  try {
    upsertSiteScanHealth({
      siteName: "example",
      status: "transient_error",
      competitionsFound: 0,
      cashCompetitionsFound: 0,
      partialCompetitionsFound: 0,
      errorMessage: "fetch failed",
      scannedAt: "2026-06-11T12:00:00.000Z",
    });
    upsertSiteScanHealth({
      siteName: "example",
      status: "success",
      competitionsFound: 3,
      cashCompetitionsFound: 2,
      partialCompetitionsFound: 0,
      errorMessage: null,
      scannedAt: "2026-06-11T12:05:00.000Z",
    });

    assert.deepEqual(getSiteScanHealth(), [
      {
        siteName: "example",
        status: "success",
        competitionsFound: 3,
        cashCompetitionsFound: 2,
        partialCompetitionsFound: 0,
        errorMessage: null,
        scannedAt: "2026-06-11T12:05:00.000Z",
      },
    ]);
  } finally {
    closeDatabaseForTests();
  }
});

test("site health cleanup removes only unregistered latest-health and incident rows", () => {
  useTempDb();
  try {
    for (const siteName of ["registered", "removed"] as const) {
      const first = {
        siteName,
        status: "blocked" as const,
        competitionsFound: 0,
        cashCompetitionsFound: 0,
        partialCompetitionsFound: 0,
        errorMessage: "blocked",
        scannedAt: "2026-07-20T12:00:00.000Z",
      };
      upsertSiteScanHealth(first);
      observeSiteHealthForAlerts(first, new Date(first.scannedAt));
      observeSiteHealthForAlerts(
        { ...first, scannedAt: "2026-07-20T12:05:00.000Z" },
        new Date("2026-07-20T12:05:00.000Z"),
      );
    }

    assert.deepEqual(pruneSiteHealthForRegisteredSites(["registered"]), {
      siteScanHealthRemoved: 1,
      incidentStatesRemoved: 1,
    });
    assert.deepEqual(getSiteScanHealth().map((row) => row.siteName), ["registered"]);
    assert.deepEqual(getSiteHealthIncidentStates().map((row) => row.siteName), ["registered"]);
  } finally {
    closeDatabaseForTests();
  }
});
