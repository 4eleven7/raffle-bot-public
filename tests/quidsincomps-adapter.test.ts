import assert from "node:assert/strict";
import test from "node:test";
import { toCompetition } from "../src/adapters/quidsincomps/quidsincomps-adapter.js";

test("Quids In Comps parser maps sale price and public ticket economics", () => {
  const competition = toCompetition(
    {
      id: "4190887d-76e2-4d72-901c-4a8e2c38c6d8",
      title: "1 IN 7",
      ticket_price: 0.99,
      sale_price: 0.79,
      ticket_price_type: "sale",
      tickets_sold: 14533,
      max_tickets: 30800,
      end_date: "2026-08-12T18:59:59+00:00",
      draw_date: null,
      description: "Instant win competition",
      status: "active",
      deleted_at: null,
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
    drawDate: competition.drawDate,
  }, {
    sourceId: "4190887d-76e2-4d72-901c-4a8e2c38c6d8",
    url: "https://quidsincomps.com/competition/4190887d-76e2-4d72-901c-4a8e2c38c6d8",
    entryPrice: 0.79,
    ticketsSold: 14533,
    maxTickets: 30800,
    drawDate: "2026-08-12T18:59:59.000Z",
  });
});

test("Quids In Comps parser rejects closed, sold-out, or incomplete rows", () => {
  assert.equal(toCompetition({
    id: "closed",
    title: "Closed",
    ticket_price: 1,
    tickets_sold: 10,
    max_tickets: 10,
    end_date: "2026-08-07T18:59:59+00:00",
    status: "active",
    deleted_at: null,
  }, "2026-08-08T09:00:00.000Z", new Date("2026-08-08T09:00:00.000Z")), null);
});
