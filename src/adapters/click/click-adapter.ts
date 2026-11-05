import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BASE_URL = "https://www.clickcompetitions.co.uk";

interface ClickPrize {
  prize: {
    id?: string;
    name?: string;
    type?: string;
    category?: string;
    rrp?: number;
    alternativeCashAmount?: number;
    alternativeGameCreditAmount?: number;
  };
  quantity?: number;
  wonCount?: number;
}

interface ClickServer {
  id: string;
  slug: string;
  name: string;
  status: string;
  minorStatus: string;
  startDate: string;
  endDate: string;
  drawDate: string;
  draw_mechanism: string;
  ticketAmount: number;
  originalTicketAmount: number;
  soldTickets?: number;
  totalTickets?: number;
  percentage?: number;
  infiniteTickets: boolean;
  maximum_tickets_quantity: number;
  global_maximum_tickets_quantity?: number;
  dynamicVisibility?: {
    list?: {
      percentage?: number;
    };
    detail?: {
      soldTickets?: number;
      totalTickets?: number;
    };
  };
  prizes: ClickPrize[];
  type: string;
}

interface ClickCompetition {
  uid: string;
  slug: string;
  title: string;
  card_title: string;
  competition: {
    uid: string;
    slug: string;
    title: string;
    card_title: string;
    server: ClickServer;
  };
  tags?: string[];
  is_competition_featured?: boolean;
}

export class ClickAdapter implements SiteAdapter {
  readonly siteName = "click";

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await this.fetchPage(`${BASE_URL}/`);
    return this.parseNextData(html);
  }

  private parseNextData(html: string): RawCompetition[] {
    const match = html.match(
      /<script\s+id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s,
    );
    if (!match) return [];

    let json: any;
    try {
      json = JSON.parse(match[1]);
    } catch {
      return [];
    }

    // Find the "All Competitions" list in pageComponents
    const pageComponents = json.props?.pageProps?.pageComponents;
    if (!Array.isArray(pageComponents)) return [];

    // Find the component with the most items (should be "All Competitions")
    let allComps: ClickCompetition[] = [];
    for (const component of pageComponents) {
      const list = component?.ref?.list;
      if (Array.isArray(list) && list.length > allComps.length) {
        allComps = list;
      }
    }

    if (allComps.length === 0) return [];

    const now = new Date().toISOString();
    const results: RawCompetition[] = [];

    for (const item of allComps) {
      const comp = item.competition;
      if (!comp?.server) continue;

      const server = comp.server;
      if (server.status !== "live") continue;
      if (server.minorStatus === "soldOut" || server.minorStatus === "closed")
        continue;

      const urlSlug = comp.slug?.replace(/^\./, "") || "";
      if (!urlSlug) continue;

      // Cash alternative from prizes
      let cashAlternative: number | null = null;
      if (server.prizes?.length) {
        const primaryPrize = server.prizes[0]?.prize;
        if (primaryPrize?.alternativeCashAmount) {
          cashAlternative = primaryPrize.alternativeCashAmount;
        }
      }

      // Categories from tags and prize category
      const categories: string[] = [];
      if (item.tags) {
        for (const tag of item.tags) {
          categories.push(tag.toLowerCase());
        }
      }
      if (server.prizes?.[0]?.prize?.category) {
        categories.push(server.prizes[0].prize.category.toLowerCase());
      }

      const isAutoDraw = server.draw_mechanism === "automatic";
      const detailVisibility = server.dynamicVisibility?.detail;
      const maxTickets = server.infiniteTickets
        ? 0
        : finiteNumber(
            detailVisibility?.totalTickets,
            server.totalTickets,
          );
      const directSoldTickets = [
        detailVisibility?.soldTickets,
        server.soldTickets,
      ].find((value): value is number =>
        typeof value === "number" && Number.isFinite(value),
      );
      const ticketsSold = directSoldTickets ?? 0;
      const usesPercentageEstimate = directSoldTickets === undefined && maxTickets > 0;
      const estimatedTicketsSold =
        directSoldTickets !== undefined || maxTickets === 0
          ? ticketsSold
          : Math.round(
              maxTickets *
                (finiteNumber(
                  server.dynamicVisibility?.list?.percentage,
                  server.percentage,
                ) / 100),
            );
      const maxEntriesPerUser = finiteNumber(server.maximum_tickets_quantity);

      results.push({
        sourceId: server.id,
        siteName: "click",
        url: `${BASE_URL}/${urlSlug}`,
        name: comp.card_title || comp.title || server.name,
        entryPrice: server.ticketAmount,
        ticketsSold: estimatedTicketsSold,
        maxTickets,
        inventorySource: directSoldTickets !== undefined
          ? "exact"
          : usesPercentageEstimate
            ? "estimated"
            : "unknown",
        maxEntriesPerUser: maxEntriesPerUser || 5000,
        maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
        cashAlternative,
        drawDate: server.drawDate || server.endDate || null,
        isAutoDraw,
        categories,
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
      throw new Error(
        `[Click Competitions] Failed to fetch ${url}: ${response.status}`,
      );
    }

    return response.text();
  }
}

function finiteNumber(...values: Array<number | undefined | null>): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}
