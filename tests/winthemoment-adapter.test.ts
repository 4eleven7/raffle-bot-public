import assert from "node:assert/strict";
import test from "node:test";
import { WinTheMomentAdapter } from "../src/adapters/winthemoment/winthemoment-adapter.js";

test("Win The Moment parser reads exact detail economics and the absolute close time", async () => {
  const baseUrl = "https://winthemoment.co.uk";
  const detailUrl = `${baseUrl}/competition/gta-xbox`;

  const renderedPageFetcher = async (url: string): Promise<string> => {
    if (url === `${baseUrl}/competitions`) {
      return `<a href="${detailUrl}">Enter</a><a href="${detailUrl}#top">Duplicate</a><a href="/terms">Terms</a>`;
    }
    if (url === detailUrl) {
      return `<main>
          <div>DRAW CLOSES IN Wed, 11 November 2026 at 20:00</div>
          <span>Tech &amp; Gaming skill</span>
          <h1>GTA 6 for Xbox Series X|S</h1>
          <p>About this Prize Win a boxed UK edition of Grand Theft Auto VI for Xbox Series X|S. Price per entry £1</p>
          <div>3 / 100 tickets sold</div>
          <div>97 tickets remaining</div>
          <div>Max 30 per person</div>
        </main>`;
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const [competition] = await new WinTheMomentAdapter(renderedPageFetcher).fetchAll();
  assert.deepEqual(
      {
        sourceId: competition?.sourceId,
        name: competition?.name,
        entryPrice: competition?.entryPrice,
        ticketsSold: competition?.ticketsSold,
        maxTickets: competition?.maxTickets,
        inventorySource: competition?.inventorySource,
        maxEntriesPerUser: competition?.maxEntriesPerUser,
        maxEntriesPerUserSource: competition?.maxEntriesPerUserSource,
        drawDate: competition?.drawDate,
        categories: competition?.categories,
      },
      {
        sourceId: "gta-xbox",
        name: "GTA 6 for Xbox Series X|S",
        entryPrice: 1,
        ticketsSold: 3,
        maxTickets: 100,
        inventorySource: "exact",
        maxEntriesPerUser: 30,
        maxEntriesPerUserSource: "site",
        drawDate: "2026-11-11T20:00:00.000Z",
        categories: ["tech", "gaming"],
      },
  );
});
