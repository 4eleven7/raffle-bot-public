import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { getPrizeValue } from "../metrics/calculator.js";
import { gradeRaffle, entryPolicyFor } from "../metrics/decision.js";
import { analyzeTrend, type TrendAnalysis } from "../metrics/trends.js";
import { isFreshEntryInventory } from "../cli/freshness.js";
import {
  getCachedAlertReview,
  recordAlertDecision,
  type StoredAlertDecision,
} from "../storage/database.js";
import type { Competition, EntryRecommendation } from "../types.js";
import { checkAlerts } from "./alerts.js";
import { canonicalCompetitionUrl } from "./canonical-url.js";
import {
  hashReviewInput,
  reviewAlertWithCodex,
  type CodexReviewResult,
} from "./codex-review.js";
import { appendAlertDecisionJsonl } from "./decision-log.js";
import {
  sendTelegramOpportunityDetailed,
  telegramOpportunityAvailability,
  type TelegramOpportunityAvailability,
  type TelegramOpportunityDispatchResult,
  type TelegramOpportunityOutcome,
  type TelegramOpportunityRoute,
} from "./telegram.js";

export { canonicalCompetitionUrl } from "./canonical-url.js";

export interface AlertDecisionRecord extends StoredAlertDecision {
  phase: "dispatch_intent" | "final";
  evaluationId: string;
  stage: "entry-window";
  canonicalUrl: string;
  aliases?: Array<{ siteName: string; sourceId: string; name: string; url: string }>;
  triggeredRules?: string[];
  deterministicReason?: string;
  decision?: "approve" | "reject" | "uncertain" | "error";
  reviewerReason?: string;
  reviewerIssues?: string[];
  reviewerModel?: string;
  reviewerSchemaVersion?: string;
  candidate?: Record<string, unknown>;
  recommendation?: EntryRecommendation;
  trend?: TrendAnalysis;
  dispatchOutcome?: TelegramOpportunityOutcome;
  dispatchError?: string;
  telegramChatId?: string;
  telegramMessageId?: number;
  route?: TelegramOpportunityRoute;
}

export interface EntryCandidateDependencies {
  evaluationId?: string;
  analyzeTrend?: (competition: Competition) => TrendAnalysis;
  reviewer?: (input: Record<string, unknown>) => Promise<CodexReviewResult>;
  sender?: (
    competition: Competition,
    recommendation: EntryRecommendation,
  ) => Promise<TelegramOpportunityOutcome | TelegramOpportunityDispatchResult>;
  availability?: (competition: Competition) => TelegramOpportunityAvailability;
  recordDecision?: (record: AlertDecisionRecord) => void;
  appendDecision?: (record: AlertDecisionRecord) => void;
  getCachedReview?: (inputHash: string) => StoredAlertDecision | null;
  now?: () => Date;
}

