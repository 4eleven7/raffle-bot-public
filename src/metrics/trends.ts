import type { Snapshot, Competition } from "../types.js";
import { getRecentSnapshots } from "../storage/database.js";
import { CONFIG } from "../config.js";

export interface TrendAnalysis {
  /** Tickets sold per hour over recent history */
  velocityPerHour: number;
  /** Estimated time until sold out (ms), null if not selling */
  estimatedSelloutMs: number | null;
  /** Whether the sell rate is accelerating */
  isAccelerating: boolean;
  /** Projected sell-through at draw time (0-1) */
  projectedSellThrough: number | null;
  /** Integer sales forecast; absent in older saved replay records. */
  projectedTicketsSold?: number | null;
  /** Number of snapshots used for analysis */
  dataPoints: number;
  /** Whether the history is safe to use for an alert projection. */
  isReliable: boolean;
  /** Whether the recent sold counter dropped and began a new series. */
  resetDetected: boolean;
}

/** Analyze ticket sale trends for a competition */
export function analyzeTrend(comp: Competition): TrendAnalysis {
  const snapshots = getRecentSnapshots(
    comp.sourceId,
    comp.siteName,
    comp.drawDate,
    comp.maxTickets,
    CONFIG.alerts.maxTrendSnapshots,
  );

  return analyzeTrendSnapshots(comp, snapshots);
}

/** Analyze a bounded history and include the current scrape as a quiet endpoint. */
export function analyzeTrendSnapshots(
  comp: Competition,
  snapshots: Snapshot[],
): TrendAnalysis {
  const normalisedPoints = normaliseSnapshots(comp, snapshots);
  const { points, resetDetected } = latestMonotonicSegment(normalisedPoints);
  const minReliablePoints = resetDetected
    ? CONFIG.alerts.minTrendDataPoints + 1
    : CONFIG.alerts.minTrendDataPoints;
  const isReliable = points.length >= minReliablePoints;

  if (!isReliable) {
    return {
      velocityPerHour: 0,
      estimatedSelloutMs: null,
      isAccelerating: false,
      projectedSellThrough: null,
      projectedTicketsSold: null,
      dataPoints: points.length,
      isReliable: false,
      resetDetected,
    };
  }

  // Calculate overall velocity (last snapshot vs first)
  const msPerHour = 60 * 60 * 1000;
  const overallVelocity = calculateVelocity(points);

  const midpoint = Math.max(1, Math.floor(points.length / 2));
  const earlyVelocity = calculateVelocity(points.slice(0, midpoint + 1));
  const recentVelocity = calculateVelocity(points.slice(midpoint));
  const latestVelocity = calculateVelocity(points.slice(-2));
  const velocityPerHour = Math.max(0, overallVelocity, recentVelocity, latestVelocity);
  const isAccelerating = recentVelocity > earlyVelocity * 1.2;

  const scrapeAt = new Date(comp.scrapedAt).getTime();
  const drawAt = comp.drawDate === null
    ? Number.NaN
    : new Date(comp.drawDate).getTime();
  const scrapeToDrawMs = Number.isFinite(scrapeAt) && Number.isFinite(drawAt)
    ? drawAt - scrapeAt
    : null;
  const evaluationAt = Number.isFinite(drawAt) &&
      typeof comp.timeToClose === "number" &&
      Number.isFinite(comp.timeToClose)
    ? drawAt - comp.timeToClose
    : Number.NaN;
  const elapsedSinceScrapeMs = Number.isFinite(scrapeAt) && Number.isFinite(evaluationAt)
    ? Math.max(0, evaluationAt - scrapeAt)
    : 0;

  // Estimate time to sellout
  const remaining = comp.maxTickets - comp.ticketsSold;
  const activeVelocity = velocityPerHour;
  const estimatedSelloutMs =
    activeVelocity > 0
      ? Math.max(0, (remaining / activeVelocity) * msPerHour - elapsedSinceScrapeMs)
      : null;

  // Project sell-through at draw time
  let projectedSellThrough: number | null = null;
  let projectedTicketsSold: number | null = null;
  if (scrapeToDrawMs !== null && scrapeToDrawMs > 0 && comp.maxTickets > 0) {
    const hoursToClose = scrapeToDrawMs / msPerHour;
    const projectedAdditionalSales = Math.ceil(activeVelocity * hoursToClose);
    projectedTicketsSold = Math.max(
      comp.ticketsSold,
      Math.min(comp.maxTickets, comp.ticketsSold + projectedAdditionalSales),
    );
    projectedSellThrough = projectedTicketsSold / comp.maxTickets;
  }

  return {
    velocityPerHour,
    estimatedSelloutMs,
    isAccelerating,
    projectedSellThrough,
    projectedTicketsSold,
    dataPoints: points.length,
    isReliable: true,
    resetDetected,
  };
}

