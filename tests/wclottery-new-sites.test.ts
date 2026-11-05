import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichCompetitionFromDetail,
  parseDetailPage,
  parsePage,
} from "../src/adapters/wclottery/wclottery-parser.js";

test("Ultimate Wins parser enriches exact ticket and closing fields", () => {
  const config = {
    siteName: "ultimatewins",
    displayName: "Ultimate Wins",
    baseUrl: "https://ultimatewins.co.uk",
    listPath: "/live-competitions/",
    userAgent: "test",
    fetchDelayMs: 0,
  };
  const [listing] = parsePage(
    `
      <div class="product type-product">
        <a href="https://ultimatewins.co.uk/competitions/500-cash-520-entries/"></a>
        <h2>£500 Cash – 520 Entries</h2>
        <div class="ts-badge-value">Tickets Just £1.49</div>
        <span class="ts-progress-sold">0</span><span class="ts-progress-max">520</span>
      </div>
    `,
    config,
  );
  assert.ok(listing);
  assert.equal(listing.entryPrice, 1.49);
  assert.equal(listing.maxTickets, 520);
  assert.equal(listing.drawDate, null);

  const enriched = enrichCompetitionFromDetail(
    listing,
    `
      <div class="product type-product">
        <h2>Win This £500 Cash – 520 Entries</h2>
        <span class="woocommerce-Price-amount">£1.49</span>
        <div class="ts-progress"><span class="ts-progress-sold">65</span><span class="ts-progress-max">520</span></div>
        <p>Max Entries PP 520 Total Tickets</p>
        <p>Fixed closing date: 6 October 2026 at 8:00 pm.</p>
      </div>
    `,
  );

  assert.equal(enriched.name, "£500 Cash – 520 Entries");
  assert.equal(enriched.ticketsSold, 65);
  assert.equal(enriched.maxTickets, 520);
  assert.equal(enriched.maxEntriesPerUser, 520);
  assert.equal(enriched.maxEntriesPerUserSource, "site");
  assert.equal(enriched.cashAlternative, 500);
  assert.equal(enriched.drawDate, "2026-10-06T19:00:00.000Z");
});

test("Win A Classic detail parser handles labelled and compact ticket counts", () => {
  const config = {
    siteName: "winaclassic",
    displayName: "Win A Classic",
    baseUrl: "https://winaclassic.co.uk",
    listPath: "/",
    userAgent: "test",
    fetchDelayMs: 0,
  };

  const labelled = parseDetailPage(
    `
      <div class="product post-123">
        <h1 class="product_title">Win a 2004 Rover MGTF Workshop to Winner draw</h1>
        <span class="price"><span class="woocommerce-Price-amount">£1.99</span></span>
        <div class="tick" data-date="2026-08-30 20:00"></div>
        <p>Competition closes: 30 August 2026 at 8:00pm</p>
        <p>Tickets sold: 526 / 8500</p>
      </div>
    `,
    config,
    "https://winaclassic.co.uk/all-competitions/win-a-rover-mgtf/",
  );

  assert.equal(labelled?.ticketsSold, 526);
  assert.equal(labelled?.maxTickets, 8500);
  assert.equal(labelled?.entryPrice, 1.99);
  assert.equal(labelled?.drawDate, "2026-08-30T19:00:00.000Z");

  const compact = parseDetailPage(
    `
      <div class="product post-456">
        <h1 class="product_title">£100 Cash Giveaway – 7 Day Quick Draw</h1>
        <span class="price"><span class="woocommerce-Price-amount">£0.25</span></span>
        <div class="tick" data-date="2026-08-14 19:00"></div>
        <p>1 sold 199 remaining</p>
        <p>Draw Date: 14 August 2026 at 7:00pm</p>
      </div>
    `,
    config,
    "https://winaclassic.co.uk/all-competitions/100-cash-giveaway/",
  );

  assert.equal(compact?.ticketsSold, 1);
  assert.equal(compact?.maxTickets, 200);
  assert.equal(compact?.entryPrice, 0.25);
  assert.equal(compact?.drawDate, "2026-08-14T18:00:00.000Z");
});

