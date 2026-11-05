import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "gardenworx";
const DISPLAY_NAME = "Garden Worx";
const COMPETITION_URL = "https://gardenworx.co.uk/competition";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface GardenWorxConfig {
  total_tickets_available?: number | null;
  tickets_sold?: number | null;
  ticket_price?: number | null;
  draw_date?: string | null;
  is_active?: boolean | null;
  prize_value?: number | null;
  prize_description?: string | null;
}

export class GardenWorxAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(COMPETITION_URL, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`[${DISPLAY_NAME}] Failed to fetch ${COMPETITION_URL}: ${response.status}`);
    }

    const html = await response.text();
    const competition = parseCompetition(html, new Date().toISOString());
    return competition ? [competition] : [];
  }
}

function parseCompetition(html: string, scrapedAt: string): RawCompetition | null {
  const config = extractConfig(html);
  if (!config || config.is_active !== true) return null;

  const maxTickets = finiteNumber(config.total_tickets_available);
  const ticketsSold = finiteNumber(config.tickets_sold);
  const entryPrice = finiteNumber(config.ticket_price);
  const drawDate = normalizeDate(config.draw_date);
  const prizeValue = positiveNumber(config.prize_value);
  const name = String(config.prize_description ?? extractOgTitle(html) ?? "").trim();

  if (!name || maxTickets <= 0 || ticketsSold < 0 || ticketsSold >= maxTickets || drawDate === null) {
    return null;
  }

  return {
    sourceId: "competition",
    siteName: SITE_NAME,
    url: COMPETITION_URL,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative: null,
    ...(prizeValue !== null
      ? {
          estimatedPrizeValue: prizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "high" as const,
          valuationNotes: "Garden Worx public competition config prize value.",
        }
      : {}),
    drawDate,
    isAutoDraw: false,
    categories: ["home & garden", "garden makeover"],
    scrapedAt,
  };
}

function extractConfig(html: string): GardenWorxConfig | null {
  const content = decodeRscPushContent(html);
  if (!content) return null;

  const marker = '"config":{';
  const start = content.indexOf(marker);
  if (start < 0) return null;

  const json = extractBalancedObject(content, start + marker.length - 1);
  if (!json) return null;

  try {
    return JSON.parse(json) as GardenWorxConfig;
  } catch {
    return null;
  }
}

function decodeRscPushContent(html: string): string {
  const pushBlocks = html.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs) || [];

  let combined = "";
  for (const block of pushBlocks) {
    const match = block.match(/self\.__next_f\.push\(\[1,"(.*?)"\]\)/s);
    if (!match) continue;
    try {
      combined += JSON.parse(`"${match[1]}"`);
    } catch {
      continue;
    }
  }

  return combined;
}

function extractBalancedObject(content: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < content.length; i++) {
    const char = content[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }

  return null;
}

function extractOgTitle(html: string): string | null {
  const match = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  return match?.[1] ?? null;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function positiveNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number > 0 ? number : null;
}
