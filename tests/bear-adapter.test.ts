import test from "node:test";
import assert from "node:assert/strict";
import { BearAdapter } from "../src/adapters/bear/bear-adapter.js";

test("Bear listing cards do not fabricate ticket inventory from price and sold percentage", () => {
  const adapter = new BearAdapter();
  const parse = (adapter as unknown as {
    parse: (html: string) => Array<{
      entryPrice: number;
      ticketsSold: number;
      maxTickets: number;
    }>;
  }).parse.bind(adapter);

  const competitions = parse(`
    <div class="rounded-md">
      <a href="/competition/win-500-cash/">Enter</a>
      <div class="font-medium text-[#3D3D3D]">Win £500 Tax Free Cash</div>
      <p class="text-center">£1.00</p>
      <p>71.2% SOLD</p>
    </div>
  `);

  assert.equal(competitions.length, 1);
  assert.equal(competitions[0]?.entryPrice, 1);
  assert.equal(competitions[0]?.ticketsSold, 0);
  assert.equal(competitions[0]?.maxTickets, 0);
});
