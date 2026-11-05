import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import {
  parseCompWatchDetail,
  parseCompWatchListLinks,
} from "../src/adapters/compwatch/compwatch-adapter.js";

const config = {
  siteName: "britcomps",
  displayName: "Brit Comps",
};

test("CompWatch parser extracts detail economics from UK listing pages", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>WIN A NINJA CREAMi DELUXE 10-IN-1 ICE CREAM MAKER</h1>
        <a href="/competitions/electronics">Electronics</a>
        <a href="/go/kaz5ZYeJ">Enter competition</a>
        <a href="/competitions/cash">Cash footer link</a>
        <p>
          Brit Comps | www.britcomps.co.uk
          1w 1d remaining
          Ticket Price £0.20
          Closes Mon 29 Jun 7:30pm
          Tickets Sold 45 / 1,500
          Odds if you enter now 1 in 46
        </p>
      </main>
    `,
    config,
    "https://compwatch.co.uk/sites/brit-comps/kaz5ZYeJ-win-a-ninja-creami-deluxe-10-in-1-ice-cream-maker",
  );

  const now = DateTime.now().setZone("Europe/London");
  let expected = DateTime.fromObject(
    { year: now.year, month: 6, day: 29, hour: 19, minute: 30 },
    { zone: "Europe/London" },
  );
  if (expected < now.minus({ hours: 24 })) expected = expected.plus({ years: 1 });

  assert.ok(comp);
  assert.equal(comp.sourceId, "kaz5ZYeJ");
  assert.equal(comp.url, "https://compwatch.co.uk/go/kaz5ZYeJ");
  assert.equal(comp.name, "WIN A NINJA CREAMi DELUXE 10-IN-1 ICE CREAM MAKER");
  assert.equal(comp.entryPrice, 0.2);
  assert.equal(comp.ticketsSold, 45);
  assert.equal(comp.maxTickets, 1500);
  assert.equal(comp.maxEntriesPerUserSource, "fallback");
  assert.equal(comp.cashAlternative, null);
  assert.deepEqual(comp.categories, ["electronics"]);
  assert.equal(comp.drawDate, expected.toUTC().toISO({ suppressMilliseconds: false }));
});

test("CompWatch parser values explicit cash listings and free entry", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>£500 TAX-FREE CASH</h1>
        <a href="/competitions/cash">Cash</a>
        <a href="/go/cash123">Enter competition</a>
        <p>
          Ticket Price FREE
          Closes Thu 25 Jun 8pm
          Tickets Sold 19 / 500
        </p>
      </main>
    `,
    { siteName: "rendalls", displayName: "Rendalls Competitions" },
    "https://compwatch.co.uk/sites/rendalls/cash123-500-tax-free-cash",
  );

  assert.ok(comp);
  assert.equal(comp.entryPrice, 0);
  assert.equal(comp.cashAlternative, 500);
  assert.equal(comp.maxEntriesPerUser, 100);
  assert.equal(comp.maxEntriesPerUserSource, "fallback");
});

test("CompWatch parser marks explicit per-user ticket limits as site sourced", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>£1,000 CASH</h1>
        <a href="/competitions/cash">Cash</a>
        <a href="/go/limit123">Enter competition</a>
        <p>
          Ticket Price £0.50
          Closes Fri 26 Jun 8pm
          Tickets Sold 100 / 2,000
          Max Tickets Per User 250
        </p>
      </main>
    `,
    { siteName: "ukcc", displayName: "UKCC" },
    "https://compwatch.co.uk/sites/ukcc/limit123-1000-cash",
  );

  assert.ok(comp);
  assert.equal(comp.maxEntriesPerUser, 250);
  assert.equal(comp.maxEntriesPerUserSource, "site");
});

test("CompWatch parser accepts pence ticket prices", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>WILD WEST QUICK CASH</h1>
        <a href="/competitions/cash">Cash</a>
        <a href="/go/pence123">Enter competition</a>
        <p>
          Ticket Price 69p
          Closes Fri 26 Jun 8pm
          Tickets Sold 1,358 / 10,500
        </p>
      </main>
    `,
    { siteName: "luckyduckycomps", displayName: "Lucky Ducky Comps" },
    "https://compwatch.co.uk/sites/lucky-ducky-comps/pence123-wild-west-quick-cash",
  );

  assert.ok(comp);
  assert.equal(comp.entryPrice, 0.69);
  assert.equal(comp.ticketsSold, 1358);
  assert.equal(comp.maxTickets, 10500);
});