export async function processEntryCandidates(
  competitions: Competition[],
  dependencies: EntryCandidateDependencies = {},
): Promise<AlertDecisionRecord[]> {
  const now = dependencies.now ?? (() => new Date());
  const evaluationId = dependencies.evaluationId ?? randomUUID();
  const trendFor = dependencies.analyzeTrend ?? analyzeTrend;
  const reviewer = dependencies.reviewer ?? reviewAlertWithCodex;
  const sender = dependencies.sender ?? sendTelegramOpportunityDetailed;
  const availability = dependencies.availability ?? telegramOpportunityAvailability;
  const persist = dependencies.recordDecision ?? recordAlertDecision;
  const append = dependencies.appendDecision ?? ((record) => {
    appendAlertDecisionJsonl(record, CONFIG.alerts.decisionLogDir);
  });
  const cachedReview = dependencies.getCachedReview ?? ((inputHash) =>
    getCachedAlertReview(
      inputHash,
      CONFIG.alerts.reviewerCacheTtlMs,
      now(),
      CONFIG.alerts.reviewerRejectCacheTtlMs,
    ));
  const records: AlertDecisionRecord[] = [];
  const groups = [...groupCandidates(competitions)].sort((left, right) =>
    Number(isDirectVerifiedCash(latestCompetition(right[1]))) -
    Number(isDirectVerifiedCash(latestCompetition(left[1])))
  );

  for (const [canonicalUrl, aliases] of groups) {
    const evaluationTime = now();
    const entryWindowAliases = aliases.filter(isInEntryWindow);
    const selected = selectCompetitionForEvaluation(aliases, evaluationTime);
    if (!isInEntryWindow(selected)) {
      if (entryWindowAliases.length === 0) continue;
      const observed = latestCompetition(entryWindowAliases);
      const trend = trendFor(observed);
      const recommendation = checkAlerts(observed, trend, evaluationTime)[0]?.recommendation ??
        gradeRaffle(observed, trend);
      const record = createRecord({
        evaluationId,
        selected,
        canonicalUrl,
        aliases: entryWindowAliases
          .map(({ siteName, sourceId, name, url }) => ({ siteName, sourceId, name, url }))
          .sort((left, right) =>
            left.url.localeCompare(right.url) ||
            left.siteName.localeCompare(right.siteName) ||
            left.sourceId.localeCompare(right.sourceId)
          ),
        triggeredRules: recommendation.stars > 0 ? [recommendation.reason] : [],
        recordedAt: evaluationTime.toISOString(),
        outcome: "suppressed_stale_timing",
        deterministicReason: "entry window ended before evaluation",
        recommendation,
        trend,
        route: "entry",
      });
      commit(record, persist, append);
      records.push(record);
      continue;
    }
    const aliasRefs = aliases
      .map(({ siteName, sourceId, name, url }) => ({ siteName, sourceId, name, url }))
      .sort((left, right) =>
        left.url.localeCompare(right.url) ||
        left.siteName.localeCompare(right.siteName) ||
        left.sourceId.localeCompare(right.sourceId)
    );
    const trend = trendFor(selected);
    const freshInventory = isFreshEntryInventory(selected, evaluationTime);
    const recommendation = checkAlerts(selected, trend, evaluationTime)[0]?.recommendation ??
      gradeRaffle(selected, trend);
    const triggeredRules = recommendation.stars > 0 ? [recommendation.reason] : [];
    const recordedAt = evaluationTime.toISOString();

    if (!freshInventory) {
      const record = createRecord({
        evaluationId,
        selected,
        canonicalUrl,
        aliases: aliasRefs,
        triggeredRules,
        recordedAt,
        outcome: "suppressed_stale_inventory",
        deterministicReason: "entry inventory is stale or invalid",
        recommendation,
        trend,
        route: "entry",
      });
      commit(record, persist, append);
      records.push(record);
      continue;
    }

    if (recommendation.stars === 0) {
      const record = createRecord({
        evaluationId,
        selected,
        canonicalUrl,
        aliases: aliasRefs,
        triggeredRules,
        recordedAt,
        outcome: "suppressed_deterministic",
        deterministicReason: recommendation.reason,
        recommendation,
        trend,
      });
      commit(record, persist, append);
      records.push(record);
      continue;
    }

    const dispatchAvailability = availability(selected);
    if (dispatchAvailability !== "ready") {
      const record = createRecord({
        evaluationId,
        selected,
        canonicalUrl,
        aliases: aliasRefs,
        triggeredRules,
        recordedAt,
        outcome: dispatchAvailability === "cooldown"
          ? "suppressed_cooldown"
          : "suppressed_telegram_disabled",
        deterministicReason: recommendation.reason,
        recommendation,
        trend,
        route: "entry",
      });
      commit(record, persist, append);
      records.push(record);
      continue;
    }

    const review = isDirectVerifiedCash(selected)
      ? directCashApproval()
      : await getReview({
          selected,
          canonicalUrl,
          aliases: aliasRefs,
          recommendation,
          trend,
          reviewer,
          cachedReview,
        });

    if (review.decision !== "approve") {
      const record = createRecord({
        evaluationId,
        selected,
        canonicalUrl,
        aliases: aliasRefs,
        triggeredRules,
        recordedAt,
        outcome: "suppressed_reviewer",
        deterministicReason: recommendation.reason,
        recommendation,
        trend,
        review,
        route: "entry",
      });
      commit(record, persist, append);
      records.push(record);
      continue;
    }

    const dispatchTime = now();
    const dispatchCandidate = refreshCompetitionTiming(selected, dispatchTime);
    if (!isInEntryWindow(dispatchCandidate)) {
      const record = createRecord({
        evaluationId,
        selected: dispatchCandidate,
        canonicalUrl,
        aliases: aliasRefs,
        triggeredRules,
        recordedAt: dispatchTime.toISOString(),
        outcome: "suppressed_stale_timing",
        deterministicReason: "entry window ended during review",
        recommendation,
        trend,
        review,
        route: "entry",
      });
      commit(record, persist, append);
      records.push(record);
      continue;
    }
    if (!isFreshEntryInventory(dispatchCandidate, dispatchTime)) {
      const record = createRecord({
        evaluationId,
        selected: dispatchCandidate,
        canonicalUrl,
        aliases: aliasRefs,
        triggeredRules,
        recordedAt: dispatchTime.toISOString(),
        outcome: "suppressed_stale_inventory",
        deterministicReason: "entry inventory became stale during review",
        recommendation,
        trend,
        review,
        route: "entry",
      });
      commit(record, persist, append);
      records.push(record);
      continue;
    }

    const intent = {
      ...createRecord({
        evaluationId,
        selected: dispatchCandidate,
        canonicalUrl,
        aliases: aliasRefs,
        triggeredRules,
        recordedAt,
        outcome: "dispatching",
        deterministicReason: recommendation.reason,
        recommendation,
        trend,
        review,
        route: "entry",
      }),
      phase: "dispatch_intent" as const,
    };
    persist(intent);

    let dispatchResult: TelegramOpportunityDispatchResult;
    try {
      dispatchResult = normalizeDispatchResult(
        await sender(dispatchCandidate, recommendation),
      );
    } catch (error) {
      dispatchResult = { outcome: "failed", alertKey: "", error: errorMessage(error) };
    }
    const finalRecordedAt = now();
    const final = createRecord({
      evaluationId,
      selected: refreshCompetitionTiming(dispatchCandidate, finalRecordedAt),
      canonicalUrl,
      aliases: aliasRefs,
      triggeredRules,
      recordedAt: finalRecordedAt.toISOString(),
      outcome: dispatchResult.outcome,
      deterministicReason: recommendation.reason,
      recommendation,
      trend,
      review,
      dispatchOutcome: dispatchResult.outcome,
      dispatchResult,
      route: "entry",
    });
    commit(final, persist, append);
    records.push(final);
  }

  return records;
}

