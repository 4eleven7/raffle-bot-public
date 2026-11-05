import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { HwdSiteConfig } from "./hwd-site-config.js";
import { parsePage, extractTotalPages } from "./hwd-parser.js";
import { fetchRenderedHtml } from "../browser/browser-pool.js";
import * as cheerio from "cheerio";
import { DateTime } from "luxon";
import { mapWithConcurrency } from "../../utils/concurrency.js";

const DETAIL_CONCURRENCY = 2;
const TICKET_TAB_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 15_000;

export class HwdAdapter implements SiteAdapter {
  readonly siteName: string;
  readonly scanCost?: "browser";

  constructor(private readonly config: HwdSiteConfig) {
    this.siteName = config.siteName;
    this.scanCost = config.requiresBrowser ? "browser" : undefined;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const competitions: RawCompetition[] = [];

    const firstPageHtml = await this.fetchPage(this.config.listPath, signal);
    competitions.push(...parsePage(firstPageHtml, this.config));

    if (this.config.paginatedPath) {
      const totalPages = extractTotalPages(firstPageHtml, this.config);
      for (let page = 2; page <= totalPages; page++) {
        signal?.throwIfAborted();
        await sleep(this.config.fetchDelayMs);
        const path = this.config.paginatedPath.replace(
          "{page}",
          String(page),
        );
        const html = await this.fetchPage(path, signal);
        competitions.push(...parsePage(html, this.config));
      }
    }

    return mapWithConcurrency(
      competitions,
      DETAIL_CONCURRENCY,
      (competition) => this.enrichFromDetail(competition, signal),
    );
  }

  private async fetchPage(path: string, signal?: AbortSignal): Promise<string> {
    const url = /^https?:\/\//i.test(path)
      ? path
      : `${this.config.baseUrl}${path}`;
    if (this.config.requiresBrowser) {
      const html = await fetchRenderedHtml(url, "li.product, div.product", signal);
      if (isCloudflareBlock(html)) return "";
      return html;
    }

    const response = await fetch(url, {
      headers: { "User-Agent": this.config.userAgent },
      signal: requestSignal(signal),
    });

    if (!response.ok) {
      throw new Error(
        `[${this.config.displayName}] Failed to fetch ${url}: ${response.status}`,
      );
    }

    return response.text();
  }

  private async enrichFromDetail(
    competition: RawCompetition,
    signal?: AbortSignal,
  ): Promise<RawCompetition> {
    signal?.throwIfAborted();
    let detailHtml: string;
    try {
      detailHtml = await this.fetchPage(
        competition.url.replace(this.config.baseUrl, ""),
        signal,
      );
    } catch {
      signal?.throwIfAborted();
      return competition;
    }

    const detail = parseDetail(detailHtml);
    const enriched: RawCompetition = {
      ...competition,
      drawDate: detail.drawDate ?? competition.drawDate,
      ticketsSold: detail.ticketsSold ?? competition.ticketsSold,
      maxTickets: detail.ticketsSold !== null && detail.maxTickets > 0
        ? detail.maxTickets
        : competition.maxTickets,
      cashAlternative: detail.cashAlternative ?? competition.cashAlternative,
      estimatedPrizeValue: detail.estimatedPrizeValue ?? competition.estimatedPrizeValue,
      valuationSource: detail.cashAlternative !== null
        ? "cash"
        : detail.estimatedPrizeValue !== null
          ? "site_estimate"
          : competition.valuationSource,
      valuationConfidence: detail.cashAlternative !== null
        ? "high"
        : detail.estimatedPrizeValue !== null
          ? "medium"
          : competition.valuationConfidence,
      valuationNotes: detail.cashAlternative !== null
        ? "Explicit cash alternative"
        : detail.estimatedPrizeValue !== null
          ? "Public prize value stated on detail page"
          : competition.valuationNotes,
      maxEntriesPerUser:
        detail.maxEntriesPerUser > 0
          ? detail.maxEntriesPerUser
          : competition.maxEntriesPerUser,
      maxEntriesPerUserSource:
        detail.maxEntriesPerUser > 0
          ? "site"
          : competition.maxEntriesPerUserSource ?? "fallback",
    };

    try {
      const inventory = await this.fetchExactInventory(detail, signal);
      if (inventory) {
        enriched.ticketsSold = inventory.sold;
        enriched.maxTickets = inventory.max;
      }
    } catch {
      signal?.throwIfAborted();
    }

    return enriched;
  }

