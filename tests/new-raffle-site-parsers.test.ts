import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichCompetitionFromDetail,
  parsePage,
} from "../src/adapters/wclottery/wclottery-parser.js";
import type { WCLotterySiteConfig } from "../src/adapters/wclottery/wclottery-site-config.js";
import { parseSovereignProduct } from "../src/adapters/shopify/sovereign-adapter.js";

const config = (siteName: string, baseUrl: string): WCLotterySiteConfig => ({
  siteName,
  displayName: siteName,
  baseUrl,
  listPath: "/",
  userAgent: "test",
  fetchDelayMs: 0,
});

test("new custom listing layouts expose complete ticket economics", () => {
  const agri = parsePage(
    `<article class="product__card"><a href="/competitions/yeti-35-cool-box/"><h3>YETI 35 Cool Box</h3></a><span aria-valuenow="1" aria-valuemax="400"></span><p>Only £1.99 to enter</p></article>`,
    config("agrigiveaways", "https://agrigiveaways.com"),
  )[0]!;
  assert.deepEqual(
    { name: agri.name, entryPrice: agri.entryPrice, ticketsSold: agri.ticketsSold, maxTickets: agri.maxTickets },
    { name: "YETI 35 Cool Box", entryPrice: 1.99, ticketsSold: 1, maxTickets: 400 },
  );

  const fun = parsePage(
    `<article class="rws-live-comp-card"><a href="/competitions/pokemon-every-ticket-is-a-winner/"><h3>Pokemon - Every Ticket Wins</h3></a><span data-rws-progress-product="pokemon-every-ticket-is-a-winner"></span><span data-rws-progress-sold>1,136/6,000</span><span class="rws-price--sale">£1.50</span><span data-rws-end="1785693600"></span></article>`,
    config("funandgames", "https://fun-and-games.co.uk"),
  )[0]!;
  assert.deepEqual(
    { name: fun.name, entryPrice: fun.entryPrice, ticketsSold: fun.ticketsSold, maxTickets: fun.maxTickets, drawDate: fun.drawDate },
    { name: "Pokemon - Every Ticket Wins", entryPrice: 1.5, ticketsSold: 1136, maxTickets: 6000, drawDate: "2026-08-02T18:00:00.000Z" },
  );

  const cult = parsePage(
    `<article class="comp-card" data-card-href="draw.php?id=36"><h2 class="comp-card__title">55\" 4K Philips Ambilight TV</h2><span class="comp-card__price-amount">£1.99</span><span class="comp-card__meta">208 / 250 tickets sold</span><span data-countdown="1785699000000"></span></article>`,
    config("cultcomps", "https://www.cultcomps.com"),
  )[0]!;
  assert.deepEqual(
    { name: cult.name, entryPrice: cult.entryPrice, ticketsSold: cult.ticketsSold, maxTickets: cult.maxTickets, drawDate: cult.drawDate },
    { name: "55\" 4K Philips Ambilight TV", entryPrice: 1.99, ticketsSold: 208, maxTickets: 250, drawDate: "2026-08-02T19:30:00.000Z" },
  );
});

test("new detail fallbacks fill economics and prefer Jammy's visible draw date", () => {
  const adrenaline = enrichCompetitionFromDetail(
    parsePage(
      `<li class="product"><a href="/competition/pop-your-way-to-15k/"><h2>POP YOUR WAY TO £15K</h2></a></li>`,
      config("adrenalinerush", "https://adrenalinerushcompetitions.co.uk"),
    )[0]!,
    `<title>POP YOUR WAY TO £15K – Adrenaline Rush Competitions</title><h1>POP YOUR WAY TO £15K</h1><div class="product-type-vhs-competition"><div class="vhs-percentage-sold__details__total">4,651 / 15,000</div><div>£8 PER ENTRY</div><div class="vhs-countdown-timer" data-end-date-time="2026-08-24T21:00:00+01:00"></div></div>`,
  );
  assert.deepEqual(
    { name: adrenaline.name, entryPrice: adrenaline.entryPrice, ticketsSold: adrenaline.ticketsSold, maxTickets: adrenaline.maxTickets, drawDate: adrenaline.drawDate },
    { name: "POP YOUR WAY TO £15K", entryPrice: 8, ticketsSold: 4651, maxTickets: 15000, drawDate: "2026-08-24T20:00:00.000Z" },
  );

  const jammy = enrichCompetitionFromDetail(
    {
      ...parsePage(
        `<li class="product"><a href="/shop/the-big-daddy/"><h2>The Big Daddy</h2></a><span class="price">£0.99</span><div class="clockdiv" data-date="July 31, 2026, 1:30 pm"></div></li>`,
        config("jammy", "https://www.jammy.co.uk"),
      )[0]!,
    },
    `<h1>The Big Daddy</h1><div class="tps-split-sold"><span class="big">27,451</span></div><div class="tps-split-remaining"><span class="big">272,548</span></div><p>Each Ticket Costs: £0.99</p><div class="clockdiv" data-date="August 17, 2026, 8:30 pm"></div><div class="jdi-datehero"><div>Draw Ends 21st August 2026 <span>· 1:30pm</span></div></div><p>Max 650 (650) Per Player</p>`,
  );
  assert.deepEqual(
    { entryPrice: jammy.entryPrice, ticketsSold: jammy.ticketsSold, maxTickets: jammy.maxTickets, drawDate: jammy.drawDate },
    { entryPrice: 0.99, ticketsSold: 27451, maxTickets: 299999, drawDate: "2026-08-21T12:30:00.000Z" },
  );

  const trail = enrichCompetitionFromDetail(
    {
      ...parsePage(
        `<article class="global-product"><a href="/competition/big-cash-credit-250-cash/"><span>£1.49 /ticket</span></a></article>`,
        config("trailtuff", "https://trailtuffcomps.co.uk"),
      )[0]!,
    },
    `<h1>Big Cash Credit £250 Cash</h1><div class="wcl-progress-meter">Tickets available: 993</div><div class="single-progressBar">Tickets Sold: 7</div><p>£1.49 /ticket</p><p>Lottery ends: August 6, 2026 8:00 pm</p><p>Lottery is limited to 1000 tickets</p>`,
  );
  assert.deepEqual(
    { entryPrice: trail.entryPrice, ticketsSold: trail.ticketsSold, maxTickets: trail.maxTickets, drawDate: trail.drawDate },
    { entryPrice: 1.49, ticketsSold: 7, maxTickets: 1000, drawDate: "2026-08-06T19:00:00.000Z" },
  );
});

