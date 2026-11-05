import { CONFIG } from "../config.js";
import { markSiteHealthEventRecorded } from "../storage/database.js";
import type { SiteHealthNotificationEvent } from "../types.js";
import { appendSiteHealthReviewJsonl } from "./site-health-log.js";

export type SiteHealthReviewWriter = (
  events: readonly SiteHealthNotificationEvent[],
  directory: string,
  recordedAt: Date,
) => string;
export type SiteHealthStateMarker = (
  event: SiteHealthNotificationEvent,
  recordedAt: Date,
) => boolean;
export type SiteHealthRecordOutcome = "logged" | "failed" | "empty";

const KIND_ORDER: Record<SiteHealthNotificationEvent["kind"], number> = {
  incident: 0,
  reminder: 1,
  recovery: 2,
};

/** Append every event before advancing the restart-safe incident lifecycle. */
export function recordSiteHealthEvents(
  events: readonly SiteHealthNotificationEvent[],
  writer: SiteHealthReviewWriter = appendSiteHealthReviewJsonl,
  recordedAt = new Date(),
  marker: SiteHealthStateMarker = markSiteHealthEventRecorded,
): SiteHealthRecordOutcome {
  if (events.length === 0) return "empty";

  try {
    writer(events, CONFIG.alerts.siteHealthLogDir, recordedAt);
  } catch (error) {
    console.error(`Could not append site health review JSONL: ${formatError(error)}`);
    return "failed";
  }

  for (const event of events) {
    try {
      if (marker(event, recordedAt)) continue;
      console.warn(
        `Site health event was logged but stale state prevented marking ${event.kind} for ${event.siteName}`,
      );
    } catch (error) {
      console.error(
        `Site health event was logged but its retry state could not be marked for ${event.siteName}: ${formatError(error)}`,
      );
    }
  }
  return "logged";
}

export function formatSiteHealthDigest(
  events: readonly SiteHealthNotificationEvent[],
  requestedMaxLength = CONFIG.alerts.siteHealthMaxMessageLength,
): string {
  return buildSiteHealthDigest(events, requestedMaxLength).text;
}

function buildSiteHealthDigest(
  events: readonly SiteHealthNotificationEvent[],
  requestedMaxLength = CONFIG.alerts.siteHealthMaxMessageLength,
): { text: string; includedEvents: SiteHealthNotificationEvent[] } {
  const configuredMaxLength = Number.isFinite(requestedMaxLength)
    ? Math.floor(requestedMaxLength)
    : 3_800;
  const maxLength = Math.min(4_000, Math.max(256, configuredMaxLength));
  const sorted = [...events].sort((left, right) =>
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    compareText(left.siteName, right.siteName) ||
    compareText(left.incidentStartedAt, right.incidentStartedAt)
  );
  const header = `Raffle bot site health (${events.length} ${events.length === 1 ? "event" : "events"})`;
  const errorMaxLength = Math.min(240, Math.max(32, Math.floor(maxLength / 8)));
  const blocks = sorted.map((event) => ({
    event,
    text: formatEvent(event, errorMaxLength),
  }));
  const included: typeof blocks = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const candidate = [...included, blocks[index]];
    const remaining = blocks.length - candidate.length;
    const text = composeDigest(header, candidate.map((block) => block.text), remaining);
    if (text.length > maxLength) break;
    included.push(blocks[index]);
  }

  if (included.length === 0 && blocks.length > 0) {
    const omittedLine = blocks.length > 1
      ? `… ${blocks.length - 1} more health ${blocks.length === 2 ? "event" : "events"} omitted`
      : "";
    const reserved = header.length + omittedLine.length + (omittedLine ? 4 : 2);
    included.push({
      event: blocks[0].event,
      text: truncate(blocks[0].text, Math.max(1, maxLength - reserved)),
    });
  }

  let remaining = blocks.length - included.length;
  let digest = composeDigest(header, included.map((block) => block.text), remaining);
  while (digest.length > maxLength && included.length > 0) {
    included.pop();
    remaining = blocks.length - included.length;
    digest = composeDigest(header, included.map((block) => block.text), remaining);
  }
  return {
    text: digest.slice(0, maxLength),
    includedEvents: included.map((block) => block.event),
  };
}

function composeDigest(header: string, blocks: string[], remaining: number): string {
  const parts = [header, ...blocks];
  if (remaining > 0) {
    parts.push(`… ${remaining} more health ${remaining === 1 ? "event" : "events"} omitted`);
  }
  return parts.join("\n\n");
}

function formatEvent(
  event: SiteHealthNotificationEvent,
  errorMaxLength: number,
): string {
  const status = event.condition === "expected_competition_empty"
    ? "EXPECTED COMPETITIONS MISSING"
    : event.status.toUpperCase().replaceAll("_", " ");
  const siteName = truncate(cleanText(event.siteName), 100);
  if (event.kind === "recovery") {
    return [
      `RECOVERY | ${siteName} | ${status === "EXPECTED COMPETITIONS MISSING" ? "COMPETITIONS VISIBLE AGAIN" : "SUCCESS"}`,
      `Recovered: ${event.recoveredAt ?? event.observedAt} | incident started: ${event.incidentStartedAt}`,
    ].join("\n");
  }

  const label = event.kind === "incident" ? "INCIDENT" : "REMINDER";
  const lines = [
    `${label} | ${siteName} | ${status} | ${event.consecutiveUnhealthy} consecutive ${event.condition === "expected_competition_empty" ? "contradictory empty" : "unhealthy"} scans`,
    `Incident started: ${event.incidentStartedAt} | observed: ${event.observedAt}`,
  ];
  if (event.errorMessage) {
    lines.push(`Error: ${truncate(cleanText(event.errorMessage), errorMaxLength)}`);
  }
  return lines.join("\n");
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…".slice(0, maxLength);
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
