import test from "node:test";
import assert from "node:assert/strict";
import { parseGrailWatchCompetition } from "../src/adapters/grailwatch/grailwatch-adapter.ts";

test("Grail Watch Club parser reads the live Rolex draw economics", () => {
  const detailHtml = `
    <html><body>
      <h1>Rolex GMT Batman or £12,000 tax free cash!</h1>
      <p>We only have 292 tickets remaining for this competition</p>
      <p>1 Ticket £50</p>
      <p>Odds: 1:499</p>
    </body></html>`;
  const homeHtml = `
    <html><body>
      Live draw on Instagram – 15/07/2026
      <script>var countDownTarget = "2026-07-15 20:00:00";</script>
    </body></html>`;

  const competition = parseGrailWatchCompetition(
    detailHtml,
    homeHtml,
    "https://www.grailwatchclub.com/product/rolex-gmt-batman-or-12000-tax-free-cash-2/",
  );

  assert.deepEqual(
    {
      name: competition?.name,
      entryPrice: competition?.entryPrice,
      ticketsSold: competition?.ticketsSold,
      maxTickets: competition?.maxTickets,
      maxEntriesPerUserSource: competition?.maxEntriesPerUserSource,
      cashAlternative: competition?.cashAlternative,
      drawDate: competition?.drawDate,
    },
    {
      name: "Rolex GMT Batman or £12,000 tax free cash!",
      entryPrice: 50,
      ticketsSold: 207,
      maxTickets: 499,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: 12000,
      drawDate: "2026-07-15T19:00:00.000Z",
    },
  );
});

test("Grail Watch Club parser retains the date-only fallback when no countdown time exists", () => {
  const competition = parseGrailWatchCompetition(
    `
      <html><body>
        <h1>Rolex GMT Batman or £12,000 tax free cash!</h1>
        <p>We only have 292 tickets remaining for this competition</p>
        <p>1 Ticket £50</p>
        <p>Odds: 1:499</p>
      </body></html>`,
    `<html><body>Live draw on Instagram – 15/07/2026</body></html>`,
    "https://www.grailwatchclub.com/product/rolex-gmt-batman-or-12000-tax-free-cash-2/",
  );

  assert.equal(competition?.drawDate, "2026-07-15T00:00:00.000Z");
});

test("Grail Watch Club parser reads an ordinary explicit cash alternative", () => {
  const detailHtml = `
    <html><body>
      <h1>Rolex GMT Master II Pepsi or £16,000 cash</h1>
      <p>We only have 280 tickets remaining for this competition</p>
      <p>1 Ticket £50</p>
      <p>Odds: 1:499</p>
    </body></html>`;
  const homeHtml = `<html><body>Live draw on Instagram – 31/07/2026</body></html>`;

  const competition = parseGrailWatchCompetition(
    detailHtml,
    homeHtml,
    "https://www.grailwatchclub.com/product/rolex-gmt-master-ii-pepsi-or-16000-cash/",
  );

  assert.equal(competition?.cashAlternative, 16_000);
  assert.ok(competition?.categories.includes("cash"));
});
