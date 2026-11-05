import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { enrichCompetitionAt } from "../src/metrics/calculator.js";
import { processEntryCandidates } from "../src/alerts/buy-review.js";
import { reviewAlertWithCodex } from "../src/alerts/codex-review.js";
import { appendAlertDecisionJsonl } from "../src/alerts/decision-log.js";
import { getAlertDecisions, getCachedAlertReview, recordAlertDecision, closeDatabaseForTests, useDatabaseForTests } from "../src/storage/database.js";

test("Codex review fails closed when the CLI is unavailable", async () => {
  const result = await reviewAlertWithCodex(
    { stage: "entry-window", route: "entry", competition: {} },
    { runner: async () => { throw new Error("Codex CLI unavailable"); } },
  );
  assert.equal(result.decision, "error");
  assert.match(result.reason, /Codex CLI unavailable/);
});

test("Codex review input hash covers runtime, schema, economics, valuation, trend, and stage", async () => {
  const base = {
    stage: "entry-window",
    route: "entry",
    competition: { entryPrice: 1, ticketsSold: 10 },
    valuation: { value: 1_000, confidence: "high" },
    recommendation: { stars: 2, reason: "positive current and projected entry" },
    trend: { projectedSellThrough: 0.2 },
  };
  const hashes = await Promise.all([
    reviewAlertWithCodex(base, { runtime: "a", schemaVersion: "1", dryRun: true }),
    reviewAlertWithCodex({ ...base, stage: "other" }, { runtime: "a", schemaVersion: "1", dryRun: true }),
    reviewAlertWithCodex(base, { runtime: "b", schemaVersion: "1", dryRun: true }),
    reviewAlertWithCodex(base, { runtime: "a", schemaVersion: "2", dryRun: true }),
  ]);
  assert.equal(new Set(hashes.map((result) => result.inputHash)).size, hashes.length);
});

test("entry review uses the deterministic recommendation and has no watch route", async () => {
  let prompt = "";
  let schemaPath = "";
  const result = await reviewAlertWithCodex(
    {
      stage: "entry-window",
      route: "entry",
      competition: { title: "£1,000 Cash" },
      recommendation: {
        stars: 2,
        currentScenario: { tickets: 1, cost: 1, winProbability: 0.1, netEV: 99, returnRatio: 100 },
        projectedScenario: { tickets: 1, cost: 1, winProbability: 0.08, netEV: 79, returnRatio: 80 },
        projectedSellThrough: 0.2,
        reason: "positive current and projected entry",
      },
    },
    {
      runner: async (nextPrompt, nextSchemaPath) => {
        prompt = nextPrompt;
        schemaPath = nextSchemaPath;
        return { decision: "approve", reason: "consistent", issues: [] };
      },
    },
  );

  assert.equal(result.decision, "approve");
  assert.match(schemaPath, /codex-alert-review\.schema\.json$/);
  assert.match(prompt, /deterministic recommendation is authoritative/i);
  assert.match(prompt, /only route is entry/i);
  assert.match(prompt, /"route":"entry"/i);
  assert.match(prompt, /"stars":2/i);
  assert.doesNotMatch(prompt, /watch is monitor-only|buy is permitted only in the final-window|do not reject a watch solely/i);
});

test("one-star entry review permits missing trend data and an unverified operator cap", async () => {
  const prompts: string[] = [];
  for (const recommendation of [
    {
      stars: 1,
      currentScenario: { tickets: 1, cost: 1, winProbability: 0.1, netEV: 9, returnRatio: 10 },
      projectedScenario: null,
      projectedSellThrough: null,
      reason: "trend data missing",
    },
    {
      stars: 1,
      currentScenario: { tickets: 1, cost: 1, winProbability: 0.1, netEV: 9, returnRatio: 10 },
      projectedScenario: null,
      projectedSellThrough: 0.2,
      reason: "operator cap unverified; one ticket evaluated",
    },
  ]) {
    const result = await reviewAlertWithCodex(
      {
        stage: "entry-window",
        route: "entry",
        competition: { title: "£100 Cash", maxEntriesPerUserSource: recommendation.reason === "trend data missing" ? "site" : "fallback" },
        recommendation,
      },
      {
        runner: async (nextPrompt) => {
          prompts.push(nextPrompt);
          return { decision: "approve", reason: "consistent", issues: [] };
        },
      },
    );
    assert.equal(result.decision, "approve");
  }

  assert.equal(prompts.length, 2);
  assert.match(prompts[0]!, /one star can have missing trend data or an unverified operator cap/i);
  assert.match(prompts[0]!, /"stars":1/i);
  assert.match(prompts[0]!, /"reason":"trend data missing"/i);
  assert.match(prompts[1]!, /"maxEntriesPerUserSource":"fallback"/i);
  assert.match(prompts[1]!, /one star can have missing trend data or an unverified operator cap/i);
});

