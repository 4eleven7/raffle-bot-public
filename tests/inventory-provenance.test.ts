import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ClickAdapter } from "../src/adapters/click/click-adapter.js";
import { EliteAdapter } from "../src/adapters/elite/elite-adapter.js";
import type { SiteAdapter } from "../src/adapters/adapter.js";
import { scanAdapterWithRetry } from "../src/scan/scan-adapter.js";
import {
  closeDatabaseForTests,
  getDb,
  getCompetition,
  getSnapshots,
  getRecentSnapshots,
  insertSnapshot,
  upsertCompetition,
  useDatabaseForTests,
} from "../src/storage/database.js";
import type { RawCompetition } from "../src/types.js";

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "comp-1",
    siteName: "example",
    url: "https://example.test/comp-1",
    name: "Example",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    maxEntriesPerUser: 10,
    cashAlternative: 500,
    drawDate: "2026-08-30T20:00:00.000Z",
    isAutoDraw: false,
    categories: [],
    scrapedAt: "2026-08-26T12:00:00.000Z",
    ...overrides,
  };
}

function useTempDb(): void {
  const directory = mkdtempSync(join(tmpdir(), "raffle-bot-inventory-"));
  useDatabaseForTests(join(directory, "test.db"));
}

test("inventory provenance persists, treats legacy rows as unknown, and trends use exact snapshots only", () => {
  useTempDb();
  try {
    upsertCompetition(competition({ inventorySource: "estimated" }));
    assert.equal(getCompetition("comp-1", "example")?.inventorySource, "estimated");

    assert.equal(insertSnapshot(competition({ ticketsSold: 10, scrapedAt: "2026-08-26T10:00:00.000Z", inventorySource: "exact" })), true);
    assert.equal(insertSnapshot(competition({ ticketsSold: 20, scrapedAt: "2026-08-26T11:00:00.000Z", inventorySource: "estimated" })), true);
    assert.equal(insertSnapshot(competition({ ticketsSold: 30, scrapedAt: "2026-08-26T12:00:00.000Z", inventorySource: "exact" })), true);

    const snapshots = getRecentSnapshots(
      "comp-1",
      "example",
      "2026-08-30T20:00:00.000Z",
      100,
      10,
    );
    assert.deepEqual(snapshots.map((snapshot) => [snapshot.ticketsSold, snapshot.inventorySource]), [
      [10, "exact"],
      [30, "exact"],
    ]);

    getDb().prepare("UPDATE competitions SET inventory_source = NULL").run();
    getDb().prepare("UPDATE snapshots SET inventory_source = NULL WHERE tickets_sold = 10").run();
    assert.equal(getCompetition("comp-1", "example")?.inventorySource, "unknown");
    assert.equal(getSnapshots("comp-1", "example")[0]?.inventorySource, "unknown");
    assert.equal(
      getRecentSnapshots(
        "comp-1",
        "example",
        "2026-08-30T20:00:00.000Z",
        100,
        10,
      ).some((snapshot) => snapshot.inventorySource === "unknown"),
      false,
    );
  } finally {
    closeDatabaseForTests();
  }
});

test("scan boundary defaults unspecified inventory to exact", async () => {
  const adapter: SiteAdapter = {
    siteName: "example",
    async fetchAll() {
      return [competition()];
    },
  };

  const result = await scanAdapterWithRetry(adapter, {
    retries: 0,
    timeoutMs: 1000,
  });

  assert.equal(result.raw[0]?.inventorySource, "exact");
});

test("Elite percentage inventory is estimated", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(nextData({
    first: eliteCompetition(1),
  }));

  try {
    const results = await new EliteAdapter().fetchAll();
    assert.equal(results[0]?.inventorySource, "estimated");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Click marks direct inventory exact and percentage fallback estimated", () => {
  const adapter = new ClickAdapter();
  const parseNextData = (adapter as unknown as {
    parseNextData(html: string): RawCompetition[];
  }).parseNextData.bind(adapter);

  const direct = parseNextData(clickNextData({
    id: "direct",
    slug: "direct",
    name: "Direct",
    status: "live",
    minorStatus: "open",
    drawDate: "2026-08-30T20:00:00.000Z",
    draw_mechanism: "automatic",
    ticketAmount: 1,
    soldTickets: 10,
    totalTickets: 100,
    infiniteTickets: false,
    maximum_tickets_quantity: 10,
    prizes: [],
    type: "singlePrize_singleTicket",
  }));
  assert.equal(direct[0]?.inventorySource, "exact");

  const fallback = parseNextData(clickNextData({
    id: "fallback",
    slug: "fallback",
    name: "Fallback",
    status: "live",
    minorStatus: "open",
    drawDate: "2026-08-30T20:00:00.000Z",
    draw_mechanism: "automatic",
    ticketAmount: 1,
    percentage: 10,
    totalTickets: 100,
    infiniteTickets: false,
    maximum_tickets_quantity: 10,
    prizes: [],
    type: "singlePrize_singleTicket",
  }));
  assert.equal(fallback[0]?.inventorySource, "estimated");
});

function nextData(data: Record<string, unknown>): string {
  return `<script id="__NEXT_DATA__">${JSON.stringify({
    props: {
      pageProps: {
        dehydratedState: {
          queries: [{}, { state: { data: { data } } }],
        },
      },
    },
  })}</script>`;
}

function eliteCompetition(id: number): Record<string, unknown> {
  return {
    id,
    name: `Competition ${id}`,
    ticketPrice: 1,
    saleTicketPrice: null,
    soldTicketsPercentage: 10,
    mainPrizePrice: 100,
    drawTime: "2026-08-30T20:00:00.000Z",
    endDate: null,
    isAutoDraw: false,
    maxTicketsPerUser: 10,
    slugUrl: `competition-${id}`,
    type: "standard",
    isFree: false,
    isSoldOut: false,
    status: "live",
    categories: [],
  };
}

function clickNextData(server: Record<string, unknown>): string {
  return `<script id="__NEXT_DATA__">${JSON.stringify({
    props: {
      pageProps: {
        pageComponents: [{
          ref: {
            list: [{
              tags: [],
              competition: {
                uid: "comp",
                slug: ".prizes.example",
                title: "Example",
                card_title: "Example",
                server,
              },
            }],
          },
        }],
      },
    },
  })}</script>`;
}
