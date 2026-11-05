import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  handleTelegramFeedbackUpdate,
  pollTelegramFeedbackOnce,
} from "../src/alerts/telegram-feedback.js";
import {
  closeDatabaseForTests,
  getTelegramFeedbackOffset,
  getTelegramFeedbackEvents,
  recordTelegramSentMessage,
  useDatabaseForTests,
} from "../src/storage/database.js";

import { getEntryResults } from "../src/storage/outcomes.js";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "telegram-feedback-"));
  useDatabaseForTests(join(directory, "feedback.db"));
  recordTelegramSentMessage({
    chatId: "123",
    messageId: 42,
    alertKey: "trend:final-window:abc",
    canonicalUrl: "https://example.test/raffle",
    siteName: "example",
    sourceId: "raffle-1",
    raffleName: "£1,000 Cash",
    sentAt: "2026-07-26T10:00:00.000Z",
  });
  return directory;
}

test("Telegram feedback records entered and legacy other button presses", async () => {
  const directory = setup();
  const answered: string[] = [];
  try {
    const entered = await handleTelegramFeedbackUpdate({
      update_id: 100,
      callback_query: {
        id: "callback-entered",
        from: { id: 7 },
        data: "raffle_feedback:entered",
        message: {
          message_id: 42,
          date: 1785056400,
          chat: { id: 123 },
        },
      },
    }, {
      logDirectory: directory,
      now: () => new Date("2026-07-26T11:00:00.000Z"),
      answerCallback: async (id) => {
        answered.push(id);
      },
    });
    const other = await handleTelegramFeedbackUpdate({
      update_id: 101,
      callback_query: {
        id: "callback-other",
        from: { id: 7 },
        data: "raffle_feedback:other",
        message: { message_id: 42, chat: { id: 123 } },
      },
    }, {
      logDirectory: directory,
      answerCallback: async (id) => {
        answered.push(id);
      },
    });

    assert.equal(entered.status, "recorded");
    assert.equal(other.status, "recorded");
    assert.deepEqual(
      getTelegramFeedbackEvents().map((event) => ({
        classification: event.classification,
        feedbackValue: event.feedbackValue,
        source: event.source,
      })),
      [
        { classification: "entered", feedbackValue: "entered", source: "inline_button" },
        { classification: "other", feedbackValue: "other", source: "inline_button" },
      ],
    );
    assert.deepEqual(answered, ["callback-entered", "callback-other"]);
    assert.equal(
      getTelegramFeedbackEvents()[0]?.occurredAt,
      "2026-07-26T11:00:00.000Z",
    );
    assert.match(
      readFileSync(join(directory, "2026-07-26.jsonl"), "utf8"),
      /raffle-1/,
    );
  } finally {
    closeDatabaseForTests();
  }
});

test("Telegram action buttons start a site check and schedule a reminder", async () => {
  setup();
  const actions: string[] = [];
  const answers: string[] = [];
  try {
    const dependencies = {
      startSiteCheck: async (
        message: { sourceId: string },
        alertText: string | null,
      ) => {
        actions.push(`fix:${message.sourceId}:${alertText}`);
        return true;
      },
      scheduleReminder: (message: { sourceId: string }) => {
        actions.push(`remind:${message.sourceId}`);
        return "scheduled" as const;
      },
      answerCallback: async (_id: string, text: string) => {
        answers.push(text);
      },
    };
    const update = (updateId: number, action: string) => ({
      update_id: updateId,
      callback_query: {
        id: `callback-${action}`,
        data: `raffle_action:${action}`,
        message: {
          message_id: 42,
          chat: { id: 123 },
          text: "0/180 sold now",
        },
      },
    });

    assert.equal(
      (await handleTelegramFeedbackUpdate(update(110, "fix_site"), dependencies)).status,
      "action_handled",
    );
    assert.equal(
      (await handleTelegramFeedbackUpdate(update(111, "remind"), dependencies)).status,
      "action_handled",
    );
    assert.deepEqual(actions, [
      "fix:raffle-1:0/180 sold now",
      "remind:raffle-1",
    ]);
    assert.deepEqual(answers, [
      "Codex started a read-only site check.",
      "Reminder scheduled for 10–15 minutes before the draw.",
    ]);
    assert.deepEqual(getTelegramFeedbackEvents(), []);
  } finally {
    closeDatabaseForTests();
  }
});

test("native reaction changes preserve other and removed instead of inventing a reason", async () => {
  const directory = setup();
  try {
    await handleTelegramFeedbackUpdate({
      update_id: 102,
      message_reaction: {
        chat: { id: 123 },
        message_id: 42,
        date: 1785060300,
        old_reaction: [],
        new_reaction: [{ type: "emoji", emoji: "🤔" }],
        user: { id: 7 },
      },
    }, { logDirectory: directory });
    await handleTelegramFeedbackUpdate({
      update_id: 103,
      message_reaction: {
        chat: { id: 123 },
        message_id: 42,
        date: 1785060360,
        old_reaction: [{ type: "emoji", emoji: "🤔" }],
        new_reaction: [],
        user: { id: 7 },
      },
    }, { logDirectory: directory });

    assert.deepEqual(
      getTelegramFeedbackEvents().map((event) => event.classification),
      ["other", "removed"],
    );
    assert.equal(getTelegramFeedbackEvents()[0]?.feedbackValue, "🤔");
  } finally {
    closeDatabaseForTests();
  }
});

