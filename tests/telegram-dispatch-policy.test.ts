import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  sendTelegramReminder,
  sendTelegramOpportunityDetailed,
  sendTelegramOpportunity,
  telegramOpportunityAvailability,
} from "../src/alerts/telegram.js";
import {
  closeDatabaseForTests,
  getTelegramSentMessage,
  recordAlertSent,
  useDatabaseForTests,
} from "../src/storage/database.js";
import { CONFIG } from "../src/config.js";
import type { Competition, EntryRecommendation } from "../src/types.js";

const minute = 60_000;

function competition(overrides: Partial<Competition> = {}): Competition {
  return {
    sourceId: "dispatch-1", siteName: "example", url: "https://example.com/dispatch-1",
    name: "£1,000 Cash", entryPrice: 1, ticketsSold: 5, maxTickets: 100,
    maxEntriesPerUser: 10, maxEntriesPerUserSource: "site", cashAlternative: 1_000,
    valuationSource: "cash", valuationConfidence: "high", drawDate: "2026-08-27T12:00:00.000Z",
    isAutoDraw: true, categories: [], scrapedAt: new Date().toISOString(), prizeValue: 1_000,
    evPerTicket: 100, optimalTickets: 10, optimalCost: 10, winProbability: 2 / 3,
    lossProbability: 1 / 3, expectedReturn: 666.67, netEV: 656.67, returnRatio: 65.667,
    houseEdge: -9, sellThrough: 0.05, timeToClose: 45 * 60_000,
    ...overrides,
  };
}

function recommendation(
  overrides: Partial<EntryRecommendation> = {},
): EntryRecommendation {
  const currentScenario = Object.freeze({
    tickets: 10,
    cost: 10,
    winProbability: 2 / 3,
    lossProbability: 1 / 3,
    expectedReturn: 666.67,
    netEV: 656.67,
    returnRatio: 65.667,
    ...overrides.currentScenario,
  });
  const projectedScenario = overrides.projectedScenario === null
    ? null
    : Object.freeze({
      tickets: 10,
      cost: 10,
      winProbability: 0.5,
      lossProbability: 0.5,
      expectedReturn: 500,
      netEV: 490,
      returnRatio: 49,
      ...overrides.projectedScenario,
    });
  return Object.freeze({
    stars: 2 as const,
    projectedSellThrough: 0.1,
    reason: "positive current and projected entry",
    ...overrides,
    currentScenario,
    projectedScenario,
  });
}

