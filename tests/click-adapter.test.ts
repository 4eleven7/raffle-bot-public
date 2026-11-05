import test from "node:test";
import assert from "node:assert/strict";
import { ClickAdapter } from "../src/adapters/click/click-adapter.js";

function nextData(server: Record<string, unknown>): string {
  return `
    <script id="__NEXT_DATA__" type="application/json">
      ${JSON.stringify({
        props: {
          pageProps: {
            pageComponents: [
              {
                ref: {
                  list: [
                    {
                      tags: ["Tech"],
                      competition: {
                        uid: "comp-1",
                        slug: ".prizes.Example",
                        title: "Example",
                        card_title: "Example",
                        server,
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      })}
    </script>
  `;
}

test("Click adapter uses dynamic detail ticket totals over per-user limits", () => {
  const adapter = new ClickAdapter();
  const parseNextData = (adapter as unknown as {
    parseNextData(html: string): Array<{
      ticketsSold: number;
      maxTickets: number;
      maxEntriesPerUser: number;
      maxEntriesPerUserSource?: string;
    }>;
  }).parseNextData.bind(adapter);

  const comps = parseNextData(
    nextData({
      id: "server-1",
      slug: "SP2126K",
      name: "Example",
      status: "live",
      minorStatus: "open",
      startDate: "2026-06-01T00:00:00.000Z",
      endDate: "2026-06-07T21:00:00.000Z",
      drawDate: "2026-06-07T21:00:00.000Z",
      draw_mechanism: "rngWithoutDelay",
      ticketAmount: 0.49,
      originalTicketAmount: 0.49,
      percentage: 58.34,
      infiniteTickets: false,
      maximum_tickets_quantity: 50,
      global_maximum_tickets_quantity: 50,
      dynamicVisibility: {
        detail: {
          soldTickets: 437,
          totalTickets: 749,
        },
      },
      prizes: [],
      type: "singlePrize_singleTicket",
    }),
  );

  assert.equal(comps[0]?.ticketsSold, 437);
  assert.equal(comps[0]?.maxTickets, 749);
  assert.equal(comps[0]?.maxEntriesPerUser, 50);
  assert.equal(comps[0]?.maxEntriesPerUserSource, "site");

  const fallback = parseNextData(nextData({
    id: "server-2",
    slug: "fallback",
    name: "Fallback",
    status: "live",
    minorStatus: "open",
    drawDate: "2026-06-07T21:00:00.000Z",
    draw_mechanism: "rngWithoutDelay",
    ticketAmount: 1,
    infiniteTickets: false,
    totalTickets: 100,
    soldTickets: 1,
    prizes: [],
    type: "singlePrize_singleTicket",
  }));
  assert.equal(fallback[0]?.maxEntriesPerUser, 5000);
  assert.equal(fallback[0]?.maxEntriesPerUserSource, "fallback");
});
