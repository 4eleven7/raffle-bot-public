import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { StoredAlertDecision } from "../storage/database.js";

const LEDGER_TIMEZONE = "Europe/London";

export function appendAlertDecisionJsonl(
  record: StoredAlertDecision,
  directory: string,
): string {
  mkdirSync(directory, { recursive: true });
  const date = londonDate(new Date(record.recordedAt));
  const path = join(directory, `${date}.jsonl`);
  appendFileSync(path, `${JSON.stringify({ ...record, ledgerTimezone: LEDGER_TIMEZONE })}\n`, "utf8");
  return path;
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