test("Telegram dispatch reports disabled, sent, and cooldown outcomes", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "raffle-telegram-"));
  useDatabaseForTests(join(directory, "alerts.db"));

  try {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    assert.equal(
      await sendTelegramOpportunity(competition(), recommendation()),
      "disabled",
    );

    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat";
    globalThis.fetch = async () => new Response(JSON.stringify({
      ok: true,
      result: { message_id: 1, chat: { id: "test-chat" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
    assert.equal(
      await sendTelegramOpportunity(competition(), recommendation()),
      "sent",
    );
    assert.equal(
      await sendTelegramOpportunity(competition(), recommendation()),
      "cooldown",
    );
    assert.equal(
      await sendTelegramOpportunity(competition(), recommendation({category:"value",stars:1})),
      "cooldown",
      "changing entry category must not send a second alert for the same draw",
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

test("Telegram sends feedback buttons and stores message-to-raffle correlation", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "raffle-telegram-feedback-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "123";
  let requestBody: Record<string, any> | null = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      ok: true,
      result: {
        message_id: 77,
        chat: { id: 123 },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const comp = competition({
      sourceId: "feedback-correlation",
      url: "https://example.com/feedback-correlation",
    });
    const result = await sendTelegramOpportunityDetailed(
      comp,
      recommendation(),
    );

    assert.equal(result.outcome, "sent");
    assert.equal(result.messageId, 77);
    assert.deepEqual(
      requestBody?.reply_markup?.inline_keyboard?.[0]?.map(
        (button: { text: string; callback_data: string }) => ({
          text: button.text,
          callbackData: button.callback_data,
        }),
      ),
      [
        { text: "Entered", callbackData: "raffle_feedback:entered" },
        { text: "Won", callbackData: "raffle_feedback:won" },
        { text: "Lost", callbackData: "raffle_feedback:lost" },
      ],
    );
    assert.equal(
      getTelegramSentMessage("123", 77)?.sourceId,
      "feedback-correlation",
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

test("Telegram reminders use the requesting chat without action buttons", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "default-chat";
  let requestBody: Record<string, any> | null = null;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      ok: true,
      result: { message_id: 78, chat: { id: 456 } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    assert.equal(
      await sendTelegramReminder(competition(), recommendation(), "456"),
      "sent",
    );
    assert.equal(requestBody?.chat_id, "456");
    assert.match(requestBody?.text, /^⏰ Reminder · /);
    assert.equal(requestBody?.reply_markup, undefined);
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
    globalThis.fetch = oldFetch;
  }
});

test("Telegram dispatch times out instead of hanging the monitor", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  const oldTimeout = CONFIG.alerts.telegramTimeoutMs;
  const directory = mkdtempSync(join(tmpdir(), "raffle-telegram-timeout-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  CONFIG.alerts.telegramTimeoutMs = 20;
  globalThis.fetch = async (_url, init) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    }, { once: true });
  });

  try {
    const startedAt = Date.now();
    const timedOut = competition({
      sourceId: "dispatch-timeout",
      url: "https://example.com/dispatch-timeout",
    });
    assert.equal(
      await sendTelegramOpportunity(timedOut, recommendation()),
      "failed",
    );
    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal(telegramOpportunityAvailability(timedOut), "ready");
  } finally {
    CONFIG.alerts.telegramTimeoutMs = oldTimeout;
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
    globalThis.fetch = oldFetch;
    closeDatabaseForTests();
  }
});

test("Telegram retries Markdown entity parse failures as plain text", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "raffle-telegram-markdown-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "123";
  const requestBodies: Record<string, any>[] = [];
  globalThis.fetch = async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    if (requestBodies.length === 1) {
      return new Response(JSON.stringify({
        ok: false,
        description: "Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 71",
      }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      ok: true,
      result: {
        message_id: 88,
        chat: { id: 123 },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await sendTelegramOpportunityDetailed(
      competition({
        sourceId: "markdown-entity",
        url: "https://example.com/markdown-entity",
        name: "*LOW ODDS* 5060 Ti PC - CiT Eclipse Case #53",
      }),
      recommendation(),
    );

    assert.equal(result.outcome, "sent");
    assert.equal(result.messageId, 88);
    assert.equal(requestBodies.length, 2);
    assert.equal(requestBodies[0].parse_mode, "Markdown");
    assert.equal(requestBodies[1].parse_mode, undefined);
    assert.equal(
      getTelegramSentMessage("123", 88)?.sourceId,
      "markdown-entity",
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

test("legacy alert keys still suppress the current entry key", () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const directory = mkdtempSync(join(tmpdir(), "raffle-telegram-legacy-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";

  try {
    const legacyCases = [
      ["legacy-source", "trend:example:legacy-source"],
      ["legacy-buy", "trend:buy-window:example:legacy-buy"],
      ["legacy-reminder", "trend:reminder-20m:example:legacy-reminder"],
      ["legacy-final", "trend:final-window:example:legacy-final"],
    ] as const;
    for (const [sourceId, key] of legacyCases) {
      const comp = competition({
        sourceId,
        url: `https://example.com/${sourceId}`,
      });
      recordAlertSent(key);
      assert.equal(telegramOpportunityAvailability(comp), "cooldown");
    }

    const hashedReminder = competition({
      sourceId: "legacy-reminder-hash",
      url: "https://example.com/legacy-reminder-hash",
    });
    const identity = createHash("sha256")
      .update(hashedReminder.url)
      .digest("hex")
      .slice(0, 24);
    recordAlertSent(`trend:reminder-20m:${identity}`);
    assert.equal(telegramOpportunityAvailability(hashedReminder), "cooldown");
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
    closeDatabaseForTests();
  }
});

test("entry dispatch sends at most one message per London draw day", async () => {
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  const directory = mkdtempSync(join(tmpdir(), "raffle-telegram-entry-day-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "test-chat";
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      ok: true,
      result: { message_id: 90 + fetchCalls, chat: { id: "test-chat" } },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const early = competition({ sourceId: "lifecycle", url: "https://example.com/lifecycle" });
    const final = competition({ ...early, timeToClose: 10 * 60_000 });

    assert.deepEqual(await Promise.all([
      sendTelegramOpportunity(early, recommendation()),
      sendTelegramOpportunity(final, recommendation()),
    ]), ["sent", "cooldown"]);
    assert.equal(fetchCalls, 1);
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
    globalThis.fetch = oldFetch;
    closeDatabaseForTests();
  }
});
