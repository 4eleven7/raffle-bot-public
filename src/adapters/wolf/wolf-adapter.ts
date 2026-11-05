import * as cheerio from "cheerio";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";

const SITE_NAME = "wolfcompetitions";
const BASE_URL = "https://wolfcompetitions.co.uk";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type ListingCard = {
  sourceId: string;
  url: string;
  name: string;
  description: string;
  entryPrice: number;
  soldPercent: number;
  isAutoDraw: boolean;
};

type Detail = {
  name: string;
  entryPrice: number;
  ticketsSold: number | null;
  maxTickets: number;
  maxEntriesPerUser: number;
  drawDate: string | null;
  cashAlternative: number | null;
};

type Progress = {
  sold: number;
  available: number;
  maxEntriesPerUser: number;
  status: string;
};

export class WolfAdapter implements SiteAdapter {
  readonly siteName = SITE_NAME;

  async fetchAll(): Promise<RawCompetition[]> {
    const html = await fetchHtml(`${BASE_URL}/`);
    const cards = parseListingCards(html);
    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];

    for (const card of cards) {
      const detail = await fetchDetail(card.url);
      if (detail.maxTickets <= 0 || detail.ticketsSold === null || detail.drawDate === null) {
        continue;
      }

      const entryPrice = detail.entryPrice || card.entryPrice;
      if (entryPrice <= 0) continue;

      competitions.push({
        sourceId: card.sourceId,
        siteName: SITE_NAME,
        url: card.url,
        name: detail.name || card.name,
        entryPrice,
        ticketsSold: detail.ticketsSold,
        maxTickets: detail.maxTickets,
        maxEntriesPerUser: detail.maxEntriesPerUser > 0 ? detail.maxEntriesPerUser : 100,
        cashAlternative:
          detail.cashAlternative ??
          extractCashAlternative(`${card.name} ${card.description}`),
        drawDate: detail.drawDate,
        isAutoDraw: card.isAutoDraw,
        categories: [],
        scrapedAt: now,
      });
    }

    return competitions;
  }
}

async function fetchDetail(url: string): Promise<Detail> {
  const html = await fetchHtml(url);
  const detail = parseDetail(html);
  const progressId = parseProgressId(html);
  if (!progressId) return detail;

  const progress = await fetchProgress(progressId);
  if (!progress) return detail;

  return {
    ...detail,
    ticketsSold: progress.sold,
    maxTickets:
      detail.maxTickets > 0
        ? detail.maxTickets
        : progress.sold + progress.available,
    maxEntriesPerUser:
      detail.maxEntriesPerUser > 0
        ? detail.maxEntriesPerUser
        : progress.maxEntriesPerUser,
  };
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Wolf fetch failed for ${url}: ${response.status}`);
  }
  return response.text();
}

export function parseListingCards(html: string): ListingCard[] {
  const $ = cheerio.load(html);
  const cards: ListingCard[] = [];
  const seen = new Set<string>();

  $(".competition-listing__item").each((_i, el) => {
    const card = $(el);
    const href = card.find('a[href*="/competition/"]').first().attr("href");
    const sourceId = href?.match(/\/competition\/([^/?#]+)/)?.[1];
    if (!href || !sourceId || seen.has(sourceId)) return;

    const text = card.text().replace(/\s+/g, " ").trim();
    const entryPrice = parseEntryPrice(text);
    const soldPercent = parseFloat(card.find("[data-progress]").first().attr("data-progress") ?? "0");
    if (entryPrice <= 0 || soldPercent < 0) return;

    seen.add(sourceId);
    cards.push({
      sourceId,
      url: href.startsWith("http") ? href : `${BASE_URL}${href}`,
      name: card.find("h3.title").first().text().replace(/\s+/g, " ").trim(),
      description: card.find(".description").first().text().replace(/\s+/g, " ").trim(),
      entryPrice,
      soldPercent,
      isAutoDraw: /Spin|Reveal|Scratch|instant/i.test(text),
    });
  });

  return cards;
}

export function parseDetail(html: string): Detail {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const competitionText = [
    $("#competition-title").text(),
    $("#competition-text").text(),
  ].join(" ").replace(/\s+/g, " ").trim();
  const maxTickets =
    parseNumber(text.match(/Total Tickets Available:\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/Total Tickets\s*([\d,]+)/i)?.[1]);
  const maxEntriesPerUser = parseNumber(
    $("#competition-ticket-selection [x-init]")
      .attr("x-init")
      ?.match(/max:\s*([\d,]+)/)?.[1],
  );

  return {
    name: $("#competition-title").text().replace(/\s+/g, " ").trim(),
    entryPrice: parseEntryPrice($("#competition-cost").text() || text),
    ticketsSold: null,
    maxTickets,
    maxEntriesPerUser,
    drawDate: parseWolfDrawDate($(".competition-date").text()),
    cashAlternative: extractCashAlternative(competitionText),
  };
}

function parseProgressId(html: string): string | null {
  const $ = cheerio.load(html);
  return $("#competition-progress").attr("data-competition") ?? null;
}

async function fetchProgress(progressId: string): Promise<Progress | null> {
  const form = new FormData();
  form.append("competition_ids", progressId);

  const response = await fetch(`${BASE_URL}/wp-json/wolf-competitions/v1/competition/progress`, {
    method: "POST",
    body: form,
    headers: { "user-agent": USER_AGENT },
  });
  if (!response.ok) return null;

  const payload = await response.json() as {
    progress?: Record<string, {
      sold?: string | number;
      available?: string | number;
      max?: string | number;
      status?: string;
    }>;
  };
  const raw = payload.progress?.[progressId];
  if (!raw) return null;

  return {
    sold: asNumber(raw.sold),
    available: asNumber(raw.available),
    maxEntriesPerUser: asNumber(raw.max) || 100,
    status: raw.status ?? "",
  };
}

function parseEntryPrice(text: string): number {
  const pound = text.match(/£\s*([\d.]+)\s*per\s*entry/i);
  if (pound) return parseFloat(pound[1]);

  const pence = text.match(/\b(\d+)p\s*per\s*entry/i);
  if (pence) return parseInt(pence[1], 10) / 100;

  return 0;
}

function parseWolfDrawDate(text: string): string | null {
  const match = text
    .replace(/\s+/g, " ")
    .match(/Drawn\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{1,2}):(\d{2})/i);
  if (!match) return null;

  const month = monthNumber(match[2]);
  if (month === null) return null;

  const now = new Date();
  const date = new Date(
    now.getFullYear(),
    month,
    parseInt(match[1], 10),
    parseInt(match[3], 10),
    parseInt(match[4], 10),
    0,
    0,
  );
  if (date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date.toISOString();
}

function monthNumber(value: string): number | null {
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  return months[value.slice(0, 3).toLowerCase()] ?? null;
}

function parseNumber(value: string | undefined): number {
  return value ? parseInt(value.replace(/,/g, ""), 10) || 0 : 0;
}

function asNumber(value: string | number | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return parseNumber(value);
}

function extractCashAlternative(text: string): number | null {
  const match =
    text.match(/(?:win|upto|up\s*to|up2)\s*£\s*([\d,]+)\s*(?:cash|instantly)?/i) ||
    text.match(/£\s*([\d,]+)\s*(?:cash|end prize|main prize)/i);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}
