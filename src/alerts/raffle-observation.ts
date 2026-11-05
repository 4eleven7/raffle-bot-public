import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../config.js";
import { gradeRaffle } from "../metrics/decision.js";
import { analyzeTrend, type TrendAnalysis } from "../metrics/trends.js";
import type {
  Competition,
  EntryRecommendation,
  RawCompetition,
  SiteScanStatus,
} from "../types.js";
import { canonicalCompetitionUrl } from "./canonical-url.js";

const LEDGER_TIMEZONE = "Europe/London";
const SCHEMA_VERSION = "1";
const RECENTLY_CLOSED_GRACE_MS = 6 * 60 * 60 * 1000;

export interface RaffleCloseObservation {
  canonicalUrl: string;
  siteName: string;
  sourceId: string;
  name: string;
  url: string;
  scrapedAt: string;
  drawDate: string;
  timeToCloseMs: number;
  entryPrice: number;
  ticketsSold: number;
  maxTickets: number;
  inventorySource: "exact" | "estimated" | "unknown";
  maxEntriesPerUser: number;
  maxEntriesPerUserSource: string | null;
  cashAlternative: number | null;
  estimatedPrizeValue: number | null;
  valuationSource: string | null;
  valuationConfidence: string | null;
  recommendation: EntryRecommendation;
  trend: TrendAnalysis;
  decisionCoverageExpected: boolean;
  presentAfterScheduledClose: boolean;
  soldOutObserved: boolean;
}

export interface DrawDateChange {
  canonicalUrl: string;
  sourceId: string;
  previousDrawDate: string;
  currentDrawDate: string;
  deltaMs: number;
}

export interface MissingCloseObservation {
  canonicalUrl: string;
  sourceId: string;
  name: string;
  url: string;
  previousDrawDate: string;
  previousScrapedAt: string;
}

export interface RaffleObservationBatch {
  schemaVersion: typeof SCHEMA_VERSION;
  phase: "raffle_observation";
  ledgerTimezone: typeof LEDGER_TIMEZONE;
  evaluationId: string;
  recordedAt: string;
  siteName: string;
  scanStatus: SiteScanStatus;
  observationWindowMs: number;
  competitions: RaffleCloseObservation[];
  drawDateChanges: DrawDateChange[];
  missingFromSuccessfulScan: MissingCloseObservation[];
}

export interface BuildRaffleObservationInput {
  evaluationId: string;
  siteName: string;
  scanStatus: SiteScanStatus;
  observedAt: Date;
  current: Competition[];
  previous: RawCompetition[];
  /** False when current rows are stored fallback data that bypassed alert evaluation. */
  decisionCoverageExpected?: boolean;
  observationWindowMs?: number;
  trendFor?: (competition: Competition) => TrendAnalysis;
}