function calculateVelocity(snapshots: Snapshot[]): number {
  if (snapshots.length < 2) return 0;
  const msPerHour = 60 * 60 * 1000;
  let elapsedMs = 0;
  let sold = 0;

  for (let index = 1; index < snapshots.length; index++) {
    const previous = snapshots[index - 1]!;
    const current = snapshots[index]!;
    const intervalMs = new Date(current.scrapedAt).getTime() - new Date(previous.scrapedAt).getTime();
    if (intervalMs <= 0) continue;
    elapsedMs += intervalMs;
    const delta = current.ticketsSold - previous.ticketsSold;
    if (delta > 0) sold += delta;
  }

  return elapsedMs > 0 ? (sold / elapsedMs) * msPerHour : 0;
}

function normaliseSnapshots(comp: Competition, snapshots: Snapshot[]): Snapshot[] {
  const currentAt = new Date(comp.scrapedAt).getTime();
  const earliestAllowedAt = Number.isFinite(currentAt)
    ? currentAt - CONFIG.alerts.maxTrendAgeMs
    : -Infinity;
  const points = snapshots
    .filter((snapshot) => {
      const snapshotAt = new Date(snapshot.scrapedAt).getTime();
      return snapshot.inventorySource === "exact" &&
        snapshot.drawDate === comp.drawDate &&
        snapshot.maxTickets === comp.maxTickets &&
        Number.isFinite(snapshotAt) &&
        snapshotAt >= earliestAllowedAt &&
        (!Number.isFinite(currentAt) || snapshotAt < currentAt);
    })
    .sort((a, b) => new Date(a.scrapedAt).getTime() - new Date(b.scrapedAt).getTime())
    .filter((point, index, sorted) => index === sorted.length - 1 ||
      Date.parse(point.scrapedAt) !== Date.parse(sorted[index + 1]!.scrapedAt))
    .slice(-CONFIG.alerts.maxTrendSnapshots);
  const lastAt = points.length > 0
    ? new Date(points[points.length - 1]!.scrapedAt).getTime()
    : -Infinity;

  if (
    comp.inventorySource === "exact" &&
    Number.isFinite(currentAt) &&
    currentAt > lastAt
  ) {
    points.push({
      id: -1,
      sourceId: comp.sourceId,
      siteName: comp.siteName,
      ticketsSold: comp.ticketsSold,
      maxTickets: comp.maxTickets,
      drawDate: comp.drawDate,
      inventorySource: "exact",
      scrapedAt: comp.scrapedAt,
    });
  }

  return points;
}

function latestMonotonicSegment(points: Snapshot[]): {
  points: Snapshot[];
  resetDetected: boolean;
} {
  let resetAt = -1;
  for (let index = 1; index < points.length; index++) {
    if (points[index]!.ticketsSold < points[index - 1]!.ticketsSold) {
      resetAt = index;
    }
  }

  return resetAt >= 0
    ? { points: points.slice(resetAt), resetDetected: true }
    : { points, resetDetected: false };
}
