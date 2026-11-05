import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  formatSiteHealthDigest,
  recordSiteHealthEvents,
} from "../src/alerts/site-health.js";
import { appendSiteHealthReviewJsonl } from "../src/alerts/site-health-log.js";
import {
  closeDatabaseForTests,
  getSiteHealthIncidentStates,
  markSiteHealthEventRecorded,
  observeSiteHealthForAlerts,
  upsertCompetition,
  useDatabaseForTests,
} from "../src/storage/database.js";
import type {
  RawCompetition,
  SiteHealthNotificationEvent,
  SiteScanHealth,
  SiteScanStatus,
} from "../src/types.js";

function useTempDb(): string {
  const directory = mkdtempSync(join(tmpdir(), "raffle-site-health-"));
  const path = join(directory, "health.db");
  useDatabaseForTests(path);
  return path;
}

function health(
  status: SiteScanStatus,
  scannedAt: string,
  overrides: Partial<SiteScanHealth> = {},
): SiteScanHealth {
  return {
    siteName: "example",
    status,
    competitionsFound: status === "success" ? 2 : 0,
    cashCompetitionsFound: status === "success" ? 1 : 0,
    partialCompetitionsFound: status === "partial" ? 1 : 0,
    errorMessage: status === "success" || status === "empty" ? null : `${status} detail`,
    scannedAt,
    ...overrides,
  };
}

function storedCompetition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "stored-1",
    siteName: "example",
    url: "https://example.test/stored-1",
    name: "Stored future competition",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    maxEntriesPerUser: 10,
    cashAlternative: 1_000,
    drawDate: "2026-07-22T12:00:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

test("two stale empties contradicting an open future stored competition create a restart-safe incident", () => {
  const path = useTempDb();
  try {
    upsertCompetition(storedCompetition());
    assert.equal(observeSiteHealthForAlerts(
      health("empty", "2026-07-20T12:00:00.000Z"),
      new Date("2026-07-20T12:00:00.000Z"),
    ), null);

    closeDatabaseForTests();
    useDatabaseForTests(path);

    const incident = observeSiteHealthForAlerts(
      health("empty", "2026-07-20T14:00:00.000Z"),
      new Date("2026-07-20T14:00:00.000Z"),
    );
    assert.equal(incident?.kind, "incident");
    assert.equal(incident?.condition, "expected_competition_empty");
    assert.match(incident?.errorMessage ?? "", /1 stale open future competition/);
    assert.match(formatSiteHealthDigest([incident!]), /EXPECTED COMPETITIONS MISSING/);
    assert.equal(getSiteHealthIncidentStates()[0]?.incidentCondition, "expected_competition_empty");

    markSiteHealthEventRecorded(incident!, new Date("2026-07-20T14:01:00.000Z"));
    const recovery = observeSiteHealthForAlerts(
      health("success", "2026-07-20T14:05:00.000Z"),
      new Date("2026-07-20T14:05:00.000Z"),
    );
    assert.equal(recovery?.kind, "recovery");
    assert.equal(recovery?.condition, "expected_competition_empty");
  } finally {
    closeDatabaseForTests();
  }
});

