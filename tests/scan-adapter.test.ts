import test from "node:test";
import assert from "node:assert/strict";
import type { SiteAdapter } from "../src/adapters/adapter.js";
import type { RawCompetition } from "../src/types.js";
import {
  buildSuccessHealth,
  classifyScanError,
  scanAdapterWithRetry,
} from "../src/scan/scan-adapter.js";

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "comp-1",
    siteName: "example",
    url: "https://example.test/comp-1",
    name: "Example",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    maxEntriesPerUser: 100,
    cashAlternative: 500,
    drawDate: "2026-06-12T20:00:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: "2026-06-11T12:00:00.000Z",
    ...overrides,
  };
}

test("scan adapter retries transient failures and returns success health", async () => {
  let calls = 0;
  const adapter: SiteAdapter = {
    siteName: "example",
    async fetchAll() {
      calls += 1;
      if (calls === 1) throw new Error("fetch failed");
      return [competition()];
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 1,
    retryBaseDelayMs: 1,
    timeoutMs: 1000,
  });

  assert.equal(calls, 2);
  assert.equal(result.error, undefined);
  assert.equal(result.health.status, "success");
  assert.equal(result.health.competitionsFound, 1);
});

test("scan adapter retries an empty result that contradicts fresh future stored competitions", async () => {
  let calls = 0;
  const adapter: SiteAdapter = {
    siteName: "intermittent-browser",
    async fetchAll() {
      calls += 1;
      return calls === 1 ? [] : [competition({ siteName: "intermittent-browser" })];
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 1,
    retryBaseDelayMs: 1,
    timeoutMs: 1000,
    getFreshFutureStoredCount: () => 12,
  });

  assert.equal(calls, 2);
  assert.equal(result.error, undefined);
  assert.equal(result.health.status, "success");
  assert.equal(result.health.competitionsFound, 1);
});

test("scan adapter reports a persistently contradictory empty result as transient", async () => {
  let calls = 0;
  const adapter: SiteAdapter = {
    siteName: "intermittent-browser",
    async fetchAll() {
      calls += 1;
      return [];
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 1,
    retryBaseDelayMs: 1,
    timeoutMs: 1000,
    getFreshFutureStoredCount: () => 12,
  });

  assert.equal(calls, 2);
  assert.equal(result.raw.length, 0);
  assert.equal(result.health.status, "transient_error");
  assert.match(result.health.errorMessage ?? "", /empty scan contradicted by 12 fresh future/);
});

test("scan adapter accepts a genuinely empty site without retrying", async () => {
  let calls = 0;
  const adapter: SiteAdapter = {
    siteName: "genuinely-empty",
    async fetchAll() {
      calls += 1;
      return [];
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 2,
    retryBaseDelayMs: 1,
    timeoutMs: 1000,
    getFreshFutureStoredCount: () => 0,
  });

  assert.equal(calls, 1);
  assert.equal(result.health.status, "empty");
});

test("scan adapter does not retry blocked failures", async () => {
  let calls = 0;
  const adapter: SiteAdapter = {
    siteName: "blocked",
    async fetchAll() {
      calls += 1;
      throw new Error("Failed to fetch: 403");
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 3,
    retryBaseDelayMs: 1,
    timeoutMs: 1000,
  });

  assert.equal(calls, 1);
  assert.equal(result.health.status, "blocked");
});

test("scan adapter does not overlap a timed-out non-cancellable fetch", async () => {
  let calls = 0;
  const adapter: SiteAdapter = {
    siteName: "slow-browser",
    async fetchAll() {
      calls += 1;
      return new Promise<RawCompetition[]>(() => {});
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 3,
    retryBaseDelayMs: 1,
    timeoutMs: 5,
  });

  assert.equal(calls, 1);
  assert.equal(result.health.status, "transient_error");
  assert.match(result.health.errorMessage ?? "", /timeout after 5ms/);
});

test("scan adapter aborts timed-out normal fetches", async () => {
  let aborted = false;
  const adapter: SiteAdapter = {
    siteName: "abortable-normal",
    async fetchAll(signal?: AbortSignal) {
      return new Promise<RawCompetition[]>((resolve) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          resolve([]);
        }, { once: true });
      });
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 3,
    retryBaseDelayMs: 1,
    timeoutMs: 5,
  });

  assert.equal(aborted, true);
  assert.equal(result.health.status, "transient_error");
});

