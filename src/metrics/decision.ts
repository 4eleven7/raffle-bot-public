import { CONFIG } from "../config.js";
import type { EntryRecommendation, Competition, RawCompetition, StarRating, TicketScenario } from "../types.js";
import type { TrendAnalysis } from "./trends.js";
import { calculateOptimalScenario, calculateScenario, enrichCompetitionAt, getPrizeValue } from "./calculator.js";

export type { EntryRecommendation, StarRating } from "../types.js";

type EntryPolicy = Pick<typeof CONFIG.filters, "maxSpend" | "minWinProbability" | "minReturnRatio">;

export function gradeRaffle(
  comp: Competition,
  trend: TrendAnalysis | null = null,
): EntryRecommendation {
  return selectEntryCategory(comp, trend, false);
}

export function gradeHighChanceRaffle(comp: Competition, trend: TrendAnalysis | null = null): EntryRecommendation {
  return evaluateRaffle(comp, trend, false);
}

function selectEntryCategory(comp: Competition, trend: TrendAnalysis | null, optimistic: boolean): EntryRecommendation {
  const highChance = evaluateRaffle(comp, trend, optimistic);
  if (highChance.stars > 0 || !CONFIG.valueOpportunities.enabled) return highChance;
  const value = evaluateRaffle(comp, trend, optimistic, CONFIG.valueOpportunities);
  if (value.stars === 0) return highChance;
  return Object.freeze({ ...value, category: "value", stars: 1,
    reason: `value entry: ${value.reason}` });
}

export function entryPolicyFor(recommendation: EntryRecommendation): EntryPolicy {
  return recommendation.category === "value" ? CONFIG.valueOpportunities : CONFIG.filters;
}

/** Discovery upper bound only. Never supply this result to entry delivery. */
export function evaluateRafflePotential(raw: RawCompetition, now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid potential observation time");
  const drawAt = raw.drawDate === null ? NaN : Date.parse(raw.drawDate);
  const observedAt = new Date(Number.isFinite(drawAt)
    ? Math.max(now.getTime(), drawAt - 23 * 60 * 60 * 1000)
    : now.getTime());
  const recommendation = selectEntryCategory(enrichCompetitionAt(raw, observedAt), null, true);
  return {
    assumption: "no further ticket sales" as const,
    observedAt: observedAt.toISOString(),
    recommendation,
    score: scoreRecommendation(recommendation),
  };
}

