import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Competition } from "../src/types.js";

type AnyModule = Record<string, any>;
const minute = 60_000;

function competition(overrides: Record<string, unknown> = {}): Competition {
  const timeToClose = typeof overrides.timeToClose === "number"
    ? overrides.timeToClose
    : 30 * minute;
  return {
    sourceId: "telegram-policy-1",
    siteName: "telegram-example",
    url: "https://example.test/telegram-policy-1?utm_source=test",
    name: "£500 Cash",
    entryPrice: 1,
    ticketsSold: 3,
    maxTickets: 100,
    maxEntriesPerUser: 10,
    maxEntriesPerUserSource: "site",
    inventorySource: "exact",
    cashAlternative: 500,
    estimatedPrizeValue: null,
    valuationSource: "cash",
    valuationConfidence: "high",
    valuationNotes: "Explicit cash alternative",
    drawDate: new Date(Date.now() + timeToClose).toISOString(),
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
    prizeValue: 500,
    evPerTicket: 100,
    optimalTickets: 3,
    optimalCost: 3,
    winProbability: 0.5,
    lossProbability: 0.5,
    expectedReturn: 250,
    netEV: 247,
    returnRatio: 82.33,
    houseEdge: -4,
    sellThrough: 0.03,
    timeToClose,
    ...overrides,
  } as unknown as Competition;
}

function recommendation(overrides: Record<string, unknown> = {}) {
  return Object.freeze({
    stars: 2,
    currentScenario: {
      tickets: 3,
      cost: 3,
      winProbability: 0.5,
      lossProbability: 0.5,
      expectedReturn: 250,
      netEV: 247,
      returnRatio: 82.33,
    },
    projectedScenario: {
      tickets: 3,
      cost: 3,
      winProbability: 0.65,
      lossProbability: 0.35,
      expectedReturn: 325,
      netEV: 322,
      returnRatio: 107.33,
    },
    projectedSellThrough: 0.6,
    reason: "internal rule explanation must not leak into Telegram",
    ...overrides,
  });
}

async function telegramApi(): Promise<AnyModule> {
  return await import("../src/alerts/telegram.js") as unknown as AnyModule;
}

async function storageApi(): Promise<AnyModule> {
  return await import("../src/storage/database.js") as unknown as AnyModule;
}

test("Telegram entry formatter is a terse two-line recommendation", async () => {
  const telegram = await telegramApi();
  assert.equal(typeof telegram.formatTelegramOpportunityMessage, "function");
  const comp = competition();
  const rec = recommendation();
  const before = JSON.stringify(rec);
  const message = telegram.formatTelegramOpportunityMessage(comp, rec);

  assert.equal(JSON.stringify(rec), before);
  assert.ok(message.split("\n").filter(Boolean).length <= 2, message);
  assert.match(message, /⭐/);
  assert.match(message, /500 Cash/i);
  assert.match(message, /3\/100 sold now/i);
  assert.match(message, /Buy now: 3\s*[x×]\s*£?1/i);
  assert.match(message, /£3\.00 total/i);
  assert.match(message, /loss chance/i);
  assert.match(message, /net\s*EV|EV/i);
  assert.match(message, /projected loss chance/i);
  assert.match(message, /projected EV/i);
  assert.match(message, /Draw in 30m/i);
  assert.match(message, /https:\/\/example\.test\/telegram-policy-1/);
  assert.doesNotMatch(message, /watch|monitor|codex|rule reason/i);

  const currentMessage = telegram.formatTelegramOpportunityMessage(
    comp,
    recommendation({ projectedScenario: null }),
  );
  assert.match(currentMessage, /50\.0% loss chance/i);
  assert.match(currentMessage, /\+£247 EV/i);
  assert.doesNotMatch(currentMessage, /projected/i);
});

test("Telegram entry formatter bounds an untrusted long title", async () => {
  const telegram = await telegramApi();
  const message = telegram.formatTelegramOpportunityMessage(
    competition({ name: "A".repeat(5_000) }),
    recommendation({ reason: "B".repeat(5_000) }),
  );

  assert.ok(message.length < 500, `message is ${message.length} characters`);
  assert.equal(message.split("\n").length, 2);
});

test("Telegram sender treats an empty successful HTTP response as failure without cooldown", async () => {
  const telegram = await telegramApi();
  const storage = await storageApi();
  const directory = mkdtempSync(join(tmpdir(), "telegram-entry-policy-"));
  storage.useDatabaseForTests(join(directory, "alerts.db"));
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  const responses = [
    new Response("{}", { status: 200 }),
    new Response(JSON.stringify({
      ok: true,
      result: { message_id: 401, chat: { id: "test-chat" } },
    }), { status: 200 }),
  ];
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return responses.shift() ?? new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    assert.equal(typeof telegram.sendTelegramOpportunity, "function");
    const candidate = competition();
    const first = await telegram.sendTelegramOpportunity(candidate, recommendation());
    const second = await telegram.sendTelegramOpportunity(candidate, recommendation());
    const outcome = (value: unknown) => typeof value === "string"
      ? value
      : (value as { outcome?: string }).outcome;
    assert.equal(outcome(first), "failed");
    assert.equal(outcome(second), "sent");
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
    storage.closeDatabaseForTests();
  }
});