export function buildRaffleObservationBatch(
  input: BuildRaffleObservationInput,
): RaffleObservationBatch {
  if (!Number.isFinite(input.observedAt.getTime())) {
    throw new RangeError("raffle observation timestamp must be valid");
  }
  const observationWindowMs = input.observationWindowMs ??
    CONFIG.alerts.raffleObservationWindowMs;
  if (!Number.isFinite(observationWindowMs) || observationWindowMs <= 0) {
    throw new RangeError("raffle observation window must be greater than zero");
  }
  const trendFor = input.trendFor ?? analyzeTrend;
  const previousByIdentity = new Map(
    input.previous.map((competition) => [
      sourceIdentity(competition),
      competition,
    ]),
  );
  const currentIdentities = new Set(
    input.current.map((competition) => sourceIdentity(competition)),
  );
  const drawDateChanges = input.current.flatMap((competition) => {
    const previous = previousByIdentity.get(sourceIdentity(competition));
    if (!previous?.drawDate || !competition.drawDate) return [];
    if (previous.drawDate === competition.drawDate) return [];
    const previousTime = new Date(previous.drawDate).getTime();
    const currentTime = new Date(competition.drawDate).getTime();
    if (!Number.isFinite(previousTime) || !Number.isFinite(currentTime)) return [];
    return [{
      canonicalUrl: canonicalCompetitionUrl(competition.url),
      sourceId: competition.sourceId,
      previousDrawDate: previous.drawDate,
      currentDrawDate: competition.drawDate,
      deltaMs: currentTime - previousTime,
    }];
  });

  const competitions = input.current
    .filter((competition) =>
      isInsideObservationWindow(
        competition.drawDate,
        input.observedAt,
        observationWindowMs,
      )
    )
    .map((competition): RaffleCloseObservation => {
      const drawDate = competition.drawDate!;
      const drawTime = new Date(drawDate).getTime();
      const timeToCloseMs = drawTime - input.observedAt.getTime();
      const trend = trendFor(competition);
      return {
        canonicalUrl: canonicalCompetitionUrl(competition.url),
        siteName: competition.siteName,
        sourceId: competition.sourceId,
        name: competition.name,
        url: competition.url,
        scrapedAt: competition.scrapedAt,
        drawDate,
        timeToCloseMs,
        entryPrice: competition.entryPrice,
        ticketsSold: competition.ticketsSold,
        maxTickets: competition.maxTickets,
        inventorySource: competition.inventorySource ?? "unknown",
        maxEntriesPerUser: competition.maxEntriesPerUser,
        maxEntriesPerUserSource: competition.maxEntriesPerUserSource ?? null,
        cashAlternative: competition.cashAlternative,
        estimatedPrizeValue: competition.estimatedPrizeValue ?? null,
        valuationSource: competition.valuationSource ?? null,
        valuationConfidence: competition.valuationConfidence ?? null,
        recommendation: gradeRaffle(competition, trend),
        trend,
        decisionCoverageExpected: input.decisionCoverageExpected ?? (
          (input.scanStatus === "success" || input.scanStatus === "partial") &&
          timeToCloseMs > 0 &&
          timeToCloseMs <= CONFIG.alerts.notificationWindowMs
        ),
        presentAfterScheduledClose: timeToCloseMs <= 0,
        soldOutObserved:
          competition.maxTickets > 0 &&
          competition.ticketsSold >= competition.maxTickets,
      };
    });

  const missingFromSuccessfulScan =
      (input.scanStatus === "success" || input.scanStatus === "empty")
    ? input.previous
        .filter((competition) =>
          !currentIdentities.has(sourceIdentity(competition)) &&
          isInsideObservationWindow(
            competition.drawDate,
            input.observedAt,
            observationWindowMs,
          ) &&
          isRecentlyObserved(competition, input.observedAt)
        )
        .map((competition): MissingCloseObservation => ({
          canonicalUrl: canonicalCompetitionUrl(competition.url),
          sourceId: competition.sourceId,
          name: competition.name,
          url: competition.url,
          previousDrawDate: competition.drawDate!,
          previousScrapedAt: competition.scrapedAt,
        }))
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    phase: "raffle_observation",
    ledgerTimezone: LEDGER_TIMEZONE,
    evaluationId: input.evaluationId,
    recordedAt: input.observedAt.toISOString(),
    siteName: input.siteName,
    scanStatus: input.scanStatus,
    observationWindowMs,
    competitions,
    drawDateChanges,
    missingFromSuccessfulScan,
  };
}

export function appendRaffleObservationBatch(
  batch: RaffleObservationBatch,
  directory: string,
): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${londonDate(new Date(batch.recordedAt))}.jsonl`);
  appendFileSync(path, `${JSON.stringify(batch)}\n`, "utf8");
  return path;
}

function sourceIdentity(
  competition: Pick<RawCompetition, "siteName" | "sourceId">,
): string {
  return `${competition.siteName}\u0000${competition.sourceId}`;
}

function isInsideObservationWindow(
  drawDate: string | null,
  observedAt: Date,
  observationWindowMs: number,
): boolean {
  if (!drawDate) return false;
  const drawTime = new Date(drawDate).getTime();
  if (!Number.isFinite(drawTime)) return false;
  const delta = drawTime - observedAt.getTime();
  return delta >= -RECENTLY_CLOSED_GRACE_MS && delta <= observationWindowMs;
}

function isRecentlyObserved(
  competition: RawCompetition,
  observedAt: Date,
): boolean {
  const scrapedAt = new Date(competition.scrapedAt).getTime();
  return Number.isFinite(scrapedAt) &&
    observedAt.getTime() - scrapedAt <= CONFIG.filters.maxStoredCompetitionAgeMs;
}

function londonDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LEDGER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
