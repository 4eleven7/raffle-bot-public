import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { SiteHealthNotificationEvent } from "../types.js";

const LEDGER_TIMEZONE = "Europe/London";
const SCHEMA_VERSION = "1";

export interface SiteHealthReviewLogEvent extends SiteHealthNotificationEvent {
  /** Stable identity for next-day deduplication after a narrow append/state crash window. */
  eventKey: string;
}

export interface SiteHealthReviewBatch {
  schemaVersion: typeof SCHEMA_VERSION;
  phase: "site_health";
  recordedAt: string;
  ledgerTimezone: typeof LEDGER_TIMEZONE;
  events: SiteHealthReviewLogEvent[];
}

/** Append one complete monitor batch to the Europe/London daily review ledger. */
export function appendSiteHealthReviewJsonl(
  events: readonly SiteHealthNotificationEvent[],
  directory: string,
  recordedAt = new Date(),
): string {
  if (events.length === 0) {
    throw new RangeError("site health review batch must contain at least one event");
  }
  if (!Number.isFinite(recordedAt.getTime())) {
    throw new RangeError("site health review timestamp must be a valid date");
  }

  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${londonDate(recordedAt)}.jsonl`);
  const record: SiteHealthReviewBatch = {
    schemaVersion: SCHEMA_VERSION,
    phase: "site_health",
    recordedAt: recordedAt.toISOString(),
    ledgerTimezone: LEDGER_TIMEZONE,
    events: events.map((event) => ({
      ...event,
      eventKey: siteHealthEventKey(event),
    })),
  };
  appendDurably(path, `${JSON.stringify(record)}\n`);
  return path;
}

function siteHealthEventKey(event: SiteHealthNotificationEvent): string {
  return createHash("sha256")
    .update([
      SCHEMA_VERSION,
      event.kind,
      event.condition,
      event.siteName,
      event.incidentStartedAt,
      event.transitionAt,
    ].join("\u0000"))
    .digest("hex")
    .slice(0, 24);
}

function appendDurably(path: string, line: string): void {
  const file = openSync(path, "a+");
  try {
    const size = fstatSync(file).size;
    if (size > 0) {
      const finalByte = Buffer.allocUnsafe(1);
      const bytesRead = readSync(file, finalByte, 0, 1, size - 1);
      const boundary = bytesRead !== 1 || finalByte[0] !== 0x0a ? "\n" : "";
      writeFileSync(file, `${boundary}${line}`, "utf8");
    } else {
      writeFileSync(file, line, "utf8");
    }
    fsyncSync(file);
  } finally {
    closeSync(file);
  }
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
