import test from "node:test";
import assert from "node:assert/strict";
import { parseKingOfCompsCompetition } from "../src/adapters/kingofcomps/kingofcomps-adapter.js";

test("King of Comps parser reads cash draw ticket economics", () => {
  const competition = parseKingOfCompsCompetition(
    `
      <body>
        <h1>Sunday Madness - £45,000 PRIZE POT - £5,000 END PRIZE</h1>
        <p>£1.00 Per Ticket</p>
        <p>83,293 TICKETS REMAINING 6,707/90,000</p>
        <div x-data="{ remaining: 472068.846814, hasFinished: false }"></div>
      </body>
    `,
    "https://kingofcomps.co.uk/competition/sunday-madness",
  );

  assert.equal(competition?.ticketsSold, 6707);
  assert.equal(competition?.maxTickets, 90000);
  assert.equal(competition?.entryPrice, 1);
  assert.equal(competition?.cashAlternative, 5000);
  assert.ok(competition?.drawDate);
});