test("scan adapter aborts and drains a timed-out browser fetch before returning", async () => {
  let active = false;
  let aborted = false;
  const adapter: SiteAdapter = {
    siteName: "abortable-browser",
    scanCost: "browser",
    async fetchAll(signal?: AbortSignal) {
      active = true;
      return new Promise<RawCompetition[]>((resolve) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          setTimeout(() => {
            active = false;
            resolve([]);
          }, 5);
        }, { once: true });
      });
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 3,
    retryBaseDelayMs: 1,
    timeoutMs: 5,
  });

  assert.equal(aborted, true);
  assert.equal(active, false);
  assert.equal(result.health.status, "transient_error");
  assert.match(result.health.errorMessage ?? "", /timeout after 5ms/);
});

test("scan adapter bounds cleanup when a browser fetch ignores abort", async () => {
  const adapter: SiteAdapter = {
    siteName: "broken-browser",
    scanCost: "browser",
    async fetchAll() {
      return new Promise<RawCompetition[]>(() => {});
    },
  };
  const startedAt = Date.now();

  const result = await scanAdapterWithRetry(adapter, {
    retries: 3,
    retryBaseDelayMs: 1,
    timeoutMs: 5,
    browserCleanupGraceMs: 5,
  });

  assert.ok(Date.now() - startedAt < 100);
  assert.equal(result.health.status, "transient_error");
  assert.match(result.health.errorMessage ?? "", /timeout after 5ms/);
});

test("success health classifies partial cash competitions", () => {
  const health = buildSuccessHealth("example", [
    competition({ drawDate: null }),
    competition({ sourceId: "comp-2", cashAlternative: null }),
  ]);

  assert.equal(health.status, "partial");
  assert.equal(health.competitionsFound, 2);
  assert.equal(health.cashCompetitionsFound, 1);
  assert.equal(health.partialCompetitionsFound, 1);
});

test("success health accepts ready free-entry cash competitions", () => {
  const health = buildSuccessHealth("example", [
    competition({
      entryPrice: 0,
      name: "Free £100 Cash",
      maxEntriesPerUser: 1,
      categories: ["free"],
    }),
  ]);

  assert.equal(health.status, "success");
  assert.equal(health.partialCompetitionsFound, 0);
});

test("success health accepts explicit free-2-enter wording", () => {
  const health = buildSuccessHealth("example", [
    competition({
      entryPrice: 0,
      name: "Free 2 Enter - Mystery Box",
      maxEntriesPerUser: 1,
      categories: [],
    }),
  ]);

  assert.equal(health.status, "success");
  assert.equal(health.partialCompetitionsFound, 0);
});

test("tax-free prize wording does not prove a zero entry price", async () => {
  const adapter: SiteAdapter = {
    siteName: "tax-free-is-paid",
    async fetchAll() {
      return [
        competition({
          siteName: "tax-free-is-paid",
          entryPrice: 0,
          name: "Win £1,000 Tax-Free Cash",
          categories: ["taxfree"],
        }),
        competition({
          sourceId: "free-spin",
          siteName: "tax-free-is-paid",
          entryPrice: 0,
          name: "Free Spin Every 24 Hours",
          categories: [],
        }),
      ];
    },
  };

  const result = await scanAdapterWithRetry(adapter, { retries: 0, timeoutMs: 1000 });

  assert.deepEqual(result.raw, []);
  assert.equal(result.health.status, "partial");
  assert.equal(result.health.partialCompetitionsFound, 2);
  assert.match(result.health.errorMessage ?? "", /entryPrice 0 requires explicit free-entry provenance/);
});

test("an explicit free-entry label cannot carry a paid entry price", async () => {
  const adapter: SiteAdapter = {
    siteName: "contradictory-free-price",
    async fetchAll() {
      return [
        competition({
          siteName: "contradictory-free-price",
          entryPrice: 1.29,
          name: "Free Entry – £100 Gift Voucher",
        }),
        competition({
          sourceId: "category-free",
          siteName: "contradictory-free-price",
          entryPrice: 0.25,
          name: "Amazon Fire Tablet",
          categories: ["free"],
        }),
      ];
    },
  };

  const result = await scanAdapterWithRetry(adapter, { retries: 0, timeoutMs: 1000 });

  assert.deepEqual(result.raw, []);
  assert.equal(result.health.status, "partial");
  assert.equal(result.health.partialCompetitionsFound, 2);
  assert.match(result.health.errorMessage ?? "", /contradicts explicit free-entry provenance/);
});

test("success health rejects missing required economics even without a prize value", () => {
  const health = buildSuccessHealth("example", [
    competition({ cashAlternative: null, drawDate: null }),
  ]);

  assert.equal(health.status, "partial");
  assert.equal(health.competitionsFound, 1);
  assert.equal(health.cashCompetitionsFound, 0);
  assert.equal(health.partialCompetitionsFound, 1);
  assert.match(health.errorMessage ?? "", /drawDate is required/);
});

