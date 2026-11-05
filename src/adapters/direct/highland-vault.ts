import * as cheerio from "cheerio";
import type { RawCompetition } from "../../types.js";
import { isClosedCompetitionDetailPage, parseDetailPage } from "../wclottery/wclottery-parser.js";

export function parseHighlandVaultDetail(html: string, url: string, now: Date): RawCompetition | null {
  const $ = cheerio.load(html);
  const description = $("#tab-description").text().replace(/\s+/g, " ").trim();
  if (isClosedCompetitionDetailPage(html) || !/\bno instant wins\b/i.test(description) ||
      !/\bguaranteed winner\b/i.test(description) ||
      /\binstant wins?\b/i.test(description.replace(/\bno instant wins\b/gi, ""))) return null;
  const comp = parseDetailPage(html, {
    siteName: "highlandvault", displayName: "Highland Vault", baseUrl: "https://highlandvault.com",
    listPath: "/fantastic-competitions/", userAgent: "Mozilla/5.0", fetchDelayMs: 500,
  }, url);
  if (!comp) return null;
  const entryPrice = Number($(".lty-lottery-price[data-price-amount]").first().attr("data-price-amount"));
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  const inventory = $(".hv-progress--single .hv-progress__meta").text();
  const sold = inventory.match(/Tickets\s+sold:\s*([\d,]+)/i);
  const total = inventory.match(/\b([\d,]+)\s+total\b/i);
  if (!sold || !total) return null;
  const ticketsSold = Number(sold[1].replace(/,/g, ""));
  const maxTickets = Number(total[1].replace(/,/g, ""));
  const close = Date.parse(comp.drawDate ?? "");
  if (!Number.isSafeInteger(ticketsSold) || !Number.isSafeInteger(maxTickets) ||
      ticketsSold < 0 || ticketsSold >= maxTickets || !Number.isFinite(close) || close <= now.getTime()) return null;
  return { ...comp, entryPrice, ticketsSold, maxTickets, inventorySource: "exact",
    // The draw description and FAQ disagree; do not grant a multi-ticket cap.
    maxEntriesPerUser: 1, maxEntriesPerUserSource: "fallback",
    prizeDescription: description, prizeEvidence: `${url}: operator description and exact ticket counts`,
    prizePayout: { kind: "fixed" }, scrapedAt: now.toISOString() };
}
