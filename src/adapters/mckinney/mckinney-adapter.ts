import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class McKinneyAdapter implements SiteAdapter {
  readonly siteName = "mckinney";

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await this.fetchPage("https://mckinneycompetitions.com/");
    return this.parse(html);
  }

  private parse(html: string): RawCompetition[] {
    const $ = cheerio.load(html);
    const now = new Date().toISOString();
    const results: RawCompetition[] = [];
    const seen = new Set<string>();

    // Only parse cards from #section-all-competitions to avoid duplicates
    // from the spotlight/tomorrow carousels
    const container = $("#section-all-competitions");
    const cards = container.length
      ? container.find("div.competitionCard")
      : $("div.competitionCard");

    cards.each((_i, el) => {
      try {
        const $el = $(el);
        const comp = this.parseCard($, $el, now);
        if (comp && !seen.has(comp.url)) {
          seen.add(comp.url);
          results.push(comp);
        }
      } catch {
        // Skip unparseable cards
      }
    });

    return results;
  }

  private parseCard(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<AnyNode>,
    now: string,
  ): RawCompetition | null {
    // URL and slug
    const link = $el.find("a").first().attr("href") || "";
    const slug = link.replace(/.*\/competition\//, "").replace(/\/$/, "");
    if (!slug) return null;

    const url = link.startsWith("http")
      ? link
      : `https://mckinneycompetitions.com${link}`;

    // Title
    const name = $el.find("h2.comp-title").text().trim();
    if (!name) return null;

    // Price: "£100.00 per entry"
    const priceText = $el.find("h3.entry-price").text();
    const priceMatch = priceText.match(/£([\d,.]+)/);
    const entryPrice = priceMatch
      ? parseFloat(priceMatch[1].replace(",", ""))
      : 0;

    // Tickets sold / max: "1,243 / 5,999 Tickets Sold"
    const ticketsText = $el.find("div.tickets-sold").text().trim();
    const ticketsMatch = ticketsText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    const ticketsSold = ticketsMatch
      ? parseInt(ticketsMatch[1].replace(/,/g, ""), 10)
      : 0;
    const maxTickets = ticketsMatch
      ? parseInt(ticketsMatch[2].replace(/,/g, ""), 10)
      : 0;

    // Cash alternative from title: "... or £45,000"
    let cashAlternative: number | null = null;
    const cashMatch = name.match(/or\s+£([\d,]+)/i);
    if (cashMatch) {
      cashAlternative = parseFloat(cashMatch[1].replace(/,/g, ""));
    }

    // Draw date: "Draw | Mon 6th Apr"
    const drawText = $el.find("span.comp-draw").text().trim();
    const drawDate = this.parseDrawDate(drawText);

    // Category
    const categories: string[] = [];
    const catText = $el.find("h3.comp-category").text().trim();
    if (catText) categories.push(catText.toLowerCase());

    // Auto draw detection
    const isAutoDraw =
      catText.toLowerCase().includes("autodraw") ||
      name.toLowerCase().includes("auto draw");

    return {
      sourceId: slug,
      siteName: "mckinney",
      url,
      name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      cashAlternative,
      drawDate,
      isAutoDraw,
      categories,
      scrapedAt: now,
    };
  }

  private parseDrawDate(text: string): string | null {
    const relative = text.match(/Draw\s*\|\s*(Tonight|Tomorrow)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (relative) {
      const date = new Date();
      if (/tomorrow/i.test(relative[1])) {
        date.setDate(date.getDate() + 1);
      }
      let hour = parseInt(relative[2], 10);
      if (relative[4].toLowerCase() === "pm" && hour < 12) hour += 12;
      if (relative[4].toLowerCase() === "am" && hour === 12) hour = 0;
      date.setHours(hour, parseInt(relative[3] ?? "0", 10), 0, 0);
      return date.toISOString();
    }

    // "Draw | Mon 6th Apr" or "Draw | Tue 8th Apr"
    const match = text.match(
      /(\w+)\s+(\d+)(?:st|nd|rd|th)\s+(\w+)/,
    );
    if (!match) return null;

    const [, , day, monthStr] = match;
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    const month = months[monthStr.toLowerCase()];
    if (month === undefined) return null;

    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(year, month, parseInt(day, 10), 23, 0, 0);
    // If the date is in the past, assume next year
    if (candidate < now) year += 1;

    const drawDate = new Date(year, month, parseInt(day, 10), 23, 0, 0);
    return drawDate.toISOString();
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
        `[McKinney] Failed to fetch ${url}: ${response.status}`,
      );
    }

    return response.text();
  }
}
