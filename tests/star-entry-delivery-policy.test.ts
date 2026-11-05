import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Competition, EntryRecommendation } from "../src/types.js";
import {
  closeDatabaseForTests,
  getTelegramFeedbackEvents,
  recordTelegramSentMessage,
  useDatabaseForTests,
} from "../src/storage/database.js";
import { handleTelegramFeedbackUpdate, telegramFeedbackReplyMarkup } from "../src/alerts/telegram-feedback.js";

const minute = 60_000;

function competition(overrides: Partial<Competition> = {}): Competition {
  return {
    sourceId: "entry-delivery-1",
    siteName: "example",
    url: "https://example.test/entry-delivery-1?utm_source=test",
    name: "£1,000 Cash",
    entryPrice: 1,
    ticketsSold: 5,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 70,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1_000,
    estimatedPrizeValue: null,
    valuationSource: "cash",
    valuationConfidence: "high",
    valuationNotes: "Explicit cash alternative",
    drawDate: "2026-08-26T12:45:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: "2026-08-26T12:00:00.000Z",
    prizeValue: 1_000,
    evPerTicket: 100,
    optimalTickets: 10,
    optimalCost: 10,
    winProbability: 2 / 3,
    lossProbability: 1 / 3,
    expectedReturn: 666.67,
    netEV: 656.67,
    returnRatio: 65.667,
    houseEdge: -9,
    sellThrough: 0.05,
    timeToClose: 45 * minute,
    ...overrides,
  };
}

function recommendation(overrides: Partial<EntryRecommendation> = {}): EntryRecommendation {
  return Object.freeze({
    stars: 2,
    currentScenario: Object.freeze({
      tickets: 10,
      cost: 10,
      winProbability: 2 / 3,
      lossProbability: 1 / 3,
      expectedReturn: 666.67,
      netEV: 656.67,
      returnRatio: 65.667,
    }),
    projectedScenario: Object.freeze({
      tickets: 10,
      cost: 10,
      winProbability: 0.5,
      lossProbability: 0.5,
      expectedReturn: 500,
      netEV: 490,
      returnRatio: 49,
    }),
    projectedSellThrough: 0.1,
    reason: "positive current and projected entry",
    ...overrides,
  });
}

test("entry message is two concise lines with stars and no watch or reviewer text", async () => {
  const { formatTelegramOpportunityMessage } = await import("../src/alerts/telegram.js");
  const output = formatTelegramOpportunityMessage(competition(), recommendation());
  const lines = output.split("\n").filter(Boolean);

  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^⭐⭐ /u);
  assert.match(lines[0]!, /5\/100 sold now/u);
  assert.match(lines[0]!, /Buy now: 10×£1\.00/u);
  assert.match(lines[0]!, /£10\.00 total/u);
  assert.match(lines[0]!, /50\.0% projected loss chance/u);
  assert.match(lines[0]!, /\+£490 projected EV/u);
  assert.match(lines[0]!, /Draw in 45m/u);
  assert.match(lines[1]!, /^\[Enter\]\(/u);
  assert.doesNotMatch(output, /watch|monitor|Codex|review|rule/i);
});

test("Telegram requires ok true and does not start cooldown for an empty 2xx body", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "raffle-entry-send-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  globalThis.fetch = async () => new Response("{}", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const telegram = await import("../src/alerts/telegram.js");
    const first = await telegram.sendTelegramOpportunityDetailed(
      competition(),
      recommendation(),
    );
    assert.equal(first.outcome, "failed");
    assert.equal(
      telegram.telegramOpportunityAvailability(competition()),
      "ready",
    );
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
    globalThis.fetch = oldFetch;
    closeDatabaseForTests();
  }
});

test("cooldown key groups same London draw date and separates a later round", async () => {
  const { makeOpportunityAlertKey } = await import("../src/alerts/telegram.js");
  const first = competition({ drawDate: "2026-10-25T00:30:00.000Z" });
  const corrected = competition({ drawDate: "2026-10-25T22:30:00.000Z" });
  const nextRound = competition({ drawDate: "2026-10-26T22:30:00.000Z" });

  assert.equal(makeOpportunityAlertKey(first), makeOpportunityAlertKey(corrected));
  assert.notEqual(makeOpportunityAlertKey(first), makeOpportunityAlertKey(nextRound));
});

