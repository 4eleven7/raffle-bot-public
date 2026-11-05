import assert from "node:assert/strict";
import test from "node:test";
import { parseNicheCompetitionDetail } from "../src/adapters/nichecompetitions/nichecompetitions-adapter.js";

test("Niche Competitions parses deterministic RSC and JSON-LD economics", () => {
    const html = `
      <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Product","name":"PlayStation 5 Slim Console 1TB (White)","offers":{"price":"0.99","priceValidUntil":"2099-08-09"},"additionalProperty":{"name":"Prize value","value":570}}
      </script>
      <body>
        Closes Sun 9 Aug, 20:00. Cash alternative£570. Maximum 622 entries per person.
        <script>self.__next_f.push([1,"\\\"ticketPrice\\\":0.99,\\\"maxTickets\\\":1555,\\\"ticketsRemaining\\\":1553"])</script>
      </body>`;

    const row = parseNicheCompetitionDetail(
      html,
      "https://www.nichecompetitions.com/competitions/playstation-5-slim-console-1tb-white-mrt7vrgr",
      "2099-01-01T00:00:00.000Z",
    );

    assert.ok(row);
    assert.equal(row.siteName, "nichecompetitions");
    assert.equal(row.name, "PlayStation 5 Slim Console 1TB (White)");
    assert.equal(row.entryPrice, 0.99);
    assert.equal(row.ticketsSold, 2);
    assert.equal(row.maxTickets, 1555);
    assert.equal(row.maxEntriesPerUser, 622);
    assert.equal(row.cashAlternative, 570);
    assert.equal(row.estimatedPrizeValue, 570);
    assert.equal(row.drawDate, "2099-08-09T19:00:00.000Z");
});