test("preserves explicit cash alternatives for physical prize titles", async () => {
  let prompt = "";
  await reviewAlertWithCodex(
    {
      stage: "entry-window",
      route: "entry",
      competition: { title: "Win an iPhone 17 and Airpods" },
      valuation: {
        cashAlternative: 600,
        source: "cash",
        confidence: "high",
        notes: "Explicit cash alternative in current detail payload",
      },
    },
    {
      runner: async (nextPrompt) => {
        prompt = nextPrompt;
        return { decision: "approve", reason: "consistent", issues: [] };
      },
    },
  );

  assert.match(prompt, /physical prize title can have a valid cash alternative/i);
  assert.match(prompt, /current detail payload/i);
  assert.match(prompt, /do not reject only because the title names the physical prize/i);
});

test("Codex review checks non-cash prize and valuation consistency", async () => {
  let prompt = "";
  await reviewAlertWithCodex(
    {
      stage: "entry-window",
      route: "entry",
      competition: { title: "Sony PlayStation 5 bundle" },
      valuation: {
        value: 450,
        source: "site_estimate",
        confidence: "medium",
        notes: "Operator detail page states retail value £450",
      },
      recommendation: { stars: 1, reason: "trend data missing" },
    },
    {
      runner: async (nextPrompt) => {
        prompt = nextPrompt;
        return { decision: "approve", reason: "consistent", issues: [] };
      },
    },
  );

  assert.match(prompt, /approve only when the prize description and non-cash valuation evidence are internally consistent/i);
  assert.match(prompt, /"source":"site_estimate"/i);
  assert.match(prompt, /Operator detail page states retail value/i);
});

test("distinguishes reviewer transport errors from uncertainty", async () => {
  const malformed = await reviewAlertWithCodex({}, { runner: async () => ({}) });
  const transportError = await reviewAlertWithCodex({}, {
    runner: async () => { throw new Error("Codex CLI exited with status 1"); },
  });

  assert.equal(malformed.decision, "error");
  assert.match(malformed.reason, /malformed/);
  assert.equal(transportError.decision, "error");
  assert.match(transportError.reason, /status 1/);
});

test("alert ledger caches approvals longer than reviewer vetoes", () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-alert-ledger-"));
  useDatabaseForTests(join(directory, "alerts.db"));
  try {
    recordAlertDecision({ inputHash: "approve", decision: "approve", outcome: "sent", recordedAt: "2026-07-15T12:00:00.000Z" });
    recordAlertDecision({ inputHash: "uncertain", decision: "uncertain", outcome: "skipped", recordedAt: "2026-07-15T12:01:00.000Z" });
    recordAlertDecision({ inputHash: "reject", decision: "reject", outcome: "suppressed_reviewer", recordedAt: "2026-07-15T12:00:00.000Z" });
    assert.equal(getAlertDecisions().length, 3);
    assert.equal(
      getCachedAlertReview("approve", 6 * 60 * 60 * 1000, new Date("2026-07-15T17:00:00.000Z"), 5 * 60 * 1000)?.decision,
      "approve",
    );
    assert.equal(
      getCachedAlertReview("reject", 6 * 60 * 60 * 1000, new Date("2026-07-15T12:04:00.000Z"), 5 * 60 * 1000)?.decision,
      "reject",
    );
    assert.equal(
      getCachedAlertReview("reject", 6 * 60 * 60 * 1000, new Date("2026-07-15T12:06:00.000Z"), 5 * 60 * 1000),
      null,
    );
    appendAlertDecisionJsonl(getAlertDecisions()[0]!, directory);
    const file = readFileSync(join(directory, "2026-07-15.jsonl"), "utf8");
    assert.match(file, /Europe\/London/);
  } finally {
    closeDatabaseForTests();
  }
});

