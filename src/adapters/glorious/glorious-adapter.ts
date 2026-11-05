import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const BASE_URL = "https://www.glorious.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

interface GloriousCompetition {
  id?: unknown;
  price?: unknown;
  totalTickets?: unknown;
  category?: unknown;
  status?: unknown;
  drawDate?: unknown;
  cashAlternative?: unknown;
  maxPerPerson?: unknown;
  drawType?: unknown;
  prizeName?: unknown;
  prizeValue?: unknown;
  isSiteCreditPrize?: unknown;
  ticketsSold?: unknown;
}

interface GloriousSsrData {
  queries?: Array<{
    state?: { data?: unknown };
  }>;
}

export class GloriousAdapter implements SiteAdapter {
  readonly siteName = "glorious";

  async fetchAll(): Promise<RawCompetition[]> {
    const response = await fetch(BASE_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!response.ok) throw new Error(`Glorious returned ${response.status}`);
    return parseGloriousHome(await response.text());
  }
}

export function parseGloriousHome(
  html: string,
  now = new Date(),
): RawCompetition[] {
  const $ = cheerio.load(html);
  const byId = new Map(
    extractSsrCompetitions(html)
      .map((competition) => [String(competition.id ?? ""), competition] as const)
      .filter(([id]) => id.length > 0),
  );
  const seen = new Set<string>();
  const competitions: RawCompetition[] = [];

  $("a[href*='/competition/']").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const url = new URL(href, BASE_URL).toString();
    const id = url.match(/-(\d+)(?:[/?#]|$)/)?.[1] ?? "";
    const source = byId.get(id);
    if (!source || seen.has(id) || !isUsableCompetition(source, now)) return;

    const price = numberValue(source.price);
    const totalTickets = numberValue(source.totalTickets);
    const ticketsSold = numberValue(source.ticketsSold);
    const drawDate = dateValue(source.drawDate);
    if (price <= 0 || totalTickets <= 0 || ticketsSold < 0 || ticketsSold > totalTickets || !drawDate) {
      return;
    }

    const cashAlternative = positiveNumberOrNull(source.cashAlternative);
    const prizeValue = positiveNumberOrNull(source.prizeValue);
    const maxPerPerson = positiveNumberOrNull(source.maxPerPerson);
    const prizeName = cleanText(String(source.prizeName ?? ""));
    const category = cleanText(String(source.category ?? ""));
    seen.add(id);
    competitions.push({
      sourceId: id,
      siteName: "glorious",
      url,
      name: prizeName,
      entryPrice: price,
      ticketsSold,
      maxTickets: totalTickets,
      maxEntriesPerUser: maxPerPerson ?? 100,
      maxEntriesPerUserSource: maxPerPerson !== null ? "site" : "fallback",
      cashAlternative,
      estimatedPrizeValue: cashAlternative ?? (source.isSiteCreditPrize === true ? null : prizeValue),
      valuationSource: cashAlternative !== null ? "cash" : prizeValue !== null ? "site_estimate" : null,
      valuationConfidence: cashAlternative !== null ? "high" : prizeValue !== null ? "medium" : null,
      valuationNotes: prizeValue !== null ? "Glorious public competition payload prizeValue." : null,
      drawDate,
      isAutoDraw: String(source.drawType ?? "").toLowerCase() === "automated",
      categories: category ? [category] : [],
      scrapedAt: now.toISOString(),
    });
  });

  return competitions;
}

function extractSsrCompetitions(html: string): GloriousCompetition[] {
  const marker = "window.__SSR_DATA__=";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return [];
  const scriptEnd = html.indexOf("</script>", markerIndex);
  if (scriptEnd < 0) return [];

  try {
    const payload = html
      .slice(markerIndex + marker.length, scriptEnd)
      .trim()
      .replace(/;$/, "");
    const ssr = JSON.parse(payload) as GloriousSsrData;
    const competitions: GloriousCompetition[] = [];
    for (const query of ssr.queries ?? []) {
      if (!Array.isArray(query.state?.data)) continue;
      for (const item of query.state.data) {
        if (isGloriousCompetition(item)) competitions.push(item);
      }
    }
    return competitions;
  } catch {
    return [];
  }
}

function isGloriousCompetition(value: unknown): value is GloriousCompetition {
  return Boolean(value && typeof value === "object" && "id" in value && "price" in value && "drawDate" in value);
}

function isUsableCompetition(competition: GloriousCompetition, now: Date): boolean {
  const status = String(competition.status ?? "").toLowerCase();
  const drawType = String(competition.drawType ?? "").toLowerCase();
  const prizeName = String(competition.prizeName ?? "").toLowerCase();
  const drawDate = dateValue(competition.drawDate);
  return (
    status === "active" &&
    drawType !== "instant-win" &&
    !prizeName.includes("odds booster") &&
    drawDate !== null &&
    new Date(drawDate).getTime() > now.getTime()
  );
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumberOrNull(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed > 0 ? parsed : null;
}

function dateValue(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
