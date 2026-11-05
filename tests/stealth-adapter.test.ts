import assert from "node:assert/strict";
import test from "node:test";
import { StealthAdapter } from "../src/adapters/stealth/stealth-adapter.js";

test("Stealth adapter uses exact sold counts and leaves percentage-only inventory unknown", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === "https://stealthcompetitions.co.uk") {
      return new Response(
        `
          <a href="https://stealthcompetitions.co.uk/competition/shark-attack">Shark Attack</a>
          <a href="https://stealthcompetitions.co.uk/competition/ps20000-cash-with-instant-wins-8142">£20,000 Cash</a>
          <a href="https://stealthcompetitions.co.uk/competition/audi-rs6">Audi RS6</a>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://stealthcompetitions.co.uk/competition/shark-attack") {
      return new Response(
        `
          <h1>SHARK ATTACK!</h1>
          <div>6p Per Ticket</div>
          <div>Max: 250,000</div>
          <div>User Max: 15,000</div>
          <p>Tickets Sold: 125,000</p>
          <p>50% Sold</p>
          <p>£500 Cash - End Prize</p>
          <p>We'll draw the winner on DRAW ON Fri Jun 26th 9:30pm.</p>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://stealthcompetitions.co.uk/competition/ps20000-cash-with-instant-wins-8142") {
      return new Response(
        `
          <h1>£20,000 CASH WITH INSTANT WINS!</h1>
          <div>99p Per Ticket</div>
          <div>Max: 100,000</div>
          <div>User Max: 7,500</div>
          <p>7% Sold</p>
          <p>WE ARE GIVING YOU THE CHANCE TO WIN £20,000 CASH PLUS INSTANT WINS ALONG THE WAY FOR JUST 99P PER TICKET!</p>
          <p>We'll draw the winner on DRAW ON Sun Jul 5th 9:30pm.</p>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://stealthcompetitions.co.uk/competition/audi-rs6") {
      return new Response(
        `
          <h1>AUDI RS6 CARBON BLACK WITH INSTANT WINS!</h1>
          <div>50p Per Ticket</div>
          <div>Max: 700,000</div>
          <div>User Max: 50,000</div>
          <p>6% Sold</p>
          <p>40,801 / 700k</p>
          <p>Cash Alternative: £90,000</p>
          <p>We'll draw the winner on DRAW ON Sun Aug 2nd 9:30pm.</p>
        `,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new StealthAdapter().fetchAll();

    assert.equal(competitions.length, 3);
    assert.equal(competitions[0]?.sourceId, "shark-attack");
    assert.equal(competitions[0]?.entryPrice, 0.06);
    assert.equal(competitions[0]?.ticketsSold, 125000);
    assert.equal(competitions[0]?.maxTickets, 250000);
    assert.equal(competitions[0]?.cashAlternative, 500);
    assert.equal(competitions[0]?.maxEntriesPerUser, 15000);
    assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
    assert.deepEqual(competitions[0]?.categories, ["cash", "instant-win", "home"]);
    assert.equal(competitions[1]?.cashAlternative, 20000);
    assert.equal(competitions[1]?.ticketsSold, 0);
    assert.equal(competitions[1]?.maxTickets, 0);
    assert.equal(competitions[1]?.entryPrice, 0.99);
    assert.equal(competitions[1]?.maxEntriesPerUserSource, "site");
    assert.equal(competitions[2]?.ticketsSold, 40801);
    assert.equal(competitions[2]?.maxTickets, 700000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Stealth adapter takes the main prize from title and competition metadata, never instant wins", async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    {
      slug: "duncans-ps10000-for-5p-with-instant-wins",
      name: "DUNCANS £10,000 FOR 5P WITH INSTANT WINS!",
      description:
        "THIS IS DUNCANS COMPETITION GIVING YOU THE CHANCE TO WIN £10,000 CASH FOR JUST 5P WITH INSTANT WINS!",
      instant: "£2,000 CASH",
      expected: 10_000,
      userMax: 40_000,
    },
    {
      slug: "shauns-summer-by-the-sea-ps2000-end-prize",
      name: "SHAUNS SUMMER BY THE SEA - £2,000 END PRIZE!",
      description: "SUMMER BY THE SEA HAS AN END PRIZE OF £2,000 WITH INSTANT WINS!",
      instant: "£1,000 CASH",
      expected: 2_000,
      userMax: 20_000,
    },
    {
      slug: "katishas-ultimate-maldives-holiday-with-instant-wins",
      name: "KATISHA'S ULTIMATE MALDIVES HOLIDAY WITH INSTANT WINS!",
      description: "WIN A LUXURY MALDIVES HOLIDAY. CASH ALTERNATIVE - £6,500",
      instant: "£1,000 CASH",
      expected: 6_500,
      userMax: 2_200,
    },
    {
      slug: "lesleys-ibiza-holiday-with-ps3k-instant-wins-1",
      name: "LESLEY'S IBIZA HOLIDAY WITH £3K INSTANT WINS!",
      description: "WIN AN IBIZA HOLIDAY. CASH ALTERNATIVE - £6,500",
      instant: "£1,000 CASH",
      expected: 6_500,
      userMax: 2_200,
    },
    {
      slug: "ps2000-a-month-for-a-year-with-instant-wins-8509",
      name: "£2,000 A MONTH FOR A YEAR WITH INSTANT WINS!",
      description:
        "WIN £2,000 EVERY MONTH FOR A YEAR OR A £20,000 CASH LUMP SUM WITH INSTANT WINS!",
      instant: "£1,000 CASH",
      expected: 20_000,
      userMax: null,
    },
  ];

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://stealthcompetitions.co.uk") {
      return new Response(
        cases
          .map(({ slug, name }) =>
            `<a href="https://stealthcompetitions.co.uk/competition/${slug}">${name}</a>`
          )
          .join("\n"),
      );
    }

    const fixture = cases.find(({ slug }) => url.endsWith(`/competition/${slug}`));
    if (!fixture) return new Response("not found", { status: 404 });

    return new Response(`
      <html>
        <head><meta name="description" content="${fixture.description}"></head>
        <body>
          <h1>${fixture.name}</h1>
          <div>10p Per Ticket</div>
          <div>Max: 10,000</div>
          <div>Tickets Sold: 100</div>
          ${fixture.userMax === null ? "" : `<div>User Max: ${fixture.userMax}</div>`}
          <p>We'll draw the winner on DRAW ON Fri Jul 31st 9:30pm.</p>
          <section><h2>Instant Wins</h2><p>${fixture.instant}</p></section>
          <section>
            <h2>Competition Details</h2>
            <div class="wysiwyg">${fixture.description}</div>
          </section>
        </body>
      </html>
    `);
  };

  try {
    const competitions = await new StealthAdapter().fetchAll();
    assert.equal(competitions.length, cases.length);
    assert.deepEqual(
      competitions.map(({ cashAlternative }) => cashAlternative),
      cases.map(({ expected }) => expected),
    );
    assert.deepEqual(
      competitions.map(({ maxEntriesPerUserSource }) => maxEntriesPerUserSource),
      ["site", "site", "site", "site", "fallback"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