test("reuses a stable prize review when trend data changes", async () => {
  const observedAt = new Date("2026-08-30T19:20:00.000Z");
  const raw = {
    sourceId: "cache-1",
    siteName: "cache-test",
    url: "https://cache.test/cache-1",
    name: "Milwaukee drill",
    entryPrice: 1,
    ticketsSold: 1,
    maxTickets: 6,
    inventorySource: "exact" as const,
    maxEntriesPerUser: 10,
    maxEntriesPerUserSource: "site" as const,
    cashAlternative: null,
    estimatedPrizeValue: 50,
    valuationSource: "site_estimate" as const,
    valuationConfidence: "medium" as const,
    valuationNotes: "Explicit synthetic product estimate",
    drawDate: "2026-08-30T19:50:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: observedAt.toISOString(),
  };
  const trends = [
    {
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: null,
      dataPoints: 1,
      isReliable: false,
      resetDetected: false,
    },
    {
      velocityPerHour: 2,
      estimatedSelloutMs: 1_764_000_000,
      isAccelerating: true,
      projectedSellThrough: 0.2,
      dataPoints: 2,
      isReliable: true,
      resetDetected: false,
    },
  ];
  let firstHash: string | null = null;
  let reviewerCalls = 0;
  const dependencies = {
    now: () => observedAt,
    analyzeTrend: () => trends.shift()!,
    reviewer: async () => {
      reviewerCalls += 1;
      return {
        decision: "approve" as const,
        reason: "consistent",
        issues: [],
        model: "synthetic",
        schemaVersion: "1",
      };
    },
    getCachedReview: (inputHash: string) => {
      if (firstHash === null) {
        firstHash = inputHash;
        return null;
      }
      return inputHash === firstHash
        ? {
            inputHash,
            decision: "approve",
            outcome: "sent",
            recordedAt: observedAt.toISOString(),
            reviewerReason: "cached approval",
          }
        : null;
    },
    availability: () => "ready" as const,
    sender: async () => "sent" as const,
    recordDecision: () => undefined,
    appendDecision: () => undefined,
  };

  await processEntryCandidates([enrichCompetitionAt(raw, observedAt)], dependencies);
  await processEntryCandidates([enrichCompetitionAt(raw, observedAt)], dependencies);

  assert.equal(reviewerCalls, 1);
});

test("aligns final sent timing with its recorded timestamp", async () => {
  const times = [
    new Date("2026-08-31T12:00:00.000Z"),
    new Date("2026-08-31T12:00:01.000Z"),
    new Date("2026-08-31T12:00:03.000Z"),
  ];
  const drawDate = "2026-08-31T12:30:00.000Z";
  const result = await processEntryCandidates([enrichCompetitionAt({
    sourceId: "timing-1",
    siteName: "timing-test",
    url: "https://timing.test/timing-1",
    name: "£1,000 cash",
    entryPrice: 1,
    ticketsSold: 5,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 10,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1_000,
    estimatedPrizeValue: null,
    valuationSource: "cash",
    valuationConfidence: "high",
    valuationNotes: "Explicit synthetic cash alternative",
    drawDate,
    isAutoDraw: false,
    categories: [],
    scrapedAt: times[0]!.toISOString(),
  }, times[0]!)], {
    now: () => times.shift() ?? new Date("2026-08-31T12:00:03.000Z"),
    analyzeTrend: () => ({
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: 0.05,
      dataPoints: 3,
      isReliable: true,
      resetDetected: false,
    }),
    availability: () => "ready",
    sender: async () => "sent",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
  });

  const record = result.at(-1)!;
  const candidate = record.candidate as Record<string, unknown>;
  assert.equal(
    candidate.timeToClose,
    new Date(String(candidate.drawDate)).getTime() - new Date(record.recordedAt).getTime(),
  );
});

test("keeps an in-window alias when a canonical URL has future draws", async () => {
  const observedAt = new Date("2026-09-25T17:55:00.000Z");
  const shared = {
    siteName: "alias-window-test",
    url: "https://alias-window.test/#enter",
    entryPrice: 1,
    ticketsSold: 0,
    maxTickets: 1,
    inventorySource: "exact" as const,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback" as const,
    cashAlternative: 100,
    estimatedPrizeValue: null,
    valuationSource: "cash" as const,
    valuationConfidence: "high" as const,
    valuationNotes: "Explicit synthetic cash alternative",
    isAutoDraw: false,
    categories: [],
  };
  const active = enrichCompetitionAt({
    ...shared,
    sourceId: "active-draw",
    name: "£100 cash tonight",
    drawDate: "2026-09-25T18:55:00.000Z",
    scrapedAt: observedAt.toISOString(),
  }, observedAt);
  const future = enrichCompetitionAt({
    ...shared,
    sourceId: "future-draw",
    name: "£100 cash next month",
    drawDate: "2026-10-25T18:55:00.000Z",
    scrapedAt: "2026-09-25T17:55:01.000Z",
  }, observedAt);

  const records = await processEntryCandidates([active, future], {
    now: () => observedAt,
    analyzeTrend: () => ({
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: 0,
      projectedTicketsSold: 0,
      dataPoints: 3,
      isReliable: true,
      resetDetected: false,
    }),
    availability: () => "disabled",
    recordDecision: () => undefined,
    appendDecision: () => undefined,
  });

  assert.equal(records.length, 1);
  assert.equal((records[0]!.candidate as Record<string, unknown>).sourceId, "active-draw");
});
