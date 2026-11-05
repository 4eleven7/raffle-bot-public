import test from "node:test";
import assert from "node:assert/strict";
import { parsePage } from "../src/adapters/rafflex/rafflex-parser.js";

test("Rafflex parser prefers exact card prices over cash alternative amounts", () => {
  const comps = parsePage(
    `
      <a href="https://rushcompetitions.co.uk/competition/ninja-crispi" class="pg-card">
        <div class="pg-card-inner">
          <div class="pg-subtitle-bar">
            <span class="pg-subtitle-text">Cash Alt £130</span>
          </div>
          <div class="pg-prog-meta">
            <span>40% SOLD</span>
            <span>239 / 599 SOLD</span>
          </div>
          <div class="pg-footer">
            <div class="pg-price-group">
              <div class="pg-price">£0.49</div>
            </div>
          </div>
        </div>
      </a>
    `,
    {
      siteName: "rush",
      displayName: "Rush Competitions",
      baseUrl: "https://rushcompetitions.co.uk",
      listPath: "/",
      userAgent: "",
      fetchDelayMs: 0,
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.entryPrice, 0.49);
  assert.equal(comps[0]?.cashAlternative, 130);
  assert.equal(comps[0]?.ticketsSold, 239);
  assert.equal(comps[0]?.maxTickets, 599);
});

test("Rafflex parser accepts plural competition paths", () => {
  const [competition] = parsePage(
    `
      <a href="https://thatprizeguy.co.uk/competitions/summer-millionaire">
        <h2>BIG SUMMER MILLIONAIRE MAKER</h2>
        <div>2,097,670 / 8,000,000 sold</div>
        <div>50p Per Ticket</div>
        <div>Sun Aug 30th 10:30pm</div>
      </a>
    `,
    {
      siteName: "thatprizeguy",
      displayName: "That Prize Guy",
      baseUrl: "https://thatprizeguy.co.uk",
      listPath: "/",
      userAgent: "",
      fetchDelayMs: 0,
    },
  );

  assert.equal(competition?.sourceId, "summer-millionaire");
  assert.equal(competition?.entryPrice, 0.5);
  assert.equal(competition?.ticketsSold, 2097670);
  assert.equal(competition?.maxTickets, 8000000);
});

test("Rafflex parser preserves an explicit zero-price node before a monetary title", () => {
  const comps = parsePage(
    `
      <a href="https://daydreamdraws.co.uk/competition/ps100-winners-choice-gift-voucher">
        <div class="progress">105 / 999</div>
        <div class="price"><span>0p</span><span>Per Entry</span></div>
        <h3>£100 WINNERS CHOICE GIFT VOUCHER</h3>
      </a>
    `,
    {
      siteName: "daydreamdraws",
      displayName: "Daydream Draws",
      baseUrl: "https://daydreamdraws.co.uk",
      listPath: "/",
      userAgent: "",
      fetchDelayMs: 0,
    },
  );

  assert.equal(comps.length, 1);
  assert.equal(comps[0]?.entryPrice, 0);
  assert.equal(comps[0]?.ticketsSold, 105);
  assert.equal(comps[0]?.maxTickets, 999);
  assert.deepEqual(comps[0]?.categories, ["free"]);
});

test("Rafflex parser keeps Clutch instant-win cash out of the main prize", () => {
  const comps = parsePage(
    `
      <a href="https://clutchcomps.com/competition/diamond-hunt-ps200-end-draw">
        <h2>DIAMOND HUNT 💎 £200 END DRAW 💰</h2>
        <div>11167 / 21000 sold</div>
        <div>Cash Alt: £75 Instant Win</div>
        <span>£0.20</span>
      </a>
      <a href="https://clutchcomps.com/competition/win-a-trip-to-gillhams-thailand-for-2-people-plus-flights">
        <h2>WIN A TRIP TO GILLHAMS THAILAND FOR 2 PEOPLE + PLUS FLIGHTS! 🎣✈️</h2>
        <div>14465 / 34000 sold</div>
        <div>Cash Alt: £75 Instant Win</div>
        <span>£0.50</span>
      </a>
    `,
    {
      siteName: "clutchcomps",
      displayName: "Clutch Comps",
      baseUrl: "https://clutchcomps.com",
      listPath: "/",
      userAgent: "",
      fetchDelayMs: 0,
    },
  );

  assert.equal(comps.length, 2);
  assert.equal(comps[0]?.cashAlternative, 200);
  assert.equal(comps[1]?.cashAlternative, null);
});