test("WC Lottery parser handles the current ChronoWin homepage layout", () => {
  const [competition] = parsePage(
    `
      <a href="https://chronowin.co.uk/product/16233/">Enter Now</a>
      <p>Win This ROLEX Datejust 36 ref. 16233 Time Left to End:</p>
      <p>561/600 Tickets Remaining</p>
      <h2>for just £19.99</h2>
      <p>Value: £6500The Rolex Datejust</p>
      <p>End Date: July 19, 2026 10:00 pm - Draw Date: 19/07/2026 10:30PM</p>
    `,
    {
      siteName: "chronowin",
      displayName: "ChronoWin",
      baseUrl: "https://chronowin.co.uk",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
  );

  assert.equal(competition?.name, "ROLEX Datejust 36 ref. 16233");
  assert.equal(competition?.entryPrice, 19.99);
  assert.equal(competition?.ticketsSold, 39);
  assert.equal(competition?.maxTickets, 600);
  assert.equal(competition?.estimatedPrizeValue, 5525);
  assert.equal(competition?.drawDate, "2026-07-19T21:30:00.000Z");
});

test("WC Lottery parser reads Edge ticket cap from the detail labels", () => {
  const config = {
    siteName: "edge",
    displayName: "Edge Competitions",
    baseUrl: "https://edgecompetitions.co.uk",
    listPath: "/current-competitions/",
    userAgent: "test",
    fetchDelayMs: 0,
  };
  const [listing] = parsePage(
    `
      <li class="product type-product post-9801 product_cat-competitions">
        <a href="https://edgecompetitions.co.uk/product/win-an-ion-hoody-ionic-%c2%b7-only-100-tickets/"><h2>WIN AN ION ‘HOODY IONIC’ · ONLY 100 TICKETS</h2></a>
        <span class="price">£1.99 PER ENTRY</span>
        <p>Tickets Sold: 6/100</p>
        <div class="flip-clock-wrap" data-enddate="2026-10-18 18:00"></div>
      </li>
    `,
    config,
  );

  assert.ok(listing);
  assert.equal(listing.ticketsSold, 6);
  assert.equal(listing.maxTickets, 100);
  assert.equal(listing.entryPrice, 1.99);

  const enriched = enrichCompetitionFromDetail(
    listing,
    `
      <div class="product post-9801">
        <h1 class="product_title">WIN AN ION ‘HOODY IONIC’ · ONLY 100 TICKETS</h1>
        <p>100 TOTAL TICKETS</p>
        <p>10 MAX ENTRIES PER USER</p>
        <p>1.99 COST PER ENTRY</p>
      </div>
    `,
  );

  assert.equal(enriched.maxEntriesPerUser, 10);
  assert.equal(enriched.maxEntriesPerUserSource, "site");
});

test("WC Lottery parser handles ChronoWin ticket and draw fields", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-1759">
        <h1>ROLEX Datejust Blue Vignette Diamond Dial 36 ref. 16233</h1>
        <p class="price"><span class="amount">£19.99</span></p>
        <div class="tickets-sold">561/600 Tickets Remaining</div>
        <p>Value: £6500</p>
        <p>End Date: July 19, 2026 10:00 pm - Draw Date: 19/07/2026 10:30PM</p>
      </div>
    `,
    {
      siteName: "chronowin",
      displayName: "ChronoWin",
      baseUrl: "https://chronowin.co.uk",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://chronowin.co.uk/product/16233/",
  );

  assert.equal(competition?.entryPrice, 19.99);
  assert.equal(competition?.ticketsSold, 39);
  assert.equal(competition?.maxTickets, 600);
  assert.equal(competition?.estimatedPrizeValue, 5525);
  assert.equal(competition?.drawDate, "2026-07-19T21:30:00.000Z");
});

test("WC Lottery parser handles Plum Equestrian ticket tabs and draw date", () => {
  const competition = parseDetailPage(
    `
      <div class="jtx-single-product-container-inner">
        <h1>Win our Super Low Milage Horsebox “Pimms” or Take £20000 Tax Free Cash!</h1>
        <p class="price"><span class="amount">£13.97</span></p>
        <div class="jtx-lottery-ticket-meta-box"><h4>MAX TICKETS</h4><span class="jtx-lottery-ticket-meta-span">4599</span></div>
        <div class="jtx-lottery-ticket-meta-box"><h4>TOTAL TICKETS</h4><span class="jtx-lottery-ticket-meta-span">4599</span></div>
        <div class="jtx-lottery-ticket-meta-box"><h4>DRAW DATE</h4><span class="jtx-lottery-ticket-meta-span">12/08/2026 23:15</span></div>
        <div class="jtx-lottery-ticket-bar-product"><span>3638 tickets remaining</span> 4599</div>
      </div>
    `,
    {
      siteName: "plumequestrian",
      displayName: "Plum Equestrian",
      baseUrl: "https://www.plumequestrian.com",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://www.plumequestrian.com/product/pimms/",
  );

  assert.equal(competition?.entryPrice, 13.97);
  assert.equal(competition?.ticketsSold, 961);
  assert.equal(competition?.maxTickets, 4599);
  assert.equal(competition?.cashAlternative, 20000);
  assert.equal(competition?.drawDate, "2026-08-12T22:15:00.000Z");
});

test("WC Lottery detail parser refreshes price-only cards and values Garilla's explicit gift card", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-3345">
        <h1>TUI Gift Card (£300)</h1>
        <p class="price"><span class="amount">£1.00</span></p>
        <div class="lty-progress-bar"><span class="lty-progress-bar-start">12</span><span class="lty-progress-bar-end">1200</span></div>
        <p>Competition ends on: August 15, 2026 12:00 am</p>
      </div>
    `,
    {
      siteName: "garilla",
      displayName: "Garilla",
      baseUrl: "https://garilla.co.uk",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://garilla.co.uk/product/tui-gift-card/",
  );

  assert.equal(competition?.name, "TUI Gift Card (£300)");
  assert.equal(competition?.estimatedPrizeValue, 300);
  assert.equal(competition?.valuationSource, "site_estimate");
  assert.equal(competition?.ticketsSold, 12);
  assert.equal(competition?.maxTickets, 1200);
});

