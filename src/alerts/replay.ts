import { enrichCompetitionAt } from "../metrics/calculator.js";
import type { TrendAnalysis } from "../metrics/trends.js";
import type { RawCompetition, StarRating } from "../types.js";
import {
  processEntryCandidates,
  type AlertDecisionRecord,
} from "./buy-review.js";
import type {
  TelegramOpportunityAvailability,
  TelegramOpportunityOutcome,
  TelegramOpportunityRoute,
} from "./telegram.js";

export type AlertReplayClassification =
  | "alerted_as_expected"
  | "skipped_as_expected"
  | "missed_alert"
  | "skipped_but_should_alert"
  | "alerted_but_should_skip";

export interface AlertReplayExpectation {
  shouldAlert: boolean;
  classification: AlertReplayClassification;
  outcome?: string;
  stage?: "entry-window" | null;
  route?: TelegramOpportunityRoute | null;
  stars?: StarRating;
  reviewerDecision?: "approve" | "reject" | "uncertain" | "error" | null;
  deterministicReasonIncludes?: string;
  timeToCloseMs?: number;
  closeToleranceMs?: number;
}

export interface AlertReplayScenario {
  id: string;
  kind: "policy" | "regression" | "classification_probe";
  description: string;
  observedAt: string;
  evaluationDelayMs?: number;
  competition: RawCompetition;
  trend?: TrendAnalysis | null;
  reviewer?: {
    decision: "approve" | "reject" | "uncertain" | "error";
    reason: string;
  };
  telegram?: {
    availability?: TelegramOpportunityAvailability;
    outcome?: TelegramOpportunityOutcome;
  };
  expected: AlertReplayExpectation;
}

export interface AlertReplayDataset {
  version: 1;
  name: string;
  scenarios: AlertReplayScenario[];
}

export interface AlertReplayResult {
  id: string;
  kind: AlertReplayScenario["kind"];
  description: string;
  passed: boolean;
  failures: string[];
  classification: AlertReplayClassification;
  shouldAlert: boolean;
  outcome: string;
  stage: "entry-window" | null;
  route: TelegramOpportunityRoute | null;
  stars: StarRating | null;
  deterministicReason: string | null;
  timing: {
    observedAt: string;
    scrapedAt: string;
    drawDate: string | null;
    timeToCloseMs: number;
    closeErrorMs: number | null;
  };
  decision: AlertDecisionRecord | null;
}

export interface AlertReplayReport {
  dataset: string;
  total: number;
  passed: number;
  failed: number;
  classifications: Record<AlertReplayClassification, number>;
  results: AlertReplayResult[];
}

const CLASSIFICATIONS: AlertReplayClassification[] = [
  "alerted_as_expected",
  "skipped_as_expected",
  "missed_alert",
  "skipped_but_should_alert",
  "alerted_but_should_skip",
];

export function parseAlertReplayDataset(source: string): AlertReplayDataset {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(`alert replay dataset is not valid JSON: ${formatError(error)}`);
  }
  if (!isRecord(parsed) || parsed.version !== 1) {
    throw new TypeError("alert replay dataset version must be 1");
  }
  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new TypeError("alert replay dataset scenarios must be a non-empty array");
  }

  const ids = new Set<string>();
  for (const candidate of parsed.scenarios) {
    const id = isRecord(candidate) && typeof candidate.id === "string"
      ? candidate.id
      : "";
    if (!id) throw new TypeError("every alert replay scenario requires an id");
    if (ids.has(id)) throw new TypeError(`duplicate alert replay scenario id: ${id}`);
    ids.add(id);
  }

  const scenarios = parsed.scenarios.map((candidate) =>
    validateScenario(candidate)
  );
  return {
    version: 1,
    name: typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name
      : "synthetic alert replay",
    scenarios,
  };
}

export async function runAlertReplayDataset(
  dataset: AlertReplayDataset,
): Promise<AlertReplayReport> {
  const results: AlertReplayResult[] = [];
  for (const scenario of dataset.scenarios) {
    results.push(await runAlertReplayScenario(scenario));
  }
  const classifications = Object.fromEntries(
    CLASSIFICATIONS.map((classification) => [
      classification,
      results.filter((result) => result.classification === classification).length,
    ]),
  ) as Record<AlertReplayClassification, number>;

  return {
    dataset: dataset.name,
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    classifications,
    results,
  };
}

