import type {
  RawCompetition,
  CompetitionMetrics,
  Competition,
  TicketScenario,
} from "../types.js";
import { CONFIG } from "../config.js";

/** Calculate all metrics for a competition at a specific observation time. */
export function calculateMetrics(
  comp: RawCompetition,
  observedAt = new Date(),
): CompetitionMetrics {
  const prize = getPrizeValue(comp);
  const price = comp.entryPrice;
  const sold = comp.ticketsSold;
  const max = comp.maxTickets;

  // EV per single ticket at current state
  const evPerTicket = comp.drawUsesFullTicketRange
    ? prize / max - price
    : sold > 0 || prize > 0 ? prize / (sold + 1) - price : -price;

  const optimal = calculateOptimalScenario(comp);

  // House edge: how much the house profits if fully sold out
  const maxRevenue = max * price;
  const houseEdge = maxRevenue > 0 ? 1 - prize / maxRevenue : 1;

  const sellThrough = max > 0 ? sold / max : 0;

  const timeToClose = comp.drawDate
    ? new Date(comp.drawDate).getTime() - observedAt.getTime()
    : null;

  return {
    prizeValue: prize,
    evPerTicket,
    optimalTickets: optimal.tickets,
    optimalCost: optimal.cost,
    winProbability: optimal.winProbability,
    lossProbability: optimal.lossProbability,
    expectedReturn: optimal.expectedReturn,
    netEV: optimal.netEV,
    returnRatio: optimal.returnRatio,
    houseEdge,
    sellThrough,
    timeToClose,
  };
}

/** Enrich a raw competition with calculated metrics */
export function enrichCompetition(raw: RawCompetition): Competition {
  return enrichCompetitionAt(raw, new Date());
}

/** Enrich a raw competition using an explicit replay/observation clock. */
export function enrichCompetitionAt(
  raw: RawCompetition,
  observedAt: Date,
): Competition {
  return { ...raw, ...calculateMetrics(raw, observedAt) };
}

export function calculateOptimalScenario(
  comp: RawCompetition,
  ticketsSold: number = comp.ticketsSold,
  entryThresholds?: { minWinProbability: number; minReturnRatio: number },
  maxSpend = CONFIG.filters.maxSpend,
): TicketScenario {
  const prize = getPrizeValue(comp);
  const price = comp.entryPrice;
  const max = comp.maxTickets;
  const remaining = Math.max(0, max - comp.ticketsSold);
  const userLimit = comp.maxEntriesPerUserSource === "site" ? comp.maxEntriesPerUser : 1;
  // These tickets are bought now; later buyers cannot consume this allocation.
  const scenarioFor = (tickets: number) => calculateScenario({
    ...comp, ticketsSold: Math.min(ticketsSold, max - tickets),
  }, tickets);

  // Zero-price/free-entry raffles are deliberately not recommended as a stake.
  // They distort EV/risk ratios and are not paid entry opportunities.
  if (prize <= 0 || price <= 0 || ticketsSold < 0) {
    return scenarioFor(0);
  }

  const spendLimit = Math.floor(maxSpend / price);
  let minTickets = 0;
  let maxTickets = Math.max(0, Math.min(remaining, userLimit, spendLimit));
  if (entryThresholds) {
    const { minWinProbability: winFloor, minReturnRatio: returnFloor } = entryThresholds;
    if (!Number.isFinite(winFloor) || winFloor <= 0 || winFloor > 1 ||
        !Number.isFinite(returnFloor) || returnFloor < 0) return scenarioFor(0);

    const requiredTickets = comp.drawUsesFullTicketRange || (winFloor === 1 && ticketsSold > 0)
      ? winFloor * max
      : ticketsSold === 0 ? 1 : Math.min(winFloor * max, winFloor * ticketsSold / (1 - winFloor));
    minTickets = Math.max(1, Math.floor(requiredTickets));
    if (scenarioFor(minTickets).winProbability < winFloor) minTickets++;

    const maxPoolForReturn = prize / (price * (1 + returnFloor));
    if (maxPoolForReturn < max) {
      if (comp.drawUsesFullTicketRange) return scenarioFor(0);
      maxTickets = Math.min(maxTickets, Math.ceil(maxPoolForReturn - ticketsSold));
      if (maxTickets > 0 && scenarioFor(maxTickets).returnRatio < returnFloor) maxTickets--;
    }
  }
  if (maxTickets < minTickets || maxTickets <= 0) return scenarioFor(0);

  // Before sellout EV is concave. After sellout it is linear, so also check the upper bound.
  const rawOptimal = comp.drawUsesFullTicketRange ? maxTickets
    : ticketsSold === 0 ? 1 : Math.sqrt((prize * ticketsSold) / price) - ticketsSold;
  const counts = [Math.floor(rawOptimal), Math.ceil(rawOptimal), maxTickets]
    .map((tickets) => Math.max(minTickets, Math.min(tickets, maxTickets)))
    .sort((a, b) => a - b);
  let best = scenarioFor(0);
  for (const tickets of counts) {
    const scenario = scenarioFor(tickets);
    if (entryThresholds && (scenario.winProbability < entryThresholds.minWinProbability ||
        scenario.returnRatio < entryThresholds.minReturnRatio)) continue;
    const roundingTolerance = 8 * Number.EPSILON * Math.max(
      scenario.expectedReturn, scenario.cost, best.expectedReturn, best.cost,
    );
    if (scenario.netEV - best.netEV > roundingTolerance) best = scenario;
  }
  return best;
}

/** Calculate scenario for buying N tickets */
export function calculateScenario(
  comp: RawCompetition,
  tickets: number,
): TicketScenario {
  const prize = getPrizeValue(comp);
  const cost = tickets * comp.entryPrice;
  const drawPool = comp.drawUsesFullTicketRange
    ? comp.maxTickets
    : comp.ticketsSold + tickets;
  const winProbability =
    tickets > 0 ? tickets / drawPool : 0;
  const lossProbability = 1 - winProbability;
  const expectedReturn = winProbability * prize;
  const netEV = expectedReturn - cost;
  const returnRatio = cost > 0 ? netEV / cost : (netEV > 0 ? Infinity : -Infinity);

  return { tickets, cost, winProbability, lossProbability, expectedReturn, netEV, returnRatio };
}

export function getPrizeValue(comp: Pick<RawCompetition, "cashAlternative" | "estimatedPrizeValue">): number {
  return comp.cashAlternative && comp.cashAlternative > 0
    ? comp.cashAlternative
    : comp.estimatedPrizeValue && comp.estimatedPrizeValue > 0
      ? comp.estimatedPrizeValue
      : 0;
}

export function getPrizeValueLabel(comp: Pick<RawCompetition, "cashAlternative" | "estimatedPrizeValue" | "valuationConfidence">): string {
  const value = getPrizeValue(comp);
  const prefix = (comp.cashAlternative ?? 0) > 0 ? "cash" : "est.";
  const confidence = comp.cashAlternative ? "" : comp.valuationConfidence ? ` ${comp.valuationConfidence}` : "";
  return `${prefix} £${value.toLocaleString("en-GB")}${confidence}`;
}

/** Generate scenario table for multiple ticket counts */
export function generateScenarios(
  comp: RawCompetition,
  ticketCounts?: number[],
): TicketScenario[] {
  const remaining = comp.maxTickets - comp.ticketsSold;
  const counts =
    ticketCounts ??
    [1, 2, 3, 5, 10, 15, 20, 25, 50].filter((n) => n <= remaining);

  return counts.map((n) => calculateScenario(comp, n));
}
