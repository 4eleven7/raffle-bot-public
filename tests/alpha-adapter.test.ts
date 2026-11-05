import test from "node:test";
import assert from "node:assert/strict";
import { parseAlphaCompetition } from "../src/adapters/alpha/alpha-adapter.js";

test("Alpha parser reads direct competition economics", () => {
  const competition = parseAlphaCompetition(
    `
      <h1>Win This Range Rover Or £7,000</h1>
      <div class="gradientheading">Win This Range Rover Or £7,000</div>
      <h2><span class="woocommerce-Price-amount">£1.49</span> Per Ticket</h2>
      <p class="lottery-end">This Competition ends on July 31, 2026 11:59 pm</p>
      <p class="max-pariticipants">The maximum amount of tickets is 10000</p>
      <p class="cureent-participating">Tickets sold: 126</p>
      <p>Range Rover Evoque or £7,000 CASH ALTERNATIVE</p>
    `,
    "https://alphacomps.uk/go/rangerover/",
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "rangerover");
  assert.equal(competition.entryPrice, 1.49);
  assert.equal(competition.ticketsSold, 126);
  assert.equal(competition.maxTickets, 10000);
  assert.equal(competition.cashAlternative, 7000);
  assert.equal(
    competition.drawDate,
    "2026-07-31T22:59:00.000Z",
  );
});