export async function runAlertReplayScenario(
  scenario: AlertReplayScenario,
): Promise<AlertReplayResult> {
  const observedAt = new Date(scenario.observedAt);
  const competition = enrichCompetitionAt(scenario.competition, observedAt);
  const evaluationAt = new Date(
    observedAt.getTime() + (scenario.evaluationDelayMs ?? 0),
  );
  const trend = scenario.trend ?? unavailableTrend();
  const decisions = await processEntryCandidates(
    [competition],
    {
      evaluationId: `synthetic:${scenario.id}`,
      now: () => evaluationAt,
      analyzeTrend: () => trend,
      reviewer: async () => ({
        decision: scenario.reviewer?.decision ?? "approve",
        reason: scenario.reviewer?.reason ?? "synthetic reviewer approval",
        inputHash: `synthetic:${scenario.id}:review`,
        model: "synthetic",
        schemaVersion: "1",
      }),
      sender: async () => scenario.telegram?.outcome ?? "sent",
      availability: () => scenario.telegram?.availability ?? "ready",
      recordDecision: () => undefined,
      appendDecision: () => undefined,
      getCachedReview: () => null,
    },
  );
  const decision = decisions.at(-1) ?? null;
  const outcome = decision?.outcome ?? "no_decision";
  const classification = classifyAlertReplay(
    scenario.expected.shouldAlert,
    outcome,
  );
  const failures: string[] = [];

  if (scenario.expected.shouldAlert && outcome !== "sent") {
    failures.push(`expected an alert but outcome was ${outcome}`);
  }
  if (!scenario.expected.shouldAlert && outcome === "sent") {
    failures.push("expected no alert but outcome was sent");
  }

  compare(
    failures,
    "classification",
    classification,
    scenario.expected.classification,
  );
  if (scenario.expected.outcome !== undefined) {
    compare(failures, "outcome", outcome, scenario.expected.outcome);
  }
  if (scenario.expected.stage !== undefined) {
    compare(
      failures,
      "stage",
      decision?.stage ?? null,
      scenario.expected.stage,
    );
  }
  if (scenario.expected.route !== undefined) {
    compare(
      failures,
      "route",
      decision?.route ?? null,
      scenario.expected.route,
    );
  }
  if (scenario.expected.stars !== undefined) {
    compare(
      failures,
      "stars",
      decision?.recommendation?.stars ?? null,
      scenario.expected.stars,
    );
  }
  if (scenario.expected.reviewerDecision !== undefined) {
    compare(
      failures,
      "reviewerDecision",
      decision?.decision ?? null,
      scenario.expected.reviewerDecision,
    );
  }
  if (
    scenario.expected.deterministicReasonIncludes &&
    !decision?.deterministicReason?.includes(
      scenario.expected.deterministicReasonIncludes,
    )
  ) {
    failures.push(
      `deterministicReason does not include ${JSON.stringify(scenario.expected.deterministicReasonIncludes)}`,
    );
  }

  const expectedClose = scenario.expected.timeToCloseMs;
  const closeErrorMs = expectedClose === undefined
    ? null
    : competition.timeToClose === null
    ? Number.POSITIVE_INFINITY
    : competition.timeToClose - expectedClose;
  if (
    closeErrorMs !== null &&
    Math.abs(closeErrorMs) > (scenario.expected.closeToleranceMs ?? 0)
  ) {
    failures.push(
      `close error ${closeErrorMs}ms exceeds tolerance ${scenario.expected.closeToleranceMs ?? 0}ms`,
    );
  }

  return {
    id: scenario.id,
    kind: scenario.kind,
    description: scenario.description,
    passed: failures.length === 0,
    failures,
    classification,
    shouldAlert: scenario.expected.shouldAlert,
    outcome,
    stage: decision?.stage ?? null,
    route: decision?.route ?? null,
    stars: decision?.recommendation?.stars ?? null,
    deterministicReason: decision?.deterministicReason ?? null,
    timing: {
      observedAt: scenario.observedAt,
      scrapedAt: scenario.competition.scrapedAt,
      drawDate: scenario.competition.drawDate,
      timeToCloseMs: competition.timeToClose ?? Number.NaN,
      closeErrorMs,
    },
    decision,
  };
}

export function classifyAlertReplay(
  shouldAlert: boolean,
  outcome: string,
): AlertReplayClassification {
  if (outcome === "sent") {
    return shouldAlert ? "alerted_as_expected" : "alerted_but_should_skip";
  }
  if (!shouldAlert) return "skipped_as_expected";
  if (
    outcome === "no_decision" ||
    outcome === "failed" ||
    outcome === "suppressed_telegram_disabled" ||
    outcome === "jsonl_append_failed"
  ) {
    return "missed_alert";
  }
  return "skipped_but_should_alert";
}