function groupCandidates(competitions: Competition[]): Map<string, Competition[]> {
  const groups = new Map<string, Competition[]>();
  for (const competition of competitions) {
    const key = canonicalCompetitionUrl(competition.url);
    const group = groups.get(key) ?? [];
    group.push(competition);
    groups.set(key, group);
  }
  return groups;
}

function isInEntryWindow(comp: Competition): boolean {
  return comp.timeToClose !== null &&
    comp.timeToClose > 0 &&
    comp.timeToClose <= CONFIG.alerts.notificationWindowMs;
}

function latestCompetition(competitions: Competition[]): Competition {
  return [...competitions].sort(
    (left, right) => new Date(right.scrapedAt).getTime() - new Date(left.scrapedAt).getTime(),
  )[0]!;
}

function selectCompetitionForEvaluation(
  competitions: Competition[],
  observedAt: Date,
): Competition {
  const refreshed = competitions.map((competition) =>
    refreshCompetitionTiming(competition, observedAt),
  );
  const inEntryWindow = refreshed.filter(isInEntryWindow);
  return latestCompetition(inEntryWindow.length > 0 ? inEntryWindow : refreshed);
}

function refreshCompetitionTiming(comp: Competition, observedAt: Date): Competition {
  const drawTime = comp.drawDate === null ? Number.NaN : new Date(comp.drawDate).getTime();
  return {
    ...comp,
    timeToClose: Number.isFinite(drawTime) ? drawTime - observedAt.getTime() : null,
  };
}

function isDirectVerifiedCash(comp: Competition): boolean {
  return (comp.cashAlternative ?? 0) > 0 &&
    comp.valuationSource === "cash" &&
    comp.valuationConfidence === "high";
}

function directCashApproval(): CodexReviewResult {
  return {
    decision: "approve",
    reason: "direct verified cash value",
    issues: [],
    model: "deterministic",
    schemaVersion: CONFIG.alerts.reviewerSchemaVersion,
  };
}