test("new, dormant, sold-out, and not-yet-stale sites do not create empty incidents", () => {
  useTempDb();
  try {
    upsertCompetition(storedCompetition({
      sourceId: "past",
      siteName: "dormant",
      drawDate: "2026-07-19T12:00:00.000Z",
    }));
    upsertCompetition(storedCompetition({
      sourceId: "sold-out",
      siteName: "sold-out",
      ticketsSold: 100,
      maxTickets: 100,
    }));
    upsertCompetition(storedCompetition({
      sourceId: "fresh",
      siteName: "fresh",
      scrapedAt: "2026-07-20T11:30:00.000Z",
    }));
    upsertCompetition(storedCompetition({
      sourceId: "free",
      siteName: "free-only",
      name: "Free entry giveaway",
      entryPrice: 0,
    }));
    upsertCompetition(storedCompetition({
      sourceId: "instant",
      siteName: "instant-only",
      name: "Instant Wins Prize Pot",
      categories: ["instant-win"],
    }));
    upsertCompetition(storedCompetition({
      sourceId: "unvalued",
      siteName: "unvalued-only",
      cashAlternative: null,
      estimatedPrizeValue: null,
    }));

    for (const siteName of [
      "new-site",
      "dormant",
      "sold-out",
      "fresh",
      "free-only",
      "instant-only",
      "unvalued-only",
    ] as const) {
      assert.equal(observeSiteHealthForAlerts(
        health("empty", "2026-07-20T12:00:00.000Z", { siteName }),
        new Date("2026-07-20T12:00:00.000Z"),
      ), null);
      assert.equal(observeSiteHealthForAlerts(
        health("empty", "2026-07-20T14:00:00.000Z", { siteName }),
        new Date("2026-07-20T14:00:00.000Z"),
      ), null);
    }
    assert.ok(getSiteHealthIncidentStates().every((state) => state.incidentStartedAt === null));
  } finally {
    closeDatabaseForTests();
  }
});

test("an expected-empty incident expires silently after its stored draws close", () => {
  useTempDb();
  try {
    upsertCompetition(storedCompetition({ drawDate: "2026-07-20T13:00:00.000Z" }));
    observeSiteHealthForAlerts(
      health("empty", "2026-07-20T12:00:00.000Z"),
      new Date("2026-07-20T12:00:00.000Z"),
    );
    const incident = observeSiteHealthForAlerts(
      health("empty", "2026-07-20T12:05:00.000Z"),
      new Date("2026-07-20T12:05:00.000Z"),
    )!;
    markSiteHealthEventRecorded(incident, new Date("2026-07-20T12:06:00.000Z"));

    assert.equal(observeSiteHealthForAlerts(
      health("empty", "2026-07-20T14:00:00.000Z"),
      new Date("2026-07-20T14:00:00.000Z"),
    ), null);
    assert.equal(getSiteHealthIncidentStates()[0]?.incidentStartedAt, null);
    assert.equal(getSiteHealthIncidentStates()[0]?.incidentCondition, null);
  } finally {
    closeDatabaseForTests();
  }
});

test("site health incidents survive restart, remind after 24h, and recover only after a recorded incident", () => {
  const path = useTempDb();
  try {
    assert.equal(
      observeSiteHealthForAlerts(
        health("blocked", "2026-07-20T12:00:00.000Z"),
        new Date("2026-07-20T12:00:00.000Z"),
      ),
      null,
    );

    closeDatabaseForTests();
    useDatabaseForTests(path);

    const incident = observeSiteHealthForAlerts(
      health("partial", "2026-07-20T12:05:00.000Z"),
      new Date("2026-07-20T12:05:00.000Z"),
    );
    assert.equal(incident?.kind, "incident");
    assert.equal(incident?.consecutiveUnhealthy, 2);
    assert.equal(incident?.incidentStartedAt, "2026-07-20T12:00:00.000Z");
    markSiteHealthEventRecorded(incident!, new Date("2026-07-20T12:06:00.000Z"));

    assert.equal(
      observeSiteHealthForAlerts(
        health("transient_error", "2026-07-21T12:05:59.000Z"),
        new Date("2026-07-21T12:05:59.000Z"),
      ),
      null,
    );

    const reminder = observeSiteHealthForAlerts(
      health("blocked", "2026-07-21T12:06:00.000Z"),
      new Date("2026-07-21T12:06:00.000Z"),
    );
    assert.equal(reminder?.kind, "reminder");
    markSiteHealthEventRecorded(reminder!, new Date("2026-07-21T12:06:00.000Z"));

    const recovery = observeSiteHealthForAlerts(
      health("success", "2026-07-21T12:10:00.000Z"),
      new Date("2026-07-21T12:10:00.000Z"),
    );
    assert.equal(recovery?.kind, "recovery");
    assert.equal(recovery?.recoveredAt, "2026-07-21T12:10:00.000Z");

    const pendingRecovery = observeSiteHealthForAlerts(
      health("success", "2026-07-21T12:11:00.000Z"),
      new Date("2026-07-21T12:11:00.000Z"),
    );
    assert.equal(pendingRecovery?.kind, "recovery");
    assert.equal(pendingRecovery?.recoveredAt, recovery?.recoveredAt);

    markSiteHealthEventRecorded(pendingRecovery!, new Date("2026-07-21T12:11:30.000Z"));
    assert.equal(
      observeSiteHealthForAlerts(
        health("success", "2026-07-21T12:12:00.000Z"),
        new Date("2026-07-21T12:12:00.000Z"),
      ),
      null,
    );

    assert.equal(observeSiteHealthForAlerts(
      health("blocked", "2026-07-21T12:13:00.000Z"),
      new Date("2026-07-21T12:13:00.000Z"),
    ), null);
    const nextIncident = observeSiteHealthForAlerts(
      health("blocked", "2026-07-21T12:14:00.000Z"),
      new Date("2026-07-21T12:14:00.000Z"),
    );
    assert.equal(nextIncident?.kind, "incident");
    assert.equal(nextIncident?.incidentStartedAt, "2026-07-21T12:13:00.000Z");
  } finally {
    closeDatabaseForTests();
  }
});

