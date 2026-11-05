import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRaffleScore,
  excludedRaffleReason,
  gradeRaffle,
} from "../src/metrics/decision.js";
import type { Competition } from "../src/types.js";

const hour = 60 * 60 * 1000;

function competition(overrides: Partial<Competition> = {}): Competition {
  return {
    sourceId: "comp-1",
    siteName: "example",
    url: "https://example.com/comp-1",
    name: "Example Competition",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    inventorySource: "exact",
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "site",
    cashAlternative: 1000,
    valuationSource: "cash",
    valuationConfidence: "high",
    drawDate: new Date(Date.now() + 12 * hour).toISOString(),
    isAutoDraw: true,
    categories: [],
    scrapedAt: new Date().toISOString(),
    evPerTicket: 89.9,
    optimalTickets: 90,
    optimalCost: 90,
    winProbability: 0.9,
    lossProbability: 0.1,
    expectedReturn: 900,
    netEV: 810,
    returnRatio: 9,
    houseEdge: -9,
    sellThrough: 0.1,
    timeToClose: 12 * hour,
    ...overrides,
  };
}

function expectGrade(
  comp: Competition,
  stars: 0 | 1 | 2 | 3,
  reason: string,
): void {
  const recommendation = gradeRaffle(comp);
  assert.equal(recommendation.stars, stars);
  assert.equal(recommendation.reason, reason);
}

test("competitions more than 24h from draw are not actionable", () => {
  const comp = competition({
    drawDate: new Date(Date.now() + 42 * hour).toISOString(),
    timeToClose: 42 * hour,
  });

  expectGrade(comp, 0, "not soon enough");
});

test("score sorting keeps near-draw actionable competitions above far-future EV", () => {
  const nearDraw = competition({
    sourceId: "near",
    timeToClose: 6 * hour,
    netEV: 100,
    returnRatio: 1,
    winProbability: 0.5,
    optimalTickets: 10,
    optimalCost: 10,
  });
  const farFuture = competition({
    sourceId: "far",
    timeToClose: 42 * hour,
    netEV: 10000,
    returnRatio: 10,
    winProbability: 0.9,
    optimalTickets: 90,
    optimalCost: 90,
  });

  assert.equal(compareRaffleScore(nearDraw, farFuture) < 0, true);
});

test("only explicit exact inventory can receive stars", () => {
  for (const inventorySource of [undefined, "unknown", "estimated"] as const) {
    const recommendation = gradeRaffle(competition({ inventorySource }));
    assert.equal(recommendation.stars, 0, inventorySource ?? "omitted");
    assert.equal(recommendation.reason, "ticket inventory is not exact");
  }
});

test("zero-stake rejection is not reported as invalid maths", () => {
  expectGrade(
    competition({ entryPrice: 1, cashAlternative: 2 }),
    0,
    "no positive stake",
  );
});

test("free-entry competitions are excluded from buy decisions", () => {
  const comp = competition({
    entryPrice: 0,
    name: "FREE TO ENTER £100 CASH WITH £750 UPGRADE OPTION",
    categories: ["free"],
    optimalTickets: 0,
    optimalCost: 0,
    winProbability: 0,
    expectedReturn: 0,
    netEV: 0,
    returnRatio: -Infinity,
  });

  expectGrade(comp, 0, "excluded free-entry raffle");
});

test("tax-free cash is not treated as free entry", () => {
  const comp = competition({
    name: "Win £1111 TAX FREE Cash",
  });

  assert.notEqual(gradeRaffle(comp).reason, "excluded free-entry raffle");
});

test("paid upgrade-option competitions are excluded from buy decisions", () => {
  const comp = competition({
    name: "£100 Cash With £750 Upgrade Option",
  });

  expectGrade(comp, 0, "excluded upgrade-option raffle");
});

test("entry-bundle competitions are excluded from buy decisions", () => {
  const comp = competition({
    name: "WIN 3,000 TICKETS INTO OUR £50,000 CASH COMPETITION FOR 15P!",
  });

  expectGrade(comp, 0, "excluded entry-bundle raffle");
});

test("entry bundles phrased as entries into another draw are excluded", () => {
  const comp = competition({
    name: "Win 5 entries into 50g Gold Bar Draw on Thursday",
  });

  expectGrade(comp, 0, "excluded entry-bundle raffle");
});

test("site-credit accelerators are excluded before valuation", () => {
  for (const name of [
    "Odds Accelerator #23 (£100 Site Credit End Prize)",
    "£125 Site Credit",
    "FRIDAY MIDDAY COASTER'S CREDIT COMP!",
    "£50 Website Credit only 50 Tickets - Let's Win",
  ]) {
    expectGrade(competition({ name }), 0, "excluded site-credit raffle");
  }
});

