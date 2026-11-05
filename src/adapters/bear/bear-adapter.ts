import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BASE_URL = "https://bearcompetitions.com";

export class BearAdapter implements SiteAdapter {
  readonly siteName = "bear";

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await this.fetchPage(`${BASE_URL}/all-competitions`);
    const competitions = this.parse(html);

    // Enrich with exact data from detail pages (Klaviyo var item JSON)
    for (const comp of competitions) {
      try {
        await sleep(300);
        const detailHtml = await this.fetchPage(comp.url);
        this.enrichFromDetail(comp, detailHtml);
      } catch {
        // Keep the partial row; scan integrity quarantines missing inventory.
      }
    }

    return competitions;
  }

  private parse(html: string): RawCompetition[] {
    const $ = cheerio.load(html);
    const now = new Date().toISOString();
    const results: RawCompetition[] = [];

    // Cards are div.rounded-md elements containing competition links
    const cards = $("div.rounded-md").has("a[href*='/competition/']");

    cards.each((_i, el) => {
      try {
        const $el = $(el);
        const comp = this.parseCard($, $el, now);
        if (comp) results.push(comp);
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
    // URL
    const link = $el.find("a[href*='/competition/']").first().attr("href") || "";
    if (!link) return null;

    const url = link.startsWith("http") ? link : `${BASE_URL}${link}`;
    const slug = link.replace(/.*\/competition\//, "").replace(/\/$/, "");
    if (!slug) return null;

    // Skip sold out
    const ctaText = $el.text();
    if (ctaText.includes("SOLD OUT") && $el.find(".opacity-50").length > 0)
      return null;

    // Title
    const name = $el
      .find("div.font-medium")
      .filter((_i, el) => {
        const cls = $(el).attr("class") || "";
        return cls.includes("text-[#3D3D3D]");
      })
      .first()
      .text()
      .trim()
      .replace(/&#039;/g, "'");
    if (!name) return null;

    // Price: "£19.99" or sale "79p" / "£0.99"
    let entryPrice = 0;
    // Check for sale price first (second span in flex container)
    const saleSpan = $el.find("span.text-accent").filter((_i, el) => {
      const cls = $(el).attr("class") || "";
      return cls.includes("font-semibold") && !cls.includes("line-through");
    }).first();

    if (saleSpan.length) {
      entryPrice = this.parsePrice(saleSpan.text());
    } else {
      // Regular price
      const priceEl = $el.find("p.text-center").filter((_i, el) => {
        const text = $(el).text();
        return text.includes("£") && !text.includes("/");
      }).first();
      entryPrice = this.parsePrice(priceEl.text());
    }

    // Draw date from countdown remaining seconds
    let drawDate: string | null = null;
    const xDataAttr = $el.find("[x-data]").attr("x-data") || "";
    const remainingMatch = xDataAttr.match(/remaining:\s*([\d.]+)/);
    if (remainingMatch) {
      const remainingSecs = parseFloat(remainingMatch[1]);
      const drawTime = new Date(Date.now() + remainingSecs * 1000);
      drawDate = drawTime.toISOString();
    }

    // Fallback: parse badge text "Tomorrow 9:00pm", "Today 9:00pm"
    if (!drawDate) {
      const badge = $el.find("span.uppercase").first().text().trim();
      drawDate = this.parseBadgeDate(badge);
    }

    // Cash alternative from title: "or £XX,XXX" or "£50,000 Tax Free Cash"
    let cashAlternative: number | null = null;
    const cashMatch =
      name.match(/or\s+£([\d,]+)/i) ||
      name.match(/£([\d,]+)\s*(?:Tax\s*Free\s*)?Cash/i);
    if (cashMatch) {
      cashAlternative = parseFloat(cashMatch[1].replace(/,/g, ""));
    }

    // Auto draw detection
    const isAutoDraw = name.toLowerCase().includes("auto draw");

    return {
      sourceId: slug,
      siteName: "bear",
      url,
      name,
      entryPrice,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      cashAlternative,
      drawDate,
      isAutoDraw,
      categories: [],
      scrapedAt: now,
    };
  }

  private parsePrice(text: string): number {
    const trimmed = text.trim();
    // Handle pence: "79p", "49p", "10p"
    const penceMatch = trimmed.match(/(\d+)p/i);
    if (penceMatch) return parseInt(penceMatch[1], 10) / 100;

    // Handle pounds: "£19.99"
    const poundMatch = trimmed.match(/£([\d,.]+)/);
    if (poundMatch) return parseFloat(poundMatch[1].replace(",", ""));

    return 0;
  }

  private parseBadgeDate(text: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();

    const timeMatch = text.match(/(\d{1,2}):(\d{2})(am|pm)/i);
    if (!timeMatch) return null;

    let hours = parseInt(timeMatch[1], 10);
    const mins = parseInt(timeMatch[2], 10);
    if (timeMatch[3].toLowerCase() === "pm" && hours < 12) hours += 12;
    if (timeMatch[3].toLowerCase() === "am" && hours === 12) hours = 0;

    const now = new Date();
    const draw = new Date(now);
    draw.setHours(hours, mins, 0, 0);

    if (lower.startsWith("tomorrow")) {
      draw.setDate(draw.getDate() + 1);
    }

    // If "today" but time already passed, skip
    if (lower.startsWith("today") && draw < now) return null;

    return draw.toISOString();
  }

  private enrichFromDetail(comp: RawCompetition, html: string): void {
    // Primary: parse "sold/max" from rendered HTML (always accurate)
    // Match "3,562/4,999</p>" — the ticket count is always before a closing </p> tag
    const ticketMatch = html.match(/([\d,]+)\/([\d,]+)<\/p>/);
    if (ticketMatch) {
      comp.ticketsSold = parseInt(ticketMatch[1].replace(/,/g, ""), 10);
      comp.maxTickets = parseInt(ticketMatch[2].replace(/,/g, ""), 10);
    }

    // Extract Klaviyo var item JSON for draw date and price
    // Note: Klaviyo data can be stale/wrong for some pages, so
    // only use it for fields not available in HTML
    const match = html.match(/var\s+item\s*=\s*(\{[^}]+\})/);
    if (match) {
      try {
        const item = JSON.parse(match[1]);
        // Only trust Klaviyo if the SKU matches the page URL
        const slug = comp.url.replace(/.*\/competition\//, "").replace(/\/$/, "");
        if (item.SKU === slug) {
          if (item.Price) comp.entryPrice = item.Price;
          if (item.DrawDate) comp.drawDate = item.DrawDate;
          if (item.MaxTickets && item.TicketsSold !== undefined) {
            comp.maxTickets = item.MaxTickets;
            comp.ticketsSold = item.TicketsSold;
          }
        } else if (item.DrawDate && !comp.drawDate) {
          // Even if SKU doesn't match, draw date from HTML badge parsing
          // may still be useful as fallback
        }
      } catch {
        // Skip malformed Klaviyo data
      }
    }

    // Extract draw date from badge if not yet set
    if (!comp.drawDate) {
      const badgeMatch = html.match(
        /Draw\s+\w+\s+(\d+)(?:st|nd|rd|th)\s+(\w+)/i,
      );
      if (badgeMatch) {
        const months: Record<string, number> = {
          jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
          jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
        };
        const day = parseInt(badgeMatch[1], 10);
        const month = months[badgeMatch[2].toLowerCase()];
        if (month !== undefined) {
          const now = new Date();
          let year = now.getFullYear();
          const candidate = new Date(year, month, day, 21, 30, 0);
          if (candidate < now) year += 1;
          comp.drawDate = new Date(year, month, day, 21, 30, 0).toISOString();
        }
      }
    }
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
        `[Bear Competitions] Failed to fetch ${url}: ${response.status}`,
      );
    }

    return response.text();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
