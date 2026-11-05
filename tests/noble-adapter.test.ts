import assert from "node:assert/strict";
import test from "node:test";
import { NobleAdapter } from "../src/adapters/noble/noble-adapter.js";

test("Noble adapter parses homepage and exact competition page RSC payloads", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === "https://noblewins.co.uk/") {
      return new Response(
        `
          <script>self.__next_f.push([1,"11:[\\"$\\",\\"$L1f\\",null,{\\"competitions\\":[{\\"id\\":\\"paid-1\\",\\"slug\\":\\"karcher-k4-power-control-pressure-washer\\",\\"title\\":\\"WIN a Kärcher K4 Power Control Pressure Washer\\",\\"category\\":\\"Home & Garden\\",\\"status\\":\\"Live\\",\\"priceNumber\\":0.79,\\"cashFormatted\\":\\"£180.00\\",\\"drawCloseAt\\":\\"$D2026-06-24T19:00:00.000Z\\",\\"totalTickets\\":400,\\"ticketsSold\\":60,\\"isInstantWin\\":false},{\\"id\\":\\"free-1\\",\\"slug\\":\\"250-giveaway\\",\\"title\\":\\"🦊 £250 Tax-Free Cash Giveaway\\",\\"category\\":\\"Giveaways\\",\\"status\\":\\"Live\\",\\"priceNumber\\":0,\\"cashFormatted\\":\\"\\",\\"drawCloseAt\\":\\"$D2026-06-28T19:00:00.000Z\\",\\"totalTickets\\":2000,\\"ticketsSold\\":228,\\"isInstantWin\\":false}]}]"])</script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://noblewins.co.uk/competitions/karcher-k4-power-control-pressure-washer") {
      return new Response(
        `
          <script>self.__next_f.push([1,"11:[\\"$\\",\\"div\\",null,{\\"children\\":[\\"$\\",\\"$L20\\",null,{\\"competition\\":{\\"id\\":\\"paid-1\\",\\"slug\\":\\"karcher-k4-power-control-pressure-washer\\",\\"title\\":\\"WIN a Kärcher K4 Power Control Pressure Washer\\",\\"category\\":\\"Home & Garden\\",\\"status\\":\\"Live\\",\\"cashAlternative\\":\\"£180.00\\",\\"ticketPrice\\":0.79,\\"maxTickets\\":40,\\"totalTickets\\":400,\\"ticketsSold\\":60,\\"maxTicketsPerUser\\":40,\\"drawCloseAt\\":\\"$D2026-06-24T19:00:00.000Z\\"}}]}]"])</script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://noblewins.co.uk/competitions/250-giveaway") {
      return new Response(
        `
          <script>self.__next_f.push([1,"11:[\\"$\\",\\"div\\",null,{\\"children\\":[\\"$\\",\\"$L20\\",null,{\\"competition\\":{\\"id\\":\\"free-1\\",\\"slug\\":\\"250-giveaway\\",\\"title\\":\\"🦊 £250 Tax-Free Cash Giveaway\\",\\"category\\":\\"Giveaways\\",\\"status\\":\\"Live\\",\\"cashAlternative\\":\\"\\",\\"ticketPrice\\":0,\\"maxTickets\\":1,\\"totalTickets\\":2000,\\"ticketsSold\\":228,\\"drawCloseAt\\":\\"$D2026-06-28T19:00:00.000Z\\"}}]}]"])</script>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new NobleAdapter().fetchAll();

    assert.equal(competitions.length, 2);

    const paid = competitions.find((competition) => competition.sourceId === "karcher-k4-power-control-pressure-washer");
    assert.equal(paid?.entryPrice, 0.79);
    assert.equal(paid?.ticketsSold, 60);
    assert.equal(paid?.maxTickets, 400);
    assert.equal(paid?.maxEntriesPerUser, 40);
    assert.equal(paid?.maxEntriesPerUserSource, "site");
    assert.equal(paid?.cashAlternative, 180);
    assert.deepEqual(paid?.categories, ["home & garden"]);

    const free = competitions.find((competition) => competition.sourceId === "250-giveaway");
    assert.equal(free?.entryPrice, 0);
    assert.equal(free?.ticketsSold, 228);
    assert.equal(free?.maxTickets, 2000);
    assert.equal(free?.maxEntriesPerUser, 100);
    assert.equal(free?.maxEntriesPerUserSource, "fallback");
    assert.equal(free?.cashAlternative, 250);
    assert.deepEqual(free?.categories, ["giveaways"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
