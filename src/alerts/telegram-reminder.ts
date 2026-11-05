import type { Competition, EntryRecommendation } from "../types.js";
import { enrichCompetitionAt } from "../metrics/calculator.js";
import {
  completeTelegramReminder,
  getCompetition,
  getPendingTelegramReminders,
} from "../storage/database.js";
import {
  processEntryCandidates,
  type EntryCandidateDependencies,
} from "./buy-review.js";
import {
  REMINDER_MAX_LEAD_MS,
  REMINDER_MIN_LEAD_MS,
} from "./telegram-feedback.js";
import {
  makeOpportunityAlertKey,
  sendTelegramReminder,
  type TelegramOpportunityOutcome,
} from "./telegram.js";

export interface TelegramReminderResult {
  sent: number;
  notWorth: number;
  expired: number;
}

export async function processDueTelegramReminders(
  competitions: Competition[],
  dependencies: {
    now?: () => Date;
    reviewer?: NonNullable<EntryCandidateDependencies["reviewer"]>;
    sender?: (
      competition: Competition,
      recommendation: EntryRecommendation,
      chatId: string,
    ) => Promise<TelegramOpportunityOutcome>;
  } = {},
): Promise<TelegramReminderResult> {
  const clock = dependencies.now ?? (() => new Date());
  const now = clock();
  const sender = dependencies.sender ?? sendTelegramReminder;
  const current = new Map(
    competitions.map((competition) => [
      `${competition.siteName}\0${competition.sourceId}`,
      competition,
    ]),
  );
  const result: TelegramReminderResult = { sent: 0, notWorth: 0, expired: 0 };

  for (const reminder of getPendingTelegramReminders()) {
    const competition = current.get(`${reminder.siteName}\0${reminder.sourceId}`);
    if (!competition) {
      const stored = getCompetition(reminder.sourceId, reminder.siteName);
      const storedDrawAt = stored?.drawDate
        ? new Date(stored.drawDate).getTime()
        : Number.NaN;
      if (!Number.isFinite(storedDrawAt) || storedDrawAt <= now.getTime()) {
        if (completeTelegramReminder(reminder.chatId, reminder.alertKey, "expired", now)) {
          result.expired += 1;
        }
      }
      continue;
    }

    const freshCompetition = enrichCompetitionAt(competition, now);
    const timeToClose = freshCompetition.timeToClose;
    if (
      timeToClose === null ||
      timeToClose < REMINDER_MIN_LEAD_MS ||
      makeOpportunityAlertKey(freshCompetition) !== reminder.alertKey
    ) {
      if (completeTelegramReminder(reminder.chatId, reminder.alertKey, "expired", now)) {
        result.expired += 1;
      }
      continue;
    }
    if (timeToClose > REMINDER_MAX_LEAD_MS) continue;

    try {
      const [decision] = await processEntryCandidates([freshCompetition], {
        now: clock,
        reviewer: dependencies.reviewer,
        availability: () => "ready",
        sender: (competition, recommendation) =>
          sender(competition, recommendation, reminder.chatId),
        recordDecision: () => undefined,
        appendDecision: () => undefined,
      });
      if (decision?.outcome === "sent") {
        if (completeTelegramReminder(reminder.chatId, reminder.alertKey, "sent", now)) {
          result.sent += 1;
        }
      } else if (decision?.outcome.startsWith("suppressed_") &&
                 decision.outcome !== "suppressed_stale_inventory") {
        if (completeTelegramReminder(reminder.chatId, reminder.alertKey, "not_worth", now)) {
          result.notWorth += 1;
        }
      }
    } catch (error) {
      console.warn(
        `Could not send Telegram raffle reminder for ${reminder.siteName}/${reminder.sourceId}: ${formatError(error)}`,
      );
    }
  }

  return result;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