test("ticket bundles into named comps are excluded before valuation", () => {
  for (const name of [
    "Win 30 entries into Rolex Bluesy - Ultra Low Odds",
    "WIN 10X ENTRIES TO THE SURRON ULTRA BEE #2",
    "WIN TICKETS INTO THE BIG ONES & WICKED WEDNESDAY COMPS INSTANTLY ENDING TOMORROW",
    "£500 Tickets To The £70k Mega LEGO Comp + Instant Wins #20",
    "WIN 1,666 TICKETS ON THE £2,000 DRAW + WIN 2,500 ON THE £1,000 DRAW #1 *AUTO DRAW*",
    "BMW 320d ODDS BOOSTER! YOUR 50p CHANCE TO WIN 500 Tickets",
    "QUICK QUIRKY - WIN 10 SADDLE/£1500 CASH TICKETS #3",
  ]) {
    const comp = competition({ name });

    expectGrade(comp, 0, "excluded entry-bundle raffle");
  }
});

test("golden ticket into another draw is excluded from buy decisions", () => {
  const comp = competition({
    name: "Win a £1,000 Golden Ticket into the Brand New Audi Q5 Edition 1",
  });

  expectGrade(comp, 0, "excluded entry-bundle raffle");
});

test("lucky-dip and random-ticket-allocation competitions are excluded", () => {
  for (const comp of [
    competition({ name: "Lucky Dip for 10 entries into our cash draw" }),
    competition({ name: "£200 Cash", categories: ["random-ticket-allocation"] }),
  ]) {
    expectGrade(comp, 0, "excluded lucky-dip raffle");
  }
});

test("instant-win prize pots are excluded from buy decisions", () => {
  const comp = competition({
    name: "SIMPLY CASH - £10,000 INSTANT WIN PRIZE POT - £500 END PRIZE",
  });

  expectGrade(comp, 0, "excluded instant-win prize pot");
});

test("instant-win bundles with aggregate prize values are excluded from buy decisions", () => {
  const comp = competition({
    name: "10 GUITAR INSTANT WIN: IBANEZ END PRIZE: OVER £5000 IN PRIZES",
  });

  expectGrade(comp, 0, "excluded instant-win prize pot");
});

test("combined-prize raffles are excluded from buy decisions", () => {
  for (const name of [
    "The Clover Coven | Every Ticket Wins Cash | £100 Jackpot! #2",
    "The Whispering Quill £100 Mixed Jackpot",
    "Pork Scratchings | 25 x Cash Instants To Find! #4",
    "£900k+ Instant Wins",
    "Yamaha Instant Wins - 7,000 Prizes - £300,000 Prize Fund",
  ]) {
    expectGrade(competition({ name }), 0, "excluded combined-prize raffle");
  }
});

test("generic prize-pot and multiwinner prize-pool raffles are excluded", () => {
  for (const name of [
    "HOOK A DUCK (2) - £2,000 prize pot",
    "Beach Bonanza – £1,100 Prize Pool – 328 Winners",
    "Cash V Cars | £250,000 Worth of Prizes | £1,000 Main Prize",
    "£100,000 Bankers Vault - Safe Cracker Edition",
  ]) {
    expectGrade(competition({ name }), 0, "excluded combined-prize raffle");
  }

  assert.equal(
    excludedRaffleReason(competition({ name: "Win a £2,000 swimming pool" })),
    null,
  );
});

test("vault branding alone does not exclude a fixed prize, while game evidence still does", () => {
  for (const name of ["TALISKER SKYE + TALISKER BAG – VAULT RAID", "£1,000 Cash from the Vault"]) {
    const comp = competition({ name });
    assert.equal(excludedRaffleReason(comp), null);
    assert.ok(gradeRaffle(comp).stars > 0);
    assert.equal(gradeRaffle({ ...comp, categories: ["instant-win"] }).stars, 0);
  }
  assert.equal(gradeRaffle(competition({ name: "£100,000 Bankers Vault - Safe Cracker Edition" })).stars, 0);
});

test("hyphenated instant-win category tokens mark combined-prize raffles", () => {
  for (const category of ["instant-win", "instant-wins"]) {
    expectGrade(
      competition({
        name: "Mystery cash draw",
        categories: [category],
      }),
      0,
      "excluded combined-prize raffle",
    );
  }
});

test("explicit instant-win titles are excluded wherever the phrase appears", () => {
  for (const name of [
    "£10,000 CASH + 200 INSTANT WINS",
    "Gold Bank £2,500 Cash + Instant Wins — Draw Friday",
    "Raffledup £1,000 Cash + 50 Inst Wins",
    "CASH CARNAGE £500 END PRIZE PLUS 5 X £500 INSTANT CASH 5P!",
    "WORLD CUP CASH HUNT- £2000 INSTANTS & 2 x £100 End Prizes",
    "Around the Grounds | £1k Main Prize | £10k Pool of Instant Cash Prizes!",
    "SERIOUSLY EASY CASH WINS WITH £500 MAIN PRIZE £1,000,000 POT",
  ]) {
    expectGrade(competition({ name }), 0, "excluded combined-prize raffle");
  }
});

