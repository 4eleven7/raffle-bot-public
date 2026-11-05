import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEstimatedValuation,
  applyEstimatedValuations,
  parseLlmValuations,
} from "../src/valuation/estimate.js";
import { getPrizeValue } from "../src/metrics/calculator.js";
import { CONFIG } from "../src/config.js";
import type { RawCompetition } from "../src/types.js";

function competition(overrides: Partial<RawCompetition> = {}): RawCompetition {
  return {
    sourceId: "comp-1",
    siteName: "example",
    url: "https://example.com/comp-1",
    name: "Example Competition",
    entryPrice: 1,
    ticketsSold: 10,
    maxTickets: 100,
    maxEntriesPerUser: 100,
    cashAlternative: null,
    drawDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("manual estimated valuation unlocks known non-cash prizes", () => {
  const comp = applyEstimatedValuation(competition({
    siteName: "coast2coast",
    sourceId: "ninja-artisan-electric-outdoor-pizza-oven-air-fryer-2",
    name: "Ninja Artisan Electric Outdoor Pizza Oven & Air Fryer!",
  }));

  assert.equal(comp.estimatedPrizeValue, 270);
  assert.equal(comp.valuationSource, "manual_estimate");
  assert.equal(comp.valuationConfidence, "medium");
});

test("manual estimated valuation uses Prize Circle's explicit bundle value", () => {
  const comp = applyEstimatedValuation(competition({
    siteName: "prizecircleuk",
    sourceId: "plouise-bundle",
    name: "Plouise Bundle",
  }));

  assert.equal(comp.estimatedPrizeValue, 38);
  assert.equal(comp.valuationSource, "manual_estimate");
  assert.equal(comp.valuationConfidence, "medium");
});

test("manual estimated valuation unlocks the tracked Competition Fox Ninja air fryer prize", () => {
  const comp = applyEstimatedValuation(competition({
    siteName: "competitionfox",
    sourceId: "ninja-af110uk-4-7l-air-fryer-grey-auto-win-26-06",
    name: "Ninja AF110UK 4.7L Air Fryer - Grey-AUTO WIN 26/06",
  }));

  assert.equal(comp.estimatedPrizeValue, 100);
  assert.equal(comp.valuationSource, "manual_estimate");
  assert.equal(comp.valuationConfidence, "medium");
});

test("manual estimated valuation unlocks the tracked Reward Club Big Green Egg prize", () => {
  const comp = applyEstimatedValuation(competition({
    siteName: "therewardclubdraws",
    sourceId: "apple-13-macbook-neo-or-ps500-cash-alternative-877183d6-051a-4ad0-aede-150fb6f0e4fc",
    name: "BIG GREEN EGG BBQ",
  }));

  assert.equal(comp.estimatedPrizeValue, 740);
  assert.equal(comp.valuationSource, "manual_estimate");
  assert.equal(comp.valuationConfidence, "medium");
});

test("manual estimated valuation unlocks tracked Nintendo Switch 2 prizes", () => {
  const comps = [
    applyEstimatedValuation(competition({
      siteName: "bonkers",
      sourceId: "857615",
      name: "NINTENDO SWITCH 2 CONSOLE",
    })),
    applyEstimatedValuation(competition({
      siteName: "gigahertz",
      sourceId: "569966",
      name: "Nintendo Switch 2 | Pokopia + Star Fox",
    })),
    applyEstimatedValuation(competition({
      siteName: "luckyday",
      sourceId: "nintendo-switch-2-mario-bundle",
      name: "Nintendo Switch 2 Mario Bundle - Lucky Day Competitions",
    })),
  ];

  assert.deepEqual(
    comps.map((comp) => comp.estimatedPrizeValue),
    [317, 357, 328],
  );
  assert.deepEqual(
    comps.map((comp) => comp.valuationSource),
    ["manual_estimate", "manual_estimate", "manual_estimate"],
  );
});

test("manual estimated valuation unlocks the requested exercise raffles", () => {
  const comps = [
    applyEstimatedValuation(competition({
      siteName: "mckinney",
      sourceId: "cross-training-peloton-bike-autodraw",
      name: "Cross Training Peloton Bike - Autodraw",
    })),
    applyEstimatedValuation(competition({
      siteName: "mckinney",
      sourceId: "walking-pad-autodraw-1",
      name: "Walking Pad - Autodraw",
    })),
    applyEstimatedValuation(competition({
      siteName: "luckyday",
      sourceId: "multi-gym-crossover-with-smith-bar-bundle",
      name: "Multi-Gym Crossover with Smith Bar Bundle - Lucky Day Competitions",
    })),
    applyEstimatedValuation(competition({
      siteName: "tommyfrench",
      sourceId: "21386",
      name: "Walking Pad",
    })),
  ];

  assert.deepEqual(
    comps.map((comp) => comp.estimatedPrizeValue),
    [1359, 100, 637, 100],
  );
  assert.deepEqual(
    comps.map((comp) => comp.valuationSource),
    ["manual_estimate", "manual_estimate", "manual_estimate", "manual_estimate"],
  );
});

test("manual estimated valuation unlocks tracked one-off non-cash prizes", () => {
  const comps = [
    applyEstimatedValuation(competition({
      siteName: "letswin",
      sourceId: "firepit-table-with-glass-screen-or-cash-only-89-tickets-02-07",
      name: "Firepit Table with Glass Screen or Cash!! Only 89 Tickets!! 02/07",
    })),
    applyEstimatedValuation(competition({
      siteName: "thecarcompetition",
      sourceId: "6780570",
      name: "Win This PlayStation 5 Or Xbox Series X",
    })),
    applyEstimatedValuation(competition({
      siteName: "kilted",
      sourceId: "3818694",
      name: "Garden Patio Furniture Set",
    })),
    applyEstimatedValuation(competition({
      siteName: "letswin",
      sourceId: "the-essential-stock-up-hamper-or-cash-only-40-tickets-01-07",
      name: "The Essential Stock Up Hamper or Cash!! Only 40 tickets!! 01/07",
    })),
  ];

  assert.deepEqual(
    comps.map((comp) => comp.estimatedPrizeValue),
    [120, 340, 250, 50],
  );
  assert.deepEqual(
    comps.map((comp) => comp.valuationSource),
    ["manual_estimate", "manual_estimate", "manual_estimate", "manual_estimate"],
  );
});

test("manual estimated valuation unlocks tracked KickOff football prizes", () => {
  const comps = [
    applyEstimatedValuation(competition({
      siteName: "kickoff",
      sourceId: "win-signed-mo-salah-shirt",
      name: "WIN SIGNED MO SALAH SHIRT",
    })),
    applyEstimatedValuation(competition({
      siteName: "kickoff",
      sourceId: "win-signed-van-dijk-shirt",
      name: "WIN SIGNED VAN DIJK SHIRT",
    })),
    applyEstimatedValuation(competition({
      siteName: "kickoff",
      sourceId: "win-signed-liverpool-squad-shirt",
      name: "WIN SIGNED LIVERPOOL SQUAD SHIRT",
    })),
    applyEstimatedValuation(competition({
      siteName: "kickoff",
      sourceId: "win-world-cup-2026-match-ball-2",
      name: "WIN WORLD CUP 2026 MATCH BALL",
    })),
  ];

  assert.deepEqual(
    comps.map((comp) => comp.estimatedPrizeValue),
    [100, 100, 150, 80],
  );
  assert.deepEqual(
    comps.map((comp) => comp.valuationConfidence),
    ["low", "low", "low", "low"],
  );
});

test("manual estimated valuation unlocks tracked Dream Break travel prizes", () => {
  const comp = applyEstimatedValuation(competition({
    siteName: "dreambreak",
    sourceId: "family-of-up-to-5-disneyland-paris-centre-parc-nature-villages-eur500-a0804d78-cb25-4376-b538-6d47f3362647",
    name: "Family of up to 5 - Disneyland Paris & Centre Parc Nature Villages + €500",
  }));

  assert.equal(comp.estimatedPrizeValue, 2500);
  assert.equal(comp.valuationSource, "manual_estimate");
  assert.equal(comp.valuationConfidence, "low");
});

test("title stated gift-card values are discounted instead of treated as cash", () => {
  const comp = applyEstimatedValuation(competition({
    name: "THE GIFT CARD GOLD MINE - £500 GIFT CARD END PRIZE!",
  }));

  assert.equal(comp.estimatedPrizeValue, 425);
  assert.equal(comp.valuationSource, "site_estimate");
  assert.equal(comp.valuationConfidence, "medium");
});

test("title stated property prize values support shorthand millions", () => {
  const comp = applyEstimatedValuation(competition({
    name: "£1.2M Home in Zone 1",
  }));

  assert.equal(comp.estimatedPrizeValue, 1020000);
  assert.equal(comp.valuationSource, "site_estimate");
  assert.equal(comp.valuationConfidence, "medium");
});

test("explicit cash alternatives stay cash-valued", () => {
  const comp = applyEstimatedValuation(competition({
    cashAlternative: 100,
    name: "£100 CASH",
  }));

  assert.equal(comp.estimatedPrizeValue, undefined);
  assert.equal(comp.valuationSource, "cash");
  assert.equal(comp.valuationConfidence, "high");
});

test("values direct cash titles without treating bundles as cash", () => {
  const directCash = [
    ["WIN £500 CASH WEDNESDAY - 9pm Autodraw", 500],
    ["£10,000 CASH - HIGHROLLER", 10_000],
    ["LOW ODDS £1,000 TAX FREE CASH", 1_000],
    ["Win £100 Tax Free Cash *Daily Deal*", 100],
    ["Win £6,000 Tax Free Cash", 6_000],
  ] as const;

  for (const [name, expected] of directCash) {
    const valued = applyEstimatedValuation(competition({ name }));
    assert.equal(valued.cashAlternative, expected, name);
    assert.equal(valued.valuationSource, "cash", name);
    assert.equal(valued.valuationConfidence, "high", name);
  }

  const bundle = applyEstimatedValuation(competition({
    name: "£10,000 CASH + 200 INSTANT WINS",
  }));
  assert.equal(bundle.cashAlternative, null);
  assert.equal(bundle.valuationSource, undefined);
});

test("zero cash value falls through to an available estimated prize value", () => {
  const comp = competition({
    cashAlternative: 0,
    estimatedPrizeValue: 240,
    valuationSource: "site_estimate",
    valuationConfidence: "medium",
  });

  assert.equal(getPrizeValue(comp), 240);
});

test("LLM valuation enriches missing non-cash prizes with a conservative haircut", async () => {
  const [comp] = await applyEstimatedValuations([
    competition({
      sourceId: "pizza-oven",
      name: "Ninja Artisan Electric Outdoor Pizza Oven & Air Fryer!",
    }),
  ], {
    useCache: false,
    llmEstimator: async ([candidate]) => new Map([
      [
        candidate.cacheKey,
        {
          value: 240,
          source: "llm_estimate",
          confidence: "medium",
          notes: "LLM retail estimate £300 with 80% haircut",
        },
      ],
    ]),
  });

  assert.equal(comp?.estimatedPrizeValue, 240);
  assert.equal(comp?.valuationSource, "llm_estimate");
  assert.equal(comp?.valuationConfidence, "medium");
});

test("LLM valuation is skipped when deterministic valuation already exists", async () => {
  let calls = 0;
  const [comp] = await applyEstimatedValuations([
    competition({
      name: "THE GIFT CARD GOLD MINE - £500 GIFT CARD END PRIZE!",
    }),
  ], {
    useCache: false,
    llmEstimator: async () => {
      calls += 1;
      return new Map();
    },
  });

  assert.equal(calls, 0);
  assert.equal(comp?.estimatedPrizeValue, 425);
  assert.equal(comp?.valuationSource, "site_estimate");
});

test("LLM valuation is skipped for entry-bundle prizes", async () => {
  let calls = 0;
  const comps = await applyEstimatedValuations([
    competition({
      sourceId: "entries-into-cash",
      name: "100 Entries into Friday’s £10,000 Cash",
    }),
    competition({
      sourceId: "tickets-to-lego",
      name: "£500 Tickets To The £70k Mega LEGO Comp + Instant Wins #20",
    }),
    competition({
      sourceId: "tickets-on-cash",
      name: "WIN 1,666 TICKETS ON THE £2,000 DRAW + WIN 2,500 ON THE £1,000 DRAW #1 *AUTO DRAW*",
    }),
    competition({
      sourceId: "cash-tickets",
      name: "QUICK QUIRKY - WIN 10 SADDLE/£1500 CASH TICKETS #3",
    }),
  ], {
    useCache: false,
    llmEstimator: async () => {
      calls += 1;
      return new Map();
    },
  });

  assert.equal(calls, 0);
  assert.deepEqual(
    comps.map((comp) => comp.estimatedPrizeValue),
    [undefined, undefined, undefined, undefined],
  );
  assert.deepEqual(
    comps.map((comp) => comp.valuationSource),
    [undefined, undefined, undefined, undefined],
  );
});

test("aggregate prize-pot and prize-pool rows receive no deterministic or LLM valuation", async () => {
  const deterministic = applyEstimatedValuation(competition({
    sourceId: "aggregate-worth",
    name: "HOOK A DUCK - £2,000 prize pot worth £2,000",
  }));
  assert.equal(deterministic.estimatedPrizeValue, undefined);
  assert.equal(deterministic.valuationSource, undefined);

  let calls = 0;
  const comps = await applyEstimatedValuations([
    competition({
      sourceId: "hook-a-duck",
      name: "HOOK A DUCK (2) - £2,000 prize pot",
    }),
    competition({
      sourceId: "beach-bonanza",
      name: "Beach Bonanza – £1,100 Prize Pool – 328 Winners",
    }),
    competition({
      sourceId: "instant-category",
      name: "Mystery cash draw",
      categories: ["instant-wins"],
    }),
  ], {
    useCache: false,
    llmEstimator: async () => {
      calls += 1;
      return new Map();
    },
  });

  assert.equal(calls, 0);
  for (const comp of comps) {
    assert.equal(comp.estimatedPrizeValue, undefined);
    assert.equal(comp.valuationSource, undefined);
  }
});

test("an aggregate worth-of-prizes value is replaced by an explicit main prize", () => {
  const valued = applyEstimatedValuation(competition({
    siteName: "palladiumcompetitions",
    sourceId: "penqyPd7",
    name: "Cash V Cars | £250,000 Worth of Prizes | £1,000 Main Prize",
    cashAlternative: 250_000,
  }));

  assert.equal(valued.cashAlternative, 1_000);
  assert.equal(valued.valuationSource, "cash");
  assert.equal(valued.valuationNotes, "Explicit main, end, or final cash prize in current title");
});

test("vault totals are cleared while a site-scoped end draw remains valued", () => {
  const aggregate = applyEstimatedValuation(competition({
    siteName: "ddcompetitions",
    name: "£100,000 Bankers Vault - Safe Cracker Edition",
    cashAlternative: 100_000,
  }));
  const endDraw = applyEstimatedValuation(competition({
    siteName: "luckytiger",
    name: "£50k FELIX'S VAULT",
    cashAlternative: 1_000,
  }));

  assert.equal(aggregate.cashAlternative, null);
  assert.equal(aggregate.valuationSource, undefined);
  assert.equal(endDraw.cashAlternative, 1_000);
  assert.equal(endDraw.valuationSource, "cash");
});

test("Pure Prizes numeric instant rows keep only the explicit end prize", () => {
  const valued = applyEstimatedValuation(competition({
    siteName: "pureprizes",
    sourceId: "300",
    name: "10x £300 Instant Wins With A £100 End Prize",
    categories: ["instant-win"],
    cashAlternative: 300,
    estimatedPrizeValue: 240,
    valuationSource: "llm_estimate",
    valuationConfidence: "high",
    valuationNotes: "Title indicates £300 prize value",
  }));

  assert.equal(valued.cashAlternative, 100);
  assert.equal(valued.estimatedPrizeValue, undefined);
  assert.equal(valued.valuationSource, "cash");
  assert.equal(valued.valuationNotes, "Explicit main, end, or final cash prize in current title");
});

test("excluded Garden-like instant rows clear aggregate parser values but keep distinct final cash", () => {
  const garden = applyEstimatedValuation(competition({
    siteName: "fifty20",
    sourceId: "garden-gains-18th-july",
    name: "Garden Gains",
    categories: ["cash", "instant-win"],
    cashAlternative: 50,
    estimatedPrizeValue: 934,
    valuationSource: "site_estimate",
    valuationConfidence: "medium",
    valuationNotes: "Operator copy states approximate prize worth",
  }));

  assert.equal(garden.cashAlternative, 50);
  assert.equal(garden.estimatedPrizeValue, undefined);
  assert.equal(garden.valuationSource, "cash");
  assert.equal(garden.valuationConfidence, "high");
  assert.equal(garden.valuationNotes, "Explicit cash prize or cash alternative");
  assert.equal(getPrizeValue(garden), 50);

  const aggregateOnly = applyEstimatedValuation(competition({
    sourceId: "garden-gains-polluted-aggregate",
    name: "Garden Gains - Instant Wins Prize Pool",
    categories: ["instant-win"],
    cashAlternative: 934,
    estimatedPrizeValue: 934,
    valuationSource: "site_estimate",
    valuationConfidence: "medium",
    valuationNotes: "Aggregate instant prizes worth £934",
  }));

  assert.equal(aggregateOnly.cashAlternative, null);
  assert.equal(aggregateOnly.estimatedPrizeValue, undefined);
  assert.equal(aggregateOnly.valuationSource, undefined);
  assert.equal(aggregateOnly.valuationConfidence, undefined);
  assert.equal(aggregateOnly.valuationNotes, undefined);
  assert.equal(getPrizeValue(aggregateOnly), 0);
});

test("mixed instant raffles use explicit title cash alternatives and main/end/final prizes", () => {
  const cases = [
    ["£500K CASH VAULT WITH £5000 CASH MAIN PRIZE", 500_000, 5_000],
    ["£13K CASH VAULT - £1,000 MAIN PRIZE", 13_000, 1_000],
    ["£500 END PRIZE + £2K INSTANT WINS", 2_000, 500],
    ["£1K MAIN PRIZE + £10K INSTANT WIN PRIZE POOL", 10_000, 1_000],
    ["£100 END PRIZE + £5K INSTANTS", 5_000, 100],
    ["Luxury Car + Instant Wins or £8,000 cash alternative", 60_000, 8_000],
    ["Instant Wins - FINAL £750 CASH PRIZE", 10_000, 750],
    ["GOLD RUSH £500 END PRIZE PLUS £2000 IN INSTANT CASH ONLY 8P!", 2_000, 500],
    ["WORLD CUP CASH HUNT- £2000 INSTANTS & 2 x £100 End Prizes", 2_000, 100],
    ["Around the Grounds | £1k Main Prize | £10k Pool of Instant Cash Prizes! | 2,000 Site Credits!", 10_000, 1_000],
    ["Win an M2R Racing Dirt Bike + Loads of Instant Wins! CASH £1400", 1_400, 1_400],
  ] as const;

  for (const [name, parsedCash, expectedCash] of cases) {
    const valued = applyEstimatedValuation(competition({
      name,
      siteName: name.includes("M2R Racing") ? "endurotickets" : "example",
      categories: ["instant competitions"],
      cashAlternative: parsedCash,
    }));

    assert.equal(valued.cashAlternative, expectedCash, name);
    assert.equal(valued.valuationSource, "cash", name);
    assert.equal(valued.valuationConfidence, "high", name);
    assert.equal(getPrizeValue(valued), expectedCash, name);
  }
});

test("aggregate-only instant/game rows clear parser cash values", () => {
  for (const [name, category] of [
    ["£500K CASH VAULT", "instant competitions"],
    ["Safari Slots", "slots"],
    ["Balloon Pop", "pop game"],
    ["Safari Spins", "spin2win"],
  ]) {
    const valued = applyEstimatedValuation(competition({
      name,
      categories: [category],
      cashAlternative: 500_000,
    }));

    assert.equal(valued.cashAlternative, null, name);
    assert.equal(valued.valuationSource, undefined, name);
    assert.equal(getPrizeValue(valued), 0, name);
  }
});

test("site-scoped final cash remains available on excluded instant rows", () => {
  for (const [siteName, name, cashAlternative] of [
    ["devoncash", "CASH-MAN 2K OF INSTANT WINS LOW ODDS JUST 99p", 50],
    ["fifty20", "GARDEN GAINS", 50],
    ["cashcity", "THROW A SIX", 100],
    ["audrey", "QUEEN OF HEARTS", 250],
  ] as const) {
    const valued = applyEstimatedValuation(competition({
      siteName,
      name,
      categories: ["instant-win"],
      cashAlternative,
    }));

    assert.equal(valued.cashAlternative, cashAlternative, siteName);
    assert.equal(valued.valuationSource, "cash", siteName);
    assert.equal(getPrizeValue(valued), cashAlternative, siteName);
  }
});

test("admission and event ticket prizes remain eligible for LLM valuation", async () => {
  const names = [
    "Win 2 tickets to Taylor Swift",
    "2 Tickets to The Rocky Horror Show!",
    "WIN 2 TICKETS to see WESTLIFE at the P&J Live",
    "Win 4 tickets to Arsenal v Chelsea",
    "2x Theme Park Tickets",
    "Win 2 return flight tickets to New York",
  ];
  let candidateNames: string[] = [];

  await applyEstimatedValuations(
    names.map((name, index) => competition({
      sourceId: `admission-${index}`,
      name,
    })),
    {
      useCache: false,
      llmEstimator: async (candidates) => {
        candidateNames = candidates.map((candidate) => candidate.competition.name);
        return new Map();
      },
    },
  );

  assert.deepEqual(candidateNames, names);
});

test("known raffle-ticket bundles remain ineligible for deterministic and LLM valuation", async () => {
  const names = [
    "WIN 5 X ROLEX DATEJUST TICKETS WORTH £300 – DRAW NO.1",
    "Win 100 x Rolex Daytona Panda or £20k Tickets #3",
    "WIN 400 TICKETS ON THE 1K EVERY WEEK IN AUGUST",
    "100 Tickets for ‘All-Inclusive France Trip For Two’ Competition #2",
    "Ticket Bundle Comp: Max Tickets on The Triumph Speed 400",
    "🕷️Quick… £6666 MINI Draw – £120 Of Tickets For Main Comp",
    "🕷️ Tickets Galore Instants.. £100 Of Tickets for Tonights Comp End Prize (Autodraw)",
  ];
  let calls = 0;
  const comps = await applyEstimatedValuations(
    names.map((name, index) => competition({
      sourceId: `raffle-bundle-${index}`,
      name,
    })),
    {
      useCache: false,
      llmEstimator: async () => {
        calls += 1;
        return new Map();
      },
    },
  );

  assert.equal(calls, 0);
  for (const comp of comps) {
    assert.equal(comp.estimatedPrizeValue, undefined);
    assert.equal(comp.valuationSource, undefined);
  }
});

test("LLM valuation is skipped for site-credit accelerators", async () => {
  let calls = 0;
  const comps = await applyEstimatedValuations([
    competition({
      sourceId: "odds-accelerator-23-100-site-credit-end-prize",
      name: "Odds Accelerator #23 (£100 Site Credit End Prize)",
    }),
    competition({
      sourceId: "125-site-credit",
      name: "£125 Site Credit",
    }),
    competition({
      sourceId: "coasters-credit",
      name: "FRIDAY MIDDAY COASTER'S CREDIT COMP!",
    }),
  ], {
    useCache: false,
    llmEstimator: async () => {
      calls += 1;
      return new Map();
    },
  });

  assert.equal(calls, 0);
  for (const comp of comps) {
    assert.equal(comp.estimatedPrizeValue, undefined);
    assert.equal(comp.valuationSource, undefined);
  }
});

test("LLM valuation includes vehicle-looking prizes regardless of category", async () => {
  let calls = 0;
  const [comp] = await applyEstimatedValuations([
    competition({
      siteName: "agrigiveaways",
      sourceId: "wdLwjgbj",
      name: "Brand New Classic LandRover Defender 90",
      categories: ["music & instruments"],
    }),
  ], {
    useCache: false,
    llmEstimator: async (candidates) => {
      calls += 1;
      return new Map([[candidates[0]!.cacheKey, {
        value: 20_000,
        source: "llm_estimate",
        confidence: "low",
        notes: "Vehicle prize valued from title",
      }]]);
    },
  });

  assert.equal(calls, 1);
  assert.equal(comp?.estimatedPrizeValue, 20_000);
  assert.equal(comp?.valuationSource, "llm_estimate");
});

test("LLM valuation still runs for vehicle-looking prizes in vehicle categories", async () => {
  let calls = 0;
  const [comp] = await applyEstimatedValuations([
    competition({
      sourceId: "defender",
      name: "Land Rover Defender",
      categories: ["car"],
    }),
  ], {
    useCache: false,
    llmEstimator: async ([candidate]) => {
      calls += 1;
      return new Map([
        [
          candidate.cacheKey,
          {
            value: 20000,
            source: "llm_estimate",
            confidence: "low",
            notes: "Vehicle category confirms this is a real car prize",
          },
        ],
      ]);
    },
  });

  assert.equal(calls, 1);
  assert.equal(comp?.estimatedPrizeValue, 20000);
  assert.equal(comp?.valuationSource, "llm_estimate");
});

test("LLM valuation parser rejects unknown ids and applies configured haircut", () => {
  const parsed = parseLlmValuations(
    JSON.stringify({
      valuations: [
        {
          id: "known",
          retailValue: 300,
          confidence: "medium",
          notes: "Normal UK retail is about £300",
        },
        {
          id: "unknown",
          retailValue: 999,
          confidence: "high",
        },
        {
          id: "ambiguous",
          retailValue: null,
        },
      ],
    }),
    new Set(["known", "ambiguous"]),
  );

  assert.equal(parsed.get("known")?.value, 240);
  assert.equal(parsed.get("known")?.source, "llm_estimate");
  assert.equal(parsed.get("known")?.confidence, "medium");
  assert.equal(parsed.get("unknown"), undefined);
  assert.equal(parsed.get("ambiguous"), null);
});

test("LLM no-estimate results leave competitions unvalued", async () => {
  const [comp] = await applyEstimatedValuations([
    competition({
      sourceId: "mystery",
      name: "Mystery Bundle",
    }),
  ], {
    useCache: false,
    llmEstimator: async ([candidate]) => new Map([[candidate.cacheKey, null]]),
  });

  assert.equal(comp?.estimatedPrizeValue, undefined);
  assert.equal(comp?.valuationSource, undefined);
});

test("LLM valuation processes every candidate in configured-size batches", async () => {
  const batchSizes: number[] = [];
  const count = CONFIG.valuation.llmMaxRafflesPerRequest * 2 + 1;
  const comps = Array.from({ length: count }, (_, index) => competition({
    siteName: "batch-policy",
    sourceId: `batch-${index}`,
    name: `Mystery item ${index}`,
  }));

  const valued = await applyEstimatedValuations(comps, {
    useCache: false,
    llmEstimator: async (candidates) => {
      batchSizes.push(candidates.length);
      return new Map(candidates.map((candidate) => [candidate.cacheKey, {
        value: 100,
        source: "llm_estimate" as const,
        confidence: "medium" as const,
        notes: "Batch test valuation",
      }]));
    },
  });

  assert.deepEqual(batchSizes, [
    CONFIG.valuation.llmMaxRafflesPerRequest,
    CONFIG.valuation.llmMaxRafflesPerRequest,
    1,
  ]);
  assert.equal(valued.every((comp) => comp.estimatedPrizeValue === 100), true);
});

test("cached no-estimate valuations are retried after 24 hours", async () => {
  const now = new Date("2026-08-26T12:00:00.000Z");
  const input = competition({
    siteName: "cache-policy",
    sourceId: "no-estimate-retry",
    name: "Unpriced mystery item",
  });

  await applyEstimatedValuations([input], {
    useCache: false,
    now,
    llmEstimator: async ([candidate]) => new Map([[candidate!.cacheKey, null]]),
  });

  let calls = 0;
  await applyEstimatedValuations([input], {
    now: new Date("2026-08-27T00:00:00.000Z"),
    llmEstimator: async () => {
      calls += 1;
      return new Map();
    },
  });
  assert.equal(calls, 0);

  await applyEstimatedValuations([input], {
    now: new Date("2026-08-27T13:00:00.000Z"),
    llmEstimator: async () => {
      calls += 1;
      return new Map();
    },
  });
  assert.equal(calls, 1);
});

test("new prize context preserves old caches when absent and invalidates them when evidence changes", async () => {
  const {createHash} = await import("node:crypto");
  const {mkdtempSync} = await import("node:fs");
  const {tmpdir} = await import("node:os");
  const {join} = await import("node:path");
  const {useDatabaseForTests,closeDatabaseForTests,upsertCachedPrizeValuation} = await import("../src/storage/database.js");
  useDatabaseForTests(join(mkdtempSync(join(tmpdir(),"raffle-cache-compat-")),"test.db"));
  try {
    const input=competition({name:"Unpriced model X"});
    const now=new Date();
    const hash=createHash("sha256").update(`${input.siteName}|${input.sourceId}|${input.name.toLowerCase()}`).digest("hex").slice(0,16);
    upsertCachedPrizeValuation({cacheKey:`${input.siteName}:${input.sourceId}:${hash}`,siteName:input.siteName,sourceId:input.sourceId,prizeName:input.name,url:input.url,estimatedPrizeValue:80,valuationConfidence:"medium",valuationNotes:"Existing estimate",status:"valued"},now);
    let calls=0;
    const options={now,llmEstimator:async()=>{calls++;return new Map();}};
    const cached=await applyEstimatedValuations([{...input}],options);
    assert.equal(cached[0]?.estimatedPrizeValue,80);
    assert.equal(calls,0);
    await applyEstimatedValuations([{...input,prizeDescription:"Different contents, confirmed by the operator"}],options);
    assert.equal(calls,1);
  } finally {closeDatabaseForTests();}
});
