import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RawCompetition } from "../src/types.js";
import { getPrizeValue } from "../src/metrics/calculator.js";
import { CompWatchAdapter } from "../src/adapters/compwatch/compwatch-adapter.js";
import { ReffleAdapter } from "../src/adapters/reffle/reffle-adapter.js";

type AnyModule = Record<string, any>;

function rawCompetition(overrides: Record<string, unknown> = {}): RawCompetition {
  return {
    sourceId: "data-policy-1",
    siteName: "data-example",
    url: "https://example.test/data-policy-1",
    name: "Ninja Pizza Oven",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    maxEntriesPerUser: 10,
    maxEntriesPerUserSource: "site",
    inventorySource: "exact",
    cashAlternative: null,
    estimatedPrizeValue: null,
    valuationSource: null,
    valuationConfidence: null,
    valuationNotes: null,
    drawDate: "2026-12-30T19:30:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: "2026-08-26T12:00:00.000Z",
    ...overrides,
  } as unknown as RawCompetition;
}

async function storageApi(): Promise<AnyModule> {
  return await import("../src/storage/database.js") as unknown as AnyModule;
}

test("LLM valuation sends every eligible candidate instead of truncating at eight", async () => {
  const valuation = await import("../src/valuation/estimate.js") as unknown as AnyModule;
  const storage = await storageApi();
  const directory = mkdtempSync(join(tmpdir(), "valuation-policy-"));
  storage.useDatabaseForTests(join(directory, "valuation.db"));
  const comps = Array.from({ length: 9 }, (_value, index) => rawCompetition({
    sourceId: `llm-${index}`,
    name: `Recognisable prize ${index}`,
  }));
  let received: string[] = [];

  try {
    const result = await valuation.applyEstimatedValuations(comps, {
      useCache: true,
      llmEstimator: async (candidates: Array<{ cacheKey: string }>) => {
        received.push(...candidates.map((candidate) => candidate.cacheKey));
        return new Map(candidates.map((candidate) => [candidate.cacheKey, {
          value: 100,
          source: "llm_estimate",
          confidence: "medium",
          notes: "bounded test estimate",
        }]));
      },
      now: new Date("2026-08-26T12:00:00.000Z"),
    });

    assert.equal(received.length, 9);
    assert.equal(result.filter((comp: RawCompetition) => comp.estimatedPrizeValue === 100).length, 9);
  } finally {
    storage.closeDatabaseForTests();
  }
});

test("a no-estimate cache miss is retried before the 30-day cache TTL", async () => {
  const valuation = await import("../src/valuation/estimate.js") as unknown as AnyModule;
  const storage = await storageApi();
  const directory = mkdtempSync(join(tmpdir(), "valuation-retry-policy-"));
  storage.useDatabaseForTests(join(directory, "valuation.db"));
  const comp = rawCompetition({ sourceId: "retry-me", name: "Unclear prize title" });
  let calls = 0;

  try {
    const estimator = async (candidates: Array<{ cacheKey: string }>) => {
      calls += 1;
      return new Map([[candidates[0]!.cacheKey, null]]);
    };
    await valuation.applyEstimatedValuations([comp], {
      useCache: true,
      llmEstimator: estimator,
      now: new Date("2026-08-26T12:00:00.000Z"),
    });
    await valuation.applyEstimatedValuations([comp], {
      useCache: true,
      llmEstimator: estimator,
      now: new Date("2026-08-27T12:00:00.000Z"),
    });

    assert.equal(calls, 2);
  } finally {
    storage.closeDatabaseForTests();
  }
});

test("vehicle titles without a category are still eligible for valuation", async () => {
  const valuation = await import("../src/valuation/estimate.js") as unknown as AnyModule;
  const storage = await storageApi();
  const directory = mkdtempSync(join(tmpdir(), "valuation-vehicle-policy-"));
  storage.useDatabaseForTests(join(directory, "valuation.db"));
  const comp = rawCompetition({
    sourceId: "vehicle-without-category",
    name: "BMW M3 Competition",
    categories: [],
  });
  let received = 0;

  try {
    const result = await valuation.applyEstimatedValuations([comp], {
      useCache: false,
      llmEstimator: async (candidates: Array<{ cacheKey: string }>) => {
        received = candidates.length;
        return new Map([[candidates[0]!.cacheKey, {
          value: 20_000,
          source: "llm_estimate",
          confidence: "low",
          notes: "bounded vehicle estimate",
        }]]);
      },
    });

    assert.equal(received, 1);
    assert.equal(result[0]?.estimatedPrizeValue, 20_000);
  } finally {
    storage.closeDatabaseForTests();
  }
});