test("Dream Wins detail parser reads VHS competition economics", () => {
  const competition = enrichCompetitionFromDetail(
    {
      sourceId: "",
      siteName: "dreamwins",
      url: "https://dreamwinscompetitions.co.uk/competition/soda-pop/",
      name: "",
      entryPrice: 0,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: "2026-08-04T00:00:00.000Z",
    },
    `<h1>🥤 SODA POP 🥤</h1><div class="product product-type-vhs-competition post-46456"><div class="vhs-percentage-sold__details__total">20,900 / 65,000</div><div>£0.30 Per Entry</div><div>6500 Max Per Person</div><div class="vhs-countdown-timer" data-end-date-time="2026-09-22 20:00:00"></div><div class="product-accordion-item"><div class="product-accordionHeader">Prize Details</div><div class="product-accordionBody">MAIN PRIZE - £500 CASH</div></div></div>`,
  );

  assert.deepEqual(
    {
      sourceId: competition.sourceId,
      name: competition.name,
      entryPrice: competition.entryPrice,
      ticketsSold: competition.ticketsSold,
      maxTickets: competition.maxTickets,
      drawDate: competition.drawDate,
      estimatedPrizeValue: competition.estimatedPrizeValue,
    },
    {
      sourceId: "46456",
      name: "🥤 SODA POP 🥤",
      entryPrice: 0.3,
      ticketsSold: 20900,
      maxTickets: 65000,
      drawDate: "2026-09-22T19:00:00.000Z",
      estimatedPrizeValue: 500,
    },
  );
});

test("Sovereign Draw parser reads Shopify stock, ticket price, cash alternative, and close date", () => {
  const competition = parseSovereignProduct(
    {
      id: 16015161983301,
      title: "WIN A ROLEX GMT MASTER II or £10,000 CASH",
      handle: "win-an-iphone-17-pro-or-800-cash-copy",
      body_html: "<p>Up for grabs is the Stunning Rolex GMT MASTER II BATMAN.</p><p>JUST 1700 tickets available!</p>",
      tags: ["Cash", "ROLEX"],
      variants: [{ id: 58544056074565, title: "1 Ticket £9.99", price: "9.99", available: true }],
    },
    `<span id="variant-58544056074565">Only 1698 left</span><script>const widgets = [{"timer":{"date":"2026-08-16T23:00:00.000+01:00"}}]</script>`,
  );

  assert.deepEqual(
    {
      sourceId: competition?.sourceId,
      entryPrice: competition?.entryPrice,
      ticketsSold: competition?.ticketsSold,
      maxTickets: competition?.maxTickets,
      cashAlternative: competition?.cashAlternative,
      drawDate: competition?.drawDate,
    },
    {
      sourceId: "16015161983301",
      entryPrice: 9.99,
      ticketsSold: 2,
      maxTickets: 1700,
      cashAlternative: 10000,
      drawDate: "2026-08-16T22:00:00.000Z",
    },
  );
});

test("GalaxyComps chooses the prize title instead of ticket metadata", () => {
  const [competition] = parsePage(
    `<article class="product type-product"><a href="/product/shark-chillpill-3in1-fan/"><h2>499 Total Tickets</h2><h2>3.21% Sold</h2><h2>SHARK CHILLPILL 3in1 FAN</h2><span>£0.99</span></a></article>`,
    config("galaxycomps", "https://galaxycomps.co.uk"),
  );
  assert.equal(competition?.name, "SHARK CHILLPILL 3in1 FAN");
});

test("Fun & Games values the standalone LEGO prize without valuing instant-win promotions", () => {
  const competition = parsePage(
    `<article class="rws-live-comp-card"><a href="/competitions/sagrada-familia/"><h3>Sagrada Familia</h3></a><span data-rws-progress-product="sagrada-familia"></span><span data-rws-progress-sold>180/1,560</span><span class="rws-price--sale">£0.63</span><span data-rws-end="1791136800"></span></article>`,
    config("funandgames", "https://fun-and-games.co.uk"),
  )[0]!;
  const enriched = enrichCompetitionFromDetail(
    { ...competition, sourceId: "457615" },
    `<h1>Sagrada Familia</h1><p>Standalone LEGO prize</p>`,
  );
  assert.equal(enriched.estimatedPrizeValue, 649.99);
  assert.equal(enriched.valuationSource, "manual_estimate");
});