test("empty and unrecorded recovery observations cannot create false health events", () => {
  useTempDb();
  try {
    assert.equal(observeSiteHealthForAlerts(
      health("blocked", "2026-07-20T12:00:00.000Z"),
      new Date("2026-07-20T12:00:00.000Z"),
    ), null);
    assert.equal(observeSiteHealthForAlerts(
      health("empty", "2026-07-20T12:01:00.000Z"),
      new Date("2026-07-20T12:01:00.000Z"),
    ), null);
    assert.equal(observeSiteHealthForAlerts(
      health("transient_error", "2026-07-20T12:02:00.000Z"),
      new Date("2026-07-20T12:02:00.000Z"),
    ), null);

    const unsentIncident = observeSiteHealthForAlerts(
      health("partial", "2026-07-20T12:03:00.000Z"),
      new Date("2026-07-20T12:03:00.000Z"),
    );
    assert.equal(unsentIncident?.kind, "incident");
    assert.equal(observeSiteHealthForAlerts(
      health("success", "2026-07-20T12:04:00.000Z"),
      new Date("2026-07-20T12:04:00.000Z"),
    ), null);
    assert.equal(getSiteHealthIncidentStates()[0]?.incidentStartedAt, null);
  } finally {
    closeDatabaseForTests();
  }
});

test("a failed health-ledger append leaves an incident pending for retry", () => {
  useTempDb();
  try {
    observeSiteHealthForAlerts(
      health("blocked", "2026-07-20T12:00:00.000Z"),
      new Date("2026-07-20T12:00:00.000Z"),
    );
    const incident = observeSiteHealthForAlerts(
      health("blocked", "2026-07-20T12:01:00.000Z"),
      new Date("2026-07-20T12:01:00.000Z"),
    )!;

    assert.equal(recordSiteHealthEvents([incident], () => {
      throw new Error("disk unavailable");
    }), "failed");
    assert.equal(getSiteHealthIncidentStates()[0]?.incidentAlertedAt, null);

    assert.equal(recordSiteHealthEvents(
      [incident],
      () => "/tmp/site-health-reviews/2026-07-20.jsonl",
      new Date("2026-07-20T12:01:30.000Z"),
      () => {
        throw new Error("database unavailable");
      },
    ), "logged");
    assert.equal(getSiteHealthIncidentStates()[0]?.incidentAlertedAt, null);

    const pending = observeSiteHealthForAlerts(
      health("transient_error", "2026-07-20T12:02:00.000Z"),
      new Date("2026-07-20T12:02:00.000Z"),
    )!;
    assert.equal(pending.kind, "incident");
    assert.equal(recordSiteHealthEvents(
      [pending],
      () => "/tmp/site-health-reviews/2026-07-20.jsonl",
      new Date("2026-07-20T12:03:00.000Z"),
    ), "logged");
    assert.equal(
      getSiteHealthIncidentStates()[0]?.incidentAlertedAt,
      "2026-07-20T12:03:00.000Z",
    );
  } finally {
    closeDatabaseForTests();
  }
});