  private async fetchExactInventory(
    detail: DetailPage,
    signal?: AbortSignal,
  ): Promise<{ sold: number; max: number } | null> {
    if (detail.firstTicketNumbers.size === 0 && detail.tabStarts.length === 0) return null;

    const pages = [{
      ticketNumbers: detail.firstTicketNumbers,
      soldTicketNumbers: detail.firstSoldTicketNumbers,
    }];
    const remainingTabs = detail.tabStarts.filter((start) =>
      !detail.firstTicketNumbers.has(start)
    );

    if (remainingTabs.length > 0) {
      if (!detail.ajaxUrl || !detail.nonce || !detail.productId) return null;
      const ajaxUrl = new URL(detail.ajaxUrl, this.config.baseUrl);
      if (!isSameOperatorOrigin(ajaxUrl, new URL(this.config.baseUrl))) return null;

      const fetchedPages = await mapWithConcurrency(
        remainingTabs,
        TICKET_TAB_CONCURRENCY,
        async (tab) => {
          const body = new URLSearchParams({
            action: "lty_ticket_tab_selection",
            product_id: detail.productId!,
            tab: String(tab),
            lty_security: detail.nonce!,
          });
          const response = await fetch(ajaxUrl, {
            method: "POST",
            headers: {
              "User-Agent": this.config.userAgent,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
            },
            body,
            signal: requestSignal(signal),
          });
          if (!response.ok) throw new Error(`ticket tab ${tab} returned ${response.status}`);
          const payload = await response.json() as {
            success?: boolean;
            data?: { html?: string };
          };
          if (!payload.success || typeof payload.data?.html !== "string") {
            throw new Error(`ticket tab ${tab} returned invalid data`);
          }
          return parseTicketPage(payload.data.html);
        },
      );
      pages.push(...fetchedPages);
    }

    const ticketNumbers = new Set<number>();
    const soldTicketNumbers = new Set<number>();
    for (const page of pages) {
      for (const ticket of page.ticketNumbers) ticketNumbers.add(ticket);
      for (const ticket of page.soldTicketNumbers) soldTicketNumbers.add(ticket);
    }
    const maxTicket = Math.max(...ticketNumbers);
    if (maxTicket <= 0 || ticketNumbers.size !== maxTicket) return null;
    if (Array.from(ticketNumbers).some((ticket) => ticket < 1 || ticket > maxTicket)) {
      return null;
    }

    return { sold: soldTicketNumbers.size, max: maxTicket };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TicketPage {
  ticketNumbers: Set<number>;
  soldTicketNumbers: Set<number>;
}

interface DetailPage extends TicketPage {
  maxTickets: number;
  ticketsSold: number | null;
  maxEntriesPerUser: number;
  cashAlternative: number | null;
  estimatedPrizeValue: number | null;
  drawDate: string | null;
  tabStarts: number[];
  firstTicketNumbers: Set<number>;
  firstSoldTicketNumbers: Set<number>;
  ajaxUrl: string | null;
  nonce: string | null;
  productId: string | null;
}

function parseDetail(html: string): DetailPage {
  const $ = cheerio.load(html);
  const fixedOdds = cleanText($(".fixed-odds").text());
  const primaryScope = $(".product").first().clone();
  primaryScope
    .find(".related, .related-products, .upsells, .cross-sells, .products, .product-list")
    .remove();
  const detailText = cleanText(primaryScope.text() || $("body").text());
  const closingDate = $("p")
    .filter((_index, element) => /Closing Date:/i.test($(element).text()))
    .first()
    .find("strong")
    .first()
    .text()
    .trim();
  const parsedClosingDate = DateTime.fromFormat(
    closingDate,
    "LLLL d, yyyy h:mm a",
    { zone: "Europe/London", locale: "en-GB" },
  );
  const countdownDate = DateTime.fromFormat(
    $(".lty-lottery-countdown-timer").first().attr("data-time") ?? "",
    "yyyy/MM/dd HH:mm:ss",
    { zone: "Europe/London", locale: "en-GB" },
  );
  const ticketTotal = parseNumber(
    $(".tickets-counter h3")
      .filter((_index, element) => /Total Tickets/i.test($(element).text()))
      .first()
      .next("p")
      .text(),
  );
  const ticketSold = parseNumber(
    $(".tickets-counter h3")
      .filter((_index, element) => /Sold Tickets/i.test($(element).text()))
      .first()
      .next("p")
      .text(),
  );
  const firstPage = parseTicketPage(
    $(".lty-lottery-ticket-tab-content").first().html() ?? "",
  );
  const params = html.match(/var\s+lty_frontend_params\s*=\s*(\{[^;]+\})\s*;/i)?.[1];
  let ajaxUrl: string | null = null;
  let nonce: string | null = null;
  if (params) {
    try {
      const parsed = JSON.parse(params) as {
        ajaxurl?: unknown;
        lottery_tickets_nonce?: unknown;
      };
      ajaxUrl = typeof parsed.ajaxurl === "string" ? parsed.ajaxurl : null;
      nonce = typeof parsed.lottery_tickets_nonce === "string"
        ? parsed.lottery_tickets_nonce
        : null;
    } catch {
      // Incomplete public parameters leave inventory unknown.
    }
  }

  return {
    ...firstPage,
    maxTickets: parseNumber(
      fixedOdds.match(/([\d,]+)\s*Max\.\s*Entries/i)?.[1],
    ) || ticketTotal,
    ticketsSold: ticketTotal > 0 && ticketSold >= 0 && ticketSold <= ticketTotal
      ? ticketSold
      : null,
    maxEntriesPerUser: parseNumber(
      fixedOdds.match(/([\d,]+)\s*per\s*Person/i)?.[1],
    ),
    cashAlternative: extractCashAlternative(detailText),
    estimatedPrizeValue: extractPrizeValue(detailText),
    drawDate: parsedClosingDate.isValid
      ? parsedClosingDate.toUTC().toISO({ suppressMilliseconds: false })
      : countdownDate.isValid
        ? countdownDate.toUTC().toISO({ suppressMilliseconds: false })
        : null,
    tabStarts: $(".lty-lottery-ticket-tab[data-tab]")
      .map((_index, element) => parseNumber($(element).attr("data-tab")))
      .get()
      .filter((value) => value > 0),
    firstTicketNumbers: firstPage.ticketNumbers,
    firstSoldTicketNumbers: firstPage.soldTicketNumbers,
    ajaxUrl,
    nonce,
    productId: $(".lty-ticket-product-id").first().attr("value") ?? null,
  };
}

function extractCashAlternative(text: string): number | null {
  const match = text.match(/cash\s+alternative(?:\s+for\s+this\s+prize)?\s*(?:is|:)?\s*£\s*([\d,.]+)/i);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractPrizeValue(text: string): number | null {
  const match = text.match(/\bworth\s*£\s*([\d,.]+)/i);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseTicketPage(html: string): TicketPage {
  const $ = cheerio.load(html);
  const ticketNumbers = new Set<number>();
  const soldTicketNumbers = new Set<number>();
  $(".lty-ticket[data-ticket]").each((_index, element) => {
    const ticket = parseNumber($(element).attr("data-ticket"));
    if (ticket <= 0) return;
    ticketNumbers.add(ticket);
    if ($(element).hasClass("lty-booked-ticket")) soldTicketNumbers.add(ticket);
  });
  return { ticketNumbers, soldTicketNumbers };
}

function parseNumber(value: string | undefined): number {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isSameOperatorOrigin(left: URL, right: URL): boolean {
  const normalizeHost = (hostname: string): string =>
    hostname.toLowerCase().replace(/^www\./, "");
  return (
    left.protocol === right.protocol &&
    left.port === right.port &&
    normalizeHost(left.hostname) === normalizeHost(right.hostname)
  );
}

function isCloudflareBlock(html: string): boolean {
  return (
    html.includes("Attention Required! | Cloudflare") ||
    html.includes("Sorry, you have been blocked")
  );
}
