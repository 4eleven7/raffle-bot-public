import { CONFIG } from "../config.js";
import type { RawCompetition } from "../types.js";

const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isFreshStoredCompetition(
  competition: { scrapedAt: string },
  now = Date.now(),
): boolean {
  const scrapedAt = new Date(competition.scrapedAt).getTime();
  if (!Number.isFinite(scrapedAt)) return false;
  const ageMs = now - scrapedAt;
  return ageMs >= -MAX_FUTURE_CLOCK_SKEW_MS &&
    ageMs <= CONFIG.filters.maxStoredCompetitionAgeMs;
}

export function isFreshEntryInventory(
  competition: Pick<RawCompetition, "inventorySource" | "ticketsSold" | "maxTickets" | "scrapedAt">,
  observedAt: Date | number = Date.now(),
): boolean {
  if (competition.inventorySource !== "exact") return false;
  if (!Number.isSafeInteger(competition.ticketsSold) ||
      !Number.isSafeInteger(competition.maxTickets) ||
      competition.maxTickets <= 0 ||
      competition.ticketsSold < 0 ||
      competition.ticketsSold >= competition.maxTickets) {
    return false;
  }

  const scrapedAt = new Date(competition.scrapedAt).getTime();
  const observedMs = observedAt instanceof Date ? observedAt.getTime() : observedAt;
  if (!Number.isFinite(scrapedAt) || !Number.isFinite(observedMs)) return false;

  const ageMs = observedMs - scrapedAt;
  return ageMs >= 0 && ageMs <= CONFIG.filters.maxEntryInventoryAgeMs;
}