function evaluateRaffle(
  comp: Competition,
  trend: TrendAnalysis | null,
  optimistic: boolean,
  policy: EntryPolicy = CONFIG.filters,
): EntryRecommendation {
  const reject = (reason: string): EntryRecommendation => recommendation(
    0,
    emptyScenario(),
    null,
    null,
    reason,
  );

  if (!Number.isFinite(policy.maxSpend) || policy.maxSpend <= 0 ||
      !Number.isFinite(policy.minWinProbability) || policy.minWinProbability <= 0 || policy.minWinProbability > 1 ||
      !Number.isFinite(policy.minReturnRatio) || policy.minReturnRatio < 0) return reject("invalid entry policy");

  if (comp.timeToClose === null || !Number.isFinite(comp.timeToClose) ||
      comp.drawDate === null || !Number.isFinite(Date.parse(comp.drawDate))) return reject("unknown close");
  if (comp.timeToClose <= 0) return reject("closed");
  if (comp.timeToClose > CONFIG.filters.actionableWindowMs) return reject("not soon enough");
  if (comp.inventorySource !== "exact") return reject("ticket inventory is not exact");
  if (!Number.isSafeInteger(comp.maxTickets) || !Number.isSafeInteger(comp.ticketsSold) ||
      comp.maxTickets <= 0 || comp.ticketsSold < 0 || comp.ticketsSold >= comp.maxTickets) {
    return reject("invalid ticket inventory");
  }
  if (!Number.isFinite(comp.entryPrice)) return reject("invalid entry price");
  const excluded = excludedRaffleReason(comp);
  if (excluded) return reject(excluded);
  if (comp.prizePayout?.kind === "conditional") return reject("prize payout depends on sales or reserve");
  if (!hasCrediblePrizeValue(comp)) return reject("prize valuation is not reliable");

  const hasVerifiedCap = comp.maxEntriesPerUserSource === "site";
  if (hasVerifiedCap && (!Number.isSafeInteger(comp.maxEntriesPerUser) || comp.maxEntriesPerUser <= 0)) {
    return reject("invalid entry cap");
  }
  const hasReliableTrend = trend?.isReliable === true &&
    trend.dataPoints >= CONFIG.alerts.minTrendDataPoints && trend.projectedSellThrough !== null;
  if (hasReliableTrend && (!Number.isFinite(trend.projectedSellThrough) ||
      trend.projectedSellThrough! < 0 || trend.projectedSellThrough! > 1)) {
    return reject("invalid sales projection");
  }
  if (hasReliableTrend && trend.projectedTicketsSold != null &&
      (!Number.isSafeInteger(trend.projectedTicketsSold) ||
       trend.projectedTicketsSold < 0 || trend.projectedTicketsSold > comp.maxTickets)) {
    return reject("invalid sales projection");
  }
  // Without a forecast, require the same stake to pass even if all tickets sell.
  const useForecast = hasReliableTrend &&
    !(trend.estimatedSelloutMs !== null && trend.estimatedSelloutMs <= comp.timeToClose);
  const projectedSellThrough = optimistic ? comp.ticketsSold / comp.maxTickets : useForecast
    ? trend.projectedSellThrough!
    : 1;
  // Older saved forecasts contain only a ratio. Remove floating-point round-trip noise.
  const legacySold = comp.maxTickets * projectedSellThrough;
  const projectedSold = Math.min(
    comp.maxTickets,
    Math.max(comp.ticketsSold, optimistic ? comp.ticketsSold : useForecast
      ? trend.projectedTicketsSold ?? Math.ceil(legacySold - Math.min(0.25, 2 * Number.EPSILON * legacySold))
      : comp.maxTickets),
  );
  const entry = calculateOptimalScenario(comp, projectedSold, policy, policy.maxSpend);
  // If no permitted stake passes, retain the unconstrained plan only to explain its rejection.
  const tickets = entry.tickets > 0 ? entry.tickets : calculateOptimalScenario(comp, comp.ticketsSold, undefined, policy.maxSpend).tickets;
  const currentScenario = calculateScenario(comp, tickets);
  const projectedScenario = calculateScenario({
    ...comp, ticketsSold: Math.min(projectedSold, comp.maxTickets - tickets),
  }, tickets);
  const currentRejection = scenarioRejection(currentScenario, policy);
  if (currentRejection) return reject(currentRejection);
  const projectedRejection = scenarioRejection(projectedScenario, policy);
  if (projectedRejection) return reject(`at draw: ${projectedRejection}`);

  if (optimistic) {
    return recommendation(1, currentScenario, projectedScenario, projectedSellThrough,
      "optimistic potential only; assumes no further ticket sales");
  }

  if (!hasVerifiedCap || !hasReliableTrend) {
    return recommendation(1, currentScenario, projectedScenario, projectedSellThrough,
      !hasVerifiedCap ? "one-ticket entry; operator cap unverified" : "entry passes at full sell-through");
  }

  const stars: StarRating =
    projectedScenario.winProbability >= CONFIG.alerts.buyMinWinProbability &&
      projectedScenario.returnRatio >= CONFIG.alerts.buyMinReturnRatio
      ? 3
      : 2;
  return recommendation(
    stars,
    currentScenario,
    projectedScenario,
    projectedSellThrough,
    stars === 3 ? "strong projected entry" : "positive current and projected entry",
  );
}

export function isActionableRaffle(comp: Competition, trend: TrendAnalysis | null = null): boolean {
  return gradeRaffle(comp, trend).stars > 0;
}

function scenarioRejection(scenario: TicketScenario, policy: EntryPolicy): string | null {
  const finiteExceptReturnRatio = Object.entries(scenario)
    .every(([key, value]) => key === "returnRatio" || Number.isFinite(value));
  if (finiteExceptReturnRatio && (scenario.tickets <= 0 || scenario.cost <= 0)) {
    return "no positive stake";
  }
  if (!Object.values(scenario).every(Number.isFinite)) return "invalid entry maths";
  if (scenario.netEV <= 0) return "negative EV";
  if (scenario.cost > policy.maxSpend) return `stake > £${policy.maxSpend}`;
  if (scenario.winProbability < policy.minWinProbability) return "too unlikely";
  if (scenario.returnRatio < policy.minReturnRatio) return "not enough upside";
  return null;
}

