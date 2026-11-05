import assert from "node:assert/strict";
import test from "node:test";
import {
  FlatOutAdapter,
  parseFlatOutCompetition,
  parseFlatOutListingLinks,
} from "../src/adapters/flatout/flatout-adapter.js";

const NOW = new Date("2026-08-05T09:00:00.000Z");

function page({
  name,
  slug,
  price,
  endDate,
  sold,
  total,
  description,
}: {
  name: string;
  slug: string;
  price: string;
  endDate: string;
  sold: number;
  total: number;
  description: string;
}): string {
  return `<html><main>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Event",
      name,
      description,
      url: `https://flatoutcompetitions.co.uk/competitions/${slug}`,
      endDate,
      offers: { "@type": "Offer", price, priceCurrency: "GBP" },
    })}</script>
    <h1>${name}</h1>
    <div aria-label="${sold} of ${total} tickets sold"></div>
    <p>${description}</p>
  </main></html>`;
}

test("Flat-Out parser reads exact event economics and site-stated value", () => {
  const competition = parseFlatOutCompetition(
    page({
      name: "Scorpion Exhaust Upgrade",
      slug: "scorpion-exhaust-system",
      price: "2.49",
      endDate: "2026-08-30T19:00:00.000Z",
      sold: 12,
      total: 1999,
      description: "Prize value is capped at £2,500 including VAT.",
    }),
    "https://flatoutcompetitions.co.uk/competitions/scorpion-exhaust-system",
    NOW,
  );

  assert.deepEqual(competition && {
    siteName: competition.siteName,
    url: competition.url,
    entryPrice: competition.entryPrice,
    ticketsSold: competition.ticketsSold,
    maxTickets: competition.maxTickets,
    drawDate: competition.drawDate,
    estimatedPrizeValue: competition.estimatedPrizeValue,
  }, {
    siteName: "flatout",
    url: "https://flatoutcompetitions.co.uk/competitions/scorpion-exhaust-system",
    entryPrice: 2.49,
    ticketsSold: 12,
    maxTickets: 1999,
    drawDate: "2026-08-30T19:00:00.000Z",
    estimatedPrizeValue: 2500,
  });
});

test("Flat-Out parser excludes closed and sold-out rows", () => {
  const closed = parseFlatOutCompetition(
    page({
      name: "Closed",
      slug: "closed",
      price: "1.00",
      endDate: "2026-08-04T19:00:00.000Z",
      sold: 0,
      total: 100,
      description: "Prize value £100 RRP.",
    }),
    "https://flatoutcompetitions.co.uk/competitions/closed",
    NOW,
  );
  const soldOut = parseFlatOutCompetition(
    page({
      name: "Sold Out",
      slug: "sold-out",
      price: "1.00",
      endDate: "2026-08-30T19:00:00.000Z",
      sold: 100,
      total: 100,
      description: "Prize value £100 RRP.",
    }),
    "https://flatoutcompetitions.co.uk/competitions/sold-out",
    NOW,
  );
  assert.equal(closed, null);
  assert.equal(soldOut, null);
});

test("Flat-Out listing links are deduplicated and scoped", () => {
  assert.deepEqual(
    parseFlatOutListingLinks(`<a href="/competitions/a">A</a><a href="/competitions/a">A</a><a href="/blog/a">B</a>`),
    ["https://flatoutcompetitions.co.uk/competitions/a"],
  );
});

test("Flat-Out adapter fetches current linked detail pages", async () => {
  const originalFetch = globalThis.fetch;
  const pages = new Map<string, string>([
    ["https://flatoutcompetitions.co.uk", `<a href="/competitions/scorpion-exhaust-system">Scorpion</a>`],
    [
      "https://flatoutcompetitions.co.uk/competitions/scorpion-exhaust-system",
      page({
        name: "Scorpion Exhaust Upgrade",
        slug: "scorpion-exhaust-system",
        price: "2.49",
        endDate: "2026-08-30T19:00:00.000Z",
        sold: 12,
        total: 1999,
        description: "Prize value is capped at £2,500 including VAT.",
      }),
    ],
  ]);
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const body = pages.get(url);
    return new Response(body ?? "Not found", { status: body ? 200 : 404 });
  }) as typeof fetch;

  try {
    const competitions = await new FlatOutAdapter({ now: () => NOW }).fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.sourceId, "scorpion-exhaust-system");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
