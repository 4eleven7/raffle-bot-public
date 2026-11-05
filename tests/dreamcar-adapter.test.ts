import test from "node:test";
import assert from "node:assert/strict";
import { DreamCarAdapter } from "../src/adapters/dreamcar/dreamcar-adapter.js";

test("Dream Car marks only a positive maxUserTickets payload value as site-proven", () => {
  const adapter = new DreamCarAdapter();
  const parse = (adapter as unknown as {
    parseRSCPayload(html: string): Array<{
      maxEntriesPerUser: number;
      maxEntriesPerUserSource?: string;
    }>;
  }).parseRSCPayload.bind(adapter);
  const payload = [competition("site-cap", 25), competition("fallback-cap", 0)]
    .map((row) => JSON.stringify(row))
    .join("");
  const encoded = JSON.stringify(payload).slice(1, -1);
  const competitions = parse(`<script>self.__next_f.push([1,"${encoded}"])</script>`);

  assert.equal(competitions[0]?.maxEntriesPerUser, 25);
  assert.equal(competitions[0]?.maxEntriesPerUserSource, "site");
  assert.equal(competitions[1]?.maxEntriesPerUser, 100);
  assert.equal(competitions[1]?.maxEntriesPerUserSource, "fallback");
});

function competition(id: string, cap: number): Record<string, unknown> {
  return {
    "@id": `/competitions/${id}`,
    id,
    name: id,
    urlStub: id,
    closeTs: "2026-07-31T20:00:00.000Z",
    drawTs: "2026-07-31T20:00:00.000Z",
    regularPrice: 100,
    numTickets: 100,
    numTicketsAvailable: 90,
    maxUserTickets: cap,
    status: "published",
    category: "cash",
    appOnly: false,
  };
}