async function getReview({
  selected,
  canonicalUrl,
  aliases,
  recommendation,
  trend,
  reviewer,
  cachedReview,
}: {
  selected: Competition;
  canonicalUrl: string;
  aliases: Array<{ siteName: string; sourceId: string; name: string; url: string }>;
  recommendation: EntryRecommendation;
  trend: TrendAnalysis;
  reviewer: (input: Record<string, unknown>) => Promise<CodexReviewResult>;
  cachedReview: (inputHash: string) => StoredAlertDecision | null;
}): Promise<CodexReviewResult> {
  const input = buildReviewInput(selected, canonicalUrl, aliases, recommendation, trend);
  const inputHash = hashReviewInput(buildReviewCacheInput(input));
  const cached = cachedReview(inputHash);
  return cached
    ? cachedResult(cached, inputHash)
    : { ...await reviewer(input), inputHash };
}

function buildReviewInput(
  comp: Competition,
  canonicalUrl: string,
  aliases: Array<{ siteName: string; sourceId: string; name: string; url: string }>,
  recommendation: EntryRecommendation,
  trend: TrendAnalysis,
): Record<string, unknown> {
  return {
    stage: "entry-window",
    route: "entry",
    canonicalUrl,
    aliases,
    competition: {
      siteName: comp.siteName,
      sourceId: comp.sourceId,
      title: comp.name,
      prizeDescription: comp.prizeDescription,
      prizeEvidence: comp.prizeEvidence,
      prizePayout: comp.prizePayout,
      url: comp.url,
      categories: comp.categories,
      entryPrice: comp.entryPrice,
      ticketsSold: comp.ticketsSold,
      maxTickets: comp.maxTickets,
      maxEntriesPerUser: comp.maxEntriesPerUser,
      maxEntriesPerUserSource: comp.maxEntriesPerUserSource ?? null,
      inventorySource: comp.inventorySource ?? "unknown",
      drawDate: comp.drawDate,
      timeToCloseMs: comp.timeToClose,
    },
    valuation: {
      value: getPrizeValue(comp),
      cashAlternative: comp.cashAlternative,
      estimatedPrizeValue: comp.estimatedPrizeValue ?? null,
      source: comp.valuationSource ?? null,
      confidence: comp.valuationConfidence ?? null,
      notes: comp.valuationNotes ?? null,
    },
    recommendation,
    trend,
  };
}

function buildReviewCacheInput(input: Record<string, unknown>): Record<string, unknown> {
  const competition = input.competition as Record<string, unknown>;
  return {
    canonicalUrl: input.canonicalUrl,
    valuation: input.valuation,
    title: competition.title,
    categories: competition.categories,
    prizeDescription: competition.prizeDescription,
    prizeEvidence: competition.prizeEvidence,
    prizePayout: competition.prizePayout,
  };
}

export async function preReviewPrizeValues(
  competitions: Competition[],
  trendFor: (comp: Competition) => TrendAnalysis,
  reviewer = reviewAlertWithCodex,
  now = new Date(),
): Promise<void> {
  let reviewed = 0;
  for (const comp of competitions) {
    if (reviewed >= 1) break;
    if (!CONFIG.alerts.reviewerEnabled || isDirectVerifiedCash(comp) || !comp.prizeDescription ||
        comp.timeToClose === null || comp.timeToClose <= CONFIG.alerts.notificationWindowMs ||
        comp.timeToClose > CONFIG.alerts.reviewerCacheTtlMs || !isFreshEntryInventory(comp, now)) continue;
    const trend = trendFor(comp);
    const recommendation = gradeRaffle(comp, trend);
    if (recommendation.stars === 0) continue;
    const canonicalUrl = canonicalCompetitionUrl(comp.url);
    const aliases = [{siteName: comp.siteName, sourceId: comp.sourceId, name: comp.name, url: comp.url}];
    const input = buildReviewInput(comp, canonicalUrl, aliases, recommendation, trend);
    const inputHash = hashReviewInput(buildReviewCacheInput(input));
    if (getCachedAlertReview(inputHash, CONFIG.alerts.reviewerCacheTtlMs, now, CONFIG.alerts.reviewerRejectCacheTtlMs)) continue;
    const review = await reviewer(input);
    recordAlertDecision({
      stage: "valuation-preflight", outcome: "valuation_review", recordedAt: new Date().toISOString(),
      inputHash, decision: review.decision, reviewerReason: review.reason,
      reviewerIssues: review.issues, reviewerModel: review.model, reviewerSchemaVersion: review.schemaVersion,
    });
    reviewed++;
  }
}

