import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { ReffleSiteConfig } from "./reffle-site-config.js";

/**
 * Reffle platform adapter. Handles two variants:
 * 1. Classic WordPress Reffle theme: .raffles > .raffle > .raffle-body
 *    (Drawn to Win, House of Luxx, Celestial Prizes)
 * 2. Vue/Tailwind Reffle: .raffle-card or sold/remaining text patterns
 *    (Volt Comps, Hashtagluck, Paramount Prizes)
 */
export class ReffleAdapter implements SiteAdapter {
  readonly siteName: string;

  constructor(private readonly config: ReffleSiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const url = `${this.config.baseUrl}${this.config.listPath}`;
    const response = await fetch(url, {
      signal,
      headers: {
        "User-Agent": this.config.userAgent,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(
        `[${this.config.displayName}] Failed to fetch ${url}: ${response.status}`,
      );
    }

    const html = await response.text();
    const competitions = this.parse(html);
    await this.enrichMissingDrawDates(competitions, signal);
    return competitions;
  }

  private async enrichMissingDrawDates(competitions: RawCompetition[], signal?: AbortSignal): Promise<void> {
    for (const competition of competitions) {
      signal?.throwIfAborted();
      if (
        !competition.url ||
        (
          competition.drawDate !== null &&
          competition.entryPrice > 0 &&
          competition.ticketsSold > 0 &&
          competition.maxTickets > 0 &&
          competition.ticketsSold <= competition.maxTickets &&
          competition.maxEntriesPerUser > 0 &&
          competition.maxEntriesPerUserSource === "site" &&
          (competition.prizeDescription || Date.parse(competition.drawDate) - Date.now() > 24 * 60 * 60 * 1000)
        )
      ) {
        continue;
      }

      try {
        await delay(this.config.fetchDelayMs);
        const response = await fetch(competition.url, {
          signal,
          headers: {
            "User-Agent": this.config.userAgent,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
          },
        });
        if (!response.ok) continue;

        const detailHtml = await response.text();
        const detail = extractDetailMetadata(detailHtml);
        competition.prizeDescription = detail.prizeDescription;
        competition.prizeEvidence = `Public detail ${competition.url}; cash alternative GBP ${detail.cashAlternative ?? "not stated"}; prize value GBP ${detail.prizeValue ?? "not stated"}`;
        if (detail.hasInstantWins && !competition.categories.includes("instant-win")) competition.categories.push("instant-win");
        const devonDetail = this.config.siteName === "devoncash"
          ? extractDevonCashDetailMetadata(detailHtml)
          : null;
        // Darts Draw can serve a current raffle from a route slug naming an older prize.
        // Its public Nuxt raffle id and title identify the current record.
        if (this.config.siteName === "dartsdraw") {
          if (detail.sourceId !== null) competition.sourceId = detail.sourceId;
          if (detail.name !== null) competition.name = detail.name;
        }
        if (competition.drawDate === null) competition.drawDate = detail.drawDate;
        if (competition.entryPrice <= 0 && detail.entryPrice > 0) {
          competition.entryPrice = detail.entryPrice;
        }
        if (detail.explicitFreeEntry && !competition.categories.includes("free")) {
          competition.categories.push("free");
        }
        const inventoryIsInvalid =
          competition.maxTickets <= 0 ||
          competition.ticketsSold < 0 ||
          competition.ticketsSold > competition.maxTickets;
        const detailInventoryIsValid =
          detail.maxTickets > 0 &&
          detail.ticketsSold >= 0 &&
          detail.ticketsSold <= detail.maxTickets;
        if (inventoryIsInvalid && detailInventoryIsValid) {
          competition.ticketsSold = detail.ticketsSold;
          competition.maxTickets = detail.maxTickets;
        } else if (detailInventoryIsValid) {
          if (competition.ticketsSold <= 0 && detail.ticketsSold > 0) {
            competition.ticketsSold = detail.ticketsSold;
          }
          if (competition.maxTickets <= 0 && detail.maxTickets > 0) {
            competition.maxTickets = detail.maxTickets;
          }
        }
        if (detail.maxEntriesPerUser > 0) {
          competition.maxEntriesPerUser = detail.maxEntriesPerUser;
          competition.maxEntriesPerUserSource = "site";
        }
        if (detail.cashAlternativeSource === "payload") {
          competition.cashAlternative = detail.cashAlternative;
          competition.valuationNotes = detail.cashAlternative === null
            ? null
            : "Explicit cash alternative in current detail payload";
        } else if (devonDetail?.finalCashPrize !== null && devonDetail?.finalCashPrize !== undefined) {
          competition.cashAlternative = devonDetail.finalCashPrize;
        } else if (detail.cashAlternative !== null) {
          competition.cashAlternative = detail.cashAlternative;
        }
        if (
          (competition.cashAlternative ?? 0) <= 0 &&
          (detail.prizeValue ?? 0) > 0 &&
          (competition.estimatedPrizeValue ?? 0) <= 0
        ) {
          competition.estimatedPrizeValue = detail.prizeValue;
          competition.valuationSource = "site_estimate";
          competition.valuationConfidence = "medium";
          competition.valuationNotes = "Reffle public prizeValue payload";
        }
        if (devonDetail?.isInstantWin) {
          competition.isAutoDraw = true;
          if (!competition.categories.includes("instant-win")) {
            competition.categories.push("instant-win");
          }
        }
      } catch {
        signal?.throwIfAborted();
        // Keep list-page data if the detail page cannot be fetched.
      }
    }
  }

  private parse(html: string): RawCompetition[] {
    const $ = cheerio.load(html);
    const now = new Date().toISOString();

    // Parse both layouts. Some pages contain a mix of classic and Vue cards.
    const classic = this.parseClassicReffle($, now);
    const vue = this.parseVueReffle($, now);
    return dedup([...classic, ...vue]);
  }

  /** Classic Reffle: .raffles > .raffle > .raffle-body */
  private parseClassicReffle(
    $: cheerio.CheerioAPI,
    now: string,
  ): RawCompetition[] {
    const cards = $(".raffle");
    if (cards.length === 0) return [];

    const competitions: RawCompetition[] = [];

    cards.each((_i, el) => {
      try {
        const $card = $(el);
        const comp = this.parseClassicCard($, $card, now);
        if (comp) competitions.push(comp);
      } catch { /* skip */ }
    });

    return dedup(competitions);
  }

  private parseClassicCard(
    $: cheerio.CheerioAPI,
    $card: cheerio.Cheerio<AnyNode>,
    now: string,
  ): RawCompetition | null {
    // URL and source ID
    const link =
      $card.find("a[href*='/raffle/']").first().attr("href") ||
      $card.find("a").first().attr("href") || "";
    if (!link) return null;

    const slugMatch = link.match(/\/raffle\/([\w-]+)/) || link.match(/\/([\w-]+)\/?$/);
    const sourceId = slugMatch?.[1] ?? "";
    if (!sourceId) return null;

    const url = link.startsWith("http") ? link : `${this.config.baseUrl}${link}`;

    // Name
    const name =
      $card.find("h3 a, h3, h2").first().text().trim() ||
      sourceId.replace(/-/g, " ");

    // Tickets: "X Tickets Sold" and "Y remaining"
    let ticketsSold = 0;
    let maxTickets = 0;
    const cardText = $card.text();

    // "669 Tickets Sold" or "62 62 Tickets Sold" (doubled number pattern)
    const soldMatch = cardText.match(/([\d,]+)\s*(?:[\d,]+\s*)?Tickets?\s*Sold/i);
    if (soldMatch) {
      ticketsSold = parseInt(soldMatch[1].replace(/,/g, ""), 10);
    }

    // "9,331 remaining"
    const remainMatch = cardText.match(/([\d,]+)\s*remaining/i);
    if (remainMatch) {
      const remaining = parseInt(remainMatch[1].replace(/,/g, ""), 10);
      maxTickets = ticketsSold + remaining;
    }

    // Price: "£X.XX /per entry" or "£X.XX per entry"
    let entryPrice = 0;
    const priceMatch = cardText.match(/£([\d.]+)\s*\/?\s*per\s*entry/i);
    if (priceMatch) {
      entryPrice = parseFloat(priceMatch[1]);
    }

    // Cash alternative: "Prize Cash Alternative: £X"
    let cashAlternative: number | null = null;
    cashAlternative = extractCashAlternative(`${name} ${cardText}`);

    return {
      sourceId,
      siteName: this.config.siteName,
      url,
      name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative,
      drawDate: null,
      isAutoDraw: cardText.toLowerCase().includes("instant win"),
      categories: [],
      scrapedAt: now,
    };
  }

  /** Vue/Tailwind Reffle: sold/remaining as text near competition links */
  private parseVueReffle(
    $: cheerio.CheerioAPI,
    now: string,
  ): RawCompetition[] {
    const competitions = new Map<string, RawCompetition>();

    // Find all elements with "tickets sold" or "X / Y sold" text
    // and pair them with nearby competition links
    $('a[href*="/raffle/"], a[href*="/raffles/"], a[href*="/competition/"]').each((_i, el) => {
      try {
        const $link = $(el);
        const href = $link.attr("href") || "";
        const slugMatch = href.match(/\/(?:raffles?|competition)\/([\w-]+)/);
        if (!slugMatch) return;

        const sourceId = slugMatch[1];
        if (/^(active|waiting|closed|ended|coming-soon)$/i.test(sourceId)) return;

        const $card = selectVueCard($, $link);
        const cardText = $card.text().replace(/\s+/g, " ").trim();
        const url = href.startsWith("http") ? href : `${this.config.baseUrl}${href}`;

        // Name
        const name =
          $card.find("h3, h2, h4").first().text().trim() ||
          $card.find("img[alt]").first().attr("alt")?.trim() ||
          sourceId.replace(/-/g, " ");

        // Tickets: "X tickets sold" + "Y remaining"
        let ticketsSold = 0;
        let maxTickets = 0;

        const soldText = $card.find('[data-test="tickets-sold"]').first().text();
        const remainingText = $card.find('[data-test="tickets-remaining"]').first().text();
        const structuredSlash = soldText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
        if (structuredSlash) {
          ticketsSold = parseInt(structuredSlash[1].replace(/,/g, ""), 10);
          maxTickets = parseInt(structuredSlash[2].replace(/,/g, ""), 10);
        }

        const structuredSold = maxTickets === 0
          ? parseInt((soldText.match(/([\d,]+)/)?.[1] ?? "").replace(/,/g, ""), 10)
          : NaN;
        const structuredRemaining = parseInt(
          (remainingText.match(/([\d,]+)/)?.[1] ?? "").replace(/,/g, ""),
          10,
        );
        if (Number.isFinite(structuredSold)) {
          ticketsSold = structuredSold;
        }
        if (Number.isFinite(structuredRemaining)) {
          maxTickets = ticketsSold + structuredRemaining;
        }

        const soldMatch = maxTickets === 0 ? cardText.match(/([\d,]+)\s*tickets?\s*sold/i) : null;
        if (soldMatch) {
          ticketsSold = parseInt(soldMatch[1].replace(/,/g, ""), 10);
        }
        const remainMatch = maxTickets === 0 ? cardText.match(/([\d,]+)\s*remaining/i) : null;
        if (remainMatch) {
          const remaining = parseInt(remainMatch[1].replace(/,/g, ""), 10);
          maxTickets = ticketsSold + remaining;
        }
        // "X / Y sold" pattern. Keep this behind the sold+remaining parse because
        // countdown text can appear directly before the slash total on some sites.
        if (maxTickets === 0) {
          const slashSold = cardText.match(/(?:^|\D)([\d,]+)\s*\/\s*([\d,]+)\s*(?:tickets?\s*)?sold/i);
          if (slashSold) {
            ticketsSold = parseInt(slashSold[1].replace(/,/g, ""), 10);
            maxTickets = parseInt(slashSold[2].replace(/,/g, ""), 10);
          }
        }

        // Price
        const entryPrice = extractEntryPrice(`${name} ${cardText}`);

        const cashAlternative =
          extractCashAlternative(`${name} ${cardText}`) ??
          extractSlugCashAlternative(sourceId);

        const competition: RawCompetition = {
          sourceId,
          siteName: this.config.siteName,
          url,
          name,
          entryPrice,
          ticketsSold,
          maxTickets,
          maxEntriesPerUser: 100,
          maxEntriesPerUserSource: "fallback",
          cashAlternative,
          drawDate: null,
          isAutoDraw: cardText.toLowerCase().includes("instant win"),
          categories: [],
          scrapedAt: now,
        };

        const existing = competitions.get(sourceId);
        if (!existing || scoreVueCompetition(competition) > scoreVueCompetition(existing)) {
          competitions.set(sourceId, competition);
        }
      } catch { /* skip */ }
    });

    return Array.from(competitions.values());
  }
}

function selectVueCard(
  $: cheerio.CheerioAPI,
  $link: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  const candidates: cheerio.Cheerio<AnyNode>[] = [];
  const push = ($candidate: cheerio.Cheerio<AnyNode>) => {
    if ($candidate.length > 0) candidates.push($candidate.first());
  };

  push($link.find("div.rounded-lg, div.border").first());
  push($link.closest(".raffle-card"));
  push($link.closest("div.rounded-lg, div.border"));
  push($link);

  let $parent = $link.parent();
  for (let i = 0; i < 6 && $parent.length > 0; i += 1) {
    push($parent);
    $parent = $parent.parent();
  }

  return candidates
    .filter(($candidate) => uniqueRaffleLinkCount($, $candidate) <= 1)
    .sort((a, b) => scoreVueCard(b.text()) - scoreVueCard(a.text()))[0] ?? $link;
}

function uniqueRaffleLinkCount(
  $: cheerio.CheerioAPI,
  $candidate: cheerio.Cheerio<AnyNode>,
): number {
  const hrefs = new Set<string>();
  $candidate
    .find('a[href*="/raffle/"], a[href*="/raffles/"], a[href*="/competition/"]')
    .add($candidate.filter('a[href*="/raffle/"], a[href*="/raffles/"], a[href*="/competition/"]'))
    .each((_i, link) => {
      const href = $(link).attr("href");
      if (href) hrefs.add(href);
    });
  return hrefs.size;
}

function scoreVueCard(text: string): number {
  let score = 0;
  if (/£[\d.]+\s*\/\s*(?:entry|ticket)(?![A-Za-z])/i.test(text)) score += 5;
  if (/£[\d.]+\s*\/?\s*per\s*(?:entry|ticket)/i.test(text)) score += 5;
  if (/\d[\d,]*\s*\/\s*\d[\d,]*\s*(?:tickets?\s*)?sold/i.test(text)) score += 5;
  if (/\d[\d,]*\s*tickets?\s*sold/i.test(text)) score += 3;
  if (/\d[\d,]*\s*remaining/i.test(text)) score += 3;
  if (/only\s+\d+p\b/i.test(text)) score += 2;
  if (/cash|ps\d{2,7}|£\s*[\d,.]+/i.test(text)) score += 1;
  return score;
}

function scoreVueCompetition(competition: RawCompetition): number {
  return (
    (competition.entryPrice > 0 ? 8 : 0) +
    (competition.maxTickets > 0 ? 8 : 0) +
    (competition.ticketsSold > 0 ? 3 : 0) +
    (competition.drawDate ? 5 : 0) +
    ((competition.cashAlternative ?? 0) > 0 ? 2 : 0)
  );
}

function dedup(comps: RawCompetition[]): RawCompetition[] {
  const bySourceId = new Map<string, RawCompetition>();
  for (const competition of comps) {
    const existing = bySourceId.get(competition.sourceId);
    if (!existing || scoreVueCompetition(competition) > scoreVueCompetition(existing)) {
      bySourceId.set(competition.sourceId, competition);
    }
  }
  return Array.from(bySourceId.values());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractDrawDate(html: string): string | null {
  const countdown = html.match(/data-time=["'](\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?["']/i);
  if (countdown) {
    return new Date(
      parseInt(countdown[1], 10),
      parseInt(countdown[2], 10) - 1,
      parseInt(countdown[3], 10),
      parseInt(countdown[4], 10),
      parseInt(countdown[5], 10),
      parseInt(countdown[6] ?? "0", 10),
      0,
    ).toISOString();
  }

  const isoDates = Array.from(
    html.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g),
  )
    .map((match) => new Date(match[0]))
    .filter((date) => !Number.isNaN(date.getTime()) && date.getTime() > Date.now())
    .sort((a, b) => a.getTime() - b.getTime());

  return isoDates[0]?.toISOString() ?? null;
}

function extractDetailMetadata(html: string): {
  sourceId: string | null;
  name: string | null;
  drawDate: string | null;
  entryPrice: number;
  explicitFreeEntry: boolean;
  ticketsSold: number;
  maxTickets: number;
  maxEntriesPerUser: number;
  cashAlternative: number | null;
  cashAlternativeSource: "payload" | "text";
  prizeValue: number | null;
  prizeDescription: string;
  hasInstantWins: boolean;
} {
  const $ = cheerio.load(html);
  const nuxt = extractNuxtRaffleMetadata($);
  const visibleRoot = $("main").first();
  const text = (visibleRoot.length > 0 ? visibleRoot.text() : $("body").text())
    .replace(/\s+/g, " ")
    .trim();
  const soldText = $('[data-test="tickets-sold"]').first().text();
  const slashSold =
    soldText.match(/([\d,]+)\s*\/\s*([\d,]+)/) ||
    text.match(/Tickets?\s+sold:?\s*([\d,]+)\s*\/\s*([\d,]+)/i) ||
    text.match(/(?:^|\D)([\d,]+)\s*\/\s*([\d,]+)\s*(?:tickets?\s*)sold\b/i);
  const soldRemaining = slashSold
    ? null
    : text.match(/([\d,]+)\s+sold\s*[/,·-]\s*([\d,]+)\s+remaining/i);
  const soldCount = text.match(/\b([\d,]+)\s+tickets?\s+sold\b/i);
  const remainingCount = text.match(/([\d,]+)\s+(?:tickets?\s+)?left/i);
  const totalTicketsAvailable = text.match(
    /Total\s+Tickets?\s+Available\s*[-:]\s*([\d,]+)/i,
  );
  const maxEntriesMatch = text.match(/Max\s*([\d,]+)\s*tickets?\s*per\s*person/i);

  const detailTicketsSold = slashSold
    ? parseInt(slashSold[1].replace(/,/g, ""), 10)
    : soldRemaining
      ? parseInt(soldRemaining[1].replace(/,/g, ""), 10)
      : totalTicketsAvailable && remainingCount
        ? parseInt(totalTicketsAvailable[1].replace(/,/g, ""), 10) -
          parseInt(remainingCount[1].replace(/,/g, ""), 10)
        : soldCount
          ? parseInt(soldCount[1].replace(/,/g, ""), 10)
          : 0;
  const detailMaxTickets = slashSold
    ? parseInt(slashSold[2].replace(/,/g, ""), 10)
    : soldRemaining
      ? parseInt(soldRemaining[1].replace(/,/g, ""), 10) +
        parseInt(soldRemaining[2].replace(/,/g, ""), 10)
      : totalTicketsAvailable
        ? parseInt(totalTicketsAvailable[1].replace(/,/g, ""), 10)
        : 0;

  return {
    sourceId: nuxt?.sourceId ?? null,
    name: nuxt?.name ?? null,
    drawDate:
      nuxt?.drawDate ??
      extractDrawDate(html) ??
      parseHostedDate($('[data-test="tickets-remaining"]').first().text()),
    entryPrice: nuxt?.entryPrice ?? extractEntryPrice(text),
    explicitFreeEntry: nuxt?.entryPrice === 0,
    ticketsSold: nuxt?.ticketsSold ?? detailTicketsSold,
    maxTickets: nuxt?.maxTickets ?? detailMaxTickets,
    maxEntriesPerUser: nuxt?.maxEntriesPerUser ?? (maxEntriesMatch
      ? parseInt(maxEntriesMatch[1].replace(/,/g, ""), 10)
      : 0),
    cashAlternative: nuxt ? nuxt.cashAlternative : extractCashAlternative(text),
    cashAlternativeSource: nuxt ? "payload" : "text",
    prizeValue: nuxt?.prizeValue ?? null,
    prizeDescription: nuxt?.prizeDescription ?? $(".description-section").text().replace(/\s+/g, " ").trim().slice(0, 6000),
    hasInstantWins: nuxt?.hasInstantWins ?? false,
  };
}

function extractNuxtRaffleMetadata(
  $: cheerio.CheerioAPI,
): {
  sourceId: string | null;
  name: string | null;
  entryPrice: number;
  ticketsSold: number;
  maxTickets: number;
  maxEntriesPerUser: number;
  drawDate: string | null;
  cashAlternative: number | null;
  prizeValue: number | null;
  prizeDescription: string;
  hasInstantWins: boolean;
} | null {
  const serialized = $("#__NUXT_DATA__").first().text().trim();
  if (!serialized) return null;

  try {
    const data = JSON.parse(serialized) as unknown[];
    if (!Array.isArray(data)) return null;
    const raffle = data.find((value): value is Record<string, unknown> =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "ticketGenerationType" in value &&
      "price" in value &&
      "numberOfTickets" in value
    );
    if (!raffle) return null;

    const resolve = (key: string): unknown => {
      const index = raffle[key];
      return typeof index === "number" && Number.isInteger(index)
        ? data[index]
        : undefined;
    };
    const number = (key: string): number | null => {
      const value = resolve(key);
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    };
    const pricePence = number("price");
    const cashAlternativePence = number("cashAlternative");
    const prizeValuePence = number("prizeValue");
    const ticketsSold = number("ticketsSold");
    const maxTickets = number("numberOfTickets");
    const maxEntriesPerUser = number("maxTicketsPerUser");
    const raffleId = number("id");
    const rawTitle = resolve("title");
    const name = typeof rawTitle === "string" ? rawTitle.trim() : "";
    if (
      pricePence === null ||
      ticketsSold === null ||
      maxTickets === null ||
      maxTickets <= 0 ||
      ticketsSold < 0 ||
      ticketsSold > maxTickets ||
      maxEntriesPerUser === null ||
      maxEntriesPerUser <= 0
    ) {
      return null;
    }

    const rawDrawDate = resolve("endDate");
    const parsedDrawDate = typeof rawDrawDate === "string"
      ? new Date(rawDrawDate)
      : null;
    return {
      sourceId:
        raffleId !== null && Number.isInteger(raffleId) && raffleId > 0
          ? String(raffleId)
          : null,
      name: name || null,
      prizeDescription: typeof resolve("description") === "string"
        ? cheerio.load(String(resolve("description"))).text().replace(/\s+/g, " ").trim().slice(0, 6000) : "",
      hasInstantWins: (number("instantWinsCount") ?? 0) > 0 || (number("instantWinTicketsCount") ?? 0) > 0,
      entryPrice: pricePence / 100,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser,
      drawDate:
        parsedDrawDate && Number.isFinite(parsedDrawDate.getTime())
          ? parsedDrawDate.toISOString()
          : null,
      cashAlternative:
        cashAlternativePence !== null && cashAlternativePence > 0
          ? cashAlternativePence / 100
          : null,
      prizeValue:
        prizeValuePence !== null && prizeValuePence > 0
          ? prizeValuePence / 100
          : null,
    };
  } catch {
    return null;
  }
}

function extractDevonCashDetailMetadata(html: string): {
  finalCashPrize: number | null;
  isInstantWin: boolean;
} {
  const $ = cheerio.load(html);
  const descriptionText = $(".description-section").first().text().replace(/\s+/g, " ").trim();
  const finalCashMatch =
    descriptionText.match(/\bfinal\s+£\s*([\d,.]+)\s*(k\b)?\s+cash\s+prize\b/i) ||
    descriptionText.match(/£\s*([\d,.]+)\s*(k\b)?\s+final\s+cash\s+prize\b/i) ||
    descriptionText.match(/\bfinal\s+cash\s+prize(?:\s+(?:is|of))?\s*:?\s*£\s*([\d,.]+)\s*(k\b)?/i);

  return {
    finalCashPrize: finalCashMatch
      ? parseCashAmount(finalCashMatch[1], finalCashMatch[2])
      : null,
    isInstantWin:
      $("#instant-wins-tab-pane, [data-bs-target='#instant-wins-tab-pane']").length > 0,
  };
}

function parseHostedDate(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const match = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  const now = DateTime.now().setZone("Europe/London");
  let date = DateTime.fromFormat(
    `${match[1]} ${match[2]} ${now.year} ${match[3]}:${match[4]} ${match[5].toUpperCase()}`,
    "MMM d yyyy h:mm a",
    { zone: "Europe/London" },
  );
  if (!date.isValid) {
    date = DateTime.fromFormat(
      `${match[1]} ${match[2]} ${now.year} ${match[3]}:${match[4]} ${match[5].toUpperCase()}`,
      "MMMM d yyyy h:mm a",
      { zone: "Europe/London" },
    );
  }
  if (!date.isValid) return null;
  if (date < now.minus({ hours: 1 })) date = date.plus({ years: 1 });
  return date.toUTC().toISO();
}

function extractEntryPrice(text: string): number {
  const priceMatch =
    text.match(/Ticket\s*Price\s*:\s*£\s*([\d.]+)/i) ||
    text.match(/(?:^|\D)1\s+tickets?.{0,20}?£\s*([\d.]+)/i) ||
    text.match(/£([\d.]+)\s*\/\s*(?:entry|ticket)(?![A-Za-z])/i) ||
    text.match(/£([\d.]+)\s*\/?\s*per\s*(?:entry|ticket)/i) ||
    text.match(/£([\d.]+)\s*(?:a\s*ticket|each)/i);
  if (priceMatch) return parseFloat(priceMatch[1]);

  const spinPriceMatch = text.match(/£([\d.]+)\s*\/?\s*per\s*spin/i);
  if (spinPriceMatch) {
    const ticketsPerSpin = text.match(/1\s+spin\s*=\s*([\d,]+)\s*tickets?/i);
    const price = parseFloat(spinPriceMatch[1]);
    const ticketCount = ticketsPerSpin ? parseInt(ticketsPerSpin[1].replace(/,/g, ""), 10) : 1;
    return ticketCount > 0 ? price / ticketCount : price;
  }

  const penceMatch =
    text.match(/(\d+)p\s*(?:per|a)\s*(?:entry|ticket)/i) ||
    text.match(/only\s+(\d+)p\b/i);
  return penceMatch ? parseInt(penceMatch[1], 10) / 100 : 0;
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/Current\s+70%\s+cash\s+alternative\s*:\s*£\s*([\d,.]+)\s*(k\b)?/i) ||
    text.match(/Cash\s*Alternative\s*:\s*£\s*([\d,.]+)\s*(k\b)?/i) ||
    text.match(/£\s*([\d,.]+)\s*(k\b)?\s*cash\s*alternative\b/i) ||
    text.match(/\bor\s*£\s*([\d,.]+)\s*(k\b)?\s*(?:cash|tax[\s-‑–—]*free\s+cash)\b/i) ||
    text.match(/£\s*([\d,.]+)\s*(k\b)?(?:\.\d{2})?\s*tax[\s-‑–—]*free\b/i) ||
    text.match(/£\s*([\d,.]+)\s*(k\b)?(?:\.\d{2})?(?:\s+[A-Za-z0-9#+&-]+){0,4}\s+instant\s+win\b/i) ||
    text.match(/(?:win\s+)?£\s*([\d,.]+)\s*(k\b)?(?:\.\d{2})?(?:\s+[A-Za-z0-9#+&-]+){0,6}\s+(?:tax[\s-‑–—]*free\s+)?cash\b/i);
  return match ? parseCashAmount(match[1], match[2]) : null;
}

function extractSlugCashAlternative(sourceId: string): number | null {
  if (/\b(?:voucher|credit|gift-card|giftcard)\b/i.test(sourceId)) return null;
  const match = sourceId.match(/^ps(\d{2,7})(?:\b|-)/i);
  return match ? parseInt(match[1], 10) : null;
}

function parseCashAmount(value: string, suffix?: string): number | null {
  const amount = parseFloat(value.replace(/,/g, ""));
  if (Number.isNaN(amount)) return null;
  return suffix ? amount * 1000 : amount;
}
