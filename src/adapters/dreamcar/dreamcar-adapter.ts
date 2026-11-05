import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BASE_URL = "https://dreamcargiveaways.co.uk";

interface DreamCarCompetition {
  id: string;
  name: string;
  urlStub: string;
  closeTs: string;
  drawTs: string;
  regularPrice: number; // pence
  numTickets: number;
  numTicketsAvailable: number;
  maxUserTickets: number;
  status: string;
  category: string;
  appOnly: boolean;
}

export class DreamCarAdapter implements SiteAdapter {
  readonly siteName = "dreamcar";

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await this.fetchPage(`${BASE_URL}/competitions`);
    return this.parseRSCPayload(html);
  }

  private parseRSCPayload(html: string): RawCompetition[] {
    const competitions = this.extractCompetitionsFromRSC(html);
    const now = new Date().toISOString();
    const results: RawCompetition[] = [];

    for (const c of competitions) {
      if (c.status !== "published" || c.appOnly) continue;

      const ticketsSold = c.numTickets - c.numTicketsAvailable;
      const entryPrice = c.regularPrice / 100; // pence to pounds

      // Cash alternative from title: "or £XX,XXX Tax Free"
      let cashAlternative: number | null = null;
      const cashMatch = c.name.match(/or\s+£([\d,]+)/i);
      if (cashMatch) {
        cashAlternative = parseFloat(cashMatch[1].replace(/,/g, ""));
      }

      const categories: string[] = [];
      if (c.category) categories.push(c.category.replace(/_/g, " "));
      const hasSiteCap = Number.isFinite(c.maxUserTickets) && c.maxUserTickets > 0;

      results.push({
        sourceId: c.id,
        siteName: "dreamcar",
        url: `${BASE_URL}/competitions/${c.urlStub}`,
        name: c.name,
        entryPrice,
        ticketsSold,
        maxTickets: c.numTickets,
        maxEntriesPerUser: hasSiteCap ? c.maxUserTickets : 100,
        maxEntriesPerUserSource: hasSiteCap ? "site" : "fallback",
        cashAlternative,
        drawDate: c.drawTs || c.closeTs || null,
        isAutoDraw: false,
        categories,
        scrapedAt: now,
      });
    }

    return results;
  }

  private extractCompetitionsFromRSC(html: string): DreamCarCompetition[] {
    // RSC payloads are in self.__next_f.push() script tags.
    // Combine all push payloads into one string, then extract competition
    // objects using balanced-brace parsing.
    const pushBlocks =
      html.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs) || [];

    let combined = "";
    for (const block of pushBlocks) {
      const m = block.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/s);
      if (!m) continue;
      try {
        combined += JSON.parse(`"${m[1]}"`);
      } catch {
        // Skip malformed pushes
      }
    }

    if (!combined.includes('"numTickets"')) return [];

    return this.extractWithBalancedBraces(combined);
  }

  private extractWithBalancedBraces(content: string): DreamCarCompetition[] {
    const results: DreamCarCompetition[] = [];
    const startPattern = '{"@id":"/competitions/';
    let searchFrom = 0;

    while (true) {
      const start = content.indexOf(startPattern, searchFrom);
      if (start === -1) break;

      // Find matching closing brace
      let depth = 0;
      let i = start;
      for (; i < content.length; i++) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }

      const jsonStr = content.substring(start, i + 1);
      try {
        const obj = JSON.parse(jsonStr);
        if (obj.id && obj.numTickets !== undefined) {
          results.push(obj as DreamCarCompetition);
        }
      } catch {
        // Skip malformed objects
      }
      searchFrom = i + 1;
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
        `[Dream Car Giveaways] Failed to fetch ${url}: ${response.status}`,
      );
    }

    return response.text();
  }
}