function createRecord({
  evaluationId,
  selected,
  canonicalUrl,
  aliases,
  triggeredRules,
  recordedAt,
  outcome,
  deterministicReason,
  recommendation,
  trend,
  review,
  dispatchOutcome,
  dispatchResult,
  route,
}: {
  evaluationId: string;
  selected: Competition;
  canonicalUrl: string;
  aliases: Array<{ siteName: string; sourceId: string; name: string; url: string }>;
  triggeredRules: string[];
  recordedAt: string;
  outcome: string;
  deterministicReason: string;
  recommendation: EntryRecommendation;
  trend: TrendAnalysis;
  review?: CodexReviewResult;
  dispatchOutcome?: TelegramOpportunityOutcome;
  dispatchResult?: TelegramOpportunityDispatchResult;
  route?: TelegramOpportunityRoute;
}): AlertDecisionRecord {
  return {
    phase: "final",
    evaluationId,
    stage: "entry-window",
    canonicalUrl,
    aliases,
    triggeredRules,
    recordedAt,
    outcome,
    inputHash: review?.inputHash,
    decision: review?.decision,
    reviewerReason: review?.reason,
    reviewerIssues: review?.issues,
    reviewerModel: review?.model,
    reviewerSchemaVersion: review?.schemaVersion,
    deterministicReason,
    recommendation,
    trend,
    dispatchOutcome,
    dispatchError: dispatchResult?.error,
    telegramChatId: dispatchResult?.chatId,
    telegramMessageId: dispatchResult?.messageId,
    route,
    policy: { ...CONFIG.filters, ...entryPolicyFor(recommendation) },
    constraints: {
      affordableTickets: Math.floor(entryPolicyFor(recommendation).maxSpend / selected.entryPrice),
      operatorTicketLimit: selected.maxEntriesPerUserSource === "site" ? selected.maxEntriesPerUser : 1,
      operatorLimitVerified: selected.maxEntriesPerUserSource === "site",
      remainingTickets: selected.maxTickets - selected.ticketsSold,
      reliableForecast: trend?.isReliable ?? false,
    },
    candidate: {
      ...selected,
      siteName: selected.siteName,
      sourceId: selected.sourceId,
      name: selected.name,
      url: selected.url,
      entryPrice: selected.entryPrice,
      ticketsSold: selected.ticketsSold,
      maxTickets: selected.maxTickets,
      inventorySource: selected.inventorySource ?? "unknown",
      maxEntriesPerUser: selected.maxEntriesPerUser,
      maxEntriesPerUserSource: selected.maxEntriesPerUserSource ?? null,
      cashAlternative: selected.cashAlternative,
      estimatedPrizeValue: selected.estimatedPrizeValue ?? null,
      valuationSource: selected.valuationSource ?? null,
      valuationConfidence: selected.valuationConfidence ?? null,
      valuationNotes: selected.valuationNotes ?? null,
      drawDate: selected.drawDate,
      scrapedAt: selected.scrapedAt,
      timeToClose: selected.timeToClose,
    },
  };
}

function commit(
  record: AlertDecisionRecord,
  persist: (record: AlertDecisionRecord) => void,
  append: (record: AlertDecisionRecord) => void,
): void {
  persist(record);
  try {
    append(record);
  } catch (error) {
    console.warn(`Could not append alert review JSONL: ${errorMessage(error)}`);
    persist({
      ...record,
      recordedAt: new Date().toISOString(),
      outcome: "jsonl_append_failed",
    });
  }
}

function cachedResult(record: StoredAlertDecision, inputHash: string): CodexReviewResult {
  return {
    decision: record.decision === "approve" ? "approve" : record.decision === "reject" ? "reject" : record.decision === "error" ? "error" : "uncertain",
    reason: typeof record.reviewerReason === "string"
      ? record.reviewerReason
      : "cached Codex review",
    issues: Array.isArray(record.reviewerIssues)
      ? record.reviewerIssues.filter((issue): issue is string => typeof issue === "string")
      : [],
    inputHash,
    model: typeof record.reviewerModel === "string" ? record.reviewerModel : "codex-cli",
    schemaVersion: typeof record.reviewerSchemaVersion === "string"
      ? record.reviewerSchemaVersion
      : CONFIG.alerts.reviewerSchemaVersion,
  };
}

function normalizeDispatchResult(
  result: TelegramOpportunityOutcome | TelegramOpportunityDispatchResult,
): TelegramOpportunityDispatchResult {
  return typeof result === "string" ? { outcome: result, alertKey: "" } : result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "unknown error");
}