test("the health ledger records and marks every event without digest truncation", () => {
  useTempDb();
  try {
    const events: SiteHealthNotificationEvent[] = [];
    for (const siteName of ["alpha", "bravo", "charlie"] as const) {
      observeSiteHealthForAlerts(
        health("blocked", "2026-07-20T12:00:00.000Z", { siteName }),
        new Date("2026-07-20T12:00:00.000Z"),
      );
      events.push(observeSiteHealthForAlerts(
        health("blocked", "2026-07-20T12:01:00.000Z", {
          siteName,
          errorMessage: "large failure detail ".repeat(30),
        }),
        new Date("2026-07-20T12:01:00.000Z"),
      )!);
    }

    let recordedEvents: readonly SiteHealthNotificationEvent[] = [];
    assert.equal(recordSiteHealthEvents(
      events,
      (batch) => {
        recordedEvents = batch;
        return "/tmp/site-health-reviews/2026-07-20.jsonl";
      },
      new Date("2026-07-20T12:02:00.000Z"),
    ), "logged");
    assert.equal(recordedEvents.length, events.length);
    const recorded = getSiteHealthIncidentStates()
      .filter((state) => state.incidentAlertedAt !== null);
    assert.equal(recorded.length, events.length);
  } finally {
    closeDatabaseForTests();
  }
});

test("site health review JSONL uses the London log date and preserves every event", () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-site-health-ledger-"));
  const events: SiteHealthNotificationEvent[] = [
    {
      kind: "incident",
      condition: "scan_failure",
      siteName: "alpha",
      status: "blocked",
      consecutiveUnhealthy: 2,
      incidentStartedAt: "2026-07-20T22:00:00.000Z",
      transitionAt: "2026-07-20T22:00:00.000Z",
      observedAt: "2026-07-20T23:29:00.000Z",
      recoveredAt: null,
      errorMessage: "HTTP 403",
    },
    {
      kind: "recovery",
      condition: "scan_failure",
      siteName: "bravo",
      status: "success",
      consecutiveUnhealthy: 0,
      incidentStartedAt: "2026-07-20T20:00:00.000Z",
      transitionAt: "2026-07-20T23:29:00.000Z",
      observedAt: "2026-07-20T23:29:00.000Z",
      recoveredAt: "2026-07-20T23:29:00.000Z",
      errorMessage: null,
    },
  ];

  const path = appendSiteHealthReviewJsonl(
    events,
    directory,
    new Date("2026-07-20T23:30:00.000Z"),
  );
  assert.equal(path, join(directory, "2026-07-21.jsonl"));
  const record = JSON.parse(readFileSync(path, "utf8")) as {
    schemaVersion: string;
    phase: string;
    recordedAt: string;
    ledgerTimezone: string;
    events: Array<SiteHealthNotificationEvent & { eventKey: string }>;
  };
  assert.equal(record.schemaVersion, "1");
  assert.equal(record.phase, "site_health");
  assert.equal(record.recordedAt, "2026-07-20T23:30:00.000Z");
  assert.equal(record.ledgerTimezone, "Europe/London");
  assert.equal(record.events.length, events.length);
  assert.deepEqual(record.events.map((event) => event.siteName), ["alpha", "bravo"]);
  assert.ok(record.events.every((event) => event.eventKey.length > 0));
});

