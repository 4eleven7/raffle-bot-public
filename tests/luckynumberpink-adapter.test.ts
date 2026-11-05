import assert from "node:assert/strict";
import test from "node:test";
import { parseHomepage, toCompetition } from "../src/adapters/luckynumberpink/luckynumberpink-adapter.js";

test("Lucky Number Pink parser maps Wix warmup live-draw records", () => {
  const competition = toCompetition(
    {
      _id: "d563f7ca-031c-4108-b40b-42a06f190d7c",
      title: "WIN £200 Cash!",
      liveDraw: true,
      drawDate: "2026-08-09",
      time: "7:30pm",
      ticketsSold: 15,
      soldCount: 300,
      _publishStatus: "PUBLISHED",
      "link-pinkstant-wins-title": "/ticket-page/d563f7ca-031c-4108-b40b-42a06f190d7c/win-200",
      productLink: {
        name: "Win £200 Cash!",
        price: 2.99,
        description: "Win £200 tax-free CASH",
      },
    },
    "2026-08-08T09:00:00.000Z",
    new Date("2026-08-08T09:00:00.000Z"),
  );

  assert.deepEqual(competition && {
    sourceId: competition.sourceId,
    url: competition.url,
    entryPrice: competition.entryPrice,
    ticketsSold: competition.ticketsSold,
    maxTickets: competition.maxTickets,
    cashAlternative: competition.cashAlternative,
    drawDate: competition.drawDate,
  }, {
    sourceId: "d563f7ca-031c-4108-b40b-42a06f190d7c",
    url: "https://www.luckynumberpink.co.uk/ticket-page/d563f7ca-031c-4108-b40b-42a06f190d7c/win-200",
    entryPrice: 2.99,
    ticketsSold: 15,
    maxTickets: 300,
    cashAlternative: null,
    drawDate: "2026-08-09T18:30:00.000Z",
  });
});

test("Lucky Number Pink parser reads public Wix warmup data", () => {
  const html = `<script id="wix-warmup-data" type="application/json">${JSON.stringify({
    appsWarmupData: {
      dataBinding: {
        dataStore: {
          recordsByCollectionId: {
            Competitions: {
              current: {
                _id: "current",
                title: "Current Prize",
                liveDraw: true,
                drawDate: "2026-08-10",
                time: "7:30pm",
                ticketsSold: 2,
                soldCount: 100,
                _publishStatus: "PUBLISHED",
                "link-pinkstant-wins-title": "/ticket-page/current/current-prize",
                productLink: { price: 0.99 },
              },
            },
          },
        },
      },
    },
  })}</script>`;

  const rows = parseHomepage(html, new Date("2026-08-08T09:00:00.000Z"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceId, "current");
});
