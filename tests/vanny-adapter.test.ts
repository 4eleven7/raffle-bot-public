import test from "node:test";
import assert from "node:assert/strict";
import { VannyCampersAdapter } from "../src/adapters/vanny/vanny-adapter.js";
import { getAdapter } from "../src/adapters/registry.js";

test("VannyCampers adapter parses sitemap-backed competition pages", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requests.push(url);

    if (url === "https://vannycampers.co.uk/sitemap.xml") {
      return response(`
        <urlset>
          <url><loc>https://vannycampers.co.uk/rounds/r25/competitions/r25-500-site-credit</loc></url>
          <url><loc>https://vannycampers.co.uk/auto/r22autodraw/competitions/r241000</loc></url>
          <url><loc>https://vannycampers.co.uk/rounds/w30/competitions/w30-carrera-e-bike</loc></url>
          <url><loc>https://vannycampers.co.uk/auto/r22autodraw</loc></url>
        </urlset>
      `, "application/xml");
    }

    if (url === "https://vannycampers.co.uk/rounds/r25/competitions/r25-500-site-credit") {
      return response(`
        <html>
          <body>
            <script type="application/ld+json">${JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              "@id": "https://vannycampers.co.uk/rounds/r25/competitions/r25-500-site-credit#product",
              name: "£500 Site Credit",
              description: "Fancy the chance to WIN £500 Credit to be used to win a camper or one of our other amazing prizes!",
              url: "https://vannycampers.co.uk/rounds/r25/competitions/r25-500-site-credit",
              offers: {
                "@type": "Offer",
                price: "1.97",
                priceCurrency: "GBP",
              },
            })}</script>
            <script>
              window.__reactRouterContext.streamController.enqueue(
                '"competitionEndTime","2026-07-07T19:35:00.000Z","canonicalUrl","https://vannycampers.co.uk/rounds/r25/competitions/r25-500-site-credit","quantityAvailable",429,"maxTicketsAvailable",{"_1147":1818},"499","isLoggedIn"'
              );
            </script>
          </body>
        </html>
      `);
    }

    if (url === "https://vannycampers.co.uk/auto/r22autodraw/competitions/r241000") {
      return response(`
        <html>
          <body>
            <script type="application/ld+json">${JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              "@id": "https://vannycampers.co.uk/auto/r22autodraw/competitions/r241000#product",
              name: "£1000 Prize Draw Ticket",
              description: "£1000 cash tax free",
              url: "https://vannycampers.co.uk/auto/r22autodraw/competitions/r241000",
              offers: {
                "@type": "Offer",
                price: "0.5",
                priceCurrency: "GBP",
              },
            })}</script>
            <script>
              window.__reactRouterContext.streamController.enqueue(
                '"competitionEndTime","2026-06-30T19:30:00.000Z","canonicalUrl","https://vannycampers.co.uk/auto/r22autodraw/competitions/r241000","quantityAvailable",2849,"maxTicketsAvailable",{"_1114":1837},"2999","isLoggedIn"'
              );
            </script>
          </body>
        </html>
      `);
    }

    if (url === "https://vannycampers.co.uk/rounds/w30/competitions/w30-carrera-e-bike") {
      return response(`
        <html>
          <body>
            <script type="application/ld+json">${JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              name: "Carrera Vengeance-E 3.0 Electric Mountain Bike",
              description: "This £1,099 Carrera e-mountain bike has hills wondering what hit them.",
              url: "https://vannycampers.co.uk/rounds/w30/competitions/w30-carrera-e-bike",
              offers: {
                "@type": "Offer",
                price: "1.97",
                priceCurrency: "GBP",
              },
            })}</script>
            <script>
              window.__reactRouterContext.streamController.enqueue(
                '"competitionEndTime","2026-08-04T19:50:00.000Z","canonicalUrl","https://vannycampers.co.uk/rounds/w30/competitions/w30-carrera-e-bike","quantityAvailable",748,"maxTicketsAvailable",{"_1147":1818},"999","isLoggedIn"'
              );
            </script>
          </body>
        </html>
      `);
    }

    return response("Not found", "text/plain", 404);
  }) as typeof fetch;

  try {
    const competitions = await new VannyCampersAdapter({
      now: () => new Date("2026-06-22T10:15:00.000Z"),
    }).fetchAll();

    assert.deepEqual(requests, [
      "https://vannycampers.co.uk/sitemap.xml",
      "https://vannycampers.co.uk/rounds/r25/competitions/r25-500-site-credit",
      "https://vannycampers.co.uk/auto/r22autodraw/competitions/r241000",
      "https://vannycampers.co.uk/rounds/w30/competitions/w30-carrera-e-bike",
    ]);
    assert.deepEqual(competitions, [
      {
        sourceId: "r25-500-site-credit",
        siteName: "vannycampers",
        url: "https://vannycampers.co.uk/rounds/r25/competitions/r25-500-site-credit",
        name: "£500 Site Credit",
        entryPrice: 1.97,
        ticketsSold: 70,
        maxTickets: 499,
        maxEntriesPerUser: 499,
        cashAlternative: null,
        estimatedPrizeValue: 500,
        valuationSource: "site_estimate",
        valuationConfidence: "high",
        valuationNotes: "Explicit site credit value in product title/description",
        drawDate: "2026-07-07T19:35:00.000Z",
        isAutoDraw: false,
        categories: ["campervan", "site-credit"],
        scrapedAt: "2026-06-22T10:15:00.000Z",
      },
      {
        sourceId: "r241000",
        siteName: "vannycampers",
        url: "https://vannycampers.co.uk/auto/r22autodraw/competitions/r241000",
        name: "£1000 Prize Draw Ticket",
        entryPrice: 0.5,
        ticketsSold: 150,
        maxTickets: 2999,
        maxEntriesPerUser: 2999,
        cashAlternative: 1000,
        drawDate: "2026-06-30T19:30:00.000Z",
        isAutoDraw: true,
        categories: ["cash"],
        scrapedAt: "2026-06-22T10:15:00.000Z",
      },
      {
        sourceId: "w30-carrera-e-bike",
        siteName: "vannycampers",
        url: "https://vannycampers.co.uk/rounds/w30/competitions/w30-carrera-e-bike",
        name: "Carrera Vengeance-E 3.0 Electric Mountain Bike",
        entryPrice: 1.97,
        ticketsSold: 251,
        maxTickets: 999,
        maxEntriesPerUser: 999,
        cashAlternative: null,
        estimatedPrizeValue: 1099,
        valuationSource: "site_estimate",
        valuationConfidence: "high",
        valuationNotes: "Explicit product value in operator description",
        drawDate: "2026-08-04T19:50:00.000Z",
        isAutoDraw: false,
        categories: [],
        scrapedAt: "2026-06-22T10:15:00.000Z",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("VannyCampers adapter is registered", () => {
  assert.ok(getAdapter("vannycampers"));
});

test("VannyCampers does not treat a ticket price introduced by From as prize value", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://vannycampers.co.uk/sitemap.xml") {
      return response("<urlset><url><loc>https://vannycampers.co.uk/rounds/w32/competitions/105nami</loc></url></urlset>", "application/xml");
    }
    return response(`
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        name: "Nami - Auto Peugeot Boxer",
        description: "WIN Nami. From £4.97. Draw 18th August.",
        url,
        offers: { price: "6.97" },
      })}</script>
      <script>"competitionEndTime","2026-08-18T20:00:00.000Z","quantityAvailable",99,"maxTicketsAvailable",{"_1":2},"100","isLoggedIn"</script>
    `);
  }) as typeof fetch;

  try {
    const competitions = await new VannyCampersAdapter().fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.estimatedPrizeValue, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function response(body: string, contentType: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": contentType },
  });
}
