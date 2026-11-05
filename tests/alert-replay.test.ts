import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifyAlertReplay,
  parseAlertReplayDataset,
  runAlertReplayScenario,
  runAlertReplayDataset,
} from "../src/alerts/replay.js";

test("synthetic entry replay exercises policy and delivery classifications", async () => {
  const fixturePath = join(
    process.cwd(),
    "fixtures",
    "alert-replay",
    "synthetic.v1.json",
  );
  const dataset = parseAlertReplayDataset(readFileSync(fixturePath, "utf8"));
  const report = await runAlertReplayDataset(dataset);

  assert.equal(report.failed, 0, JSON.stringify(report.results, null, 2));
  assert.equal(report.passed, dataset.scenarios.length);
  assert.deepEqual(
    new Set(report.results.map((result) => result.classification)),
    new Set([
      "alerted_as_expected",
      "skipped_as_expected",
    ]),
  );
  assert.ok(
    report.results.every((result) =>
      result.timing.observedAt &&
      result.timing.drawDate &&
      Number.isFinite(result.timing.timeToCloseMs)
    ),
  );
  assert.ok(
    report.results.every((result) =>
      result.stage === null || result.stage === "entry-window"
    ),
  );
  assert.ok(
    report.results.every((result) =>
      result.route === null || result.route === "entry"
    ),
  );
});

test("replay fails a suppressed positive ground truth even with a miss classification", async () => {
  const fixturePath = join(
    process.cwd(),
    "fixtures",
    "alert-replay",
    "synthetic.v1.json",
  );
  const dataset = parseAlertReplayDataset(readFileSync(fixturePath, "utf8"));
  const source = dataset.scenarios.find((candidate) => candidate.id === "final-entry-sent");
  assert.ok(source);
  const scenario = structuredClone(source);
  scenario.competition.inventorySource = "unknown";
  scenario.expected.classification = "skipped_but_should_alert";
  scenario.expected.outcome = "suppressed_deterministic";
  scenario.expected.route = undefined;
  scenario.expected.stars = 0;
  scenario.expected.deterministicReasonIncludes = "ticket inventory is not exact";

  const result = await runAlertReplayScenario(scenario);
  assert.equal(result.classification, "skipped_but_should_alert");
  assert.equal(result.passed, false);
  assert.match(result.failures.join("\n"), /expected an alert/);
});

test("replay classifies transport misses and unwanted alerts", () => {
  assert.equal(classifyAlertReplay(true, "failed"), "missed_alert");
  assert.equal(classifyAlertReplay(false, "sent"), "alerted_but_should_skip");
});

test("missing trend data suppresses an entry that cannot meet the draw-time risk floor", async () => {
  const fixturePath = join(
    process.cwd(),
    "fixtures",
    "alert-replay",
    "synthetic.v1.json",
  );
  const dataset = parseAlertReplayDataset(readFileSync(fixturePath, "utf8"));
  const scenario = dataset.scenarios.find((candidate) =>
    candidate.id === "trend-missing-entry"
  );
  assert.ok(scenario);
  assert.equal(scenario.trend, null);
  const result = await runAlertReplayScenario(scenario);
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
  assert.equal(result.stars, 0);
  assert.equal(result.outcome, "suppressed_deterministic");
  assert.equal(result.stage, "entry-window");
  assert.equal(result.route, null);
});

test("direct high-confidence cash replay bypasses reviewer decisions", async () => {
  const fixturePath = join(
    process.cwd(),
    "fixtures",
    "alert-replay",
    "synthetic.v1.json",
  );
  const dataset = parseAlertReplayDataset(readFileSync(fixturePath, "utf8"));
  const source = dataset.scenarios.find((candidate) => candidate.id === "final-entry-sent");
  assert.ok(source);
  const scenario = structuredClone(source);
  scenario.reviewer = { decision: "reject", reason: "synthetic veto must be bypassed" };
  const result = await runAlertReplayScenario(scenario);
  assert.equal(result.passed, true, JSON.stringify(result, null, 2));
  assert.equal(result.outcome, "sent");
  assert.equal(result.decision?.decision, "approve");
  assert.equal(result.decision?.reviewerReason, "direct verified cash value");
});

test("synthetic replay rejects malformed or duplicate scenarios", () => {
  assert.throws(
    () => parseAlertReplayDataset(JSON.stringify({
      version: 1,
      scenarios: [{ id: "duplicate" }, { id: "duplicate" }],
    })),
    /duplicate/i,
  );
  assert.throws(
    () => parseAlertReplayDataset(JSON.stringify({
      version: 1,
      scenarios: [{ id: "invalid", observedAt: "not-a-date" }],
    })),
    /observedAt/i,
  );
  assert.throws(
    () => parseAlertReplayDataset(JSON.stringify({
      version: 1,
      scenarios: [{
        id: "legacy-route",
        kind: "policy",
        description: "legacy",
        observedAt: "2026-07-26T10:00:00.000Z",
        competition: {
          sourceId: "legacy-route",
          siteName: "synthetic",
          url: "https://synthetic.test/legacy-route",
          name: "Cash",
          entryPrice: 1,
          ticketsSold: 1,
          maxTickets: 10,
          maxEntriesPerUser: 1,
          cashAlternative: 100,
          drawDate: "2026-07-26T10:10:00.000Z",
          isAutoDraw: false,
          categories: [],
          scrapedAt: "2026-07-26T10:00:00.000Z",
        },
        trend: null,
        expected: {
          shouldAlert: true,
          classification: "alerted_as_expected",
          route: "watch",
        },
      }],
    })),
    /expected\.route must be entry/i,
  );
});
