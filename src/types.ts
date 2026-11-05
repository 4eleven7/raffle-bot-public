/** Raw data extracted by a site adapter */
export interface RawCompetition {
  sourceId: string;
  siteName: string;
  url: string;
  name: string;
  prizeDescription?: string;
  prizeEvidence?: string;
  prizePayout?: { kind: "fixed" } | { kind: "conditional"; terms: string };
  entryPrice: number;
  ticketsSold: number;
  maxTickets: number;
  /** Whether unsold ticket numbers remain eligible to win. */
  drawUsesFullTicketRange?: boolean;
  /** Whether ticket inventory came from exact source counts or an estimate. */
  inventorySource?: "exact" | "estimated" | "unknown";
  maxEntriesPerUser: number;
  /** Whether the operator limit was parsed from the site or is only a fallback. */
  maxEntriesPerUserSource?: "site" | "fallback" | null;
  cashAlternative: number | null;
  estimatedPrizeValue?: number | null;
  valuationSource?: "cash" | "site_estimate" | "manual_estimate" | "llm_estimate" | null;
  valuationConfidence?: "high" | "medium" | "low" | null;
  valuationNotes?: string | null;
  drawDate: string | null; // ISO 8601
  isAutoDraw: boolean;
  categories: string[];
  scrapedAt: string;
}

export type SiteScanStatus =
  | "success"
  | "empty"
  | "partial"
  | "transient_error"
  | "blocked";

export interface SiteScanHealth {
  siteName: string;
  status: SiteScanStatus;
  competitionsFound: number;
  cashCompetitionsFound: number;
  partialCompetitionsFound: number;
  errorMessage: string | null;
  scannedAt: string;
}

export type SiteHealthNotificationKind = "incident" | "reminder" | "recovery";
export type SiteHealthIncidentCondition =
  | "scan_failure"
  | "expected_competition_empty";

/** Persistent monitor-health transition that is eligible for the daily review ledger. */
export interface SiteHealthNotificationEvent {
  kind: SiteHealthNotificationKind;
  condition: SiteHealthIncidentCondition;
  siteName: string;
  status: SiteScanStatus;
  consecutiveUnhealthy: number;
  incidentStartedAt: string;
  /** Stable lifecycle transition time used to deduplicate a retried JSONL append. */
  transitionAt: string;
  observedAt: string;
  recoveredAt: string | null;
  errorMessage: string | null;
}

/** Computed metrics for a competition */
export interface CompetitionMetrics {
  prizeValue: number;
  evPerTicket: number;
  optimalTickets: number;
  optimalCost: number;
  winProbability: number;
  lossProbability: number;
  expectedReturn: number;
  netEV: number;
  returnRatio: number;
  houseEdge: number;
  sellThrough: number;
  timeToClose: number | null; // ms until draw, null if no draw date
}

/** Full enriched competition = raw + metrics */
export type Competition = RawCompetition & CompetitionMetrics;

/** A point-in-time snapshot for trend analysis */
export interface Snapshot {
  id: number;
  sourceId: string;
  siteName: string;
  ticketsSold: number;
  maxTickets: number | null;
  drawDate: string | null;
  inventorySource: "exact" | "estimated" | "unknown";
  scrapedAt: string;
}

export type StarRating = 0 | 1 | 2 | 3;

/** One immutable recommendation used from grading through delivery. */
export interface EntryRecommendation {
  /** Absent on historical recommendations, which used the high-chance policy. */
  category?: "high-chance" | "value";
  stars: StarRating;
  currentScenario: TicketScenario;
  projectedScenario: TicketScenario | null;
  projectedSellThrough: number | null;
  reason: string;
}

/** Alert triggered when thresholds are met */
export interface Alert {
  competition: Competition;
  recommendation: EntryRecommendation;
  reason: string;
  priority: "high" | "medium" | "low";
}

/** Ticket scenario analysis */
export interface TicketScenario {
  tickets: number;
  cost: number;
  winProbability: number;
  lossProbability: number;
  expectedReturn: number;
  netEV: number;
  returnRatio: number;
}
