import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://nerdcompetitions.co.uk";

interface NerdCompetition {
  id: string;
  title: string;
  retailValue: number;
  cashAlternative: number;
  ticketPrice: number;
  endsAt: string;
  maxTickets: number;
  ticketsRemaining: number;
}

export class NerdCompetitionsAdapter implements SiteAdapter {
  readonly siteName = "nerdcompetitions";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(BASE_URL, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
    });
    if (!response.ok) {
      throw new Error(`[Nerd Competitions] Failed to fetch homepage: ${response.status}`);
    }

    return parseNerdCompetitions(await response.text());
  }
}

export function parseNerdCompetitions(html: string): RawCompetition[] {
  const normalized = html.replaceAll('\\"', '"');
  const scrapedAt = new Date().toISOString();
  const competitions: RawCompetition[] = [];
  const pattern = /"id":"([^"]+)","title":"([^"]+)","image":"[^"]*","retailValue":([\d.]+),"cashAlternative":([\d.]+),"ticketPrice":([\d.]+),"endsAt":"([^"]+)","funding":\{"maxTickets":(\d+),"odds":\d+,"pctOfPoolSold":[\d.]+,"ticketsRemaining":(\d+)\}/g;

  for (const match of normalized.matchAll(pattern)) {
    const [, id, title, retailValueText, cashAlternativeText, priceText, endsAt, maxTicketsText, remainingText] = match;
    const maxTickets = Number(maxTicketsText);
    const ticketsRemaining = Number(remainingText);
    if (!id || !title || !Number.isFinite(maxTickets) || maxTickets <= 0) continue;
    if (!Number.isFinite(ticketsRemaining) || ticketsRemaining < 0 || ticketsRemaining > maxTickets) continue;

    const entryPrice = Number(priceText);
    const cashAlternative = Number(cashAlternativeText);
    const retailValue = Number(retailValueText);
    const drawDate = new Date(endsAt ?? "");
    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || Number.isNaN(drawDate.getTime())) continue;

    competitions.push({
      sourceId: id,
      siteName: "nerdcompetitions",
      url: `${BASE_URL}/competitions/${id}`,
      name: title,
      entryPrice,
      ticketsSold: maxTickets - ticketsRemaining,
      maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: cashAlternative > 0 ? cashAlternative : null,
      estimatedPrizeValue: cashAlternative > 0 ? null : retailValue > 0 ? retailValue : null,
      valuationSource: cashAlternative > 0 ? null : retailValue > 0 ? "site_estimate" : null,
      valuationConfidence: cashAlternative > 0 ? null : retailValue > 0 ? "medium" : null,
      valuationNotes: cashAlternative > 0 ? null : retailValue > 0 ? "Nerd Competitions public retail value" : null,
      drawDate: drawDate.toISOString(),
      isAutoDraw: false,
      categories: ["free-postal"],
      scrapedAt,
    });
  }

  return competitions;
}
