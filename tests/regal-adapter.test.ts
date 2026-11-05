import assert from "node:assert/strict";
import test from "node:test";
import { parseRegalCompetitions, RegalCompetitionsAdapter } from "../src/adapters/regal/regal-adapter.js";

test("Regal parser extracts listing economics and derives tickets sold", () => {
  const rows = parseRegalCompetitions(
    `
      <div class="tickets dark">
        <div class="ticket-head text-center">
          <a href="https://www.regalcompetitions.com/BLUEA4-JUNE26"><img src="car.jpg"></a>
        </div>
        <div class="ticket-body">
          <div class="drawday"><p>Draw Tomorrow</p></div>
          <div class="draw-info row">
            <div class="col-xs-6"><p> 8259 Remaining</p></div>
            <div class="col-xs-6"><p><span><img src="person.png"></span> Max 10995 Entries</p></div>
          </div>
          <div class="progress"><div class="progress-bar" style="width:25%">25%</div></div>
          <div class="ticketPrize">&pound;1.99<span>PER ENTRY</span></div>
          <div class="productName">2015 AUDI A4 S LINE BLACK EDITION PLUS- SEPANG BLUE</div>
        </div>
      </div>
      <div class="tickets dark">
        <div class="ticket-head text-center">
          <a href="https://www.regalcompetitions.com/MILWAUKEE-JUNE26"><img src="tool.jpg"></a>
        </div>
        <div class="ticket-body">
          <div class="drawday drawsomeday"><p>Draw Thu 9th Jul</p></div>
          <div class="draw-info row">
            <div class="col-xs-6"><p> 637 Remaining</p></div>
            <div class="col-xs-6"><p><span><img src="person.png"></span> Max 795 Entries</p></div>
          </div>
          <div class="progress"><div class="progress-bar" style="width:20%">20%</div></div>
          <div class="ticketPrize">&pound;2.50<span>PER ENTRY</span></div>
          <div class="productName">&pound;500 CASH OR MILWAUKEE PMPP5 3 PIECE PERFECT MATCH POWER PACK</div>
        </div>
      </div>
    `,
    "2026-06-28T09:00:00.000Z",
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.sourceId, "bluea4-june26");
  assert.equal(rows[0]?.ticketsSold, 2736);
  assert.equal(rows[0]?.maxTickets, 10995);
  assert.equal(rows[0]?.entryPrice, 1.99);
  assert.match(rows[0]?.drawDate ?? "", /^2026-06-29T11:00:00.000Z$/);

  assert.equal(rows[1]?.sourceId, "milwaukee-june26");
  assert.equal(rows[1]?.cashAlternative, 500);
  assert.equal(rows[1]?.ticketsSold, 158);
  assert.equal(rows[1]?.drawDate, "2026-07-09T11:00:00.000Z");
});

test("Regal adapter fetches the live listing page", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://www.regalcompetitions.com/competition.php");
    return new Response(
      `
        <div class="tickets dark">
          <div class="ticket-head text-center">
            <a href="https://www.regalcompetitions.com/BLUEA4-JUNE26"><img src="car.jpg"></a>
          </div>
          <div class="ticket-body">
            <div class="drawday"><p>Draw Tomorrow</p></div>
            <div class="draw-info row">
              <div class="col-xs-6"><p> 8259 Remaining</p></div>
              <div class="col-xs-6"><p>Max 10995 Entries</p></div>
            </div>
            <div class="ticketPrize">&pound;1.99<span>PER ENTRY</span></div>
            <div class="productName">2015 AUDI A4 S LINE BLACK EDITION PLUS- SEPANG BLUE</div>
          </div>
        </div>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  };

  try {
    const rows = await new RegalCompetitionsAdapter().fetchAll();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sourceId, "bluea4-june26");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
