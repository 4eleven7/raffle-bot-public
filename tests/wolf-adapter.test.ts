import test from "node:test";
import assert from "node:assert/strict";
import { parseDetail, parseListingCards, WolfAdapter } from "../src/adapters/wolf/wolf-adapter.js";

test("Wolf adapter parses listing progress and detail economics", () => {
  const listing = parseListingCards(`
    <div class="competition-listing__item">
      <a href="https://wolfcompetitions.co.uk/competition/15k-for-15p-%f0%9f%92%b0/">
        <div data-progress="19" class="progress-bar"></div>
        <h3 class="title">15k for 15p</h3>
        <p class="description">15k for 15p 💰</p>
        <p class="large cost">&pound;0.15 per entry</p>
      </a>
    </div>
  `);
  assert.equal(listing.length, 1);
  assert.equal(listing[0]?.sourceId, "15k-for-15p-%f0%9f%92%b0");
  assert.equal(listing[0]?.entryPrice, 0.15);
  assert.equal(listing[0]?.soldPercent, 19);

  const detail = parseDetail(`
    <h1 id="competition-title">15k for 15p 💰</h1>
    <div id="competition-cost">15p per entry</div>
    <div class="competition-date">Drawn Sunday 28th June 19:30<br></div>
    <section id="competition-ticket-selection"><div x-init="range: { min: 1, max: 500 }"></div></section>
    <div id="competition-text">
      <p>Win upto £15,000 cash instantly</p>
      <p>Total Tickets Available: 9999 🎟️</p>
    </div>
  `);
  assert.equal(detail.name, "15k for 15p 💰");
  assert.equal(detail.entryPrice, 0.15);
  assert.equal(detail.ticketsSold, null);
  assert.equal(detail.maxTickets, 9999);
  assert.equal(detail.maxEntriesPerUser, 500);
  assert.equal(detail.cashAlternative, 15000);
  assert.ok(detail.drawDate);
});

test("Wolf adapter quarantines rows when only listing percentage supplies sold inventory", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://wolfcompetitions.co.uk/competition/rounded-progress/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://wolfcompetitions.co.uk/") {
      return new Response(`
        <div class="competition-listing__item">
          <a href="${detailUrl}">
            <div data-progress="19"></div>
            <h3 class="title">Rounded Progress</h3>
            <p class="description">Win £500 cash</p>
            <p>£0.50 per entry</p>
          </a>
        </div>
      `, { status: 200 });
    }
    if (url === detailUrl) {
      return new Response(`
        <h1 id="competition-title">Rounded Progress</h1>
        <div id="competition-cost">£0.50 per entry</div>
        <div class="competition-date">Drawn Sunday 28th June 19:30</div>
        <div id="competition-text">Win £500 cash. Total Tickets Available: 9999</div>
      `, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    assert.deepEqual(await new WolfAdapter().fetchAll(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Wolf adapter retains exact sold and available inventory from its progress API", async () => {
  const originalFetch = globalThis.fetch;
  const detailUrl = "https://wolfcompetitions.co.uk/competition/exact-progress/";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === "https://wolfcompetitions.co.uk/") {
      return new Response(`
        <div class="competition-listing__item">
          <a href="${detailUrl}">
            <div data-progress="19"></div>
            <h3 class="title">Exact Progress</h3>
            <p class="description">Win £500 cash</p>
            <p>£0.50 per entry</p>
          </a>
        </div>
      `, { status: 200 });
    }
    if (url === detailUrl) {
      return new Response(`
        <h1 id="competition-title">Exact Progress</h1>
        <div id="competition-cost">£0.50 per entry</div>
        <div class="competition-date">Drawn Sunday 28th June 19:30</div>
        <div id="competition-text">Win £500 cash. Total Tickets Available: 9999</div>
        <div id="competition-progress" data-competition="123"></div>
      `, { status: 200 });
    }
    if (url.endsWith("/wp-json/wolf-competitions/v1/competition/progress")) {
      return Response.json({
        progress: { "123": { sold: 1900, available: 8099, max: 500, status: "open" } },
      });
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const competitions = await new WolfAdapter().fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.ticketsSold, 1900);
    assert.equal(competitions[0]?.maxTickets, 9999);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
