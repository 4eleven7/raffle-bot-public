import test from "node:test";
import assert from "node:assert/strict";
import { parseCompetiownProduct } from "../src/adapters/competiown/competiown-adapter.js";

test("Competiown parser reads JSON product economics", () => {
  const competition = parseCompetiownProduct(
    {
      id: 123,
      title: "Alpine A290 Prize Draw",
      handle: "alpine-a290-prize-draw",
      body_html: "<p>Closing Date: 30/09/2026</p><p>Maximum Entries: 10,000</p><p>Tickets Sold: 10</p><p>£30,000 cash alternative</p>",
      variants: [{ price: "4.99", available: true }],
    },
    "2026-08-17T09:00:00.000Z",
  );

  assert.deepEqual(
    {
      sourceId: competition?.sourceId,
      entryPrice: competition?.entryPrice,
      ticketsSold: competition?.ticketsSold,
      maxTickets: competition?.maxTickets,
      cashAlternative: competition?.cashAlternative,
      drawDate: competition?.drawDate,
    },
    {
      sourceId: "123",
      entryPrice: 4.99,
      ticketsSold: 10,
      maxTickets: 10_000,
      cashAlternative: 30_000,
      drawDate: "2026-09-30T00:00:00.000Z",
    },
  );
});

test("Competiown parser rejects sold-out or incomplete products", () => {
  const competition = parseCompetiownProduct({
    id: 456,
    title: "Closed draw",
    handle: "closed-draw",
    body_html: "<p>Closing Date: 30/09/2026</p><p>Maximum Entries: 10</p><p>Tickets Sold: 10</p>",
    variants: [{ price: "0.99", available: true }],
  });

  assert.equal(competition, null);
});