test("new cooldown keys use the London draw date, not the old route stage", async () => {
  const telegram = await telegramApi();
  assert.equal(typeof telegram.makeOpportunityAlertKey, "function");
  const sameLondonDateEarly = competition({
    drawDate: "2026-08-27T00:30:00.000Z",
  });
  const sameLondonDateLate = competition({
    drawDate: "2026-08-27T22:30:00.000Z",
  });
  const nextLondonDate = competition({
    drawDate: "2026-08-28T00:30:00.000Z",
  });
  const key = (comp: Competition) => telegram.makeOpportunityAlertKey(comp);

  assert.equal(key(sameLondonDateEarly), key(sameLondonDateLate));
  assert.notEqual(key(sameLondonDateEarly), key(nextLondonDate));
  assert.match(key(sameLondonDateEarly), /2026-08-27/);
});

test("legacy watch keys suppress for 24 hours but are not the new key", async () => {
  const telegram = await telegramApi();
  const storage = await storageApi();
  const directory = mkdtempSync(join(tmpdir(), "telegram-legacy-policy-"));
  storage.useDatabaseForTests(join(directory, "alerts.db"));
  const comp = competition({ siteName: "legacy-site", sourceId: "legacy-entry" });
  const legacyKey = "trend:buy-window:legacy-site:legacy-entry";
  storage.recordAlertSent(legacyKey);
  const newKey = telegram.makeOpportunityAlertKey(comp);
  try {
    assert.notEqual(newKey, legacyKey);
    assert.equal(storage.wasAlertSentRecently(newKey, 24 * 60 * 60 * 1000), false);
    const oldToken = process.env.TELEGRAM_BOT_TOKEN;
    const oldChat = process.env.TELEGRAM_CHAT_ID;
    const oldFetch = globalThis.fetch;
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat";
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 402 } }), { status: 200 });
    };
    try {
      const result = await telegram.sendTelegramOpportunity(comp, recommendation());
      const outcome = typeof result === "string" ? result : result.outcome;
      assert.equal(outcome, "cooldown");
      assert.equal(requests, 0);
      assert.equal(storage.wasAlertSentRecently(newKey, 24 * 60 * 60 * 1000), false);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
      else process.env.TELEGRAM_BOT_TOKEN = oldToken;
      if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
      else process.env.TELEGRAM_CHAT_ID = oldChat;
    }
  } finally {
    storage.closeDatabaseForTests();
  }
});

test("feedback buttons record entered, won, and lost while old other rows still parse", async () => {
  const telegramFeedback = await import("../src/alerts/telegram-feedback.js") as unknown as AnyModule;
  const storage = await storageApi();
  const directory = mkdtempSync(join(tmpdir(), "telegram-feedback-policy-"));
  storage.useDatabaseForTests(join(directory, "feedback.db"));
  storage.recordTelegramSentMessage({
    chatId: "123",
    messageId: 77,
    alertKey: "entry:2026-08-27",
    canonicalUrl: "https://example.test/entry",
    siteName: "example",
    sourceId: "entry",
    raffleName: "£500 Cash",
    sentAt: "2026-08-26T10:00:00.000Z",
  });
  try {
    const markup = telegramFeedback.telegramFeedbackReplyMarkup();
    const callbacks = markup.inline_keyboard.flat().map((button: { callback_data: string }) => button.callback_data);
    assert.deepEqual(callbacks, [
      "raffle_feedback:entered",
      "raffle_feedback:won",
      "raffle_feedback:lost",
      "raffle_action:fix_site",
      "raffle_action:remind",
    ]);

    for (const [index, value] of ["entered", "won", "lost"].entries()) {
      const result = await telegramFeedback.handleTelegramFeedbackUpdate({
        update_id: 700 + index,
        callback_query: {
          id: `feedback-${value}`,
          data: `raffle_feedback:${value}`,
          message: { message_id: 77, chat: { id: 123 } },
        },
      }, { logDirectory: directory, answerCallback: async () => undefined });
      assert.equal(result.status, "recorded");
    }

    storage.recordTelegramFeedbackEvent({
      updateId: 799,
      chatId: "123",
      messageId: 77,
      alertKey: "entry:2026-08-27",
      canonicalUrl: "https://example.test/entry",
      siteName: "example",
      sourceId: "entry",
      raffleName: "£500 Cash",
      sentAt: "2026-08-26T10:00:00.000Z",
      classification: "other",
      feedbackValue: "👎",
      source: "inline_button",
      actorId: null,
      occurredAt: "2026-08-26T11:00:00.000Z",
      receivedAt: "2026-08-26T11:00:00.000Z",
      rawJson: "{}",
    });
    assert.deepEqual(
      storage.getTelegramFeedbackEvents().map((event: { classification: string }) => event.classification),
      ["entered", "won", "lost", "other"],
    );
  } finally {
    storage.closeDatabaseForTests();
  }
});