function validateScenario(value: unknown): AlertReplayScenario {
  if (!isRecord(value)) throw new TypeError("alert replay scenario must be an object");
  const observedAt = typeof value.observedAt === "string"
    ? new Date(value.observedAt)
    : new Date(Number.NaN);
  if (!Number.isFinite(observedAt.getTime())) {
    throw new TypeError(`scenario ${String(value.id)} observedAt must be a valid ISO date`);
  }
  if (
    value.evaluationDelayMs !== undefined &&
    (typeof value.evaluationDelayMs !== "number" ||
      !Number.isFinite(value.evaluationDelayMs) ||
      value.evaluationDelayMs < 0)
  ) {
    throw new TypeError(`scenario ${String(value.id)} evaluationDelayMs must be a non-negative number`);
  }
  if (!isRawCompetition(value.competition)) {
    throw new TypeError(`scenario ${String(value.id)} competition is incomplete`);
  }
  if (!isTrendAnalysis(value.trend)) {
    if (value.trend !== undefined && value.trend !== null) {
      throw new TypeError(`scenario ${String(value.id)} trend is incomplete`);
    }
  }
  if (!isRecord(value.expected) || typeof value.expected.shouldAlert !== "boolean") {
    throw new TypeError(`scenario ${String(value.id)} expected.shouldAlert is required`);
  }
  if (
    typeof value.expected.classification !== "string" ||
    !CLASSIFICATIONS.includes(
      value.expected.classification as AlertReplayClassification,
    )
  ) {
    throw new TypeError(`scenario ${String(value.id)} expected.classification is invalid`);
  }
  if (
    value.expected.stars !== undefined &&
    ![0, 1, 2, 3].includes(value.expected.stars as number)
  ) {
    throw new TypeError(`scenario ${String(value.id)} expected.stars is invalid`);
  }
  if (
    value.expected.stage !== undefined &&
    value.expected.stage !== null &&
    value.expected.stage !== "entry-window"
  ) {
    throw new TypeError(`scenario ${String(value.id)} expected.stage must be entry-window`);
  }
  if (
    value.expected.route !== undefined &&
    value.expected.route !== null &&
    value.expected.route !== "entry"
  ) {
    throw new TypeError(`scenario ${String(value.id)} expected.route must be entry`);
  }
  if (
    value.kind !== "policy" &&
    value.kind !== "regression" &&
    value.kind !== "classification_probe"
  ) {
    throw new TypeError(`scenario ${String(value.id)} kind is invalid`);
  }
  return value as unknown as AlertReplayScenario;
}

function isRawCompetition(value: unknown): value is RawCompetition {
  return isRecord(value) &&
    typeof value.sourceId === "string" &&
    typeof value.siteName === "string" &&
    typeof value.url === "string" &&
    typeof value.name === "string" &&
    typeof value.entryPrice === "number" &&
    typeof value.ticketsSold === "number" &&
    typeof value.maxTickets === "number" &&
    typeof value.maxEntriesPerUser === "number" &&
    (typeof value.cashAlternative === "number" || value.cashAlternative === null) &&
    (typeof value.drawDate === "string" || value.drawDate === null) &&
    typeof value.isAutoDraw === "boolean" &&
    Array.isArray(value.categories) &&
    value.categories.every((category) => typeof category === "string") &&
    typeof value.scrapedAt === "string";
}

function isTrendAnalysis(value: unknown): value is TrendAnalysis {
  return isRecord(value) &&
    typeof value.velocityPerHour === "number" &&
    (typeof value.estimatedSelloutMs === "number" || value.estimatedSelloutMs === null) &&
    typeof value.isAccelerating === "boolean" &&
    (typeof value.projectedSellThrough === "number" ||
      value.projectedSellThrough === null) &&
    typeof value.dataPoints === "number" &&
    typeof value.isReliable === "boolean" &&
    typeof value.resetDetected === "boolean";
}

function unavailableTrend(): TrendAnalysis {
  return {
    velocityPerHour: 0,
    estimatedSelloutMs: null,
    isAccelerating: false,
    projectedSellThrough: null,
    dataPoints: 0,
    isReliable: false,
    resetDetected: false,
  };
}

function compare(
  failures: string[],
  field: string,
  actual: unknown,
  expected: unknown,
): void {
  if (actual !== expected) {
    failures.push(
      `${field} expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
