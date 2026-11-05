import test from "node:test";
import assert from "node:assert/strict";
import { McKinneyAdapter } from "../src/adapters/mckinney/mckinney-adapter.js";

test("McKinney adapter parses Tonight draw labels", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      `
        <section id="section-all-competitions">
          <div class="competitionCard">
            <a href="https://mckinneycompetitions.com/competition/bmw-325i-mini-cooper-sport-5-000-or-30-000-cash">
              <span class="comp-draw">Draw | Tonight 10:30pm</span>
              <h3 class="comp-category">Vehicles</h3>
              <h2 class="comp-title">BMW 325i & Mini Cooper Sport + £5,000 or £30,000 Cash</h2>
              <div class="tickets-sold">9,897 / 44,999 Tickets Sold</div>
              <h3 class="entry-price">£1.99 <label>per entry</label></h3>
            </a>
          </div>
        </section>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );

  try {
    const comps = await new McKinneyAdapter().fetchAll();
    const expected = new Date();
    expected.setHours(22, 30, 0, 0);

    assert.equal(comps.length, 1);
    assert.equal(comps[0]?.drawDate, expected.toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});
