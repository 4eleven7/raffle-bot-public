import test from "node:test";
import assert from "node:assert/strict";
import { parseWinMeAPrizeCompetition } from "../src/adapters/winmeaprize/winmeaprize-adapter.js";

test("WinMeAPrize parser reads ASP.NET competition economics", () => {
  const competition = parseWinMeAPrizeCompetition(
    `
      <div class="item name"><h3>World Cup £200 Tax Free Cash!</h3></div>
      <div class="item r-name">£200 Cash!</div>
      <div class="item tktprc">Tickets only £0.69.</div>
      <div>Tickets Sold so far:0 from 500 available.</div>
      <div class="item rundate"><strong>Guaranteed Winner!</strong> on Wednesday 15th July at 08 pm</div>
    `,
    "https://winmeaprize.com/Competitions/200-Tax-Free-Cash--/351",
  );

  assert.ok(competition);
  assert.equal(competition.sourceId, "351");
  assert.equal(competition.entryPrice, 0.69);
  assert.equal(competition.ticketsSold, 0);
  assert.equal(competition.maxTickets, 500);
  assert.equal(competition.cashAlternative, 200);
  assert.ok(competition.drawDate);
  assert.equal(competition.isAutoDraw, true);
});

test("WinMeAPrize parser keeps cash values scoped to the current competition", () => {
  const competition = parseWinMeAPrizeCompetition(
    `
      <div class="maintxt" id="question">
        <div class="item name"><h3>£1000 Tax Free Cash!</h3></div>
        <div class="item cshalt"></div>
        <div class="item tktprc">Tickets only £0.99.</div>
        <div>Tickets Sold so far:0 from 10,000 available.</div>
        <div class="item r-name">£1000 Tax Free Cash!</div>
        <div class="item r-desc"></div>
        <div class="item rundate"><strong>Guaranteed Winner!</strong> on Friday 4th September at 08 pm</div>
      </div>
      <div class="related-competition">
        <div class="item r-name">Aviator F-Series Watch!</div>
        <div class="item r-desc">£50 Cash Alternative!</div>
      </div>
    `,
    "https://winmeaprize.com/Competitions/1000-Tax-Free-Cash-/364",
  );

  assert.ok(competition);
  assert.equal(competition.name, "£1000 Tax Free Cash!");
  assert.equal(competition.cashAlternative, 1_000);
});
