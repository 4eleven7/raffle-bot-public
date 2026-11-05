import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BASE_URL = "https://rafflee.co.uk";

/** Rafflee uses Next.js RSC with raffle data embedded in self.__next_f.push() blocks */
export class RaffleeAdapter implements SiteAdapter {
  readonly siteName = "rafflee";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(`${BASE_URL}/competitions`, {
      headers: {
        "User-Agent": UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(
        `[Rafflee] Failed to fetch: ${response.status}`,
      );
    }

    const html = await response.text();
    return this.parse(html);
  }

  private parse(html: string): RawCompetition[] {
    const raffles = this.extractRaffles(html);
    if (!raffles) return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];

    for (const r of raffles) {
      try {
        const comp = this.mapRaffle(r, now);
        if (comp) competitions.push(comp);
      } catch {
        // Skip unparseable raffles
      }
    }

    return competitions;
  }

  /** Extract the initialRaffles JSON array from the RSC payload */
  private extractRaffles(html: string): RaffleData[] | null {
    // Find the script block containing initialRaffles
    const scriptPattern =
      /<script\b[^>]*>self\.__next_f\.push\(\[1,"(.*?)"\]\)<\/script>/gs;
    let match: RegExpExecArray | null;

    while ((match = scriptPattern.exec(html)) !== null) {
      if (!match[1].includes("initialRaffles")) continue;

      // Unescape the RSC string
      const content = match[1]
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");

      const marker = '"initialRaffles":';
      const idx = content.indexOf(marker);
      if (idx < 0) continue;

      // Extract array using balanced brackets
      const arrStart = idx + marker.length;
      let depth = 0;
      let end = -1;
      for (let j = arrStart; j < content.length; j++) {
        if (content[j] === "[") depth++;
        if (content[j] === "]") depth--;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }

      if (end > 0) {
        try {
          return JSON.parse(content.substring(arrStart, end));
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  private mapRaffle(r: RaffleData, now: string): RawCompetition | null {
    // Skip non-active raffles
    if (r.raffleInstanceState !== "ENTRY_START") return null;

    const entryPrice = r.entryConfiguration?.singleEntryPrice ?? 0;
    const maxEntries = r.playerLimits?.maxEntries ?? 0;
    const siteMaxEntriesPerUser = r.playerLimits?.maxEntriesPerUser;
    const hasSiteMaxEntriesPerUser =
      Number.isFinite(siteMaxEntriesPerUser) && (siteMaxEntriesPerUser ?? 0) > 0;
    const maxEntriesPerUser = hasSiteMaxEntriesPerUser
      ? siteMaxEntriesPerUser as number
      : 100;
    const ticketsSold = r.entriesRegistrationCount ?? 0;

    // Draw date from entryEndTime (epoch ms)
    let drawDate: string | null = null;
    const endTime =
      r.raffleInstanceSchedule?.entryEndTime ?? r.entryEndTime;
    if (endTime) {
      drawDate = new Date(endTime).toISOString();
    }

    // Cash alternative: check prizes array for cashPrize, or parse from name
    let cashAlternative: number | null = null;
    if (r.prizes && r.prizes.length > 0) {
      const cashPrize = r.prizes[0].cashPrize;
      if (cashPrize && cashPrize > 0) {
        cashAlternative = cashPrize;
      }
    }
    // Fallback: parse explicit cash wording from the name or promotional text.
    if (cashAlternative === null) {
      const cashText = [
        r.raffleName,
        r.customText,
        r.lobbyProperties?.customText,
      ].find((text) => /£[\d,]+(?:\.\d{1,2})?\s*cash\b/i.test(text ?? ""));
      const cashMatch = cashText?.match(
        /£([\d,]+(?:\.\d{1,2})?)\s*cash\b/i,
      );
      if (cashMatch) {
        cashAlternative = parseFloat(cashMatch[1].replace(/,/g, ""));
      }
    }

    // URL from slug
    const slug = r.slug || "";
    const url = slug.startsWith("http")
      ? slug
      : `${BASE_URL}${slug}`;

    // Category
    const category =
      r.lobbyProperties?.raffleCategory ?? "";
    const categories = category ? [category] : [];

    return {
      sourceId: String(r.raffleInstanceId),
      siteName: "rafflee",
      url,
      name: r.raffleName || "",
      entryPrice,
      ticketsSold,
      maxTickets: maxEntries,
      maxEntriesPerUser,
      maxEntriesPerUserSource: hasSiteMaxEntriesPerUser ? "site" : "fallback",
      cashAlternative,
      drawDate,
      isAutoDraw: r.instantWinEnabled ?? false,
      categories,
      scrapedAt: now,
    };
  }
}

/** Shape of a raffle in the initialRaffles JSON */
interface RaffleData {
  raffleInstanceId: number;
  raffleInstanceState: string;
  raffleInstanceSchedule?: {
    entryEndTime?: number;
    drawTime?: number;
  };
  entryEndTime?: number;
  raffleName?: string;
  slug?: string;
  prizeType?: string;
  entryConfiguration?: {
    singleEntryPrice?: number;
  };
  playerLimits?: {
    maxEntries?: number;
    maxEntriesPerUser?: number;
  };
  entriesRegistrationCount?: number;
  prizes?: Array<{
    cashPrize?: number;
  }>;
  lobbyProperties?: {
    raffleCategory?: string;
    customText?: string;
  };
  customText?: string;
  instantWinEnabled?: boolean;
}