test("WC Lottery detail parser applies the narrow 365 Shrek retail estimate", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-2086">
        <h1>WIN! SHREK LEGO FOR ONLY 60p!!</h1>
        <p class="price"><span class="amount">£0.60</span></p>
        <p>Set Number: 72423</p>
        <div class="lty-progress-bar"><span class="lty-progress-bar-start">2</span><span class="lty-progress-bar-end">200</span></div>
        <p>This competition will end on (07.08.26, 18:00)</p>
      </div>
    `,
    {
      siteName: "365competition",
      displayName: "365 Competitions",
      baseUrl: "https://www.365competition.co.uk",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://www.365competition.co.uk/product/win-shrek-lego-for-only-60p/",
  );

  assert.equal(competition?.estimatedPrizeValue, 109.99);
  assert.equal(competition?.valuationSource, "manual_estimate");
  assert.equal(competition?.ticketsSold, 2);
  assert.equal(competition?.maxTickets, 200);
});

test("WC Lottery detail parser restores Dynamic's actual title when the card only says per-entry", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-39">
        <h1>KTM Superduke R 1290cc + instants!</h1>
        <p class="price"><span class="amount">£5.00</span></p>
        <div class="lty-progress-bar"><span class="lty-progress-bar-start">0</span><span class="lty-progress-bar-end">3000</span></div>
        <p>Competition ends on: July 31, 2026 8:34 pm</p>
      </div>
    `,
    {
      siteName: "dynamiccompetitions",
      displayName: "Dynamic Competitions",
      baseUrl: "https://dynamic-competitions.co.uk",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://dynamic-competitions.co.uk/competitions/ktm-superduke-r-1290cc-instants/",
  );

  assert.equal(competition?.name, "KTM Superduke R 1290cc + instants!");
});

