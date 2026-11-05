import assert from "node:assert/strict";
import test from "node:test";
import { AllForGiveawaysAdapter, parseAllForGiveawaysCompetition } from "../src/adapters/allforgiveaways/allforgiveaways-adapter.js";

const NOW = new Date("2026-08-05T09:00:00.000Z");
const API_DRAW_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

test("All For Giveaways parser maps public classic economics and cash value", () => {
  const competition = parseAllForGiveawaysCompetition({
    id: "back-to-school",
    title: "BACK TO SCHOOL BUNDLE",
    subtitle: "£150 AMAZON + £150 TESCO + HYPE BUNDLE",
    description: "Worth £570. Or take £500 cash alt. 75 Max Entries Per Person.",
    status: "live",
    site_section: "classic",
    ticket_price_pennies: 50,
    max_tickets: 1699,
    tickets_sold: 103,
    draw_at: "2026-08-10T19:00:00+00:00",
    is_free: false,
    classic_kind: "standard",
  }, "2026-08-05T09:00:00.000Z", NOW);

  assert.deepEqual(competition && {
    sourceId: competition.sourceId,
    url: competition.url,
    entryPrice: competition.entryPrice,
    ticketsSold: competition.ticketsSold,
    maxTickets: competition.maxTickets,
    maxEntriesPerUser: competition.maxEntriesPerUser,
    cashAlternative: competition.cashAlternative,
    estimatedPrizeValue: competition.estimatedPrizeValue,
    drawDate: competition.drawDate,
  }, {
    sourceId: "back-to-school",
    url: "https://www.allforgiveaways.com/competition/back-to-school",
    entryPrice: 0.5,
    ticketsSold: 103,
    maxTickets: 1699,
    maxEntriesPerUser: 75,
    cashAlternative: 500,
    estimatedPrizeValue: 570,
    drawDate: "2026-08-10T19:00:00.000Z",
  });
});

test("All For Giveaways parser preserves explicit free entry and rejects instant-only rows", () => {
  const free = parseAllForGiveawaysCompetition({
    id: "free-games",
    title: "FREE GAMES NIGHT",
    description: "Completely FREE to enter. 1 FREE ENTRY PER PERSON.",
    status: "live",
    site_section: "classic",
    ticket_price_pennies: 0,
    max_tickets: 750,
    tickets_sold: 207,
    draw_at: "2026-08-14T19:00:00+00:00",
    is_free: true,
    free_entries_per_user: 1,
    classic_kind: "standard_draw",
  }, "2026-08-05T09:00:00.000Z", NOW);
  const instant = parseAllForGiveawaysCompetition({
    id: "hook-a-duck",
    title: "HOOK A DUCK FULL OF £300'S",
    description: "20X £300'S To Win Instantly. End prize is a coin pusher.",
    status: "live",
    site_section: "classic",
    ticket_price_pennies: 40,
    max_tickets: 25000,
    tickets_sold: 3658,
    draw_at: "2026-08-13T07:00:00+00:00",
    is_free: false,
    classic_kind: "standard",
  }, "2026-08-05T09:00:00.000Z", NOW);

  assert.equal(free?.entryPrice, 0);
  assert.ok(free?.categories.includes("free"));
  assert.equal(free?.maxEntriesPerUser, 1);
  assert.equal(instant, null);
});

test("All For Giveaways adapter discovers current API rows from public bundles", async () => {
  const originalFetch = globalThis.fetch;
  const anonKey = ["eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", "test", "test"].join(".");
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://www.allforgiveaways.com/") {
      return new Response('<script type="module" src="/assets/app.js"></script>');
    }
    if (url === "https://www.allforgiveaways.com/assets/app.js") {
      return new Response(`createClient("https://example.supabase.co", "${anonKey}")`);
    }
    if (url.startsWith("https://example.supabase.co/rest/v1/competitions")) {
      return new Response(JSON.stringify([{
        id: "current",
        title: "Current Prize",
        description: "Worth £100.",
        status: "live",
        site_section: "classic",
        ticket_price_pennies: 50,
        max_tickets: 100,
        tickets_sold: 10,
        draw_at: API_DRAW_DATE,
        is_free: false,
        classic_kind: "standard",
      }]));
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const rows = await new AllForGiveawaysAdapter().fetchAll();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceId, "current");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
