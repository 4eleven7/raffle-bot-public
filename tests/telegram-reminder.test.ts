import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeOpportunityAlertKey } from "../src/alerts/telegram.js";
import { processDueTelegramReminders } from "../src/alerts/telegram-reminder.js";
import {
  closeDatabaseForTests,
  createTelegramReminder,
  getPendingTelegramReminders,
  recordTelegramSentMessage,
  useDatabaseForTests,
} from "../src/storage/database.js";
import type { Competition } from "../src/types.js";

function competition(now: Date, overrides: Partial<Competition> = {}): Competition {
  const drawDate = new Date(now.getTime() + 14 * 60_000).toISOString();
  return {
    sourceId: "reminder-1",
    siteName: "example",
    url: "https://example.test/reminder-1",
    name: "£1,000 Cash",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 70,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1_000,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate,
    isAutoDraw: false,
    categories: [],
    scrapedAt: now.toISOString(),
    prizeValue: 1_000,
    evPerTicket: 99,
    optimalTickets: 22,
    optimalCost: 22,
    winProbability: 22 / 32,
    lossProbability: 10 / 32,
    expectedReturn: 687.5,
    netEV: 665.5,
    returnRatio: 30.25,
    houseEdge: -9,
    sellThrough: 0.1,
    timeToClose: 14 * 60_000,
    ...overrides,
  };
}

test("due Telegram reminders send only when the fresh raffle is still worth entering", async () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-reminder-"));
  useDatabaseForTests(join(directory, "reminders.db"));
  const now = new Date("2026-09-06T18:45:00.000Z");
  const worthEntering = competition(now);
  const notWorthEntering = competition(now, {
    sourceId: "reminder-2",
    url: "https://example.test/reminder-2",
    name: "£1 Prize",
    entryPrice: 10,
    cashAlternative: 1,
    prizeValue: 1,
  });
  const sent: string[] = [];

  try {
    for (const [index, comp] of [worthEntering, notWorthEntering].entries()) {
      const message = {
        chatId: "123",
        messageId: 40 + index,
        alertKey: makeOpportunityAlertKey(comp),
        canonicalUrl: comp.url,
        siteName: comp.siteName,
        sourceId: comp.sourceId,
        raffleName: comp.name,
        sentAt: "2026-09-06T18:00:00.000Z",
      };
      recordTelegramSentMessage(message);
      createTelegramReminder(message, now);
    }

    const dependencies = {
      now: () => now,
      sender: async (comp: Competition) => {
        sent.push(comp.sourceId);
        return "sent" as const;
      },
    };
    const staleResult = await processDueTelegramReminders(
      [{ ...worthEntering, scrapedAt: new Date(now.getTime() - 121_000).toISOString() }, notWorthEntering],
      dependencies,
    );
    assert.deepEqual(staleResult, { sent: 0, notWorth: 1, expired: 0 });
    assert.equal(getPendingTelegramReminders().length, 1);
    assert.deepEqual(sent, []);

    const result = await processDueTelegramReminders([worthEntering], dependencies);
    assert.deepEqual(result, { sent: 1, notWorth: 0, expired: 0 });
    assert.deepEqual(sent, ["reminder-1"]);
    assert.deepEqual(getPendingTelegramReminders(), []);
  } finally {
    closeDatabaseForTests();
  }
});

test("Telegram reminders keep the existing reject and uncertain Codex vetoes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-reminder-review-"));
  useDatabaseForTests(join(directory, "reminders.db"));
  const now = new Date("2026-09-06T18:45:00.000Z");
  const competitions = ["reject", "uncertain"].map((decision) =>
    competition(now, {
      sourceId: `reminder-${decision}`,
      url: `https://example.test/reminder-${decision}`,
      cashAlternative: null,
      estimatedPrizeValue: 1_000,
      valuationSource: "manual_estimate",
      valuationConfidence: "medium",
    })
  );
  const reviewDecisions = ["reject", "uncertain"] as const;
  let sends = 0;

  try {
    for (const [index, comp] of competitions.entries()) {
      const message = {
        chatId: "123",
        messageId: 50 + index,
        alertKey: makeOpportunityAlertKey(comp),
        canonicalUrl: comp.url,
        siteName: comp.siteName,
        sourceId: comp.sourceId,
        raffleName: comp.name,
        sentAt: "2026-09-06T18:00:00.000Z",
      };
      recordTelegramSentMessage(message);
      createTelegramReminder(message, now);
    }

    const result = await processDueTelegramReminders(competitions, {
      now: () => now,
      reviewer: async () => {
        const decision = reviewDecisions.shift();
        assert.ok(decision);
        return {
          decision,
          reason: `test ${decision}`,
          issues: [],
          model: "test",
          schemaVersion: "1",
        };
      },
      sender: async () => {
        sends += 1;
        return "sent";
      },
    });

    assert.deepEqual(result, { sent: 0, notWorth: 2, expired: 0 });
    assert.equal(sends, 0);
    assert.deepEqual(getPendingTelegramReminders(), []);
  } finally {
    closeDatabaseForTests();
  }
});