test("unknown messages and duplicate Telegram updates do not create feedback data", async () => {
  const directory = setup();
  try {
    const unknown = await handleTelegramFeedbackUpdate({
      update_id: 104,
      callback_query: {
        id: "unknown",
        from: { id: 7 },
        data: "raffle_feedback:entered",
        message: { message_id: 999, chat: { id: 123 } },
      },
    }, { logDirectory: directory });
    const update = {
      update_id: 105,
      callback_query: {
        id: "duplicate",
        from: { id: 7 },
        data: "raffle_feedback:entered",
        message: { message_id: 42, chat: { id: 123 } },
      },
    };
    await handleTelegramFeedbackUpdate(update, { logDirectory: directory });
    const duplicate = await handleTelegramFeedbackUpdate(update, {
      logDirectory: directory,
    });

    assert.equal(unknown.status, "ignored_unknown_message");
    assert.equal(duplicate.status, "duplicate");
    assert.equal(getTelegramFeedbackEvents().length, 1);
  } finally {
    closeDatabaseForTests();
  }
});

test("Telegram polling requests feedback updates and advances the durable offset", async () => {
  const directory = setup();
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  let requestBody: Record<string, any> | null = null;
  try {
    const result = await pollTelegramFeedbackOnce({
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          ok: true,
          result: [{
            update_id: 106,
            callback_query: {
              id: "polled",
              from: { id: 7 },
              data: "raffle_feedback:entered",
              message: { message_id: 42, chat: { id: 123 } },
            },
          }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      dependencies: {
        logDirectory: directory,
        answerCallback: async () => undefined,
      },
    });

    assert.deepEqual(result, {
      received: 1,
      recorded: 1,
      nextOffset: 107,
    });
    assert.equal(getTelegramFeedbackOffset(), 107);
    assert.equal(requestBody?.offset, 0);
    assert.deepEqual(
      requestBody?.allowed_updates,
      ["callback_query", "message_reaction", "message"],
    );
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    closeDatabaseForTests();
  }
});

test("Telegram polling does not acknowledge an API failure", async () => {
  const directory = setup();
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  try {
    await assert.rejects(
      pollTelegramFeedbackOnce({
        fetchImpl: async () => new Response(JSON.stringify({
          ok: false,
          description: "Conflict: webhook active",
        }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
        dependencies: {
          logDirectory: directory,
          answerCallback: async () => undefined,
        },
      }),
      /webhook active/,
    );
    assert.equal(getTelegramFeedbackOffset(), 0);
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    closeDatabaseForTests();
  }
});


test("Telegram amount replies record actual totals without double counting or accepting unknown messages", async () => {
  const directory = setup();
  const replies: string[] = [];
  const dependencies = {logDirectory:directory,replyToMessage:async (_chat: string,_id: number,text: string)=>{replies.push(text);}};
  const spent = {update_id:900,message:{message_id:99,chat:{id:123},text:"/spent 12.50",reply_to_message:{message_id:42}}};
  try {
    assert.equal((await handleTelegramFeedbackUpdate(spent,dependencies)).status,"recorded");
    assert.equal((await handleTelegramFeedbackUpdate(spent,dependencies)).status,"duplicate");
    assert.equal(getEntryResults().totals.knownSpend,12.5);
    await handleTelegramFeedbackUpdate({update_id:901,message:{...spent.message,text:"/return 40"}},dependencies);
    assert.equal(getEntryResults().totals.realisedNet,27.5);
    assert.equal(getEntryResults().totals.entries,1);
    assert.equal((await handleTelegramFeedbackUpdate({update_id:902,message:{...spent.message,reply_to_message:{message_id:999}}},dependencies)).status,"ignored_unknown_message");
    assert.match(replies[0] ?? "",/actual spend: £12.50/);
  } finally {closeDatabaseForTests();}
});

test("replayed button updates cannot replace a later recorded outcome", async () => {
  const directory=setup();
  const dependencies={logDirectory:directory,answerCallback:async()=>{},replyToMessage:async()=>{}};
  const lost={update_id:910,callback_query:{id:"lost",data:"raffle_feedback:lost",message:{message_id:42,chat:{id:123}}}};
  try {
    await handleTelegramFeedbackUpdate(lost,dependencies);
    await handleTelegramFeedbackUpdate({update_id:911,message:{message_id:100,chat:{id:123},text:"/return 40",reply_to_message:{message_id:42}}},dependencies);
    await handleTelegramFeedbackUpdate(lost,dependencies);
    assert.equal(getEntryResults().totals.won,1);
    assert.equal(getEntryResults().entries[0]?.received,40);
  } finally {closeDatabaseForTests();}
});