function hasCrediblePrizeValue(comp: Competition): boolean {
  if (!Number.isFinite(getPrizeValue(comp)) || getPrizeValue(comp) <= 0) return false;
  if ((comp.cashAlternative ?? 0) > 0) {
    return comp.valuationSource === "cash" && comp.valuationConfidence === "high";
  }
  return (
    (comp.valuationSource === "site_estimate" ||
      comp.valuationSource === "manual_estimate" ||
      comp.valuationSource === "llm_estimate") &&
    (comp.valuationConfidence === "high" || comp.valuationConfidence === "medium")
  );
}

function emptyScenario(): TicketScenario {
  return {
    tickets: 0,
    cost: 0,
    winProbability: 0,
    lossProbability: 1,
    expectedReturn: 0,
    netEV: 0,
    returnRatio: 0,
  };
}

function recommendation(
  stars: StarRating,
  currentScenario: TicketScenario,
  projectedScenario: TicketScenario | null,
  projectedSellThrough: number | null,
  reason: string,
): EntryRecommendation {
  return Object.freeze({
    stars,
    currentScenario: Object.freeze({ ...currentScenario }),
    projectedScenario: projectedScenario
      ? Object.freeze({ ...projectedScenario })
      : null,
    projectedSellThrough,
    reason,
  });
}

export function excludedRaffleReason(
  comp: Pick<Competition, "entryPrice" | "name" | "categories"> &
    Partial<Pick<Competition, "url" | "sourceId">>,
): string | null {
  const text = `${comp.name} ${comp.categories.join(" ")}`.toLowerCase();
  if (comp.entryPrice <= 0 || /\bfree(?:\s|-)+(?:entry|to\s+enter|giveaway)\b/i.test(text)) {
    return "excluded free-entry raffle";
  }
  if (/\bupgrade\s+option\b/i.test(text)) {
    return "excluded upgrade-option raffle";
  }
  if (/\blucky[\s-]*dips?\b/i.test(text) || /\brandom-ticket-allocation\b/i.test(text)) {
    return "excluded lucky-dip raffle";
  }

  const prizeShapeExclusion = excludedPrizeValuationReason(comp);
  if (prizeShapeExclusion) return prizeShapeExclusion;

  return null;
}

export function excludedPrizeValuationReason(
  comp: Pick<Competition, "name" | "categories"> &
    Partial<Pick<Competition, "url" | "sourceId">>,
): string | null {
  const name = comp.name.toLowerCase();
  const text = `${name} ${comp.categories.join(" ")}`.toLowerCase();
  const identity = `${name} ${comp.sourceId ?? ""} ${comp.url ?? ""}`
    .replace(/[-_/]+/g, " ")
    .toLowerCase();
  if (
    /\b(?:tickets?|entries)\s+into\b/i.test(name) ||
    /\b(?:tickets?|entries)\s+(?:to|for|on)\b.{0,100}\b(?:draws?|comps?|competitions?|raffles?)\b/i.test(name) ||
    /\bwin\s+\d[\d,]*\s*x\s+entries?\s+to\b/i.test(name) ||
    /\bwin\s+\d[\d,]*\b.{0,100}\b(?:tickets?|entries)\b.{0,100}\b(?:draws?|comps?|competitions?|raffles?)\b/i.test(name) ||
    /\bwin\s+\d[\d,]*\s+tickets?\s+on\s+(?:the\s+)?(?:£\s*[\d,.]+\s*[km]?|[\d,.]+\s*[km])\b/i.test(name) ||
    /\bwin\s+\d[\d,]*\s*x\b.{0,80}\bor\s+£\s*[\d,.]+\s*[km]?\s+tickets?\b/i.test(name) ||
    /\bwin\s+\d[\d,]*\b.{0,60}\b(?:£\s*[\d,.]+\s*)?cash\s+tickets?\b/i.test(name) ||
    /\bticket\s+bundle\s+comp(?:etition)?\b/i.test(name) ||
    /\bodds\s+booster\b/i.test(identity) ||
    /\bgolden\s+ticket\b.*\binto\b/i.test(name)
  ) {
    return "excluded entry-bundle raffle";
  }
  if (/\b(?:site|website|store)\s+credits?\b/i.test(text) || /\bcredit\s+comp(?:etition)?s?\b/i.test(text)) {
    return "excluded site-credit raffle";
  }
  if (
    /\bodds\s+accelerator\b/i.test(text) ||
    /\bsite\s+credit\s+end\s+prize\b/i.test(text) ||
    /\binstant\s+wins?\s+prize\s+pot\b/i.test(text) ||
    /\binstant\s+win\b.*\bover\s+£?[\d,]+(?:\.\d+)?\s+in\s+prizes\b/i.test(text)
  ) {
    return "excluded instant-win prize pot";
  }
  if (
    comp.categories.some(isCombinedPrizeCategory) ||
    /\binst(?:ant)?[\s_-]+wins?\b/i.test(name) ||
    /\binstants\b/i.test(name) ||
    /\binstantly\b/i.test(name) ||
    /\binstant\s+cash\b/i.test(name) ||
    /\bspin\s+(?:to|2)\s+win\b/i.test(name) ||
    /\bevery\s+spin\s+wins?\b/i.test(name) ||
    /\bspins\b.{0,80}\bwins?\b/i.test(name) ||
    /\bballoon\s+pop\b/i.test(name) ||
    /\bslots\b/i.test(name) ||
    /\bspin\s+the\s+wheel\b/i.test(name) ||
    /\bscratch\s*(?:&|and|to)\s*win\b/i.test(name) ||
    /\bsuper\s+scratch\s+cards?\b/i.test(name) ||
    /\bscratch\s+card\s+madness\b/i.test(name) ||
    /\bpool\s+of\b.{0,80}\bprizes?\b/i.test(name) ||
    /£\s*[\d,.]+\s*[km]?\s+worth\s+of\s+prizes\b/i.test(name) ||
    /\bprizes\s+worth\s+(?:over\s+|more\s+than\s+)?£\s*[\d,.]+\s*[km]?\b/i.test(name) ||
    /\bsafe[\s-]*cracker\b/i.test(name) ||
    (
      /\b(?:main|end|final)\s+(?:cash\s+)?prizes?\b/i.test(name) &&
      /£\s*[\d,.]+\s*[km]?\s+pot\b/i.test(name)
    ) ||
    /\bprize[\s-]+(?:pot|pool)\b/i.test(text) ||
    /\bevery\s+ticket\s+wins?\b/i.test(text) ||
    /\bmixed\s+jackpot\b/i.test(text) ||
    /\bcash\s+instants?\b/i.test(name) ||
    /\binstants?\s+to\s+find\b/i.test(name) ||
    /\binstant\s+wins?\b\s*$/i.test(text) ||
    /\binstant\s+wins?\b.*\b(?:prizes?|prize\s+fund|jackpot|end\s+prize|autodraw|auto-draw)\b/i.test(text) ||
    /\b(?:prizes?|prize\s+fund|jackpot|end\s+prize|autodraw|auto-draw)\b.*\binstant\s+wins?\b/i.test(text)
  ) {
    return "excluded combined-prize raffle";
  }
  return null;
}