test("explicit gameplay titles are excluded while physical scratch-card prizes remain eligible", () => {
  for (const name of [
    "SCRATCH & WIN £500 INSTANTLY",
    "World Cup Spin To Win",
    "Safari Spin 2 Win",
    "Every Spin Wins Cash",
    "100 Spins To Win £1,000",
    "Balloon Pop",
    "Tuppeny Slots",
    "Spin The Wheel",
    "Scratch To Win",
    "Super Scratch Card",
    "Scratch Card Madness",
  ]) {
    expectGrade(competition({ name }), 0, "excluded combined-prize raffle");
  }

  assert.equal(
    excludedRaffleReason(competition({ name: "£50 National Lottery Scratch Card Bundle" })),
    null,
  );
  assert.equal(
    excludedRaffleReason(competition({ name: "£50 National Lottery Scratch Card Pack" })),
    null,
  );
});

test("explicit instant and gameplay category shapes are excluded", () => {
  for (const category of [
    "instant competitions",
    "instant win competitions",
    "instas",
    "slots",
    "Safari Slots",
    "scratchy",
    "pop game",
    "spin2win",
    "spinny",
  ]) {
    expectGrade(
      competition({ name: "Mystery cash game", categories: [category] }),
      0,
      "excluded combined-prize raffle",
    );
  }
});

test("ordinary instant-draw and auto-draw labels remain eligible", () => {
  for (const comp of [
    competition({ name: "£1,000 Instant Draw" }),
    competition({ name: "£1,000 Auto Draw" }),
    competition({ name: "£1,000 Cash", categories: ["instant draw"] }),
    competition({ name: "£1,000 Cash", categories: ["auto draw"] }),
  ]) {
    assert.equal(excludedRaffleReason(comp), null);
  }
});

test("entry-bundle URLs stay excluded when the parser shortens the display title", () => {
  const comp = competition({
    name: "Win the Tudor Black Bay Chrono Panda",
    url: "https://classycompetitions.co.uk/product/odds-booster-tudor-black-bay-panda-win-15-tickets/",
    categories: [],
  });

  expectGrade(comp, 0, "excluded entry-bundle raffle");
});

test("admission and event tickets are not mistaken for raffle-entry bundles", () => {
  for (const name of [
    "Win 2 tickets to Taylor Swift",
    "2 Tickets to The Rocky Horror Show!",
    "WIN 2 TICKETS to see WESTLIFE at the P&J Live",
    "Win 4 tickets to Arsenal v Chelsea",
    "2x Theme Park Tickets",
    "Win 2 return flight tickets to New York",
  ]) {
    assert.equal(excludedRaffleReason(competition({ name })), null, name);
  }
});

test("named raffle-ticket bundles remain excluded", () => {
  for (const name of [
    "WIN 5 X ROLEX DATEJUST TICKETS WORTH £300 – DRAW NO.1",
    "Win 100 x Rolex Daytona Panda or £20k Tickets #3",
    "WIN 400 TICKETS ON THE 1K EVERY WEEK IN AUGUST",
    "100 Tickets for ‘All-Inclusive France Trip For Two’ Competition #2",
    "Ticket Bundle Comp: Max Tickets on The Triumph Speed 400",
    "🕷️Quick… £6666 MINI Draw – £120 Of Tickets For Main Comp",
    "🕷️ Tickets Galore Instants.. £100 Of Tickets for Tonights Comp End Prize (Autodraw)",
  ]) {
    expectGrade(competition({ name }), 0, "excluded entry-bundle raffle");
  }
});

test("high-stake entries remain eligible when base economics pass", () => {
  const comp = competition({
    ticketsSold: 40,
    maxTickets: 140,
    optimalTickets: 100,
    optimalCost: 100,
    winProbability: 0.361,
    lossProbability: 0.639,
    netEV: 1605,
    returnRatio: 8,
  });

  expectGrade(comp, 1, "entry passes at full sell-through");
});

test("high-stake entries are rejected when return is below the base floor", () => {
  const comp = competition({
    drawUsesFullTicketRange: true,
    cashAlternative: 120,
    optimalTickets: 100,
    optimalCost: 100,
    winProbability: 0.361,
    lossProbability: 0.639,
    netEV: 60,
    returnRatio: 0.3,
  });

  expectGrade(comp, 0, "not enough upside");
});

test("low-probability entries remain zero stars even with high upside", () => {
  const comp = competition({
    ticketsSold: 900,
    maxTickets: 1000,
    cashAlternative: 20000,
    optimalTickets: 50,
    optimalCost: 100,
    winProbability: 0.08,
    lossProbability: 0.92,
    netEV: 1_500,
    returnRatio: 3,
  });

  expectGrade(comp, 0, "too unlikely");
});

test("low-probability mediocre-upside competitions are rejected", () => {
  const comp = competition({
    ticketsSold: 900,
    maxTickets: 1000,
    cashAlternative: 5000,
    optimalTickets: 50,
    optimalCost: 100,
    winProbability: 0.08,
    lossProbability: 0.92,
    netEV: 300,
    returnRatio: 0.6,
  });

  expectGrade(comp, 0, "too unlikely");
});
