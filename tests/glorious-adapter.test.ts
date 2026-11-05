import test from "node:test";
import assert from "node:assert/strict";
import { parseGloriousHome } from "../src/adapters/glorious/glorious-adapter.js";

test("Glorious parser reads structured live competitions and excludes instant formats", () => {
  const html = `
    <a href="/competition/win-a-dyson-cool-am07-premium-tower-fan-18">Dyson</a>
    <a href="/competition/go-for-glory-over-1-000-instant-win-prizes-16">Instant</a>
    <script>window.__SSR_DATA__={"queries":[{"state":{"data":[
      {"id":18,"price":1.49,"totalTickets":499,"category":"lifestyle","status":"active","drawDate":"2099-07-19T19:30:00.000Z","cashAlternative":null,"maxPerPerson":50,"drawType":"automated","prizeName":"Dyson Cool Fan","prizeValue":239.99,"isSiteCreditPrize":false,"ticketsSold":278},
      {"id":16,"price":0.79,"totalTickets":14999,"category":"instant","status":"active","drawDate":"2099-08-05T19:30:00.000Z","cashAlternative":null,"maxPerPerson":50,"drawType":"instant-win","prizeName":"Instant Win","prizeValue":1000,"isSiteCreditPrize":false,"ticketsSold":10}
    ]}}]};</script>
  `;

  const competitions = parseGloriousHome(html, new Date("2099-01-01T00:00:00.000Z"));
  assert.equal(competitions.length, 1);
  assert.equal(competitions[0].sourceId, "18");
  assert.equal(
    competitions[0].url,
    "https://www.glorious.co.uk/competition/win-a-dyson-cool-am07-premium-tower-fan-18",
  );
  assert.equal(competitions[0].entryPrice, 1.49);
  assert.equal(competitions[0].ticketsSold, 278);
  assert.equal(competitions[0].maxTickets, 499);
  assert.equal(competitions[0].maxEntriesPerUser, 50);
  assert.equal(competitions[0].estimatedPrizeValue, 239.99);
  assert.equal(competitions[0].drawDate, "2099-07-19T19:30:00.000Z");
});