test("direct high-confidence cash bypasses review while estimated value requires approval", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js") as Record<string, any>;
  assert.equal(typeof processEntryCandidates, "function");
  let reviews = 0;
  let sends = 0;
  const dependencies = {
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    analyzeTrend: () => ({
      dataPoints: 3,
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: 0.1,
      isReliable: true,
      resetDetected: false,
    }),
    reviewer: async () => {
      reviews += 1;
      return {
        decision: "approve",
        reason: "value is internally consistent",
        issues: [],
        inputHash: "test-review",
      };
    },
    sender: async (_competition: Competition, supplied: EntryRecommendation) => {
      assert.ok(supplied.stars > 0);
      sends += 1;
      return { outcome: "sent", alertKey: "entry:test" };
    },
    availability: () => "ready",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
    getCachedReview: () => null,
    getStoredCompetitions: () => [],
  };

  await processEntryCandidates([competition()], dependencies);
  assert.equal(reviews, 0);
  assert.equal(sends, 1);

  await processEntryCandidates([competition({
    cashAlternative: null,
    estimatedPrizeValue: 1_000,
    valuationSource: "llm_estimate",
    valuationConfidence: "medium",
  })], dependencies);
  assert.equal(reviews, 1);
  assert.equal(sends, 2);
});

test("estimated value is suppressed when its reviewer rejects it", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js");
  let sends = 0;
  const result = await processEntryCandidates([competition({
    cashAlternative: null,
    estimatedPrizeValue: 1_000,
    valuationSource: "llm_estimate",
    valuationConfidence: "medium",
  })], {
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    analyzeTrend: () => ({
      dataPoints: 3,
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: 0.1,
      isReliable: true,
      resetDetected: false,
    }),
    reviewer: async () => ({
      decision: "reject",
      reason: "value mismatch",
      issues: ["value"],
    }),
    sender: async () => {
      sends += 1;
      return "sent";
    },
    availability: () => "ready",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
    getCachedReview: () => null,
  });

  assert.equal(sends, 0);
  assert.equal(result.at(-1)?.outcome, "suppressed_reviewer");
});

test("ready cash precedes slow reviews and queued inventory is checked with the current clock", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js");
  const start = Date.parse("2026-08-26T12:00:00.000Z");
  let elapsed = 0;
  const reviewed: string[] = [];
  const sent: string[] = [];
  const rows = ["review-1", "review-2", "review-3", "cash"].map((id) => competition({
    sourceId: id, url: `https://example.test/${id}`,
    scrapedAt: new Date(start - 30_000).toISOString(),
    cashAlternative: id === "cash" ? 1000 : null,
    estimatedPrizeValue: id === "cash" ? null : 1000,
    valuationSource: id === "cash" ? "cash" : "manual_estimate",
  }));
  const records = await processEntryCandidates(rows, {
    now: () => new Date(start + elapsed),
    analyzeTrend: () => ({ dataPoints: 0, velocityPerHour: 0, estimatedSelloutMs: null,
      isAccelerating: false, projectedSellThrough: null, isReliable: false, resetDetected: false }),
    reviewer: async (input) => {
      reviewed.push((input.competition as { sourceId: string }).sourceId);
      elapsed += 50_000;
      return { decision: "approve", reason: "consistent", issues: [] };
    },
    sender: async (comp) => { sent.push(comp.sourceId); return "sent"; },
    availability: () => "ready", recordDecision: () => undefined,
    appendDecision: () => undefined, getCachedReview: () => null,
  });
  assert.deepEqual(sent, ["cash", "review-1"]);
  assert.deepEqual(reviewed, ["review-1", "review-2"]);
  assert.equal(records.find((r) => r.candidate?.sourceId === "review-3")?.deterministicReason,
    "entry inventory is stale or invalid");
});

test("stale or future inventory is suppressed before review", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js");
  let reviews = 0;
  let sends = 0;
  const result = await processEntryCandidates([
    competition({ scrapedAt: "2026-08-26T11:57:59.999Z" }),
    competition({
      sourceId: "future",
      url: "https://example.test/entry-delivery-1-future?utm_source=test",
      scrapedAt: "2026-08-26T12:00:00.001Z",
    }),
  ], {
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    analyzeTrend: () => ({
      dataPoints: 3,
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: 0.1,
      isReliable: true,
      resetDetected: false,
    }),
    reviewer: async () => {
      reviews += 1;
      return { decision: "approve", reason: "consistent", issues: [] };
    },
    sender: async () => {
      sends += 1;
      return "sent";
    },
    availability: () => "ready",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
    getCachedReview: () => null,
  });

  assert.equal(reviews, 0);
  assert.equal(sends, 0);
  assert.deepEqual(result.map((record) => record.outcome), [
    "suppressed_stale_inventory",
    "suppressed_stale_inventory",
  ]);
});

test("inventory freshness is checked again after reviewer delay", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js");
  const times = [
    new Date("2026-08-26T12:00:00.000Z"),
    new Date("2026-08-26T12:03:00.000Z"),
  ];
  let sends = 0;
  const result = await processEntryCandidates([competition({
    cashAlternative: null,
    estimatedPrizeValue: 1_000,
    valuationSource: "llm_estimate",
    valuationConfidence: "medium",
  })], {
    now: () => times.shift() ?? new Date("2026-08-26T12:03:00.000Z"),
    analyzeTrend: () => ({
      dataPoints: 3,
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: 0.1,
      isReliable: true,
      resetDetected: false,
    }),
    reviewer: async () => ({
      decision: "approve",
      reason: "consistent",
      issues: [],
    }),
    sender: async () => {
      sends += 1;
      return "sent";
    },
    availability: () => "ready",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
    getCachedReview: () => null,
  });

  assert.equal(sends, 0);
  assert.equal(result.at(-1)?.outcome, "suppressed_stale_inventory");
  assert.equal(result.at(-1)?.deterministicReason, "entry inventory became stale during review");
});

