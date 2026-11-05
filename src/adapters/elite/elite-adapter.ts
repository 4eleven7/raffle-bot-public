import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface EliteCompetition {
  id: number;
  name: string;
  ticketPrice: number;
  saleTicketPrice: number | null;
  soldTicketsPercentage: number;
  mainPrizePrice: number;
  drawTime: string | null;
  endDate: string | null;
  isAutoDraw: boolean;
  maxTicketsPerUser: number | null;
  slugUrl: string;
  type: string;
  isFree: boolean;
  isSoldOut: boolean;
  status: string;
  categories: Array<{ name: string }>;
}

export class EliteAdapter implements SiteAdapter {
  readonly siteName = "elite";

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await this.fetchPage(
      "https://elitecompetitions.co.uk/active-competitions",
    );

    const competitions = this.extractFromNextData(html);
    return competitions;
  }

  private extractFromNextData(html: string): RawCompetition[] {
    const match = html.match(/__NEXT_DATA__[^>]*>(.*?)<\/script>/s);
    if (!match) return [];

    const json = JSON.parse(match[1]);
    const queries = json.props?.pageProps?.dehydratedState?.queries;
    if (!queries || queries.length < 2) return [];

    // The competitions are in the second query, keyed by index
    const data = queries[1].state?.data?.data;
    if (!data) return [];

    const now = new Date().toISOString();
    const results: RawCompetition[] = [];

    for (const key of Object.keys(data)) {
      const c = data[key] as EliteCompetition;
      if (!c?.id || !c?.name) continue;
      if (c.isFree || c.isSoldOut) continue;

      const price = c.saleTicketPrice ?? c.ticketPrice;
      if (price <= 0) continue;

      // We only have sold percentage, not absolute counts.
      // Estimate max tickets from: maxTicketsPerUser is usually ~1-5% of total pool.
      // For EV calcs we'll store percentage-based estimates.
      // A rough heuristic: mainPrizePrice / ticketPrice * 2 gives approximate max tickets.
      const estimatedMaxTickets = price > 0
        ? Math.round((c.mainPrizePrice / price) * 2)
        : 0;
      const estimatedSold = Math.round(
        estimatedMaxTickets * (c.soldTicketsPercentage / 100),
      );
      const hasSiteCap = Number.isFinite(c.maxTicketsPerUser) && (c.maxTicketsPerUser ?? 0) > 0;

      results.push({
        sourceId: String(c.id),
        siteName: "elite",
        url: `https://elitecompetitions.co.uk/competitions/${c.slugUrl}`,
        name: c.name,
        entryPrice: price,
        ticketsSold: estimatedSold,
        maxTickets: estimatedMaxTickets,
        inventorySource: "estimated",
        maxEntriesPerUser: hasSiteCap ? c.maxTicketsPerUser! : 100000,
        maxEntriesPerUserSource: hasSiteCap ? "site" : "fallback",
        cashAlternative: c.mainPrizePrice,
        drawDate: c.drawTime ?? c.endDate,
        isAutoDraw: c.isAutoDraw,
        categories: c.categories?.map((cat) => cat.name) ?? [],
        scrapedAt: now,
      });
    }

    return results;
  }

  private async fetchPage(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`[Elite] Failed to fetch ${url}: ${response.status}`);
    }

    return response.text();
  }
}
