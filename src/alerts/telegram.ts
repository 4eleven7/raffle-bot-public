import { createHash } from "node:crypto";
import { DateTime } from "luxon";
import type { Competition, EntryRecommendation } from "../types.js";
import { canonicalCompetitionUrl } from "./canonical-url.js";
import { CONFIG } from "../config.js";
import {
  recordAlertSent,
  recordTelegramSentMessage,
  wasAlertSentRecently,
} from "../storage/database.js";
import { telegramFeedbackReplyMarkup } from "./telegram-feedback.js";

const ALREADY_SENT = new Set<string>();
const IN_FLIGHT = new Set<string>();
const OPPORTUNITY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function getConfig(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

export type TelegramOpportunityOutcome = "sent" | "cooldown" | "disabled" | "failed";
export type TelegramOpportunityAvailability = "ready" | "cooldown" | "disabled";
export type TelegramOpportunityRoute = "entry";
export interface TelegramOpportunityDispatchResult {
  outcome: TelegramOpportunityOutcome;
  alertKey: string;
  chatId?: string;
  messageId?: number;
  error?: string;
}

/** Send a standalone opportunity message (for trend-based alerts) */
export async function sendTelegramOpportunity(
  comp: Competition,
  recommendation: EntryRecommendation,
): Promise<TelegramOpportunityOutcome> {
  return (await sendTelegramOpportunityDetailed(comp, recommendation)).outcome;
}

export async function sendTelegramOpportunityDetailed(
  comp: Competition,
  recommendation: EntryRecommendation,
): Promise<TelegramOpportunityDispatchResult> {
  const key = makeOpportunityAlertKey(comp);
  const config = getConfig();
  if (!config) {
    return {
      outcome: "disabled",
      alertKey: key,
      error: "Telegram credentials unavailable",
    };
  }

  if (hasRecentOpportunityAlert(comp, key)) {
    return { outcome: "cooldown", alertKey: key };
  }

  IN_FLIGHT.add(key);
  try {
    const message = formatTelegramOpportunityMessage(comp, recommendation);
    const result = await sendMessage(config, message);
    if (result.outcome === "sent") {
      const persistenceErrors: string[] = [];
      try {
        rememberAlert(key, OPPORTUNITY_COOLDOWN_MS);
      } catch (error) {
        persistenceErrors.push(`cooldown persistence failed: ${formatError(error)}`);
      }
      if (result.messageId !== undefined) {
        try {
          recordTelegramSentMessage({
            chatId: result.chatId ?? config.chatId,
            messageId: result.messageId,
            alertKey: key,
            canonicalUrl: canonicalCompetitionUrl(comp.url),
            siteName: comp.siteName,
            sourceId: comp.sourceId,
            raffleName: comp.name,
            sentAt: new Date().toISOString(),
          });
        } catch (error) {
          persistenceErrors.push(
            `feedback correlation persistence failed: ${formatError(error)}`,
          );
        }
      }
      if (persistenceErrors.length > 0) {
        result.error = [result.error, ...persistenceErrors]
          .filter(Boolean)
          .join(" · ");
      }
    }
    return { ...result, alertKey: key };
  } finally {
    IN_FLIGHT.delete(key);
  }
}

export async function sendTelegramReminder(
  comp: Competition,
  recommendation: EntryRecommendation,
  chatId: string,
): Promise<TelegramOpportunityOutcome> {
  const config = getConfig();
  if (!config) return "disabled";
  const result = await sendMessage(
    { ...config, chatId },
    `⏰ Reminder · ${formatTelegramOpportunityMessage(comp, recommendation)}`,
    true,
    false,
  );
  return result.outcome;
}

export function telegramOpportunityAvailability(
  comp: Competition,
): TelegramOpportunityAvailability {
  if (!getConfig()) return "disabled";
  return hasRecentOpportunityAlert(comp, makeOpportunityAlertKey(comp))
    ? "cooldown"
    : "ready";
}

export function makeOpportunityAlertKey(
  comp: Pick<Competition, "url" | "drawDate">,
): string {
  const identity = createHash("sha256")
    .update(canonicalCompetitionUrl(comp.url))
    .digest("hex")
    .slice(0, 24);
  const round = comp.drawDate
    ? DateTime.fromISO(comp.drawDate, { setZone: true })
      .setZone("Europe/London")
      .toISODate()
    : null;
  return `entry:${round ?? "unknown"}:${identity}`;
}

export function formatTelegramOpportunityMessage(
  comp: Competition,
  recommendation: EntryRecommendation,
): string {
  const scenario = recommendation.projectedScenario ?? recommendation.currentScenario;
  const projected = recommendation.projectedScenario !== null;
  const stars = "⭐".repeat(recommendation.stars);
  const minutes = Math.max(1, Math.ceil((comp.timeToClose ?? 0) / 60_000));
  const title = comp.name.length > 80 ? `${comp.name.slice(0, 79)}…` : comp.name;
  const line = [
    `${stars} ${recommendation.category === "value" ? "Value entry · " : ""}*${escapeMarkdown(title)}*`,
    `${comp.ticketsSold.toLocaleString("en-GB")}/${comp.maxTickets.toLocaleString("en-GB")} sold now`,
    `Buy now: ${scenario.tickets.toLocaleString("en-GB")}×£${comp.entryPrice.toFixed(2)}`,
    `£${scenario.cost.toFixed(2)} total`,
    `${(scenario.winProbability * 100).toFixed(1)}% ${projected ? "projected " : ""}win chance`,
    `${(scenario.lossProbability * 100).toFixed(1)}% ${projected ? "projected " : ""}loss chance`,
    `${scenario.netEV >= 0 ? "+" : "-"}£${Math.abs(Math.round(scenario.netEV))} ${projected ? "projected " : ""}EV`,
    `Draw in ${minutes}m`,
  ].join(" · ");
  return `${line}\n[Enter](${comp.url})`;
}

async function sendMessage(
  config: TelegramConfig,
  text: string,
  markdown = true,
  includeReplyMarkup = true,
): Promise<Omit<TelegramOpportunityDispatchResult, "alertKey">> {
  const result = await sendMessageRequest(config, text, markdown, includeReplyMarkup);
  if (
    markdown &&
    result.outcome === "failed" &&
    isTelegramEntityParseError(result.error)
  ) {
    const plainTextResult = await sendMessageRequest(
      config,
      text,
      false,
      includeReplyMarkup,
    );
    if (plainTextResult.outcome === "failed") {
      return {
        ...plainTextResult,
        error: [
          `Markdown send failed: ${result.error}`,
          `plain-text retry failed: ${plainTextResult.error}`,
        ].join(" · "),
      };
    }
    return plainTextResult;
  }
  return result;
}

async function sendMessageRequest(
  config: TelegramConfig,
  text: string,
  markdown: boolean,
  includeReplyMarkup: boolean,
): Promise<Omit<TelegramOpportunityDispatchResult, "alertKey">> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.alerts.telegramTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        ...(markdown ? { parse_mode: "Markdown" } : {}),
        disable_web_page_preview: false,
        ...(includeReplyMarkup
          ? { reply_markup: telegramFeedbackReplyMarkup() }
          : {}),
      }),
    });
    let body: {
      ok?: boolean;
      description?: string;
      result?: {
        message_id?: number;
        chat?: { id?: number | string };
      };
    } = {};
    try {
      body = await response.json() as typeof body;
    } catch {
      // HTTP status still tells us whether Telegram accepted the send.
    }
    if (!response.ok || body.ok !== true) {
      return {
        outcome: "failed",
        error: body.description ?? (
          response.ok
            ? "Telegram sendMessage response did not confirm success"
            : `Telegram sendMessage returned HTTP ${response.status}`
        ),
      };
    }
    return {
      outcome: "sent",
      messageId: Number.isSafeInteger(body.result?.message_id)
        ? body.result!.message_id
        : undefined,
      chatId: body.result?.chat?.id === undefined
        ? config.chatId
        : String(body.result.chat.id),
      ...(body.result?.message_id === undefined
        ? { error: "Telegram response did not include message_id; feedback correlation unavailable" }
        : {}),
    };
  } catch (error) {
    // Best-effort — don't crash the monitor
    return {
      outcome: "failed",
      error: error instanceof DOMException && error.name === "AbortError"
        ? `Telegram sendMessage timed out after ${CONFIG.alerts.telegramTimeoutMs}ms`
        : formatError(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isTelegramEntityParseError(error: string | undefined): boolean {
  return error?.includes("can't parse entities") ?? false;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeMarkdown(s: string): string {
  return s.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function hasRecentOpportunityAlert(
  comp: Competition,
  key: string,
): boolean {
  if (IN_FLIGHT.has(key) || hasRecentAlert(key, OPPORTUNITY_COOLDOWN_MS)) return true;

  const identity = createHash("sha256")
    .update(canonicalCompetitionUrl(comp.url))
    .digest("hex")
    .slice(0, 24);
  const legacyKeys = [
    `trend:${comp.siteName}:${comp.sourceId}`,
    `trend:buy-window:${comp.siteName}:${comp.sourceId}`,
    `trend:reminder-20m:${comp.siteName}:${comp.sourceId}`,
    `trend:final-window:${comp.siteName}:${comp.sourceId}`,
    `trend:buy-window:${identity}`,
    `trend:reminder-20m:${identity}`,
    `trend:final-window:${identity}`,
  ];

  return legacyKeys.some((legacyKey) =>
    hasRecentAlert(legacyKey, OPPORTUNITY_COOLDOWN_MS)
  );
}

function hasRecentAlert(key: string, cooldownMs: number): boolean {
  if (ALREADY_SENT.has(key)) return true;
  return wasAlertSentRecently(key, cooldownMs);
}

function rememberAlert(key: string, cooldownMs: number): void {
  ALREADY_SENT.add(key);
  setTimeout(() => ALREADY_SENT.delete(key), cooldownMs).unref();
  recordAlertSent(key);
}