function isCombinedPrizeCategory(category: string): boolean {
  const normalized = category.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (/^(?:instant|auto) draws?$/.test(normalized)) return false;

  return (
    /\binstant\b/.test(normalized) ||
    /\binstas?\b/.test(normalized) ||
    /\bslots?\b/.test(normalized) ||
    /\bscratchy\b/.test(normalized) ||
    /\bpop game\b/.test(normalized) ||
    /\bspin\s*2\s*win\b/.test(normalized) ||
    /\bspinny\b/.test(normalized)
  );
}

export function scoreRaffle(comp: Competition, trend: TrendAnalysis | null = null): number {
  return scoreRecommendation(gradeRaffle(comp, trend));
}

function scoreRecommendation(grade: EntryRecommendation): number {
  if (grade.stars === 0) return -Infinity;

  const scenario = grade.projectedScenario ?? grade.currentScenario;
  const stakePenalty = scenario.cost > 0 ? Math.sqrt(scenario.cost) : 1;
  return (
    scenario.netEV * scenario.winProbability * Math.max(0, scenario.returnRatio)
  ) / stakePenalty;
}

export function compareRaffleScore(
  a: Competition,
  b: Competition,
  aTrend: TrendAnalysis | null = null,
  bTrend: TrendAnalysis | null = null,
): number {
  const aScore = scoreRaffle(a, aTrend);
  const bScore = scoreRaffle(b, bTrend);
  const aActionable = Number.isFinite(aScore);
  const bActionable = Number.isFinite(bScore);

  if (aActionable && bActionable) return bScore - aScore;
  if (aActionable) return -1;
  if (bActionable) return 1;

  const aClose = a.timeToClose !== null && a.timeToClose > 0 ? a.timeToClose : Infinity;
  const bClose = b.timeToClose !== null && b.timeToClose > 0 ? b.timeToClose : Infinity;

  return (
    aClose - bClose ||
    b.winProbability - a.winProbability ||
    b.netEV - a.netEV
  );
}