test("scan adapter excludes rows missing identifiers or explicit entry-price provenance", async () => {
  const adapter: SiteAdapter = {
    siteName: "missing-required-fields",
    async fetchAll() {
      return [
        competition({ sourceId: "missing-name", name: "" }),
        competition({ sourceId: "missing-url", url: "" }),
        competition({ sourceId: "missing-date", drawDate: null }),
        competition({ sourceId: "unproven-free", entryPrice: 0, name: "£100 Voucher", categories: [] }),
      ];
    },
  };

  const result = await scanAdapterWithRetry(adapter, { retries: 0, timeoutMs: 1000 });

  assert.deepEqual(result.raw, []);
  assert.equal(result.health.status, "partial");
  assert.equal(result.health.competitionsFound, 4);
  assert.equal(result.health.partialCompetitionsFound, 4);
  assert.match(result.health.errorMessage ?? "", /4 invalid competitions excluded/);
});

test("scan adapter excludes an impossible 2026 sold of 299 total row and reports partial health", async () => {
  const adapter: SiteAdapter = {
    siteName: "devoncash",
    async fetchAll() {
      return [
        competition({ sourceId: "valid" }),
        competition({
          sourceId: "750-cash-ends-friday-24th",
          siteName: "devoncash",
          ticketsSold: 2026,
          maxTickets: 299,
        }),
      ];
    },
  };

  const result = await scanAdapterWithRetry(adapter, { retries: 0, timeoutMs: 1000 });

  assert.deepEqual(result.raw.map((row) => row.sourceId), ["valid"]);
  assert.equal(result.health.status, "partial");
  assert.equal(result.health.competitionsFound, 2);
  assert.equal(result.health.cashCompetitionsFound, 2);
  assert.equal(result.health.partialCompetitionsFound, 1);
  assert.match(result.health.errorMessage ?? "", /ticketsSold 2026 exceeds maxTickets 299/);
});

test("scan adapter excludes a zero-total row without reporting an empty scan", async () => {
  const adapter: SiteAdapter = {
    siteName: "citycompetitions",
    async fetchAll() {
      return [competition({
        siteName: "citycompetitions",
        ticketsSold: 0,
        maxTickets: 0,
      })];
    },
  };

  const result = await scanAdapterWithRetry(adapter, { retries: 0, timeoutMs: 1000 });

  assert.deepEqual(result.raw, []);
  assert.equal(result.health.status, "partial");
  assert.equal(result.health.competitionsFound, 1);
  assert.equal(result.health.partialCompetitionsFound, 1);
  assert.match(result.health.errorMessage ?? "", /maxTickets 0 must be finite and greater than zero/);
});

test("scan adapter excludes non-finite or negative economics", async () => {
  const adapter: SiteAdapter = {
    siteName: "invalid-economics",
    async fetchAll() {
      return [
        competition({ sourceId: "negative-price", entryPrice: -1 }),
        competition({ sourceId: "non-finite-sold", ticketsSold: Number.NaN }),
        competition({ sourceId: "negative-cap", maxEntriesPerUser: -1 }),
        competition({ sourceId: "non-finite-cash", cashAlternative: Number.POSITIVE_INFINITY }),
        competition({
          sourceId: "negative-estimate",
          cashAlternative: null,
          estimatedPrizeValue: -50,
        }),
      ];
    },
  };

  const result = await scanAdapterWithRetry(adapter, { retries: 0, timeoutMs: 1000 });

  assert.deepEqual(result.raw, []);
  assert.equal(result.health.status, "partial");
  assert.equal(result.health.competitionsFound, 5);
  assert.equal(result.health.partialCompetitionsFound, 5);
  assert.match(result.health.errorMessage ?? "", /5 invalid competitions excluded/);
});

test("scan error classifier separates transient and blocked failures", () => {
  assert.equal(classifyScanError(new Error("timeout after 20000ms")), "transient_error");
  assert.equal(classifyScanError(new Error("net::ERR_NAME_NOT_RESOLVED")), "transient_error");
  assert.equal(classifyScanError(new Error("Failed to fetch: 503")), "transient_error");
  assert.equal(classifyScanError(new Error("Cloudflare origin timeout: 522")), "transient_error");
  assert.equal(classifyScanError(new Error("Cloudflare invalid upstream certificate: 526")), "transient_error");
  assert.equal(
    classifyScanError(new Error("empty scan contradicted by fresh future competitions")),
    "transient_error",
  );
  assert.equal(classifyScanError(new Error("Failed to fetch: 403")), "blocked");
});