test("CompWatch parser falls back to description pence prices", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>£100 Cash 22.06</h1>
        <a href="/competitions/cash">Cash</a>
        <a href="/go/blacklabel123">Enter competition</a>
        <p>
          This one's simple... £100 Cash, only 33p and only 500 Tickets!
          Ticket Price —
          Closes Mon 22 Jun 9:00pm
          Tickets Sold 123 / 500
        </p>
      </main>
    `,
    { siteName: "blacklabel", displayName: "Black Label Competitions" },
    "https://compwatch.co.uk/sites/black-label-competitions/blacklabel123-100-cash",
  );

  assert.ok(comp);
  assert.equal(comp.entryPrice, 0.33);
  assert.equal(comp.cashAlternative, 100);
});

test("CompWatch parser falls back to explicit free descriptions", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>Children's SEND Sensory Bundle</h1>
        <a href="/competitions/bundle">Bundle</a>
        <a href="/go/click12win123">Enter competition</a>
        <p>
          We've put together this complete free bundle for one of you to win.
          Ticket Price —
          Closes Sun 21 Jun 6:30pm
          Tickets Sold 263 / 2,000
        </p>
      </main>
    `,
    { siteName: "click12win", displayName: "Click12Win" },
    "https://compwatch.co.uk/sites/click12win/click12win123-send-sensory-bundle",
  );

  assert.ok(comp);
  assert.equal(comp.entryPrice, 0);
  assert.equal(comp.ticketsSold, 263);
  assert.equal(comp.maxTickets, 2000);
});

test("CompWatch parser prefers cash alternatives over voucher face values", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>Win A £500 Jet2 Holiday Voucher Or Take £400 Cash Alternative</h1>
        <a href="/competitions/holiday">Holiday</a>
        <a href="/go/voucher123">Enter competition</a>
        <p>
          Ticket Price £0.99
          Closes Sun 21 Jun 8pm
          Tickets Sold 95 / 1,000
        </p>
      </main>
    `,
    { siteName: "rafflemaster", displayName: "Raffle Master" },
    "https://compwatch.co.uk/sites/raffle-master/voucher123-jet2-voucher",
  );

  assert.ok(comp);
  assert.equal(comp.cashAlternative, 400);
});

test("CompWatch parser does not value non-cash voucher titles as cash alternatives", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>Win this £500 Amazon Voucher</h1>
        <a href="/competitions/gift-card">Gift Card</a>
        <a href="/go/voucher456">Enter competition</a>
        <p>
          Ticket Price £0.99
          Closes Wed 24 Jun 7pm
          Tickets Sold 105 / 1,000
        </p>
      </main>
    `,
    { siteName: "giveawaylounge", displayName: "The Giveaway Lounge" },
    "https://compwatch.co.uk/sites/the-giveaway-lounge/voucher456-amazon-voucher",
  );

  assert.ok(comp);
  assert.equal(comp.cashAlternative, null);
});

test("CompWatch parser rejects detail pages without required economics", () => {
  const comp = parseCompWatchDetail(
    `
      <main>
        <h1>Vague Prize</h1>
        <p>Ticket Price £0.20 Tickets Sold 45 / 1,500</p>
      </main>
    `,
    config,
    "https://compwatch.co.uk/sites/brit-comps/missing-date-vague-prize",
  );

  assert.equal(comp, null);
});

test("CompWatch list parser returns unique detail links and skips badges", () => {
  const links = parseCompWatchListLinks(
    `
      <a href="/sites/brit-comps">Brit Comps</a>
      <a href="/sites/brit-comps/badge">Badge</a>
      <a href="/sites/brit-comps/kaz5ZYeJ-win-a-ninja">Ninja</a>
      <a href="/sites/brit-comps/kaz5ZYeJ-win-a-ninja">Duplicate</a>
      <a href="/sites/brit-comps/cash123-cash">Cash</a>
    `,
    { slug: "brit-comps" },
  );

  assert.deepEqual(links, [
    "/sites/brit-comps/kaz5ZYeJ-win-a-ninja",
    "/sites/brit-comps/cash123-cash",
  ]);
});
