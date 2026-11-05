import assert from "node:assert/strict";
import test from "node:test";
import { RaffleeAdapter } from "../src/adapters/rafflee/rafflee-adapter.js";

test("Rafflee adapter parses explicit cash alternatives from raffle custom text", async () => {
  const originalFetch = globalThis.fetch;
  const initialRaffles = [
    {
      raffleInstanceId: 645,
      raffleInstanceState: "ENTRY_START",
      raffleInstanceSchedule: { entryEndTime: 1784325600000 },
      raffleName: "DJI Osmo Nano On-The-Go Combo",
      slug: "/competitions/tech/dji-osmo-nano-on-the-go-combo-645",
      entryConfiguration: { singleEntryPrice: 0.49 },
      playerLimits: { maxEntries: 1300, maxEntriesPerUser: 650 },
      entriesRegistrationCount: 75,
      prizes: [{ cashPrize: 0 }],
      lobbyProperties: {
        raffleCategory: "tech",
        customText: "or £260 cash",
      },
      customText: "or £260 cash",
      instantWinEnabled: false,
    },
    {
      raffleInstanceId: 646,
      raffleInstanceState: "ENTRY_START",
      raffleInstanceSchedule: { entryEndTime: 1784325600000 },
      raffleName: "£500 Shop Voucher",
      slug: "/competitions/tech/500-shop-voucher-646",
      entryConfiguration: { singleEntryPrice: 0.49 },
      playerLimits: { maxEntries: 1300 },
      entriesRegistrationCount: 10,
      prizes: [{ cashPrize: 0 }],
      lobbyProperties: {
        raffleCategory: "tech",
        customText: "£500 shop voucher",
      },
      customText: "£500 shop voucher",
      instantWinEnabled: false,
    },
  ];
  const payload = JSON.stringify({ initialRaffles })
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  globalThis.fetch = async () =>
    new Response(
      `<script>self.__next_f.push([1,"${payload}"])</script>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const rows = await new RaffleeAdapter().fetchAll();

    assert.equal(rows[0]?.cashAlternative, 260);
    assert.equal(rows[0]?.maxEntriesPerUser, 650);
    assert.equal(rows[0]?.maxEntriesPerUserSource, "site");
    assert.equal(rows[1]?.cashAlternative, null);
    assert.equal(rows[1]?.maxEntriesPerUser, 100);
    assert.equal(rows[1]?.maxEntriesPerUserSource, "fallback");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Rafflee accepts nonce attributes on current RSC scripts", async () => {
  const originalFetch = globalThis.fetch;
  const payload = JSON.stringify({
    initialRaffles: [{
      raffleInstanceId: 999,
      raffleInstanceState: "ENTRY_START",
      raffleInstanceSchedule: { entryEndTime: Date.parse("2099-07-19T18:00:00Z") },
      raffleName: "Nonce payload raffle",
      slug: "/competitions/nonce-payload-999",
      entryConfiguration: { singleEntryPrice: 0.49 },
      playerLimits: { maxEntries: 500, maxEntriesPerUser: 50 },
      entriesRegistrationCount: 3,
      prizes: [{ cashPrize: 100 }],
    }],
  })
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  globalThis.fetch = async () =>
    new Response(
      `<script nonce="current">self.__next_f.push([1,"${payload}"])</script>`,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const rows = await new RaffleeAdapter().fetchAll();

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceId, "999");
    assert.equal(rows[0]?.cashAlternative, 100);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