test("the newest current alias wins instead of stale economics blocking the raffle", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js");
  const seenValues: Array<number | null> = [];
  const older = competition({
    sourceId: "older",
    url: "https://example.test/round?utm_source=old",
    scrapedAt: "2026-08-26T11:55:00.000Z",
    cashAlternative: 500,
    prizeValue: 500,
  });
  const newer = competition({
    sourceId: "newer",
    url: "https://example.test/round?utm_source=new",
    scrapedAt: "2026-08-26T11:59:00.000Z",
    cashAlternative: 1_000,
    prizeValue: 1_000,
  });

  const result = await processEntryCandidates([older, newer], {
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    analyzeTrend: () => ({
      dataPoints: 0,
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: null,
      isReliable: false,
      resetDetected: false,
    }),
    sender: async (candidate) => {
      seenValues.push(candidate.cashAlternative);
      return "sent";
    },
    availability: () => "ready",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
  });

  assert.deepEqual(seenValues, [1_000]);
  assert.equal(result.at(-1)?.outcome, "sent");
  assert.equal(result.at(-1)?.aliases?.length, 2);
});

test("review cannot send after the draw has closed", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js");
  const times = [
    new Date("2026-08-26T12:00:00.000Z"),
    new Date("2026-08-26T13:00:00.000Z"),
  ];
  let sends = 0;
  const result = await processEntryCandidates([competition()], {
    now: () => times.shift() ?? new Date("2026-08-26T13:00:00.000Z"),
    analyzeTrend: () => ({
      dataPoints: 0,
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: null,
      isReliable: false,
      resetDetected: false,
    }),
    sender: async () => {
      sends += 1;
      return "sent";
    },
    availability: () => "ready",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
  });

  assert.equal(sends, 0);
  assert.equal(result.at(-1)?.outcome, "suppressed_stale_timing");
});

test("one sender failure does not block another canonical raffle", async () => {
  const { processEntryCandidates } = await import("../src/alerts/buy-review.js");
  const result = await processEntryCandidates([
    competition({ sourceId: "failure", url: "https://example.test/failure" }),
    competition({ sourceId: "success", url: "https://example.test/success" }),
  ], {
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    analyzeTrend: () => ({
      dataPoints: 0,
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: null,
      isReliable: false,
      resetDetected: false,
    }),
    sender: async (candidate) => {
      if (candidate.sourceId === "failure") throw new Error("send failed");
      return "sent";
    },
    availability: () => "ready",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
  });

  assert.deepEqual(result.map((record) => record.outcome), ["failed", "sent"]);
});

test("canonical entry identity removes tracking fields but preserves real query identity", async () => {
  const { canonicalCompetitionUrl } = await import("../src/alerts/buy-review.js");
  assert.equal(
    canonicalCompetitionUrl("https://example.test/draw?id=7&utm_source=mail#top"),
    "https://example.test/draw?id=7",
  );
  assert.notEqual(
    canonicalCompetitionUrl("https://example.test/draw?id=7"),
    canonicalCompetitionUrl("https://example.test/draw?id=8"),
  );
});

test("feedback offers and records entered, won, and lost outcomes", async () => {
  assert.deepEqual(
    telegramFeedbackReplyMarkup().inline_keyboard.flat().map((button) => button.text),
    ["Entered", "Won", "Lost", "Fix site", "Remind me"],
  );

  const directory = mkdtempSync(join(tmpdir(), "raffle-entry-feedback-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  recordTelegramSentMessage({
    chatId: "123",
    messageId: 77,
    alertKey: "entry:key",
    canonicalUrl: "https://example.test/entry-delivery-1",
    siteName: "example",
    sourceId: "entry-delivery-1",
    raffleName: "£1,000 Cash",
    sentAt: "2026-08-26T12:00:00.000Z",
  });

  try {
    for (const [index, value] of ["entered", "won", "lost"].entries()) {
      const result = await handleTelegramFeedbackUpdate({
        update_id: index + 1,
        callback_query: {
          id: `callback-${value}`,
          from: { id: 9 },
          data: `raffle_feedback:${value}`,
          message: { message_id: 77, chat: { id: 123 } },
        },
      }, {
        answerCallback: async () => undefined,
        logDirectory: directory,
        now: () => new Date("2026-08-26T13:00:00.000Z"),
      });
      assert.equal(result.status, "recorded");
    }
    assert.deepEqual(
      getTelegramFeedbackEvents().map((event) => event.classification),
      ["entered", "won", "lost"],
    );
  } finally {
    closeDatabaseForTests();
  }
});
