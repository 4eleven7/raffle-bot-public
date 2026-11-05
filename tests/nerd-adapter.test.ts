import assert from "node:assert/strict";
import test from "node:test";
import { NerdCompetitionsAdapter, parseNerdCompetitions } from "../src/adapters/nerd/nerd-adapter.js";

const nerdPayload = String.raw`
  <script>
    self.__next_f.push([1,"items":[{"id":"playstation-5-slim-console-1tb-white-mrt7vrgr","title":"PlayStation 5 Slim Console 1TB (White)","image":"hero.jpg","retailValue":570,"cashAlternative":570,"ticketPrice":0.99,"endsAt":"2026-08-09T19:00:00+00:00","funding":{"maxTickets":1555,"odds":1555,"pctOfPoolSold":1.54,"ticketsRemaining":1531}}],"nerd":true]);
  </script>
`;

test("Nerd parser maps embedded funding payloads", () => {
  const [competition] = parseNerdCompetitions(nerdPayload);
  assert.equal(competition?.sourceId, "playstation-5-slim-console-1tb-white-mrt7vrgr");
  assert.equal(competition?.entryPrice, 0.99);
  assert.equal(competition?.ticketsSold, 24);
  assert.equal(competition?.maxTickets, 1555);
  assert.equal(competition?.cashAlternative, 570);
  assert.equal(competition?.drawDate, "2026-08-09T19:00:00.000Z");
});

test("Nerd adapter fetches the public homepage", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://nerdcompetitions.co.uk");
    return new Response(nerdPayload, { status: 200 });
  };

  try {
    const competitions = await new NerdCompetitionsAdapter().fetchAll();
    assert.equal(competitions.length, 1);
    assert.equal(competitions[0]?.name, "PlayStation 5 Slim Console 1TB (White)");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