test("WC Lottery parser handles Watches of Wales sold/total detail text", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-98365">
        <h1 class="product_title">Tudor Black Bay Bronze Flash</h1>
        <span class="price"><span class="woocommerce-Price-amount">£9.99</span></span>
        <p>56/350 tickets sold</p>
        <p>Competition closes: 13 August 2026 at 9:00pm</p>
        <p>Max 35 Per Person</p>
      </div>
    `,
    {
      siteName: "watchesofwales",
      displayName: "Watches of Wales",
      baseUrl: "https://competition.watchesofwales.co.uk",
      listPath: "/competitions/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://competition.watchesofwales.co.uk/product/tudor-black-bay-bronze-flash-2/",
  );

  assert.equal(competition?.ticketsSold, 56);
  assert.equal(competition?.maxTickets, 350);
  assert.equal(competition?.entryPrice, 9.99);
  assert.equal(competition?.maxEntriesPerUser, 35);
  assert.equal(competition?.drawDate, "2026-08-13T20:00:00.000Z");
});

test("WC Lottery parser reads Danubian plain-text ticket counts", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-1890">
        <h1 class="product_title">MERCEDES BENZ SL63 AMG 4MATIC+ (585 HP) 2023</h1>
        <span class="price"><span class="woocommerce-Price-amount">£1.99</span></span>
        <p>Competition ends on: 29/08/2026 8:00 pm</p>
        <p>15800 / 70000</p>
        <p>Tickets Sold 15,800</p>
        <p>Cash alternative £60,000.00</p>
      </div>
    `,
    {
      siteName: "danubiancompetitions",
      displayName: "Danubian Competitions",
      baseUrl: "https://danubiancompetitions.co",
      listPath: "/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://danubiancompetitions.co/product/mercedes-benz-sl-63-amg-v8/",
  );

  assert.equal(competition?.ticketsSold, 15800);
  assert.equal(competition?.maxTickets, 70000);
  assert.equal(competition?.entryPrice, 1.99);
  assert.equal(competition?.cashAlternative, 60000);
});

test("WC Lottery parser reads UnlockD detail economics", () => {
  const competition = parseDetailPage(
    `
      <div class="product">
        <h1>Win a £5,000 John Lewis Voucher</h1>
        <p>Total 12000 Tickets</p>
        <p>Max 12000 Tickets/User</p>
        <p>95/12000 Tickets Sold</p>
        <p>Per Ticket Price £10.00</p>
        <p>Opening DateTuesday 4th August 2026Closing DateSunday 30th August 2026 23:59Draw DateMonday 31st August 2026</p>
      </div>
    `,
    {
      siteName: "unlockd",
      displayName: "UnlockD",
      baseUrl: "https://unlockd.uk.com",
      listPath: "/product/win-a-5000-voucher-to-spruce-up-your-home/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://unlockd.uk.com/product/win-a-5000-voucher-to-spruce-up-your-home/",
  );

  assert.equal(competition?.ticketsSold, 95);
  assert.equal(competition?.maxTickets, 12000);
  assert.equal(competition?.entryPrice, 10);
  assert.equal(competition?.estimatedPrizeValue, 5000);
  assert.equal(competition?.drawDate, "2026-08-30T22:59:00.000Z");
});

test("WC Lottery parser handles Leica Hunter GMT draw text and ticket pool", () => {
  const competition = parseDetailPage(
    `
      <div class="product post-884">
        <h1 class="product_title">Leica M EV1</h1>
        <span class="price"><span class="woocommerce-Price-amount">£15.95</span></span>
        <div class="lty-tickets-sold">Tickets Sold: <b>115</b></div>
        <div class="lty-progress-bar"><span class="lty-progress-bar-end">1500</span></div>
        <p>Live draw: Tuesday 1st September - 2:30pm (GMT)</p>
        <p>Prize worth £9,599</p>
      </div>
    `,
    {
      siteName: "leicahunter",
      displayName: "Leica Hunter Competitions",
      baseUrl: "https://leicahuntercompetitions.com",
      listPath: "/product/m84/",
      userAgent: "test",
      fetchDelayMs: 0,
    },
    "https://leicahuntercompetitions.com/product/m84/",
  );

  assert.equal(competition?.ticketsSold, 115);
  assert.equal(competition?.maxTickets, 1500);
  assert.equal(competition?.entryPrice, 15.95);
  assert.equal(competition?.drawDate, "2026-09-01T14:30:00.000Z");
});