test("site health JSONL isolates a torn prior append and keeps retry keys stable", () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-site-health-torn-ledger-"));
  const path = join(directory, "2026-07-20.jsonl");
  writeFileSync(path, '{"incomplete":', "utf8");
  const first: SiteHealthNotificationEvent = {
    kind: "reminder",
    condition: "scan_failure",
    siteName: "alpha",
    status: "blocked",
    consecutiveUnhealthy: 8,
    incidentStartedAt: "2026-07-19T12:00:00.000Z",
    transitionAt: "2026-07-20T12:01:00.000Z",
    observedAt: "2026-07-20T12:03:00.000Z",
    recoveredAt: null,
    errorMessage: "HTTP 403",
  };
  const retry = {
    ...first,
    observedAt: "2026-07-20T12:08:00.000Z",
    consecutiveUnhealthy: 9,
  };

  appendSiteHealthReviewJsonl([first], directory, new Date("2026-07-20T12:04:00.000Z"));
  appendSiteHealthReviewJsonl([retry], directory, new Date("2026-07-20T12:09:00.000Z"));
  const lines = readFileSync(path, "utf8").trim().split("\n");
  assert.equal(lines.length, 3);
  assert.throws(() => JSON.parse(lines[0]));
  const firstRecord = JSON.parse(lines[1]) as { events: Array<{ eventKey: string }> };
  const retryRecord = JSON.parse(lines[2]) as { events: Array<{ eventKey: string }> };
  assert.equal(firstRecord.events[0]?.eventKey, retryRecord.events[0]?.eventKey);
});

test("console health digest is deterministic, batched, and bounded", () => {
  const events: SiteHealthNotificationEvent[] = Array.from({ length: 20 }, (_, index) => ({
    kind: index % 3 === 0 ? "recovery" : index % 3 === 1 ? "reminder" : "incident",
    condition: "scan_failure",
    siteName: `site-${String(20 - index).padStart(2, "0")}`,
    status: index % 3 === 0 ? "success" : "blocked",
    consecutiveUnhealthy: index + 2,
    incidentStartedAt: "2026-07-20T12:00:00.000Z",
    transitionAt: "2026-07-21T12:00:00.000Z",
    observedAt: "2026-07-21T12:00:00.000Z",
    recoveredAt: index % 3 === 0 ? "2026-07-21T12:00:00.000Z" : null,
    errorMessage: "very long health error ".repeat(30),
  }));

  const fullDigest = formatSiteHealthDigest(events, 4_000);
  const digest = formatSiteHealthDigest(events, 420);
  assert.ok(digest.length <= 420, `digest was ${digest.length} characters`);
  assert.match(digest, /^Raffle bot site health \(20 events\)/);
  assert.match(digest, /events omitted/);
  assert.ok(fullDigest.indexOf("INCIDENT") < fullDigest.indexOf("REMINDER"));
});

test("recording site health never calls Telegram even when Telegram is configured", () => {
  useTempDb();
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldChat = process.env.TELEGRAM_CHAT_ID;
  const oldFetch = globalThis.fetch;
  let fetchCalls = 0;

  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "opportunity-chat";
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };

  try {
    observeSiteHealthForAlerts(
      health("blocked", "2026-07-20T12:00:00.000Z", { siteName: "alpha" }),
      new Date("2026-07-20T12:00:00.000Z"),
    );
    const event = observeSiteHealthForAlerts(
      health("blocked", "2026-07-20T12:01:00.000Z", { siteName: "alpha" }),
      new Date("2026-07-20T12:01:00.000Z"),
    )!;
    assert.equal(recordSiteHealthEvents(
      [event],
      () => "/tmp/site-health-reviews/2026-07-20.jsonl",
      new Date("2026-07-20T12:02:00.000Z"),
    ), "logged");
    assert.equal(fetchCalls, 0);
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = oldChat;
    globalThis.fetch = oldFetch;
    closeDatabaseForTests();
  }
});