test("zero cash alternative falls through to an available estimated prize value", () => {
  assert.equal(getPrizeValue({ cashAlternative: 0, estimatedPrizeValue: 400 }), 400);
});

test("CompWatch fetches every current list link, including links past the old cap", async () => {
  const list = Array.from({ length: 25 }, (_value, index) =>
    `<a href="/sites/fixture/comp${index}">Competition ${index}</a>`
  ).join("");
  const oldFetch = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url === "https://compwatch.co.uk/sites/fixture") {
      return new Response(`<main>${list}</main>`, { status: 200 });
    }
    const sourceId = url.split("/").pop() ?? "unknown";
    return new Response(`
      <main>
        <h1>£500 Cash ${sourceId}</h1>
        <a href="/go/${sourceId}">Enter</a>
        <p>Ticket Price £1 Closes Wed 30 Dec 7:30pm Tickets Sold 1 / 100 Max Tickets Per User 5</p>
      </main>
    `, { status: 200 });
  };

  try {
    const adapter = new CompWatchAdapter({
      siteName: "fixture",
      displayName: "Fixture",
      slug: "fixture",
      operatorUrl: "https://fixture.test",
      userAgent: "test",
      fetchDelayMs: 0,
    });
    const competitions = await adapter.fetchAll();
    assert.equal(competitions.length, 25);
    assert.equal(requested.length, 26);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("Reffle merges classic and Vue layouts without duplicate loss", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/competitions")) {
      return new Response(`
        <div class="raffle">
          <a href="/raffle/classic-one">
            <h3>Classic Camera</h3>
            £1 / per entry 2 Tickets Sold 98 remaining
          </a>
        </div>
        <div class="raffle-card">
          <a href="/competition/vue-one">
            <h3>Vue Console</h3>
            <span data-test="tickets-sold">3 / 100 sold</span>
            <span data-test="tickets-remaining">97 remaining</span>
            £1 / entry
          </a>
        </div>
      `, { status: 200 });
    }
    return new Response(`
      <span data-time="2026/12/30 19:00"></span>
      <p>Tickets sold: 2 / 100 Max 5 tickets per person Ticket Price £1</p>
    `, { status: 200 });
  };

  try {
    const adapter = new ReffleAdapter({
      siteName: "reffle-fixture",
      displayName: "Reffle Fixture",
      baseUrl: "https://reffle.test",
      listPath: "/competitions",
      userAgent: "test",
      fetchDelayMs: 0,
    });
    const competitions = await adapter.fetchAll();
    assert.equal(competitions.length, 2);
    assert.deepEqual(
      new Set(competitions.map((comp) => comp.sourceId)),
      new Set(["classic-one", "vue-one"]),
    );
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("alert replay marks a suppressed positive ground truth as a failure", async () => {
  const replay = await import("../src/alerts/replay.js") as unknown as AnyModule;
  const fixturePath = join(process.cwd(), "fixtures", "alert-replay", "synthetic.v1.json");
  const dataset = replay.parseAlertReplayDataset(readFileSync(fixturePath, "utf8"));
  const source = dataset.scenarios.find((candidate: { id: string }) => candidate.id === "final-entry-sent");
  assert.ok(source);
  const scenario = structuredClone(source);
  scenario.competition.inventorySource = "unknown";
  scenario.expected.classification = "skipped_but_should_alert";
  scenario.expected.outcome = "suppressed_deterministic";
  scenario.expected.route = undefined;
  scenario.expected.stars = 0;
  const result = await replay.runAlertReplayScenario(scenario);

  assert.equal(result.classification, "skipped_but_should_alert");
  assert.equal(result.passed, false, JSON.stringify(result, null, 2));
});
