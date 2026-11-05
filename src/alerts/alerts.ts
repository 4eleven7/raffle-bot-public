import { CONFIG } from "../config.js";
import { isFreshEntryInventory } from "../cli/freshness.js";
import { gradeRaffle } from "../metrics/decision.js";
import { analyzeTrend, type TrendAnalysis } from "../metrics/trends.js";
import type { Alert, Competition } from "../types.js";

export function checkAlerts(
  comp: Competition,
  trend?: TrendAnalysis | null,
  observedAt: Date | number = Date.now(),
): Alert[] {
  if (!isFreshEntryInventory(comp, observedAt)) return [];
  if (
    comp.timeToClose === null ||
    comp.timeToClose <= 0 ||
    comp.timeToClose > CONFIG.alerts.notificationWindowMs
  ) {
    return [];
  }

  const recommendation = gradeRaffle(
    comp,
    trend === undefined ? analyzeTrend(comp) : trend,
  );
  if (recommendation.stars === 0) return [];

  return [{
    competition: comp,
    recommendation,
    reason: recommendation.reason,
    priority: recommendation.stars === 3
      ? "high"
      : recommendation.stars === 2
      ? "medium"
      : "low",
  }];
}
