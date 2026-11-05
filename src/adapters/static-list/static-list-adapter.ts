import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { DateTime } from "luxon";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import { fetchRenderedHtml } from "../browser/browser-pool.js";
import type { StaticListSiteConfig } from "./static-list-site-config.js";

type RenderedPageFetcher = (
  url: string,
  waitSelector?: string,
  signal?: AbortSignal,
) => Promise<string>;

export class StaticListAdapter implements SiteAdapter {
  readonly siteName: string;
  readonly scanCost?: "browser";

  constructor(
    private readonly config: StaticListSiteConfig,
    private readonly renderedPageFetcher: RenderedPageFetcher = fetchRenderedHtml,
  ) {
    this.siteName = config.siteName;
    this.scanCost = RENDERED_STATIC_SITES.has(config.siteName) ? "browser" : undefined;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    if (this.config.siteName === "prizequeen") {
      return this.fetchPrizeQueenStoreProducts(signal);
    }

    const html = await this.fetchPage(this.config.listPath, signal);
    const $ = cheerio.load(html);

    if (this.config.siteName === "lakedistrict") {
      const comps: RawCompetition[] = [];
      for (const href of parseLakeDistrictLinks($, this.config)) {
        signal?.throwIfAborted();
        try {
          const detailHtml = await this.fetchPage(href.replace(this.config.baseUrl, ""), signal);
          const comp = parseLakeDistrictDetail(detailHtml, this.config, href);
          if (comp) comps.push(comp);
        } catch {
          signal?.throwIfAborted();
          continue;
        }
      }
      return comps;
    }

    if (this.config.siteName === "coast") {
      const links = parseCoastListLinks($, this.config);
      const comps: RawCompetition[] = [];
      for (const href of links) {
        signal?.throwIfAborted();
        const detailHtml = await this.fetchPage(href.replace(this.config.baseUrl, ""), signal);
        const comp = parseCoastDetail(detailHtml, this.config, href);
        if (comp) comps.push(comp);
      }
      return comps;
    }

    if (GENERIC_WOO_DETAIL_SITES.has(this.config.siteName)) {
      const links = parseGenericCompetitionLinks($, this.config);
      for (const pageHref of parseGenericPaginationLinks($, this.config)) {
        signal?.throwIfAborted();
        const pageHtml = await this.fetchPage(pageHref.replace(this.config.baseUrl, ""), signal);
        links.push(
          ...parseGenericCompetitionLinks(cheerio.load(pageHtml), this.config),
        );
      }
      for (const extraPath of this.config.extraDetailPaths ?? []) {
        links.push(absoluteUrl(this.config, extraPath));
      }
      const comps: RawCompetition[] = [];
      for (const href of Array.from(new Set(links))) {
        signal?.throwIfAborted();
        try {
          const detailHtml = await this.fetchPage(href.replace(this.config.baseUrl, ""), signal);
          const comp = parseGenericWooDetail(detailHtml, this.config, href);
          if (comp) comps.push(comp);
        } catch {
          signal?.throwIfAborted();
          continue;
        }
      }
      return comps;
    }

    if (this.config.siteName === "compcity") {
      const links = parseCompCityLinks($, this.config);
      const comps: RawCompetition[] = [];
      for (const href of links) {
        signal?.throwIfAborted();
        const detailHtml = await this.fetchPage(href.replace(this.config.baseUrl, ""), signal);
        const comp = parseCompCityDetail(detailHtml, this.config, href);
        if (comp) comps.push(comp);
      }
      return comps;
    }

    if (this.config.siteName === "kitchendraw") {
      return this.enrichKitchenDrawDetails(parseKitchenDraw($, this.config), signal);
    }

    if (this.config.siteName === "northcoast") {
      return this.enrichNorthCoastDetails(parseNorthCoast($, this.config), signal);
    }

    if (this.config.siteName === "yourukcompetitions") {
      const comps: RawCompetition[] = [];
      for (const href of parseYourUkCompetitionLinks($, this.config)) {
        signal?.throwIfAborted();
        try {
          const detailHtml = await this.fetchPage(href.replace(this.config.baseUrl, ""), signal);
          let comp = parseYourUkCompetitionDetail(detailHtml, this.config, href);
          if (!comp && isYourUkLiveDrawDetail(detailHtml)) {
            const entryListPath = `${href
              .replace(this.config.baseUrl, "")
              .replace(/\/$/, "")}/entry-list`;
            const entryListHtml = await this.fetchPage(entryListPath, signal);
            comp = parseYourUkCompetitionDetail(
              detailHtml,
              this.config,
              href,
              entryListHtml,
            );
          }
          if (comp) comps.push(comp);
        } catch {
          signal?.throwIfAborted();
          continue;
        }
      }
      return comps;
    }

    switch (this.config.siteName) {
      case "theluckydip":
        return parseTheLuckyDip($, this.config);
      case "rafflerays":
        return parseRaffleRaysApi(html, this.config);
      case "jammy":
        return this.enrichJammyDetails(parseJammy($, this.config), signal);
      case "competitionfox":
        return parseCompetitionFox($, this.config);
      case "rkings":
        return parseRKings(html, this.config);
      case "spincompetitions":
        return parseSpinCompetitions($, this.config);
      case "victoryvaults":
        return parseVictoryVaults($, this.config);
      case "luckyturbo":
        return parseLuckyTurbo($, this.config);
      case "luckycharm":
        return this.enrichStaticDrawDates(parseLuckyCharm($, this.config), signal);
      case "marinecomps":
        return this.enrichMarineDetails(parseMarineComps($, this.config), signal);
      case "realcomps":
        return parseRealComps($, this.config);
      case "bikelifecompetitions":
        return parseBikeLife($, this.config);
      case "donkeycomps":
        return this.enrichDonkeyDetails(parseDonkeyComps($, this.config), signal);
      case "winwise":
        return parseWinWise($, this.config);
      case "campervanwin":
        return parseCampervanWin($, this.config);
      case "campercompetitions":
        return parseCamperCompetitions($, this.config);
      case "borders":
        return this.enrichStaticDrawDates(parseBorders($, this.config), signal);
      case "competitionplatform":
        return parseCompetitionPlatform($, this.config);
      case "twofatladies":
        return parseTwoFatLadies($, this.config);
      case "cameracomps":
        return parseCameraComps($, this.config);
      case "youngcomps":
        return parseYoungComps($, this.config);
      case "flashcompetitions":
        return parseFlashCompetitions($, this.config);
      case "fifty20":
        return parseFifty20(html, this.config);
      default:
        return [];
    }
  }

  private async fetchPage(path: string, signal?: AbortSignal): Promise<string> {
    const url = `${this.config.baseUrl}${path}`;

    if (RENDERED_STATIC_SITES.has(this.config.siteName)) {
      try {
        return await this.renderedPageFetcher(url, "body", signal);
      } catch (error) {
        signal?.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`[${this.config.displayName}] Failed to render ${url}: ${message}`);
      }
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { "User-Agent": this.config.userAgent },
          signal,
        });

        if (!response.ok) {
          if (this.config.siteName === "winwise" && response.status === 403) {
            return "";
          }

          if (attempt < 3 && [502, 503, 504].includes(response.status)) {
            await delay(attempt * 500);
            continue;
          }

          throw new Error(`HTTP ${response.status}`);
        }

        return response.text();
      } catch (error) {
        signal?.throwIfAborted();
        lastError = error;
        if (attempt < 3) {
          await delay(attempt * 500);
          continue;
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`[${this.config.displayName}] Failed to fetch ${url}: ${message}`);
  }

  private async fetchPrizeQueenStoreProducts(signal?: AbortSignal): Promise<RawCompetition[]> {
    const json = await this.fetchPage(
      "/wp-json/wc/store/v1/products?type=lottery&per_page=100",
      signal,
    );
    return parsePrizeQueenStoreProducts(json, this.config);
  }

  private async enrichStaticDrawDates(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched: RawCompetition[] = [];

    for (const competition of competitions) {
      signal?.throwIfAborted();
      if (
        competition.drawDate !== null ||
        (competition.entryPrice <= 0 && !isFreeEntry(competition)) ||
        competition.maxTickets <= 0
      ) {
        enriched.push(competition);
        continue;
      }

      try {
        const detailHtml = await this.fetchPage(
          competition.url.replace(this.config.baseUrl, ""),
          signal,
        );
        const text = cleanText(cheerio.load(detailHtml).text());
        enriched.push({
          ...competition,
          drawDate:
            extractDrawDate(detailHtml, text) ??
            extractScheduledEventEndDate(detailHtml) ??
            competition.drawDate,
        });
      } catch {
        signal?.throwIfAborted();
        enriched.push(competition);
      }
    }

    return enriched;
  }

  private async enrichDonkeyDetails(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched: RawCompetition[] = [];

    for (const competition of competitions) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await this.fetchPage(
          competition.url.replace(this.config.baseUrl, ""),
          signal,
        );
        enriched.push(enrichDonkeyCompetition(competition, detailHtml));
      } catch {
        signal?.throwIfAborted();
        enriched.push(competition);
      }
    }

    return enriched;
  }

  private async enrichJammyDetails(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched: RawCompetition[] = [];

    for (const competition of competitions) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await this.fetchPage(
          competition.url.replace(this.config.baseUrl, ""),
          signal,
        );
        enriched.push(enrichJammyCompetition(competition, detailHtml));
      } catch {
        signal?.throwIfAborted();
        enriched.push(competition);
      }
    }

    return enriched;
  }

  private async enrichMarineDetails(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched: RawCompetition[] = [];

    for (const competition of competitions) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await this.fetchPage(
          competition.url.replace(this.config.baseUrl, ""),
          signal,
        );
        enriched.push(enrichMarineCompetition(competition, detailHtml));
      } catch {
        signal?.throwIfAborted();
        enriched.push(competition);
      }
    }

    return enriched;
  }

  private async enrichKitchenDrawDetails(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched: RawCompetition[] = [];

    for (const competition of competitions) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await this.fetchPage(
          competition.url.replace(this.config.baseUrl, ""),
          signal,
        );
        enriched.push(enrichKitchenDrawCompetition(competition, detailHtml));
      } catch {
        signal?.throwIfAborted();
        enriched.push(competition);
      }
    }

    return enriched;
  }

  private async enrichNorthCoastDetails(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    const enriched: RawCompetition[] = [];

    for (const competition of competitions) {
      signal?.throwIfAborted();
      try {
        const detailHtml = await this.fetchPage(
          competition.url.replace(this.config.baseUrl, ""),
          signal,
        );
        const detailText = cleanText(cheerio.load(detailHtml).text());
        const maxEntriesPerUser = parseNumber(
          detailHtml.match(/data-raffle_mpp="(\d+)"/)?.[1],
        );
        enriched.push({
          ...competition,
          drawDate:
            extractDrawDate(detailHtml, detailText) ??
            competition.drawDate,
          maxEntriesPerUser: maxEntriesPerUser || competition.maxEntriesPerUser,
          maxEntriesPerUserSource: maxEntriesPerUser > 0
            ? "site"
            : competition.maxEntriesPerUserSource ?? "fallback",
        });
      } catch {
        signal?.throwIfAborted();
        enriched.push(competition);
      }
    }

    return enriched;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFreeEntry(competition: RawCompetition): boolean {
  return (
    competition.entryPrice === 0 &&
    (
      competition.categories.some((category) => category.trim().toLowerCase() === "free") ||
      /\bfree\s+(?:to\s+enter|entry|draw|raffle|ticket)\b/i.test(competition.name)
    )
  );
}

const GENERIC_WOO_DETAIL_SITES = new Set([
  "trinityclub",
  "toomuch",
  "coast2coast",
  "enhancedlife",
  "eastcoast",
  "pixieprizes",
  "magma",
  "lxry",
  "prizestorm",
  "southlakes",
  "winnerwonderland",
  "collie",
  "luckyescape",
  "ucomps",
  "kocompetitions",
  "netadeal",
  "tradetoolgiveaways",
  "in2win",
  "ultimatetool",
  "hbcompetitions",
  "epcomps",
  "gamingloot",
  "cannycomps",
  "luckybox",
  "letswin",
  "equinegiveaways",
  "islandcompetitions",
  "winswinswins",
  "heaven",
  "mcv",
  "prizepig",
  "flagship",
  "campfirecomps",
  "cashcity",
  "freshfishing",
  "10to2",
  "belter",
  "rocketdraws",
  "theprizelab",
  "toptrade",
  "vanquish",
  "buzzcompetitions",
  "tabletoptombola",
  "beethewinner",
  "giveawayguysuk",
  "winabundle",
  "winningwaze",
  "pureprizes",
  "empirecompetitions",
  "flexcompetitions",
  "pitstopprizes",
  "salexmo",
  "luckyday",
  "audrey",
  "luckybucks",
  "bitcomps",
  "gaminggiveaways",
  "littlewinzclub",
  "nopl",
  "puravidacompetitions",
  "prizequeen",
  "3cheers",
  "theluckyhunter",
  "wildergoat",
  "oddson",
  "golfstar",
  "prestigewatchcircle",
  "prizerunner",
  "gimmegiveaways",
  "truedreamcompetitions",
  "imperiumwheels",
  "lemonpig",
  "area52",
  "monkylondon",
  "rarecandy",
  "costacomps",
  "ultimatetrailer",
  "rrwins",
  "carphunter",
  "boonycompetitions",
  "valtorix",
  "fullmotioncomps",
]);

const RENDERED_STATIC_SITES = new Set([
  "puravidacompetitions",
  "costacomps",
  "ultimatetrailer",
  "rrwins",
  "carphunter",
  "flashcompetitions",
]);

function parseFlashCompetitions(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const competitions: RawCompetition[] = [];

  $("#question_step1 .home__question_inner-quiz").each((_index, element) => {
    const card = $(element);
    const name = cleanText(card.find("h3").first().text());
    const inventory = cleanText(card.find(".home__question_inner-quiz_bar-text").first().text())
      .match(/^(\d[\d,]*)\s*\/\s*(\d[\d,]*)$/);
    const closeText = cleanText(card.find(".home__question_inner-quiz_closing").first().text());
    const prizeText = cleanText(card.find(".home__question_inner-quiz_prize").first().text());
    const entryPrice = parsePrice(card.find(".home__question_inner-quiz_cost").first().text());
    const drawDate = parseFlashDrawDate(closeText);
    const sold = parseNumber(inventory?.[1]);
    const maxTickets = parseNumber(inventory?.[2]);

    if (!name || !inventory || entryPrice <= 0 || maxTickets <= 0 || !drawDate) return;

    const isInstantWin = /instant\s+wins?|extra\s+winners|if\s+competition\s+sells\s+out/i.test(prizeText);
    const sourceId = card.find(".enter_quiz").first().attr("data-id") || slugify(name);
    competitions.push(raw(config, `flash-${sourceId}`, `${config.baseUrl}/#enter`, name, {
      entryPrice,
      ticketsSold: sold,
      maxTickets,
      cashAlternative: isInstantWin ? null : extractCashPrizeTitle(`${name} ${prizeText}`),
      drawDate,
      categories: isInstantWin ? ["instant-win"] : ["cash"],
      scrapedAt: new Date().toISOString(),
    }));
  });

  return competitions;
}

function parseFlashDrawDate(text: string): string | null {
  const match = text.match(/Closes:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/i);
  if (!match) return null;

  const date = DateTime.fromFormat(
    `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}`,
    "dd/MM/yyyy HH:mm",
    { zone: "Europe/London" },
  );
  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function parseNorthCoast(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  $('a[href*="/product/"]').each((_i, el) => {
    const href = absoluteUrl(config, $(el).attr("href") || "");
    if (!href.startsWith(`${config.baseUrl}/product/`) || seen.has(href)) return;

    const card = $(el).closest(".item");
    const container = card.length > 0 ? card : nearestUsefulContainer($, $(el));
    const text = cleanText(container.text());
    const sold = parseNumber(text.match(/(\d+)\s+Tickets?\s+Sold/i)?.[1]);
    const remaining = parseNumber(text.match(/(\d+)\s+remaining/i)?.[1]);
    const entryPrice = parseEntryPrice(text);
    if (sold < 0 || remaining <= 0 || entryPrice <= 0) return;

    const name =
      cleanText(container.find("h1, h2, h3, .title").first().text()) ||
      cleanText($(el).text()) ||
      slugFromUrl(href)?.replace(/-/g, " ") ||
      "";
    const sourceId = slugFromUrl(href);
    if (!name || !sourceId) return;

    seen.add(href);
    comps.push(raw(config, sourceId, href, name, {
      entryPrice,
      ticketsSold: sold,
      maxTickets: sold + remaining,
      cashAlternative: extractCashAlternative(name),
      scrapedAt: now,
    }));
  });

  return comps;
}

function parseRealComps(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  $(".content-product").each((_i, el) => {
    const card = $(el);
    const href = absoluteUrl(
      config,
      card.find('a[href*="/product/"]').first().attr("href") || "",
    );
    if (!href.startsWith(`${config.baseUrl}/product/`) || seen.has(href)) return;

    const name = cleanText(card.find(".product-title").first().text());
    const text = cleanText(card.text());
    const sold = parseNumber(
      card.find(".lty-progress-bar-notice").first().text().match(/Tickets Sold:\s*([\d,]+)/i)?.[1],
    );
    const maxTickets = parseNumber(card.find(".lty-progress-bar-end").first().text());
    const entryPrice =
      parseEntryPrice(text) ||
      parseFloat(card.find(".price").first().text().match(/£\s*([\d.]+)/i)?.[1] ?? "");
    const sourceId = slugFromUrl(href);
    if (!name || !sourceId || sold < 0 || maxTickets <= 0 || entryPrice <= 0) return;

    const countdown = card.find(".lty-lottery-countdown-timer").attr("data-time");
    seen.add(href);
    comps.push(raw(config, sourceId, href, name, {
      entryPrice,
      ticketsSold: sold,
      maxTickets,
      maxEntriesPerUser: parseNumber(
        card.text().match(/Maximum\s+Tickets\s+per\s+person\s*:\s*(\d+)/i)?.[1],
      ) || undefined,
      cashAlternative: extractCashAlternative(name),
      drawDate: countdown ? dateFromText(countdown.replace(/\//g, "-")) : null,
      scrapedAt: now,
    }));
  });

  return comps;
}

function parseLuckyTurbo(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const payloadBySlug = extractLuckyTurboPayload($.html());

  $("a[href*='/competition/']").each((_i, el) => {
    const $link = $(el);
    const href = $link.attr("href") || "";
    const text = cleanText($link.text());
    if (!href || seen.has(href) || !/SOLD\s*\d/i.test(text)) return;
    if (!/£/.test(text) || /FREE/i.test(text)) return;

    const cashAlternative = extractLuckyTurboCashAlternative(text);
    if (cashAlternative === null) return;

    const price = extractLuckyTurboPrice(text);
    const name = extractLuckyTurboName(text, href);
    const sourceId = slugFromUrl(href) || slugify(name);
    if (!sourceId || seen.has(sourceId)) return;
    const payload = payloadBySlug.get(sourceId);
    if (price === 0) return;
    const hasExactInventory =
      payload?.ticketsSold !== null &&
      payload?.ticketsSold !== undefined &&
      payload.maxTickets !== null &&
      payload.maxTickets > 0 &&
      payload.ticketsSold >= 0 &&
      payload.ticketsSold <= payload.maxTickets;

    seen.add(href);
    seen.add(sourceId);
    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: payload?.ticketPrice ? payload.ticketPrice / 100 : price,
      ticketsSold: hasExactInventory ? payload.ticketsSold! : 0,
      maxTickets: hasExactInventory ? payload.maxTickets! : 0,
      maxEntriesPerUser:
        payload && payload.maxTicketsPerUser > 0 ? payload.maxTicketsPerUser : undefined,
      cashAlternative,
      drawDate:
        normalizeLuckyTurboDate(payload?.drawDate) ??
        normalizeLuckyTurboDate(payload?.endDate) ??
        extractRelativeDaysDrawDate(text),
      scrapedAt: now,
    }));
  });

  return comps;
}

interface LuckyTurboPayloadCompetition {
  ticketPrice: number | null;
  maxTickets: number | null;
  maxTicketsPerUser: number;
  ticketsSold: number | null;
  endDate: string | null;
  drawDate: string | null;
}

function extractLuckyTurboPayload(html: string): Map<string, LuckyTurboPayloadCompetition> {
  const payloadBySlug = new Map<string, LuckyTurboPayloadCompetition>();
  const text = html.replace(/\\"/g, '"');
  const pattern =
    /\{"id":\d+,"title":"[^"]*","slug":"([^"]+)"[\s\S]*?"ticketPrice":(\d+|null)[\s\S]*?"maxTickets":(\d+|null),"maxTicketsPerUser":(\d+|null),"ticketsSold":(\d+|null)[\s\S]*?"mainPrizeTitle":"[^"]*"[\s\S]*?"mainPrizeValue":(?:\d+|null)[\s\S]*?"endDate":(?:"([^"]+)"|null),"drawDate":(?:"([^"]+)"|null)[\s\S]*?"type":"[^"]+"[\s\S]*?"status":"active"/g;

  for (const match of text.matchAll(pattern)) {
    payloadBySlug.set(match[1], {
      ticketPrice: parseNullableLuckyTurboNumber(match[2]),
      maxTickets: parseNullableLuckyTurboNumber(match[3]),
      maxTicketsPerUser: parseNullableLuckyTurboNumber(match[4]) ?? 0,
      ticketsSold: parseNullableLuckyTurboNumber(match[5]),
      endDate: match[6] ?? null,
      drawDate: match[7] ?? null,
    });
  }

  return payloadBySlug;
}

function parseNullableLuckyTurboNumber(value: string | undefined): number | null {
  if (!value || value === "null") return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeLuckyTurboDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseTheLuckyDip(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const text = cleanText($("body").text());
  const productLinks = Array.from(
    new Set(
      $("a[href*='/product/']")
        .add("a[href^='product/']")
        .map((_i, el) => absoluteUrl(config, $(el).attr("href") || ""))
        .get()
        .filter((href) => href.includes("/product/")),
    ),
  );
  const now = new Date().toISOString();
  const comps: RawCompetition[] = [];
  const seen = new Set<string>();

  const pattern =
    /Closes\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)\s+[A-Za-z]+\s+(.+?)\s+£\s*([\d.]+)\s+0\s+Tickets\s+Sold:\s*([\d,]+)\s+([\d,]+)\s+\d+(?:\.\d+)?%\s+ENTER\s+NOW/gi;
  let match: RegExpExecArray | null;
  let linkIndex = 0;

  while ((match = pattern.exec(text)) !== null) {
    const name = cleanText(match[7]);
    const href = productLinks[linkIndex] ?? `${config.baseUrl}/competitions/`;
    linkIndex += 1;

    const cashAlternative = extractCashPrizeTitle(name);
    if (!cashAlternative) continue;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);

    const drawDate = dateFromNumericParts(
      match[1],
      match[2],
      match[3],
      match[4],
      match[5],
      match[6],
    );

    comps.push(raw(config, sourceId, href, name, {
      entryPrice: parseFloat(match[8]),
      ticketsSold: parseNumber(match[9]),
      maxTickets: parseNumber(match[10]),
      cashAlternative,
      drawDate,
      isAutoDraw: /\bInstant Wins?\b/i.test(name),
      scrapedAt: now,
    }));
  }

  return comps;
}

function parseRaffleRaysApi(
  json: string,
  config: StaticListSiteConfig,
): RawCompetition[] {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return [];
  }

  const competitions = (payload as { competitions?: unknown }).competitions;
  if (!Array.isArray(competitions)) return [];

  const now = new Date().toISOString();
  const comps: RawCompetition[] = [];

  for (const item of competitions) {
    if (!item || typeof item !== "object") continue;
    const competition = item as Record<string, unknown>;

    const status = String(competition.status ?? "");
    const title = String(competition.title ?? "").trim();
    const slug = String(competition.slug ?? competition.id ?? "").trim();
    if (status !== "ACTIVE" || !title || !slug) continue;
    if (competition.enableInstantWins === true) continue;

    const endDate =
      typeof competition.endDate === "string"
        ? competition.endDate
        : typeof competition.drawDate === "string"
          ? competition.drawDate
          : null;
    if (!endDate || new Date(endDate).getTime() <= Date.now()) continue;

    const description = String(competition.prizeDescription ?? competition.description ?? "");
    const cashAlternative =
      extractCashPrizeTitle(title) ??
      extractCashPrizeTitle(description) ??
      extractRaffleRaysCashAlternative(title);
    if (!cashAlternative) continue;

    const maxTickets = numberFromUnknown(competition.maxTickets);
    const ticketPrice = numberFromUnknown(competition.ticketPrice);
    if (maxTickets === 0 || ticketPrice === 0) continue;

    comps.push(raw(config, slugify(slug), `${config.baseUrl}/competitions/${slug}`, title, {
      entryPrice: ticketPrice,
      ticketsSold: numberFromUnknown(competition.soldTickets),
      maxTickets,
      maxEntriesPerUser: numberFromUnknown(competition.maxTicketsPerUser) || 100,
      cashAlternative,
      drawDate: new Date(endDate).toISOString(),
      scrapedAt: now,
    }));
  }

  return comps;
}

function parseRKings(
  html: string,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!nextDataMatch) return [];

  let payload: unknown;
  try {
    payload = JSON.parse(nextDataMatch[1]);
  } catch {
    return [];
  }

  const competitions = (
    payload as {
      props?: {
        pageProps?: {
          competitions?: unknown;
          data?: unknown;
        };
      };
    }
  ).props?.pageProps?.competitions ??
    (
      payload as {
        props?: {
          pageProps?: {
            data?: unknown;
          };
        };
      }
    ).props?.pageProps?.data;
  if (!Array.isArray(competitions)) return [];

  const now = new Date().toISOString();
  const comps: RawCompetition[] = [];

  for (const item of competitions) {
    if (!item || typeof item !== "object") continue;
    const competition = item as Record<string, unknown>;

    const status = numberFromUnknown(competition.status);
    const shortName = String(competition.short_name ?? "").trim();
    const title = cleanText(String(competition.title ?? ""));
    const drawDateRaw = String(competition.draw_date ?? competition.time ?? "").trim();
    const maxTickets = numberFromUnknown(competition.tickets_total);
    const ticketsSold = numberFromUnknown(competition.tickets_sold);
    const maxEntriesPerUser = numberFromUnknown(competition.user_limit_amount) || 100;
    const salePrice = decimalFromUnknown(competition.sale_price);
    const price = decimalFromUnknown(competition.price);
    const entryPrice = salePrice > 0 ? salePrice : price;

    if (
      status !== 1 ||
      !shortName ||
      !title ||
      !drawDateRaw ||
      maxTickets <= 0 ||
      entryPrice <= 0
    ) {
      continue;
    }

    const drawDate = new Date(drawDateRaw);
    if (Number.isNaN(drawDate.getTime()) || drawDate.getTime() <= Date.now()) {
      continue;
    }

    comps.push(
      raw(
        config,
        shortName,
        `${config.baseUrl}/competitions/${shortName}`,
        title,
        {
          entryPrice,
          ticketsSold,
          maxTickets,
          maxEntriesPerUser,
          cashAlternative:
            extractCashAlternative(title) ??
            extractCashPrizeTitle(title) ??
            extractLargeCashAmountFromName(title),
          drawDate: drawDate.toISOString(),
          scrapedAt: now,
        },
      ),
    );
  }

  return comps;
}

function parseJammy(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  $("li.product, div.product").each((_i, el) => {
    const $card = $(el);
    const href = $card.find("a[href*='/shop/']").first().attr("href") || "";
    const name = cleanText($card.find("img[alt]").first().attr("alt") || "");
    if (!href || !name || seen.has(href)) return;

    const cashAlternative = extractJammyCashAlternative(name);
    if (!cashAlternative) return;

    const text = cleanText($card.text());
    const entryPrice = parsePrice($card.find(".price").first().text());
    if (entryPrice === 0) return;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (!sourceId || seen.has(sourceId)) return;
    seen.add(href);
    seen.add(sourceId);

    const drawDate = parseJammyDrawDate($card, text);
    if (drawDate && new Date(drawDate).getTime() <= Date.now()) return;

    comps.push(raw(config, sourceId, href, name, {
      entryPrice,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: extractMaxEntriesPerUser(text),
      cashAlternative,
      drawDate,
      isAutoDraw: /auto\s*draw/i.test(text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function enrichJammyCompetition(
  competition: RawCompetition,
  detailHtml: string,
): RawCompetition {
  const $ = cheerio.load(detailHtml);
  const $inventory = $(".tps-split-wrapper").first();
  const $ticketControls = $(".jqs-wrapper").first();
  if ($inventory.length === 0 || $ticketControls.length === 0) return competition;
  const sold = parseNumber(
    $inventory
      .find(".tps-split-sold .big")
      .first()
      .text()
      .match(/[\d,]+/)?.[0],
  );
  const remaining = parseNumber(
    $inventory
      .find(".tps-split-remaining .big")
      .first()
      .text()
      .match(/[\d,]+/)?.[0],
  );
  const statedTotal = parseNumber(
    $ticketControls
      .find(".jqs-total-tickets")
      .first()
      .text()
      .match(/Total:\s*([\d,]+)\s+Tickets?/i)?.[1],
  );
  const computedTotal = sold + remaining;
  const hasExactInventory =
    computedTotal > 0 &&
    sold >= 0 &&
    remaining >= 0 &&
    (statedTotal === 0 || statedTotal === computedTotal);
  const maxEntriesPerUser = parseNumber(
    $ticketControls.find(".jqs-form[data-max]").first().attr("data-max"),
  );

  return {
    ...competition,
    ticketsSold: hasExactInventory ? sold : competition.ticketsSold,
    maxTickets: hasExactInventory ? computedTotal : competition.maxTickets,
    maxEntriesPerUser:
      maxEntriesPerUser > 0
        ? maxEntriesPerUser
        : competition.maxEntriesPerUser,
    maxEntriesPerUserSource:
      maxEntriesPerUser > 0
        ? "site"
        : competition.maxEntriesPerUserSource,
  };
}

function parseCompetitionFox(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const seen = new Set<string>();
  const now = new Date().toISOString();

  $("li.product, div.product").each((_i, el) => {
    const $card = $(el);
    const href = $card.find("a[href*='/competition/']").first().attr("href") || "";
    const text = cleanText($card.text());
    if (!href || seen.has(href)) return;

    const header = text.match(/^([\d,]+)\s*\/\s*([\d,]+)\s+(.+?)\s+([\d,]+)\s+Left\s+£\s*([\d.]+)/i);
    if (!header) return;

    const sold = parseNumber(header[1]);
    const maxTickets = parseNumber(header[2]);
    const name = cleanText(header[3]);
    const entryPrice = parseFloat(header[5]);
    if (!name || sold < 0 || maxTickets === 0 || entryPrice === 0) return;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (!sourceId || seen.has(sourceId)) return;

    const cashAlternative = extractCompetitionFoxCashAlternative(name);
    if (!cashAlternative && !isSupportedCompetitionFoxNonCashPrize(sourceId)) return;

    const drawDate = parseCompetitionFoxDrawDate(name);
    if (!drawDate || new Date(drawDate).getTime() <= Date.now()) return;

    seen.add(href);
    seen.add(sourceId);

    comps.push(raw(config, sourceId, href, name, {
      entryPrice,
      ticketsSold: sold,
      maxTickets,
      maxEntriesPerUser: extractMaxEntriesPerUser(text),
      cashAlternative,
      drawDate,
      isAutoDraw: /auto\s*win/i.test(name),
      scrapedAt: now,
    }));
  });

  return comps;
}

function isSupportedCompetitionFoxNonCashPrize(sourceId: string): boolean {
  return sourceId === "ninja-af110uk-4-7l-air-fryer-grey-auto-win-26-06";
}

function parseSpinCompetitions(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $(".jet-listing-grid__item").each((_i, el) => {
    const $card = $(el);
    const href = $card.find('a[href*="/competition/"]').first().attr("href") || "";
    const sourceId = slugFromUrl(href);
    if (!sourceId || seen.has(sourceId)) return;

    const text = cleanText($card.text());
    if (/view\s+winner|competition\s+closed|sold\s+out/i.test(text)) return;

    const maxTickets = parseNumber(text.match(/([\d,]+)\s+Total\b/i)?.[1]);
    const ticketsAvailable = parseNumber(
      text.match(/Tickets?\s+available:\s*([\d,]+)/i)?.[1],
    );
    const entryPrice = parseSpinEntryPrice(text);
    if (maxTickets <= 0 || entryPrice <= 0) return;

    const name =
      cleanText($card.find("h1, h2, h3").first().text()) ||
      sourceId.replace(/-/g, " ");

    seen.add(sourceId);
    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice,
      ticketsSold: Math.max(0, maxTickets - ticketsAvailable),
      maxTickets,
      maxEntriesPerUser:
        parseNumber(text.match(/([\d,]+)\s+Max\b/i)?.[1]) || 100,
      cashAlternative: extractExplicitCashAlternative(text),
      drawDate: extractDrawDate($card.html() ?? "", text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function parseSpinEntryPrice(text: string): number {
  const each = text.match(/£\s*([\d.]+)\s+Each\b/i);
  return each ? parseFloat(each[1]) : parseEntryPrice(text);
}

function parseVictoryVaults(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $("div.product").each((_i, el) => {
    const $card = $(el);
    const classes = $card.attr("class") || "";
    if (!classes.includes("product-type-lottery")) return;

    const text = cleanText($card.text());
    if (/view\s+winner|competition\s+closed|sold\s+out/i.test(text)) return;

    const href = $card.find('a[href*="/product/"]').first().attr("href") || "";
    const sourceId = slugFromUrl(href);
    if (!sourceId || seen.has(sourceId)) return;

    const name =
      cleanText($card.find(".product-title a, h2 a, h3 a").first().text()) ||
      cleanText($card.find("img[alt]").first().attr("alt") ?? "") ||
      sourceId.replace(/-/g, " ");
    if (!name) return;

    const maxTickets =
      parseNumber($card.find(".lty-progress-bar-end").last().text()) ||
      parseNumber(text.match(/Tickets?\s+Sold:\s*[\d,]+\s+([\d,]+)/i)?.[1]);
    const ticketsSold =
      parseNumber(
        $card.find(".lty-progress-bar-notice").text().match(/Tickets?\s+Sold:\s*([\d,]+)/i)?.[1],
      ) ||
      parseNumber(text.match(/Tickets?\s+Sold:\s*([\d,]+)/i)?.[1]);
    const priceText = cleanText($card.find(".price").first().text());
    const entryPrice = priceText.length > 0 ? parsePrice(priceText) : parsePrice(text);
    if (maxTickets <= 0 || entryPrice < 0) return;

    seen.add(sourceId);
    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice,
      ticketsSold,
      maxTickets,
      cashAlternative: extractCashAlternative(name) ?? extractCashAlternative(text),
      drawDate: parseVictoryVaultsDrawDate(text),
      categories: extractProductCategories(classes),
      scrapedAt: now,
    }));
  });

  return comps;
}

function parseVictoryVaultsDrawDate(text: string): string | null {
  const match = text.match(
    /Closes\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  return match
    ? dateFromNumericParts(
        match[1],
        match[2],
        match[3],
        match[4],
        match[5] ?? "00",
        match[6],
      )
    : null;
}

function extractProductCategories(classes: string): string[] {
  return Array.from(classes.matchAll(/product_cat-([^\s]+)/g), (match) =>
    match[1].replace(/-/g, " "),
  ).filter((category, index, categories) =>
    !["active", "uncategorized"].includes(category) &&
    categories.indexOf(category) === index,
  );
}

function parseLuckyCharm(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $("li.product, div.product").each((_i, el) => {
    const $card = $(el);
    const text = cleanText($card.text());
    if (!/Tickets remaining/i.test(text)) return;

    const href = $card.find("a[href]").first().attr("href") || "";
    const name =
      $card.find("h2, h3, h4").first().text().trim() ||
      text.match(/Tickets remaining\s+(.+?)\s+£/)?.[1]?.trim() ||
      "";
    if (!href || !name) return;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (seen.has(sourceId)) return;
    seen.add(sourceId);

    let maxTickets = parseNumber(text.match(/\b(\d[\d,]*)\s+available/i)?.[1]);
    const remaining = parseNumber(text.match(/(\d[\d,]*)\s+Tickets remaining/i)?.[1]);
    if (maxTickets === 0 && remaining > 0) {
      maxTickets = parseNumber(
        text.match(/\b(\d[\d,]*)\s+[\d.]+%\s+\d[\d,]*\s+Tickets remaining/i)?.[1],
      );
    }
    const ticketsSold = maxTickets > 0 && remaining >= 0 ? maxTickets - remaining : 0;
    const entryPrice = extractLuckyCharmEntryPrice(text);

    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice,
      ticketsSold,
      maxTickets,
      cashAlternative: extractLuckyCharmCashAlternative(text),
      categories: /\bfree\s+2\s+enter\b/i.test(name) ? ["free"] : [],
      scrapedAt: now,
    }));
  });

  return comps;
}

function extractLuckyCharmCashAlternative(text: string): number | null {
  const explicit =
    text.match(/Cash\s*(?:Alternative|Alt):\s*£\s*([\d,.]+)\s*(k\b)?/i) ||
    text.match(/\bor\s+£\s*([\d,.]+)\s*(k\b)?\s*cash/i) ||
    text.match(/£\s*([\d,.]+)\s*(k\b)?\s*(?:tax[\s-‑–—]*free\s+)?cash\b/i);
  return explicit ? parseCashAmount(explicit[1], explicit[2]) : null;
}

function extractLuckyCharmEntryPrice(text: string): number {
  const pencePerEntry = text.match(/(\d+)p\s+per\s+(?:entry|ticket)/i);
  if (pencePerEntry) return parseInt(pencePerEntry[1], 10) / 100;

  const prices = Array.from(text.matchAll(/£\s*([\d.]+)/g));
  const lastPrice = prices.at(-1)?.[1];
  return lastPrice ? parseFloat(lastPrice) : 0;
}

function parseMarineComps(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $("li.product, div.product").each((_i, el) => {
    const $card = $(el);
    const text = cleanText($card.text());
    if (!/LIVE/i.test(text) || !/%\s*SOLD/i.test(text)) return;

    const href = $card.find("a[href]").first().attr("href") || "";
    const name = text
      .replace(/^From\s+£\s*[\d.]+/i, "")
      .replace(/\bLIVE\s*-\s*[\d.]+%\s*SOLD/i, "")
      .replace(/£\s*[\d.]+.*$/i, "")
      .trim();
    if (!href || !name) return;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (seen.has(sourceId)) return;
    seen.add(sourceId);

    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: parsePrice(text),
      ticketsSold: 0,
      maxTickets: 0,
      cashAlternative: extractCashAlternative(text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function enrichMarineCompetition(
  competition: RawCompetition,
  detailHtml: string,
): RawCompetition {
  const $ = cheerio.load(detailHtml);
  const $product = $(".product[id^='product-']").first();
  const $summary = $product.find(".summary.entry-summary").first();
  const $scope = $summary.length > 0 ? $summary : $product;
  if ($scope.length === 0) return competition;

  const text = cleanText($scope.text());
  const inventory = extractSoldMax(text);
  const detailPrice = Number(
    $scope.find(".marine-ticket-bundles[data-unit-price]").first().attr("data-unit-price"),
  );
  const maxEntriesPerUser = parseNumber(
    $scope.find("input.qty[name='quantity']").first().attr("max"),
  );
  const detailName = cleanText($product.find("h1").first().text());

  return {
    ...competition,
    name: detailName || competition.name,
    entryPrice:
      Number.isFinite(detailPrice) && detailPrice > 0
        ? detailPrice
        : competition.entryPrice,
    ticketsSold: inventory?.sold ?? competition.ticketsSold,
    maxTickets: inventory?.max ?? competition.maxTickets,
    maxEntriesPerUser:
      maxEntriesPerUser > 0
        ? maxEntriesPerUser
        : competition.maxEntriesPerUser,
    maxEntriesPerUserSource:
      maxEntriesPerUser > 0
        ? "site"
        : competition.maxEntriesPerUserSource,
    cashAlternative:
      extractCashAlternative(text) ?? competition.cashAlternative,
    drawDate:
      extractMarineDrawDate($scope) ?? competition.drawDate,
  };
}

function extractMarineDrawDate(
  $scope: cheerio.Cheerio<AnyNode>,
): string | null {
  const value = $scope.find("[data-duration]").first().attr("data-duration");
  if (!value) return null;

  const date = DateTime.fromFormat(value, "yyyy/MM/dd HH:mm:ss", {
    zone: "Europe/London",
  });
  return date.isValid
    ? date.toUTC().toISO({ suppressMilliseconds: false })
    : null;
}

function parseDonkeyComps(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $("a").each((_i, el) => {
    const $link = $(el);
    if (!/Enter Now/i.test($link.text())) return;

    const href = $link.attr("href") || "";
    const $card = nearestUsefulContainer($, $link);
    const text = cleanText($card.text());
    if (!href || !/£[\d.]+\s*per\s*Entry/i.test(text)) return;

    const imgName =
      $card.find("img").first().attr("alt")?.trim() ||
      $link.prevAll("img").first().attr("alt")?.trim() ||
      $link.parent().prevAll().find("img").last().attr("alt")?.trim();
    const name =
      imgName ||
      text
        .replace(/^£[\d.]+\s*per\s*Entry/i, "")
        .replace(/Enter Now.*$/i, "")
        .trim();
    if (!name) return;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (seen.has(sourceId)) return;
    seen.add(sourceId);

    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: parsePrice(text),
      ticketsSold: 0,
      maxTickets: 0,
      cashAlternative: extractCashAlternative(text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function enrichDonkeyCompetition(
  competition: RawCompetition,
  detailHtml: string,
): RawCompetition {
  const $ = cheerio.load(detailHtml);
  const text = cleanText($("body").text());

  const progress = $("progress").first();
  const maxTickets =
    parseNumber(progress.attr("max")) ||
    parseNumber(text.match(/limited\s+to\s+([\d,]+)\s+tickets/i)?.[1]);
  const ticketsSold =
    parseNumber(progress.attr("value")) ||
    parseNumber(text.match(/Tickets\s+sold:\s*([\d,]+)/i)?.[1]);
  const maxEntriesPerUser =
    parseNumber($("input.qty").first().attr("max")) ||
    extractMaxEntriesPerUser(text);

  return {
    ...competition,
    ticketsSold: ticketsSold || competition.ticketsSold,
    maxTickets: maxTickets || competition.maxTickets,
    maxEntriesPerUser,
    cashAlternative:
      extractCashAlternative(text) ?? competition.cashAlternative,
    drawDate: extractDrawDate(detailHtml, text) ?? competition.drawDate,
  };
}

function parseWinWise(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $(".ww-competition-card, [data-url]").each((_i, el) => {
    const $card = $(el);
    const text = cleanText($card.text());
    if (!/£[\d.]+/.test(text) || !/%/.test(text)) return;

    const href =
      $card.attr("data-url") ||
      $card.find("a[href*='/product/']").first().attr("href") ||
      "";
    if (!href) return;

    const imgName = $card.find("img").first().attr("alt")?.trim();
    const name =
      imgName ||
      text.match(/(?:INSTANT WIN|LIVE DRAW)\s+(.+?)\s+£/i)?.[1]?.trim() ||
      "";
    if (!name || /Prize Image/i.test(name)) return;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (seen.has(sourceId)) return;
    seen.add(sourceId);

    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: parsePrice(text),
      ticketsSold: 0,
      maxTickets: 0,
      cashAlternative: extractCashAlternative(text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function parseCampervanWin(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $("a[href^='/competitions/']").each((_i, el) => {
    const $link = $(el);
    const href = $link.attr("href") || "";
    const sourceId = slugFromUrl(href);
    if (!sourceId || seen.has(sourceId)) return;

    const $card = nearestCampervanWinContainer($, $link);
    const text = cleanText($card.text());
    if (!/(ENTRIES|SOLD|WORTH|ENTER\s+COMPETITION)/i.test(text)) return;
    if (/100%\s*SOLD|ENTRIES\s+SOLD\s+100%/i.test(text)) return;
    const name =
      $card.find("h1, h2, h3").first().text().trim() ||
      ($link.text().trim().startsWith("Win") ? $link.text().trim() : "") ||
      sourceId.replace(/-/g, " ");
    if (!name || name === "Competition End Date") return;

    const sold =
      parseNumber(text.match(/ENTRIES\s+SOLD\s+(\d[\d,]*)/i)?.[1]) ||
      parseNumber(text.match(/\b(\d[\d,]*)\s+ENTRIES\s+SOLD/i)?.[1]);
    const remaining =
      parseNumber(text.match(/ENTRIES\s+REMAINING\s+(\d[\d,]*)/i)?.[1]) ||
      parseNumber(text.match(/\b(\d[\d,]*)\s+ENTRIES\s+REMAINING/i)?.[1]);
    const maxTickets =
      sold > 0 && remaining > 0
        ? sold + remaining
        : 0;

    if (sold === 0 && remaining === 0 && !/%\s*SOLD/i.test(text)) return;
    if (maxTickets > 0 && sold >= maxTickets) return;

    seen.add(sourceId);
    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: 7.5,
      ticketsSold: sold,
      maxTickets,
      cashAlternative: extractCashAlternative(text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function parseCamperCompetitions(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const text = cleanText($("body").text());
  if (/coming soon/i.test(text) || /will launch/i.test(text)) return [];
  if (/ticket sales end(?:ed)?/i.test(text) && /winner|won|congratulations/i.test(text)) return [];

  const name =
    $("h1").first().text().trim() ||
    $(".product_title").first().text().trim() ||
    "Win a VW Campervan";
  if (!name) return [];

  const href = config.listPath;
  const sourceId = slugFromUrl(href) || slugify(name);
  const sold = parseNumber(text.match(/([\d,]+)\s*(?:tickets|entries)\s+sold/i)?.[1]);
  const maxTickets =
    parseNumber(text.match(/(?:maximum|max)\s+(?:of\s+)?([\d,]+)\s+(?:tickets|entries)/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+(?:tickets|entries)\s+available/i)?.[1]);

  return [raw(config, sourceId, absoluteUrl(config, href), name, {
    entryPrice: parsePrice(text),
    ticketsSold: sold,
    maxTickets,
    cashAlternative: extractCashAlternative(text),
    scrapedAt: new Date().toISOString(),
  })];
}

function parseBorders(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $(".mu-product-card").each((_i, el) => {
    const $card = $(el);
    const text = cleanText($card.text());
    const href = $card.find("a[href*='/product/']").first().attr("href") || "";
    if (!href || !/Tickets Sold/i.test(text)) return;

    const name =
      $card.find(".mu-product-title, h1, h2, h3, h4").first().text().trim() ||
      $card.find("img[alt]").first().attr("alt")?.trim() ||
      "";
    if (!name) return;

    const sourceId = slugFromUrl(href) || slugify(name);
    if (seen.has(sourceId)) return;
    seen.add(sourceId);

    const available = parseNumber(
      text.match(/Tickets\s+available:\s*([\d,]+)/i)?.[1],
    );
    const maxTickets = parseNumber(
      text.match(/Tickets\s+available:\s*[\d,]+\s+([\d,]+)/i)?.[1],
    );
    const ticketsSold = maxTickets > 0 && available <= maxTickets
      ? maxTickets - available
      : 0;

    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: extractBordersEntryPrice(text),
      ticketsSold,
      maxTickets,
      cashAlternative: extractBordersCashAlternative(text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function extractBordersEntryPrice(text: string): number {
  const perEntry = text.match(/£\s*([\d.]+)\s*PER\s+ENTRY/i);
  if (perEntry) return parseFloat(perEntry[1]);

  const pencePerEntry = text.match(/(\d+)p\s*PER\s+ENTRY/i);
  if (pencePerEntry) return parseInt(pencePerEntry[1], 10) / 100;

  return parsePrice(text);
}

function extractBordersCashAlternative(text: string): number | null {
  const cashAlternative = text.match(
    /£\s*([\d,.]+)\s*(k\b)?\s*cash\s+alternative/i,
  );
  if (cashAlternative) {
    return parseCashAmount(cashAlternative[1], cashAlternative[2]);
  }

  return extractCashAlternative(text);
}

function parseCompetitionPlatform(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $('a[href^="/competitions/"]').each((_i, el) => {
    const $link = $(el);
    const href = $link.attr("href") || "";
    const sourceId = slugFromUrl(href);
    if (!sourceId || seen.has(sourceId)) return;

    const $card = nearestCompetitionPlatformContainer($, $link);
    const text = cleanText($card.text());
    if (!/%\s*Sold/i.test(text) || !/remaining/i.test(text) || !/Per Entry/i.test(text)) {
      return;
    }

    const name =
      $card.find("h1, h2, h3").first().text().trim() ||
      $link.text().trim() ||
      sourceId.replace(/-/g, " ");
    const inventory = extractSoldMax(text);

    seen.add(sourceId);
    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: parsePrice(text),
      ticketsSold: inventory?.sold ?? 0,
      maxTickets: inventory?.max ?? 0,
      cashAlternative: extractCashAlternative(text),
      scrapedAt: now,
      drawDate: parseCompetitionPlatformDrawDate(text),
    }));
  });

  return comps;
}

function parseKitchenDraw(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $(".kitchen_open_draw__grid-item, .kitchen-upsells--item").each((_i, el) => {
    const $card = $(el);
    const href = $card.find('a[href*="/product/"]').first().attr("href") || "";
    const sourceId = slugFromUrl(href);
    if (!sourceId || seen.has(sourceId)) return;

    const text = cleanText($card.text());
    const tickets = extractKitchenDrawTickets(text);
    if (!tickets) return;

    const name =
      cleanText($card.find("h2, h3").first().text()) ||
      sourceId.replace(/-/g, " ");
    const html = $card.html() ?? "";

    seen.add(sourceId);
    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: parseEntryPrice(text),
      ticketsSold: tickets.sold,
      maxTickets: tickets.max,
      cashAlternative: extractKitchenDrawCashAlternative(name),
      drawDate: extractDrawDate(html, text),
      scrapedAt: now,
    }));
  });

  return comps;
}

function enrichKitchenDrawCompetition(
  competition: RawCompetition,
  html: string,
): RawCompetition {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const detailFields = extractKitchenDrawDetailFields($);

  const estimatedPrizeValue =
    detailFields.estimatedPrizeValue ?? competition.estimatedPrizeValue ?? null;
  const hasSiteEstimate = estimatedPrizeValue !== null && estimatedPrizeValue > 0;

  return {
    ...competition,
    entryPrice: (parseHtmlEntryPrice(html) ?? parseEntryPrice(text)) || competition.entryPrice,
    ticketsSold: detailFields.tickets?.sold ?? competition.ticketsSold,
    maxTickets: detailFields.tickets?.max ?? competition.maxTickets,
    maxEntriesPerUser:
      detailFields.maxEntriesPerUser ??
      extractMaxEntriesPerUser(text) ??
      competition.maxEntriesPerUser,
    maxEntriesPerUserSource:
      detailFields.maxEntriesPerUser !== null || extractMaxEntriesPerUser(text) !== null
        ? "site"
        : competition.maxEntriesPerUserSource,
    cashAlternative:
      extractKitchenDrawCashAlternative(competition.name) ??
      extractKitchenDrawCashAlternative(text) ??
      competition.cashAlternative,
    drawDate: extractDrawDate(html, text) ?? competition.drawDate,
    estimatedPrizeValue,
    valuationSource:
      hasSiteEstimate
        ? "site_estimate"
        : competition.valuationSource,
    valuationConfidence:
      hasSiteEstimate
        ? "high"
        : competition.valuationConfidence,
    valuationNotes:
      hasSiteEstimate
        ? "Kitchen Draw Prize RRP from detail page"
        : competition.valuationNotes,
  };
}

function parseCompCityLinks(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  $('a[href^="/competitions/"], a[href^="https://compcitygiveaways.co.uk/competitions/"]').each(
    (_i, el) => {
      const $link = $(el);
      const href = $link.attr("href") || "";
      const text = cleanText($link.text());
      if (!/\d[\d,]*\s*\/\s*\d[\d,]*\s+entries/i.test(text)) return;

      const absolute = absoluteUrl(config, href);
      if (seen.has(absolute)) return;
      seen.add(absolute);
      links.push(absolute);
    },
  );

  return links.slice(0, 30);
}

function parseCompCityDetail(
  html: string,
  config: StaticListSiteConfig,
  href: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const sourceId = slugFromUrl(href);
  if (!sourceId) return null;

  const name =
    $("h1").first().text().trim() ||
    $("title").first().text().replace(/‹.*$/, "").trim() ||
    sourceId.replace(/-/g, " ");
  const soldMax = text.match(/Tickets\s+Sold\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const price = text.match(/Ticket\s+Price\s*£\s*([\d.]+)/i);
  if (!soldMax || !price) return null;
  const ticketsSold = parseNumber(soldMax[1]);
  const remaining = parseNumber(text.match(/([\d,]+)\s+remaining/i)?.[1]);
  const explicitMax =
    parseNumber(text.match(/Total\s+Tickets\s*([\d,]+)/i)?.[1]) ||
    (remaining > 0 ? remaining + ticketsSold : 0) ||
    parseNumber(soldMax[2]);

  const endDate =
    text.match(/End\s+Date\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})/i) ||
    text.match(/Draw\s+Date\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/i);
  const drawDate = endDate
    ? dateFromParts(
        endDate[1],
        endDate[2],
        endDate[3] ?? String(new Date().getFullYear()),
        endDate[4] ?? "20",
        endDate[5] ?? "00",
      )
    : null;

  const maxPerUser =
    parseNumber(text.match(/Max\s+Per\s+User\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/Max\s+Per\s+Order\s*([\d,]+)/i)?.[1]) ||
    100;

  return raw(config, sourceId, href, name, {
    entryPrice: parseFloat(price[1]),
    ticketsSold,
    maxTickets: explicitMax,
    maxEntriesPerUser: maxPerUser,
    cashAlternative: extractCompCityCashAlternative(text),
    drawDate,
    isAutoDraw: /Instant\s+Win|Instant\s+Prizes/i.test(text),
    scrapedAt: new Date().toISOString(),
  });
}

function extractCompCityCashAlternative(text: string): number | null {
  const match =
    text.match(/£\s*([\d,]+)\s*Cash\s+Alt/i) ||
    text.match(/\bor\s+£\s*([\d,]+)\s*Cash/i);
  return match ? parseNumber(match[1]) : null;
}

function parseCameraComps(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();

  $("li.productlisting_productcontainer").each((_i, el) => {
    const $card = $(el);
    const text = cleanText($card.text());
    const href = $card.find("a[href]").first().attr("href") || "";
    if (!href || !/Cash\s+Alternative/i.test(text)) return;

    const name =
      $card.find(".productlisting_title").first().text().trim() ||
      $card.find("img[alt]").first().attr("alt")?.trim() ||
      "";
    const soldMax = text.match(/([\d,]+)\s*\/\s*([\d,]+)\s*\([\d,]+\s+remaining\)/i);
    const price = text.match(/£\s*([\d.]+)\s+per\s+ticket/i);
    if (!name || !soldMax || !price) return;

    const compRef = text.match(/Comp\s+#(\d+)/i)?.[1];
    const sourceId = compRef ?? slugFromUrl(href) ?? slugify(name);
    const endDate = text.match(/Ends\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);

    comps.push(raw(config, sourceId, absoluteUrl(config, href), name, {
      entryPrice: parseFloat(price[1]),
      ticketsSold: parseNumber(soldMax[1]),
      maxTickets: parseNumber(soldMax[2]),
      cashAlternative: extractCameraCashAlternative(text),
      drawDate: endDate
        ? new Date(
            parseInt(endDate[3], 10),
            parseInt(endDate[2], 10) - 1,
            parseInt(endDate[1], 10),
            20,
            0,
            0,
            0,
          ).toISOString()
        : null,
      scrapedAt: now,
    }));
  });

  return comps;
}

function extractCameraCashAlternative(text: string): number | null {
  const match = text.match(/£\s*([\d,]+)\s*Cash\s+Alternative/i);
  return match ? parseNumber(match[1]) : null;
}

function parseYoungComps(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $('a[href^="/prizes/"]').each((_i, el) => {
    const $link = $(el);
    const href = $link.attr("href") || "";
    if (!href || href === "/prizes/every-ticket-wins") return;

    const $card = $link.find(".group").first();
    if ($card.length === 0) return;

    const text = cleanText($card.text());
    if (!/Tickets sold:/i.test(text) || !/Available:/i.test(text)) return;

    const sourceId = slugFromUrl(href);
    if (!sourceId || seen.has(sourceId)) return;

    const name =
      cleanText($card.find("h3").first().text()) ||
      sourceId.replace(/-/g, " ");
    if (isEntryBundlePrize(name)) return;

    const ticketsSold = parseNumber(text.match(/Tickets sold:\s*([\d,]+)/i)?.[1]);
    const maxTickets = parseNumber(text.match(/Available:\s*([\d,]+)/i)?.[1]);
    const drawDate = extractYoungCompsDrawDate($card);
    const entryPrice = extractYoungCompsEntryPrice($card);

    if (!name || maxTickets <= 0 || entryPrice <= 0 || drawDate === null) return;

    seen.add(sourceId);
    comps.push(
      raw(config, sourceId, absoluteUrl(config, href), name, {
        entryPrice,
        ticketsSold,
        maxTickets,
        maxEntriesPerUser: 100,
        cashAlternative:
          extractCashAlternative(name) ??
          extractCashPrizeTitle(name) ??
          extractLargeCashAmountFromName(name),
        drawDate,
        scrapedAt: now,
      }),
    );
  });

  return comps;
}

function extractYoungCompsDrawDate($card: cheerio.Cheerio<AnyNode>): string | null {
  const iso = $card.find(".countdown").first().attr("data-ends");
  if (iso) {
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const label = cleanText($card.find(".countdown").prev().text());
  const match = label.match(
    /([A-Za-z]{3})\s+(\d{1,2})(?:st|nd|rd|th)?\s*@\s*(\d{1,2}):(\d{2})/i,
  );
  if (!match) return null;

  return dateFromParts(
    match[2],
    match[1],
    String(new Date().getFullYear()),
    match[3],
    match[4],
  );
}

function extractYoungCompsEntryPrice($card: cheerio.Cheerio<AnyNode>): number {
  return parsePrice(cleanText($card.find("button span").last().text()));
}

function parseCoastListLinks(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  $('a[href^="/raffles/"], a[href^="https://www.coastcompetitions.com/raffles/"]').each(
    (_i, el) => {
      const href = $(el).attr("href") || "";
      if (href === "/raffles") return;
      const absolute = absoluteUrl(config, href);
      if (seen.has(absolute)) return;
      seen.add(absolute);
      links.push(absolute);
    },
  );

  $("script[type='application/ld+json']").each((_i, el) => {
    const text = $(el).text();
    if (!text.includes('"ItemList"')) return;
    try {
      const data = JSON.parse(text) as {
        itemListElement?: Array<{ url?: string }>;
      };
      for (const item of data.itemListElement ?? []) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        links.push(item.url);
      }
    } catch {
      // Ignore malformed structured data.
    }
  });

  return links;
}

function parseGenericCompetitionLinks(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  $('a[href*="/competition/"], a[href*="/competitions/"], a[href*="/product/"], a[href*="/products/"], a[href*="/raffle/"], a[href*="/shop/"], a[href*="/mission/"]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    const absolute = absoluteUrl(config, href);
    if (
      !absolute.startsWith(`${config.baseUrl}/competition/`) &&
      !absolute.startsWith(`${config.baseUrl}/competitions/`) &&
      !absolute.startsWith(`${config.baseUrl}/product/`) &&
      !absolute.startsWith(`${config.baseUrl}/products/`) &&
      !absolute.startsWith(`${config.baseUrl}/raffle/`) &&
      !absolute.startsWith(`${config.baseUrl}/shop/`) &&
      !absolute.startsWith(`${config.baseUrl}/mission/`)
    ) {
      return;
    }
    if (
      absolute === `${config.baseUrl}/competition/` ||
      absolute === `${config.baseUrl}/competitions/` ||
      absolute === `${config.baseUrl}/product/` ||
      absolute === `${config.baseUrl}/products/` ||
      absolute === `${config.baseUrl}/raffle/` ||
      absolute === `${config.baseUrl}/shop/` ||
      absolute === `${config.baseUrl}/mission/` ||
      absolute.includes("/product-category/") ||
      /\/competitions\/page\/\d+\/?$/i.test(absolute)
    ) {
      return;
    }
    const seenKey = normalizeCompetitionUrlKey(absolute);
    if (seen.has(seenKey)) return;
    seen.add(seenKey);
    links.push(absolute);
  });

  return links.slice(0, 40);
}

function normalizeCompetitionUrlKey(url: string): string {
  const trimmed = url.split("?")[0].replace(/\/$/, "");
  try {
    return decodeURIComponent(trimmed).toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function parseGenericPaginationLinks(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  const currentUrl = absoluteUrl(config, config.listPath).replace(/\/$/, "");

  $('a.page-numbers[href], link[rel="next"][href]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    const absolute = absoluteUrl(config, href);
    const normalized = absolute.replace(/\/$/, "");
    if (!absolute.startsWith(`${config.baseUrl}/`)) return;
    if (normalized === currentUrl || seen.has(absolute)) return;
    seen.add(absolute);
    links.push(absolute);
  });

  return links.slice(0, 5);
}

function parseGenericWooDetail(
  html: string,
  config: StaticListSiteConfig,
  href: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());

  const sourceId = slugFromUrl(href);
  let name =
    cleanText($("h1").first().text()) ||
    cleanText($(".product_title").first().text()) ||
    cleanText($('meta[property="og:title"]').attr("content") ?? "") ||
    cleanText($("title").first().text()) ||
    sourceId?.replace(/-/g, " ") ||
    "";
  if (!sourceId || !name) return null;
  if (config.siteName === "prestigewatchcircle") {
    return parsePrestigeWatchCircleDetail($, html, config, href, sourceId, name);
  }
  if (config.siteName === "valtorix") {
    const valtorixName =
      cleanText($("h3").first().text()) ||
      cleanText($("h2").first().text()).replace(/^Details of\s+/i, "") ||
      name;
    return parseValtorixDetail($, config, href, sourceId, valtorixName);
  }
  if (config.siteName === "ucomps" && /Instant Win/i.test(name)) return null;

  if (config.siteName === "pureprizes") {
    const prizeDetail = cleanText(
      $(".summary.entry-summary .prize-detail, .product .prize-detail")
        .first()
        .text(),
    );
    if (isEntryBundlePrize(prizeDetail)) {
      name = prizeDetail;
    } else if (/^\s*£?\s*[\d,.]+\s*$/.test(name)) {
      const descriptorPattern =
        /\b\d+\s*x\s*£\s*[\d,.]+\s+Instant Wins?\s+With\s+(?:A\s+)?£\s*[\d,.]+\s+End Prize\b/i;
      const descriptorScope = $(
        ".summary.entry-summary, .woocommerce-product-details__short-description, main .product",
      ).first();
      const descriptorText = cleanText(
        descriptorScope.find("p").filter((_i, element) =>
          descriptorPattern.test(cleanText($(element).text()))
        ).first().text(),
      );
      const descriptor = descriptorText.match(descriptorPattern)?.[0];
      if (descriptor) name = cleanText(descriptor);
    }
  }

  const scopedSummaryText = cleanText(
    $(".summary.entry-summary, .product .summary, main .summary").first().text(),
  );
  const primaryProduct = $(".product[id^='product-']").first();
  const productText = scopedSummaryText
    ? cleanText(`${name} ${scopedSummaryText}`)
    : (
    config.siteName === "beethewinner"
      ? extractBeeTheWinnerProductText(text, name)
      : config.siteName === "fullmotioncomps" && primaryProduct.length > 0
        ? extractFullMotionProductText(primaryProduct, name)
        : extractPrimaryProductText(text, name)
    );
  const cashScope = extractCurrentProductCashScope($, name, productText);
  if (
    ["ucomps", "netadeal", "in2win", "ultimatetool", "letswin"].includes(config.siteName) &&
    /Instant Win/i.test(name)
  ) {
    return null;
  }
  if (
    ["in2win", "ultimatetool", "letswin"].includes(config.siteName) &&
    /Odds Booster|Win\s+\d+x\s+Tickets|Instant Wins?|Instantly|Every Tickets? Wins|Every Entry Wins|Every Ticket Is A Winner|WET Scratch|prizes?\s+to\s+find|\d+\s*x\s*£[\d,]+|£[\d,]+\s+winners?/i.test(
      config.siteName === "letswin" ? name : productText,
    )
  ) {
    return null;
  }

  const soldMax =
    extractSoldMax(productText) ??
    extractHtmlSoldMax(html) ??
    extractSoldMax(text);
  const remaining = extractTicketsRemaining(productText);
  const explicitMax = extractExplicitMaxTickets(productText);
  const explicitSold = extractTicketsSold(productText) || extractTicketsSold(text);
  const maxTickets =
    soldMax?.max ||
    explicitMax ||
    (explicitSold > 0 && remaining > 0 ? explicitSold + remaining : 0);
  const ticketsSold =
    soldMax?.sold ??
    (explicitSold >= 0 && (maxTickets === 0 || explicitSold <= maxTickets)
      ? explicitSold
      : 0);
  const winningWazePrice = config.siteName === "winningwaze"
    ? parsePrice($(".summary.entry-summary .price").first().text())
    : 0;
  const monkyLondonPrice = config.siteName === "monkylondon"
    ? parsePrice($(".summary.entry-summary .price, .summary .price, .price").first().text())
    : 0;
  const entryPrice =
    winningWazePrice ||
    monkyLondonPrice ||
    parseEntryPrice(productText) ||
    parseHtmlEntryPrice(html) ||
    0;
  const drawDate =
    extractGenericWooDrawDate(config, html, productText) ??
    (config.siteName === "audrey"
      ? null
      : extractGenericWooDrawDate(config, html, text));
  const manualEstimate = extractGenericWooManualEstimate(config, name);
  const audreyFinalPrize = config.siteName === "audrey"
    ? extractAudreyFinalPrize(name)
    : null;
  const audreyNonCashEstimate = audreyFinalPrize && !audreyFinalPrize.isCash
    ? {
        value: audreyFinalPrize.amount,
        source: "site_estimate" as const,
        confidence: "high" as const,
        notes: "Current product states the draw-day prize denomination",
      }
    : null;
  const boonyPrizeValue = config.siteName === "boonycompetitions"
    ? parsePrice(html.match(/\bPrize\s+value\b[\s\S]{0,100}?£\s*[\d,.]+/i)?.[0] ?? "")
    : 0;
  const siteEstimate = manualEstimate === null
    ? audreyNonCashEstimate ?? extractGenericWooSiteEstimate(productText, name)
    : null;
  const cashAlternative = extractGenericWooCashAlternative(
    $,
    cashScope.html,
    config,
    name,
    config.siteName === "boonycompetitions"
      ? `${cashScope.text} ${text}`
      : cashScope.text,
  );
  const quantityMax = extractQuantityMax(html);
  const boonyMaxPerUser = config.siteName === "boonycompetitions"
    ? parseNumber(html.match(/<dt\b[^>]*>\s*Max\s+per\s+person\s*<\/dt>\s*<dd\b[^>]*>\s*([\d,]+)/i)?.[1])
    : 0;
  const statedMaxPerUser =
    boonyMaxPerUser ||
    extractVerifiedMaxEntriesPerUser(productText) ||
    extractVerifiedMaxEntriesPerUser(cashScope.text);
  const maxEntriesPerUser = quantityMax ?? statedMaxPerUser;

  if (maxTickets === 0 || entryPrice === 0) return null;
  if (
    config.siteName === "winningwaze" &&
    drawDate === null &&
    /Time Remaining:\s*Instant Win Prizes/i.test(productText)
  ) {
    return null;
  }

  return raw(config, sourceId, href, name, {
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser > 0 ? maxEntriesPerUser : undefined,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    prizeDescription: cleanText($("#tab-description, .woocommerce-product-details__short-description").text()).slice(0, 6000),
    prizeEvidence: cashAlternative !== null
      ? `${href}: ${cashScope.text.match(/Cash\s*(?:Alternative|Alt)[:\s]*£?\s*([\d,.]+)\s*(k\b)?/i)?.[0] ?? name}`
      : `${href}: ${siteEstimate?.notes ?? "Operator product description"}`,
    estimatedPrizeValue:
      manualEstimate ??
      siteEstimate?.value ??
      (boonyPrizeValue > 0 ? Math.round(boonyPrizeValue * 0.85) : null),
    valuationSource:
      manualEstimate !== null
        ? "manual_estimate"
        : siteEstimate?.source ?? (boonyPrizeValue > 0 ? "site_estimate" : null),
    valuationConfidence:
      manualEstimate !== null
        ? "medium"
        : siteEstimate?.confidence ?? (boonyPrizeValue > 0 ? "medium" : null),
    valuationNotes:
      manualEstimate !== null
        ? "Manual estimate from explicit prize denomination"
        : siteEstimate?.notes ??
          (boonyPrizeValue > 0 ? "Boony detail page states prize value" : null),
    drawDate,
    isAutoDraw: /auto\s*draw|automated\s*draw|autodraw/i.test(productText),
    categories: extractGenericWooCategories(config.siteName, name, productText),
    scrapedAt: new Date().toISOString(),
  });
}

function parseValtorixDetail(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
  href: string,
  sourceId: string,
  name: string,
): RawCompetition | null {
  const text = cleanText($("body").text());
  const inventory = text.match(/\bSold:\s*([\d,]+)\s*\/\s*([\d,]+)\b/i);
  const price = Number.parseFloat(
    text.match(/\bPrice per entry\s*(?:\|\s*)?([\d,.]+)\s*GBP\b/i)?.[1]?.replace(/,/g, "") ?? "0",
  );
  const cashAlternative = Number.parseFloat(
    text.match(/\bCash alternative value\s*(?:\|\s*)?([\d,.]+)\s*GBP\b/i)?.[1]?.replace(/,/g, "") ?? "0",
  );
  const drawMatch = text.match(
    /\bDraw date and time\s*(?:\|\s*)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\b/i,
  );
  if (!inventory || price <= 0 || cashAlternative <= 0 || !drawMatch) return null;

  const draw = DateTime.fromFormat(
    `${drawMatch[1]} ${drawMatch[2]} ${drawMatch[3]} ${drawMatch[4]}:${drawMatch[5]}`,
    "d LLL yyyy HH:mm",
    { zone: "Europe/London" },
  );
  if (!draw.isValid) return null;

  const sold = Number.parseInt(inventory[1].replace(/,/g, ""), 10);
  const maxTickets = Number.parseInt(inventory[2].replace(/,/g, ""), 10);
  if (!Number.isFinite(sold) || !Number.isFinite(maxTickets) || maxTickets <= 0) return null;

  return raw(config, sourceId, href, `${name} or £${cashAlternative.toLocaleString("en-GB")} cash`, {
    entryPrice: price,
    ticketsSold: sold,
    maxTickets,
    cashAlternative,
    estimatedPrizeValue: cashAlternative,
    valuationSource: "cash",
    valuationConfidence: "high",
    valuationNotes: "Cash alternative value stated on the operator detail page",
    drawDate: draw.toUTC().toISO({ suppressMilliseconds: false }),
    categories: ["cash"],
    scrapedAt: new Date().toISOString(),
  });
}

function parsePrestigeWatchCircleDetail(
  $: cheerio.CheerioAPI,
  html: string,
  config: StaticListSiteConfig,
  href: string,
  sourceId: string,
  name: string,
): RawCompetition | null {
  const ticketPriceText = $("p.elementor-icon-box-description")
    .filter((_index, element) => /ticket price/i.test($(element).text()))
    .first()
    .closest(".elementor-icon-box-content")
    .find(".elementor-icon-box-title")
    .first()
    .text();
  const entryPrice = parsePrice(ticketPriceText) || parsePrice($("[data-price-amount]").first().attr("data-price-amount") ?? "");

  const inventoryText = $(".pwc-loop-progress-tickets-remaining").first().text();
  const inventory = inventoryText.match(/([\d,]+)\s*\/\s*([\d,]+)\s+TICKETS\s+REMAINING/i);
  const ticketsRemaining = parseNumber(inventory?.[1]);
  const maxTickets = parseNumber(inventory?.[2]);
  const ticketsSold = maxTickets - ticketsRemaining;

  const timestamp = $(".pwc-loop-countdown[data-end-timestamp]").first().attr("data-end-timestamp");
  const drawDate = timestamp ? new Date(Number(timestamp) * 1000).toISOString() : null;
  const productText = cleanText($("body").text());
  const cashAlternative =
    extractCashPrizeTitle(name) ??
    parseCashAmount(productText.match(/£\s*([\d,.]+)\s+cash\s+alternative/i)?.[1] ?? "");
  const maxEntriesPerUser = parseNumber(
    productText.match(/maximum\s+of\s+([\d,]+)\s+times\s+per\s+competition/i)?.[1],
  );

  if (
    entryPrice <= 0 ||
    ticketsRemaining < 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  return raw(config, sourceId, href, name, {
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser > 0 ? maxEntriesPerUser : undefined,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: /automatic(?:ally)?\s+draw|fully\s+automated\s+draw|auto\s*draw/i.test(productText),
    categories: cashAlternative !== null ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  });
}

function parseLakeDistrictLinks(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): string[] {
  const links = new Set<string>();
  $('a[href*="/competition/"]').each((_i, element) => {
    const href = absoluteUrl(config, $(element).attr("href") ?? "");
    if (href.startsWith(`${config.baseUrl}/competition/`)) links.add(href);
  });
  return Array.from(links);
}

export function parseLakeDistrictDetail(
  html: string,
  config: StaticListSiteConfig,
  href: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = cleanText($("body").text());
  const sourceId = slugFromUrl(href);
  const name = cleanText($("h1").first().text());
  const soldMax = text.match(/([\d,]+)\s+of\s+([\d,]+)\s+tickets?\s+sold/i);
  const ticketsSold = parseNumber(soldMax?.[1]);
  const maxTickets = parseNumber(soldMax?.[2]);
  const entryPrice = parsePrice($("h2.text-primary").first().text());
  const drawDate = parseLakeDistrictDrawDate(html, text);
  const cashAlternative = extractLakeDistrictCashAlternative(name);
  const maxEntriesPerUser = parseNumber($("#ticketRange").first().attr("max"));

  if (
    !sourceId ||
    !name ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  return raw(config, sourceId, href, name, {
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw: /instant\s+win|every\s+ticket\s+wins/i.test(name),
    categories: cashAlternative !== null ? ["cash"] : [],
    scrapedAt: new Date().toISOString(),
  });
}

function parseLakeDistrictDrawDate(html: string, text: string): string | null {
  const value =
    html.match(/class=["'][^"']*\bgo_live_date\b[^"']*["'][^>]*value=["']([^"']+)["']/i)?.[1] ??
    html.match(/value=["']([^"']+)["'][^>]*class=["'][^"']*\bgo_live_date\b[^"']*["']/i)?.[1] ??
    text.match(/Draw\s+[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+(\d{4})\s+at\s+\d{1,2}:\d{2}\s*(?:am|pm)/i)?.[0];
  if (!value) return null;

  const date = DateTime.fromFormat(value, "yyyy-MM-dd HH:mm:ss", {
    zone: "Europe/London",
  });
  if (date.isValid) return date.toUTC().toISO({ suppressMilliseconds: false });

  const match = text.match(
    /Draw\s+[A-Za-z]+\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i,
  );
  if (!match) return null;
  const fallback = DateTime.fromFormat(
    `${match[1]} ${match[2]} ${match[3]} ${match[4]}:${match[5]} ${match[6]}`,
    "d LLLL yyyy h:mm a",
    { zone: "Europe/London" },
  );
  return fallback.isValid
    ? fallback.toUTC().toISO({ suppressMilliseconds: false })
    : null;
}

function extractLakeDistrictCashAlternative(name: string): number | null {
  const match = name.match(/\bor\s+£\s*([\d,.]+)\s*(k\b)?\b/i);
  if (!match) return extractCashPrizeTitle(name);
  return parseCashAmount(match[1], match[2]);
}

type PrizeQueenStoreProduct = {
  id?: unknown;
  name?: unknown;
  permalink?: unknown;
  prices?: {
    price?: unknown;
    currency_minor_unit?: unknown;
  };
  categories?: Array<{
    name?: unknown;
  }>;
  extensions?: {
    pq_lottery?: {
      closes_at?: unknown;
      max_tickets?: unknown;
      sold?: unknown;
      remaining?: unknown;
    };
  };
};

function parsePrizeQueenStoreProducts(
  json: string,
  config: StaticListSiteConfig,
): RawCompetition[] {
  let products: unknown;
  try {
    products = JSON.parse(json);
  } catch {
    return [];
  }

  if (!Array.isArray(products)) return [];

  const now = Date.now();
  const scrapedAt = new Date().toISOString();
  const competitions: RawCompetition[] = [];

  for (const product of products as PrizeQueenStoreProduct[]) {
    const id = numberFromUnknown(product.id);
    const name = decodeHtmlText(stringFromUnknown(product.name));
    const url = stringFromUnknown(product.permalink);
    const lottery = product.extensions?.pq_lottery;
    const maxTickets = numberFromUnknown(lottery?.max_tickets);
    const remaining = numberFromUnknown(lottery?.remaining);
    const ticketsSold = numberFromUnknown(lottery?.sold) ||
      (maxTickets > 0 && remaining >= 0 ? maxTickets - remaining : 0);
    const drawDate = parsePrizeQueenStoreDate(stringFromUnknown(lottery?.closes_at));
    const categories = (product.categories ?? [])
      .map((category) => stringFromUnknown(category.name).toLowerCase())
      .filter((category) => category.length > 0);
    const entryPrice = parsePrizeQueenStorePrice(product.prices);

    if (
      id <= 0 ||
      !name ||
      !url ||
      entryPrice <= 0 ||
      maxTickets <= 0 ||
      ticketsSold < 0 ||
      ticketsSold >= maxTickets ||
      drawDate === null ||
      new Date(drawDate).getTime() <= now
    ) {
      continue;
    }

    competitions.push(raw(config, String(id), url, name, {
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      cashAlternative: extractSiteCashAlternative(config.siteName, name, name),
      drawDate,
      isAutoDraw: categories.some((category) => category.includes("instant")),
      categories,
      scrapedAt,
    }));
  }

  return competitions;
}

function parsePrizeQueenStorePrice(
  prices: PrizeQueenStoreProduct["prices"],
): number {
  const rawPrice = decimalFromUnknown(prices?.price);
  const minorUnit = numberFromUnknown(prices?.currency_minor_unit) || 2;
  const divisor = 10 ** minorUnit;
  return divisor > 0 ? rawPrice / divisor : rawPrice;
}

function parsePrizeQueenStoreDate(value: string): string | null {
  if (!value) return null;

  const date = DateTime.fromFormat(value, "yyyy-MM-dd HH:mm:ss", { zone: "Europe/London" });
  if (date.isValid) return date.toUTC().toISO({ suppressMilliseconds: false });

  const minuteDate = DateTime.fromFormat(value, "yyyy-MM-dd HH:mm", { zone: "Europe/London" });
  if (minuteDate.isValid) return minuteDate.toUTC().toISO({ suppressMilliseconds: false });

  return dateFromText(value);
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function decodeHtmlText(value: string): string {
  return cleanText(cheerio.load(`<body>${value}</body>`).text());
}

function extractGenericWooManualEstimate(
  config: StaticListSiteConfig,
  name: string,
): number | null {
  if (config.siteName === "area52" && /£\s*500\s+(?:golf\s+shop\s+)?(?:vouchers?|credit)/i.test(name)) {
    return 500;
  }

  if (config.siteName !== "bitcomps") return null;

  const dollarMatch = name.match(/^\$\s*([\d,]+(?:\.\d+)?)\s+of\b/i);
  if (!dollarMatch) return null;

  const dollars = Number(dollarMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(dollars) || dollars <= 0) return null;

  return Math.round(dollars * 0.79);
}

function extractGenericWooSiteEstimate(
  text: string,
  name: string,
): {
  value: number;
  source: NonNullable<RawCompetition["valuationSource"]>;
  confidence: NonNullable<RawCompetition["valuationConfidence"]>;
  notes: string;
} | null {
  if (
    /\bworth\s+of\s+(?:instant\s+win\s+)?prizes\b/i.test(text) ||
    /\b(?:instant\s+win\s+prizes?|prizes)\s+worth\s+(?:over|more\s+than)?\s*£/i.test(text) ||
    /\bevery\s+ticket\s+(?:being|is)\s+a\s+winner\b/i.test(text)
  ) {
    return null;
  }

  const match =
    text.match(/\bRRP\s*£\s*([\d,.]+)\s*(k\b)?\+?/i) ||
    (!/\bInstant Wins?\b/i.test(name)
      ? text.match(/\bPrize\s+worth\s*£\s*([\d,.]+)\s*(k\b)?/i)
      : null) ||
    text.match(/\bworth\s+(?:over|more\s+than)\s+£\s*([\d,.]+)\s*(k\b)?/i);
  if (!match) return null;

  const multiplier = match[2]?.toLowerCase() === "k" ? 1000 : 1;
  const parsed = Number.parseFloat(match[1].replace(/,/g, "")) * multiplier;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return {
    value: Math.round(parsed * 0.85),
    source: "site_estimate",
    confidence: "medium",
    notes: "Operator detail page states retail value",
  };
}

function extractGenericWooDrawDate(
  config: StaticListSiteConfig,
  html: string,
  text: string,
): string | null {
  if (config.siteName === "boonycompetitions") {
    const timed = html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
    const parsed = timed ? new Date(timed) : null;
    if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  if (config.siteName === "audrey") {
    const match = text.match(
      /competition\s+will\s+end\s+no\s+later\s+than\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm)/i,
    );
    if (match) {
      return dateFromParts(match[1], match[2], match[3], match[4], match[5] ?? "00", match[6]);
    }
  }
  return extractDrawDate(html, text);
}

function parseYourUkCompetitionLinks(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): string[] {
  const seen = new Set<string>();
  const links: string[] = [];
  const $currentCompetitionLinks = $(
    '#competitions-page .competition a[href*="/competitions/"]',
  );
  const $links = $currentCompetitionLinks.length > 0
    ? $currentCompetitionLinks
    : $('a[href*="/competitions/"]');

  $links.each((_i, el) => {
    const href = $(el).attr("href") || "";
    if (/\/competitions(?:\/archive)?(?:\?|$)/i.test(href)) return;
    if (href.includes("/competitions?")) return;

    const absolute = absoluteUrl(config, href);
    if (!absolute.startsWith(`${config.baseUrl}/competitions/`)) return;
    if (seen.has(absolute)) return;

    seen.add(absolute);
    links.push(absolute);
  });

  return links.slice(0, 40);
}

function parseYourUkCompetitionDetail(
  html: string,
  config: StaticListSiteConfig,
  href: string,
  entryListHtml?: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = extractYourUkPrimaryText($);
  const sourceId = slugFromUrl(href);
  const name =
    cleanText($("h1").first().text()) ||
    href
      .split("/")
      .pop()
      ?.replace(/-/g, " ") ||
    "";
  if (!sourceId || !name) return null;
  if (
    /\bDraw\s+Instant Win\b/i.test(text) ||
    /\bCategory\s+Instant Win\b/i.test(text) ||
    /\bFree Competition\b/i.test(name)
  ) {
    return null;
  }

  const entryPrice = parseEntryPrice(text);
  const inventory =
    extractSoldMax(text) ??
    (entryListHtml
      ? parseYourUkEntryListInventory(entryListHtml, text)
      : null);
  const maxTickets = inventory?.max ?? 0;
  const ticketsSold = inventory?.sold ?? 0;
  const drawDate = parseYourUkDrawDate(text);

  if (entryPrice <= 0 || maxTickets <= 0 || drawDate === null) return null;

  return raw(config, sourceId, href, name, {
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative: extractYourUkCashAlternative(name, text),
    drawDate,
    isAutoDraw: false,
    categories: ["Live Draws"],
    scrapedAt: new Date().toISOString(),
  });
}

function extractYourUkPrimaryText($: cheerio.CheerioAPI): string {
  const $detailSections = $(".cd-hero, .cd-body");
  if ($detailSections.length > 0) {
    return cleanText(
      $detailSections
        .map((_i, el) => $(el).text())
        .get()
        .join(" "),
    );
  }

  const mainText = cleanText($("main").first().text());
  return mainText || cleanText($("body").text());
}

function isYourUkLiveDrawDetail(html: string): boolean {
  const $ = cheerio.load(html);
  const name = cleanText($("h1").first().text());
  const text = extractYourUkPrimaryText($);
  return (
    /\bCategory\s+Live Draws\b/i.test(text) &&
    /\bAvailable\s+[\d,]+\b/i.test(text) &&
    !/\bDraw\s+Instant Win\b|\bCategory\s+Instant Win\b/i.test(text) &&
    !/\bFree Competition\b/i.test(name)
  );
}

function parseYourUkEntryListInventory(
  html: string,
  detailText: string,
): { sold: number; max: number } | null {
  const availableMatch = detailText.match(/\bAvailable\s+([\d,]+)\b/i);
  if (!availableMatch) return null;
  const available = parseNumber(availableMatch[1]);
  const $ = cheerio.load(html);

  for (const script of $("script").toArray()) {
    const scriptText = $(script).html() ?? "";
    const marker = /\bconst\s+tickets\s*=\s*/.exec(scriptText);
    if (!marker) continue;

    const start = scriptText.indexOf("[", marker.index + marker[0].length);
    if (start < 0) continue;
    const json = extractBalancedJsonArray(scriptText, start);
    if (!json) continue;

    try {
      const tickets = JSON.parse(json) as unknown;
      if (!Array.isArray(tickets) || tickets.length === 0) continue;

      const ticketNumbers = new Set<number>();
      let sold = 0;
      let valid = true;
      for (const ticket of tickets) {
        if (!ticket || typeof ticket !== "object") {
          valid = false;
          break;
        }
        const record = ticket as Record<string, unknown>;
        const ticketNumber = record.ticket_number;
        const included = record.include_in_draw;
        if (
          !Number.isInteger(ticketNumber) ||
          (ticketNumber as number) <= 0 ||
          typeof included !== "boolean" ||
          ticketNumbers.has(ticketNumber as number)
        ) {
          valid = false;
          break;
        }
        ticketNumbers.add(ticketNumber as number);
        if (included) sold += 1;
      }

      const max = tickets.length;
      if (valid && sold + available === max) return { sold, max };
    } catch {
      continue;
    }
  }

  return null;
}

function extractBalancedJsonArray(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
      if (depth < 0) return null;
    }
  }

  return null;
}

function parseYourUkDrawDate(text: string): string | null {
  const isoMatch = text.match(/\bDraw\s+(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})/i);
  if (isoMatch) {
    return new Date(
      parseInt(isoMatch[1], 10),
      parseInt(isoMatch[2], 10) - 1,
      parseInt(isoMatch[3], 10),
      parseInt(isoMatch[4], 10),
      parseInt(isoMatch[5], 10),
      0,
      0,
    ).toISOString();
  }

  const match = text.match(/\bDraw\s+(\d{2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/i);
  if (!match) return null;

  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const month = months.indexOf(match[2].toLowerCase());
  if (month < 0) return null;

  return new Date(
    parseInt(match[3], 10),
    month,
    parseInt(match[1], 10),
    parseInt(match[4], 10),
    parseInt(match[5], 10),
    0,
    0,
  ).toISOString();
}

function extractYourUkCashAlternative(name: string, _text: string): number | null {
  const amounts = Array.from(name.matchAll(/£\s*([\d,]+(?:\.\d{1,2})?)/g))
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((amount) => amount > 0);
  return amounts.length > 0 ? Math.max(...amounts) : null;
}

function extractGenericWooCashAlternative(
  $: cheerio.CheerioAPI,
  html: string,
  config: StaticListSiteConfig,
  name: string,
  productText: string,
): number | null {
  if (/\bticket\s+bundle\s+end\s+prize\b/i.test(name)) return null;

  if (config.siteName === "coast2coast") {
    return extractCoast2CoastCashAlternative(
      name,
      productText,
      $("meta[name='description']").attr("content") ?? "",
    );
  }

  if (config.siteName === "boonycompetitions") {
    return extractBoonyCashAlternative(productText);
  }

  const embeddedCashAlternative = config.siteName === "collie"
    ? null
    : extractEmbeddedCashAlternative(html);
  return embeddedCashAlternative ??
    extractSiteCashAlternative(config.siteName, name, productText);
}

function extractBoonyCashAlternative(text: string): number | null {
  const amounts = Array.from(
    text.matchAll(
      /(?:Cash\s+Alternative\s*:?\s*£\s*([\d,.]+)|£\s*([\d,.]+)\s+cash\s+alternative)/gi,
    ),
  )
    .map((match) => parseFloat((match[1] ?? match[2]).replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
  const uniqueAmounts = [...new Set(amounts)];
  return uniqueAmounts.length === 1 ? uniqueAmounts[0] : null;
}

function extractCurrentProductCashScope(
  $: cheerio.CheerioAPI,
  name: string,
  fallbackText: string,
): { text: string; html: string } {
  const $description = $(
    "#collapse-desc .card-body, .woocommerce-Tabs-panel--description, #tab-description",
  );
  const descriptionText = cleanText($description.text());
  const descriptionHtml = $description
    .map((_index, element) => $.html(element))
    .get()
    .join("\n");
  const $product = $(".product").first();
  if ($product.length === 0) {
    const $body = $("body").clone();
    $body
      .find(
        [
          ".product",
          ".products",
          ".related",
          ".related-products",
          ".upsells",
          ".cross-sells",
          ".live-comps",
          '[data-elementor-type="loop-item"]',
        ].join(", "),
      )
      .remove();
    return {
      text: cleanText(`${fallbackText} ${descriptionText}`),
      html: `${$.html($body)}\n${descriptionHtml}`,
    };
  }

  const $scope = $product.clone();
  $scope
    .find(
      [
        ".product",
        ".products",
        ".related",
        ".related-products",
        ".upsells",
        ".cross-sells",
        ".live-comps",
        '[data-elementor-type="loop-item"]',
      ].join(", "),
    )
    .remove();

  const html = `${$.html($scope)}\n${descriptionHtml}`;
  $scope.find("script, style").remove();
  const text = cleanText(`${name} ${$scope.text()} ${descriptionText}`);
  return { text: text || fallbackText, html };
}

function extractEmbeddedCashAlternative(html: string): number | null {
  const structured = html.match(/"CashAlternative":(\d+(?:\.\d+)?)/i);
  if (structured) {
    const amount = parseFloat(structured[1]);
    if (amount > 0) return amount;
  }

  const widgetHeading = html.match(
    /<div\b[^>]*class=["'][^"']*\bcash-alternative-title\b[^"']*["'][^>]*>[\s\S]{0,240}?<h2\b[^>]*class=["'][^"']*\brgg-title-tag\b[^"']*["'][^>]*>([\s\S]{0,120}?)<\/h2>/i,
  )?.[1];
  if (!widgetHeading) return null;

  const amount = parseFloat(
    (widgetHeading.match(/(?:£|&pound;)\s*([\d,.]+)/i)?.[1] ?? "").replace(/,/g, ""),
  );
  return amount > 0 ? amount : null;
}

function parseCoastDetail(
  html: string,
  config: StaticListSiteConfig,
  href: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const sourceId = slugFromUrl(href);
  if (!sourceId) return null;

  const name =
    $("h1").first().text().trim() ||
    unescapeEmbeddedJson(html.match(/\\"title\\":\\"([^"\\]+)\\"/)?.[1]) ||
    sourceId.replace(/-/g, " ");
  const maxTickets = parseNumber(html.match(/\\"maxTickets\\":(\d+)/)?.[1]);
  const ticketsSold = parseNumber(
    html.match(/\\"initialStats\\":\{\\"ticketsSold\\":(\d+)\}/)?.[1],
  );
  const pricePence = parseNumber(
    html.match(/\\"effectivePricePence\\":(\d+)/)?.[1] ||
      html.match(/\\"ticketPricePence\\":(\d+)/)?.[1],
  );
  if (maxTickets === 0 && pricePence === 0) return null;

  return {
    sourceId,
    siteName: config.siteName,
    url: href,
    name: name.substring(0, 140),
    entryPrice: pricePence / 100,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative: extractCashAlternative(name),
    drawDate: unescapeEmbeddedJson(html.match(/\\"endAt\\":\\"([^"\\]+)\\"/)?.[1]),
    isAutoDraw: html.includes('\\"drawType\\":\\"auto\\"'),
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

function parseTwoFatLadies(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const products: Array<Record<string, unknown>> = [];

  $("[wire\\:snapshot]").each((_i, el) => {
    const snapshot = $(el).attr("wire:snapshot");
    if (!snapshot || !snapshot.includes('"products"')) return;

    try {
      const parsed = JSON.parse(snapshot) as { data?: { products?: unknown } };
      collectTwoFatLadiesProducts(parsed.data?.products, products);
    } catch {
      // Ignore unrelated Livewire snapshots.
    }
  });

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const comps: RawCompetition[] = [];

  for (const product of products) {
    const slug = typeof product.slug === "string" ? product.slug : "";
    if (!slug || seen.has(slug)) continue;

    const maxTickets = numberFromUnknown(product.max_tickets);
    if (maxTickets === 0) continue;

    seen.add(slug);
    const name = typeof product.title === "string" ? product.title : slug.replace(/-/g, " ");
    const price =
      typeof product.price_raw === "number" ? product.price_raw : parsePrice(String(product.price ?? ""));
    const url =
      typeof product.url === "string"
        ? product.url
        : `${config.baseUrl}/competition/${slug}`;

    comps.push({
      sourceId: slug,
      siteName: config.siteName,
      url,
      name: name.substring(0, 140),
      entryPrice: price,
      ticketsSold: numberFromUnknown(product.sold_tickets),
      maxTickets,
      maxEntriesPerUser: 100,
      cashAlternative: extractCashAlternative(`${name} ${String(product.cash_alt ?? "")}`),
      drawDate: parseTwoFatLadiesDate(product.draw_date_raw),
      isAutoDraw: String(product.game_type ?? "").length > 0,
      categories: extractTwoFatLadiesCategories(product.categories),
      scrapedAt: now,
    });
  }

  return comps;
}

function parseBikeLife(
  $: cheerio.CheerioAPI,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const comps: RawCompetition[] = [];
  const now = new Date().toISOString();
  const seen = new Set<string>();

  $(".lty-product-card-link").each((_i, el) => {
    const $card = $(el);
    const href = absoluteUrl(config, $card.attr("href") || "");
    if (!href.startsWith(`${config.baseUrl}/shop/`) || seen.has(href)) return;

    const sourceId = slugFromUrl(href);
    const name = cleanText($card.find(".lty-product-title").first().text());
    const text = cleanText($card.text());
    const soldMax = text.match(/SOLD:\s*\d+%\s*\(([\d,]+)\s*\/\s*([\d,]+)\)/i);
    const entryPrice =
      parseNumber($card.find(".lty-price-number").first().text()) || parseEntryPrice(text);
    const drawDate =
      dateFromText($card.find(".grid-only-countdown").attr("data-end") ?? "") ||
      extractDrawDate($card.html() ?? "", text);
    if (!sourceId || !name || !soldMax || entryPrice <= 0 || drawDate === null) return;

    seen.add(href);
    comps.push(raw(config, sourceId, href, name, {
      entryPrice,
      ticketsSold: parseNumber(soldMax[1]),
      maxTickets: parseNumber(soldMax[2]),
      cashAlternative: extractCashAlternative(text),
      drawDate,
      categories: Array.from(
        new Set(
          Array.from(($card.attr("class") || "").matchAll(/category-([^\s]+)/g), (match) =>
            match[1].replace(/-/g, " "),
          ),
        ),
      ),
      scrapedAt: now,
    }));
  });

  return comps;
}

interface Fifty20QueryState {
  queries?: Array<{
    state?: {
      data?: {
        blockData?: unknown;
      } | null;
    } | null;
  }>;
}

interface Fifty20CompetitionRecord {
  slug: string;
  status?: string | null;
  type?: number | null;
  drawDate?: string | null;
  endDateTime?: string | null;
  drawMethod?: number | null;
  numberOfTicketsInPool?: string | number | null;
  maxTicketsAllowedPerPlayer?: string | number | null;
  singleTicketPricePerCurrency?: Array<{
    ticketPrice?: string | number | null;
    currencies?: {
      code?: string | null;
    } | null;
  }> | null;
  translation?: {
    title?: string | null;
    subTitle?: string | null;
    extraInformation?: string | null;
    freeEntryInstruction?: string | null;
    competitionDetails?: string | null;
  } | null;
  rafflePrizePrizeDraws?: Array<{
    prize_type?: number | null;
    prize_value?: string | number | null;
  }> | null;
  rafflesPrizeInstantWins?: Array<{
    prize_type?: number | null;
    prize_value?: string | number | null;
  }> | null;
  totalNumberOfTicketsInPool?: string | number | null;
  totalNumberOfTicketsSold?: string | number | null;
}

function parseFifty20(
  html: string,
  config: StaticListSiteConfig,
): RawCompetition[] {
  const state = extractFifty20QueryState(html);
  if (!state) return [];

  const now = new Date().toISOString();
  const comps: RawCompetition[] = [];
  const seen = new Set<string>();

  for (const query of state.queries ?? []) {
    const blockData = query.state?.data?.blockData;
    if (!Array.isArray(blockData)) continue;

    for (const item of blockData) {
      const comp = parseFifty20Competition(item, config, now);
      if (!comp || seen.has(comp.sourceId)) continue;
      seen.add(comp.sourceId);
      comps.push(comp);
    }
  }

  return comps.filter((comp) => comp.maxTickets > 0 && comp.ticketsSold < comp.maxTickets);
}

function extractFifty20QueryState(html: string): Fifty20QueryState | null {
  const match = html.match(
    /window\.\$REACT_QUERY_STATE\s*=\s*("(?:\\.|[^"\\])*")/s,
  );
  if (!match) return null;

  try {
    const serialized = JSON.parse(match[1]) as string;
    return JSON.parse(serialized) as Fifty20QueryState;
  } catch {
    return null;
  }
}

function parseFifty20Competition(
  value: unknown,
  config: StaticListSiteConfig,
  scrapedAt: string,
): RawCompetition | null {
  if (!value || typeof value !== "object") return null;

  const comp = value as Fifty20CompetitionRecord;
  if ((comp.status ?? "").toLowerCase() !== "open") return null;

  const sourceId = typeof comp.slug === "string" ? slugify(comp.slug) : "";
  const name = cleanText(comp.translation?.title ?? "");
  const ticketPrice = extractFifty20TicketPrice(comp.singleTicketPricePerCurrency);
  const ticketsSold = numberFromUnknown(comp.totalNumberOfTicketsSold);
  const maxTickets =
    numberFromUnknown(comp.totalNumberOfTicketsInPool) ||
    numberFromUnknown(comp.numberOfTicketsInPool);
  if (!sourceId || !name || ticketPrice <= 0 || maxTickets <= 0) return null;

  const extraInformation = stripHtml(comp.translation?.extraInformation ?? "");
  const competitionDetails = stripHtml(comp.translation?.competitionDetails ?? "");
  const subTitle = cleanText(comp.translation?.subTitle ?? "");
  const fullText = cleanText([name, subTitle, extraInformation, competitionDetails].join(" "));
  const isInstantWin =
    comp.type === 0 ||
    (comp.rafflesPrizeInstantWins?.length ?? 0) > 0 ||
    /\binstant(?:ly)?\b/i.test(fullText);
  const explicitCashAlternative = extractFifty20ExplicitCashAlternative(fullText);
  const structuredCashAlternative =
    explicitCashAlternative === null
      ? extractFifty20StructuredCashPrize(comp, fullText, !isInstantWin)
      : null;
  const estimatedPrizeValue =
    explicitCashAlternative === null && !isInstantWin
      ? extractFifty20WorthEstimate(fullText)
      : null;
  const cashAlternative =
    explicitCashAlternative ??
    (
      estimatedPrizeValue !== null &&
      structuredCashAlternative !== null &&
      structuredCashAlternative < estimatedPrizeValue
        ? null
        : structuredCashAlternative
    );
  const siteMaxEntriesPerUser = numberFromUnknown(comp.maxTicketsAllowedPerPlayer);

  return {
    sourceId,
    siteName: config.siteName,
    url: `${config.baseUrl}/en-US/raffles/${comp.slug}`,
    name: name.substring(0, 140),
    entryPrice: ticketPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: siteMaxEntriesPerUser || 100,
    maxEntriesPerUserSource: siteMaxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative,
    ...(estimatedPrizeValue !== null
      ? {
          estimatedPrizeValue,
          valuationSource: "site_estimate" as const,
          valuationConfidence: "medium" as const,
          valuationNotes: "Operator copy states approximate prize worth",
        }
      : {}),
    drawDate:
      parseFifty20Date(comp.endDateTime) ??
      parseFifty20Date(comp.drawDate) ??
      dateFromText(comp.endDateTime ?? "") ??
      dateFromText(comp.drawDate ?? ""),
    isAutoDraw: comp.drawMethod === 0 || /automated draw/i.test(fullText),
    categories: buildFifty20Categories(
      ticketPrice,
      name,
      subTitle,
      explicitCashAlternative !== null || structuredCashAlternative !== null,
      isInstantWin,
    ),
    scrapedAt,
  };
}

function extractFifty20TicketPrice(
  values: Fifty20CompetitionRecord["singleTicketPricePerCurrency"],
): number {
  if (!Array.isArray(values)) return 0;

  for (const entry of values) {
    const code = entry?.currencies?.code?.toUpperCase();
    if (code && code !== "GBP") continue;
    const price = decimalFromUnknown(entry?.ticketPrice);
    if (price > 0 || price === 0) return price;
  }

  return 0;
}

function extractFifty20StructuredCashPrize(
  comp: Fifty20CompetitionRecord,
  text: string,
  includeInstantWins: boolean,
): number | null {
  if (!/(?:£|cash\b|tax[\s-]*free)/i.test(text)) return null;

  const structured = [
    ...(includeInstantWins ? comp.rafflesPrizeInstantWins ?? [] : []),
    ...(comp.rafflePrizePrizeDraws ?? []),
  ]
    .filter((prize) => prize?.prize_type === 1)
    .map((prize) => decimalFromUnknown(prize?.prize_value))
    .filter((value) => value > 0);

  if (structured.length === 0) return null;
  return Math.max(...structured);
}

function extractFifty20ExplicitCashAlternative(text: string): number | null {
  const match =
    text.match(/Cash\s*(?:Alternative|Alt)[:\s]*£?\s*([\d,.]+)\s*(k\b)?/i) ||
    text.match(/\btake\s+£\s*([\d,.]+)\s*(k\b)?\s+cash/i) ||
    text.match(/\bor\s+£\s*([\d,.]+)\s*(k\b)?\s+cash\s+alternative/i);
  return match ? parseCashAmount(match[1], match[2]) : null;
}

function extractFifty20WorthEstimate(text: string): number | null {
  const match = text.match(
    /\bworth\s+(?:more\s+than\s+|nearly\s+|around\s+|approximately\s+|over\s+)?(?:£|&pound;)\s*([\d,.]+)/i,
  );
  if (!match) return null;

  const amount = parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 0.85);
}

function buildFifty20Categories(
  entryPrice: number,
  name: string,
  subTitle: string,
  hasCashPrize: boolean,
  isInstantWin: boolean,
): string[] {
  const categories: string[] = [];
  if (
    entryPrice === 0 ||
    /\bfree\s+(?:comp|competition|raffle|draw|giveaway)\b/i.test(`${name} ${subTitle}`)
  ) {
    categories.push("free");
  }
  if (hasCashPrize || /\bcash\b/i.test(`${name} ${subTitle}`)) categories.push("cash");
  if (isInstantWin) categories.push("instant-win");
  return categories;
}

function parseFifty20Date(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = DateTime.fromISO(value, { zone: "Europe/London" });
  return date.isValid ? date.toUTC().toISO({ suppressMilliseconds: false }) : null;
}

function extractTwoFatLadiesCategories(value: unknown): string[] {
  if (!Array.isArray(value) || !Array.isArray(value[0])) return [];
  return value[0].filter((category): category is string => typeof category === "string");
}

function collectTwoFatLadiesProducts(
  value: unknown,
  output: Array<Record<string, unknown>>,
): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectTwoFatLadiesProducts(item, output);
    return;
  }
  if (typeof value !== "object") return;

  const object = value as Record<string, unknown>;
  if (
    typeof object.slug === "string" &&
    typeof object.title === "string" &&
    "max_tickets" in object &&
    "sold_tickets" in object
  ) {
    output.push(object);
  }

  for (const nested of Object.values(object)) {
    collectTwoFatLadiesProducts(nested, output);
  }
}

function raw(
  config: StaticListSiteConfig,
  sourceId: string,
  url: string,
  name: string,
  values: {
    entryPrice: number;
    ticketsSold: number;
    maxTickets: number;
    maxEntriesPerUser?: number;
    maxEntriesPerUserSource?: RawCompetition["maxEntriesPerUserSource"];
    cashAlternative: number | null;
    prizeDescription?: string;
    prizeEvidence?: string;
    estimatedPrizeValue?: number | null;
    valuationSource?: RawCompetition["valuationSource"];
    valuationConfidence?: RawCompetition["valuationConfidence"];
    valuationNotes?: string | null;
    scrapedAt: string;
    drawDate?: string | null;
    isAutoDraw?: boolean;
    categories?: string[];
  },
): RawCompetition {
  return {
    sourceId,
    siteName: config.siteName,
    url,
    name: name.substring(0, 140),
    entryPrice: values.entryPrice,
    ticketsSold: values.ticketsSold,
    maxTickets: values.maxTickets,
    maxEntriesPerUser: values.maxEntriesPerUser ?? 100,
    maxEntriesPerUserSource: values.maxEntriesPerUserSource ?? "fallback",
    cashAlternative: values.cashAlternative,
    prizeDescription: values.prizeDescription,
    prizeEvidence: values.prizeEvidence,
    estimatedPrizeValue: values.estimatedPrizeValue,
    valuationSource: values.valuationSource,
    valuationConfidence: values.valuationConfidence,
    valuationNotes: values.valuationNotes,
    drawDate: values.drawDate ?? null,
    isAutoDraw: values.isAutoDraw ?? false,
    categories: values.categories ?? [],
    scrapedAt: values.scrapedAt,
  };
}

function nearestUsefulContainer(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  let current = $el;
  for (let i = 0; i < 5; i++) {
    const parent = current.parent();
    const text = cleanText(parent.text());
    if (text.length > 20 && text.length < 800) return parent;
    current = parent;
  }
  return current;
}

function nearestCampervanWinContainer(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  let current = $el;
  for (let i = 0; i < 10; i++) {
    const parent = current.parent();
    const text = cleanText(parent.text());
    if (/(ENTRIES|SOLD|WORTH|ENTER\s+COMPETITION)/i.test(text) && text.length < 1600) {
      return parent;
    }
    current = parent;
  }
  return current;
}

function nearestCompetitionPlatformContainer(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  let current = $el;
  for (let i = 0; i < 8; i++) {
    const parent = current.parent();
    const text = cleanText(parent.text());
    if (/%\s*Sold/i.test(text) && /remaining/i.test(text) && text.length < 1200) {
      return parent;
    }
    current = parent;
  }
  return current;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function parsePrice(text: string): number {
  const pence = text.match(/(\d+)p\b/i);
  if (pence) return parseInt(pence[1], 10) / 100;

  const pound = text.match(/£\s*([\d.]+)/);
  return pound ? parseFloat(pound[1]) : 0;
}

function parseEntryPrice(text: string): number {
  const normalized = text.replace(/\s+/g, " ");

  const currentProductPrice = normalized.match(
    /You currently have for this competition\..*?£\s*([\d.]+)\s*Per\s*Entry/i,
  );
  if (currentProductPrice) return parseFloat(currentProductPrice[1]);

  const salePerEntry = normalized.match(
    /£\s*[\d.]+\s*Original price was:.*?£\s*([\d.]+)\s*Current price is:.*?Per Entry/i,
  );
  if (salePerEntry) return parseFloat(salePerEntry[1]);

  const poundPerEntry =
    normalized.match(/£\s*([\d.]+)\s*\/?\s*per\s*entry/i) ||
    normalized.match(/£\s*([\d.]+)\s*Per\s*Entry/i) ||
    normalized.match(/£\s*([\d.]+)\s*\/?\s*per\s*ticket/i) ||
    normalized.match(/£\s*([\d.]+)\s*Per\s*Ticket/i);
  if (poundPerEntry) return parseFloat(poundPerEntry[1]);

  const pencePerEntry =
    normalized.match(/(\d+)p\s*(?:\/?\s*)?per\s*entry/i) ||
    normalized.match(/(\d+)p\s*(?:\/?\s*)?per\s*ticket/i) ||
    normalized.match(/(\d+)p\s+to\s+play/i);
  if (pencePerEntry) return parseInt(pencePerEntry[1], 10) / 100;

  const drawPrice = normalized.match(/£\s*([\d.]+)\s+Draw\s+On/i);
  if (drawPrice) return parseFloat(drawPrice[1]);

  const timeLeftPrice = normalized.match(/£\s*([\d.]+)\s+Time\s+left/i);
  if (timeLeftPrice) return parseFloat(timeLeftPrice[1]);

  const penceDrawPrice = normalized.match(/(\d+)p\s+Draw\s+On/i);
  if (penceDrawPrice) return parseInt(penceDrawPrice[1], 10) / 100;

  const oneTicketPrice = normalized.match(/\b1\s+Ticket\s+£\s*([\d.]+)/i);
  if (oneTicketPrice) return parseFloat(oneTicketPrice[1]);

  const ticketPrice = normalized.match(/\bTicket\s+Price\s+£\s*([\d.]+)/i);
  if (ticketPrice) return parseFloat(ticketPrice[1]);

  return 0;
}

function parseHtmlEntryPrice(html: string): number | null {
  const widgetPrice = html.match(
    /<div\b[^>]*class=["'][^"']*\brgg-product-price\b[^"']*["'][^>]*>[\s\S]{0,500}?woocommerce-Price-amount[\s\S]{0,120}?([\d,.]+)[\s\S]{0,120}?rgg-price-title/i,
  );
  if (widgetPrice) {
    const parsed = parseFloat(widgetPrice[1].replace(/,/g, ""));
    if (!Number.isNaN(parsed)) return parsed;
  }

  const singleProductPrice = html.match(
    /<p\b[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>[\s\S]{0,600}?woocommerce-Price-amount[\s\S]{0,120}?([\d,.]+)[\s\S]{0,120}?<\/p>/i,
  );
  if (singleProductPrice) {
    const parsed = parseFloat(singleProductPrice[1].replace(/,/g, ""));
    if (!Number.isNaN(parsed)) return parsed;
  }

  const dataPrice = html.match(/data-price-amount=["']([\d.]+)["']/i);
  if (dataPrice) return parseFloat(dataPrice[1]);

  const productPrice = html.match(
    /<meta\s+property=["']product:price:amount["']\s+content=["']([\d.]+)["']/i,
  );
  if (productPrice) return parseFloat(productPrice[1]);

  const basePrice = html.match(/\bbasePrice\s*:\s*["']?([\d.]+)/i);
  if (basePrice) return parseFloat(basePrice[1]);

  const ticketPrice = html
    .replace(/&quot;/gi, '"')
    .match(/["']ticket_price["']\s*:\s*([\d.]+)/i);
  if (ticketPrice) return parseFloat(ticketPrice[1]);

  const structuredOfferPrice = html.match(
    /"offers"\s*:\s*\{[\s\S]{0,1200}?"price"\s*:\s*"([\d.]+)"/i,
  ) ?? html.match(
    /"priceSpecification"\s*:\s*\[[\s\S]{0,1200}?"price"\s*:\s*"([\d.]+)"/i,
  );
  return structuredOfferPrice ? parseFloat(structuredOfferPrice[1]) : null;
}

function extractCashAlternative(text: string): number | null {
  if (isEntryBundlePrize(text)) return null;
  return extractExplicitCashAlternative(text) ?? extractCashPrizeTitle(text);
}

function extractExplicitCashAlternative(text: string): number | null {
  if (isEntryBundlePrize(text)) return null;
  const match =
    text.match(/Cash\s*(?:Alternative|Alt)[:\s]*£?\s*([\d,.]+)\s*(k\b)?/i) ||
    text.match(/choose\s+£\s*([\d,.]+)\s*(k\b)?\s*cash/i) ||
    text.match(/\bor\s+£\s*([\d,.]+)\s*(k\b)?\s*(?:cash|tax[\s-‑–—]*free\s+cash)/i) ||
    text.match(/£\s*([\d,.]+)\s*(k\b)?\s+(?:main\s+prize\s+)?cash\s+alt\b/i) ||
    text.match(/£\s*([\d,.]+)\s*(k\b)?\s*(?:cash|tax[\s-‑–—]*free\s+cash)/i);
  return match ? parseCashAmount(match[1], match[2]) : null;
}

function extractKitchenDrawTickets(text: string): { sold: number; max: number } | null {
  const availableMax = text.match(/Tickets?\s+Available:\s*([\d,]+)\s+of\s+([\d,]+)/i);
  if (availableMax) {
    const available = parseNumber(availableMax[1]);
    const max = parseNumber(availableMax[2]);
    if (max > 0) return { sold: Math.max(0, max - available), max };
  }

  const soldMax = text.match(/Tickets?\s+Sold:\s*([\d,]+)\s+of\s+([\d,]+)/i);
  if (soldMax) {
    return {
      sold: parseNumber(soldMax[1]),
      max: parseNumber(soldMax[2]),
    };
  }

  const drawDetails = text.match(/Max\s+Entries:\s*([\d,]+).*?Entries\s+Received:\s*([\d,]+)/i);
  if (drawDetails) {
    const max = parseNumber(drawDetails[1]);
    const sold = parseNumber(drawDetails[2]);
    if (max > 0) return { sold, max };
  }

  return null;
}

function extractKitchenDrawDetailFields(
  $: cheerio.CheerioAPI,
): {
  tickets: { sold: number; max: number } | null;
  maxEntriesPerUser: number | null;
  estimatedPrizeValue: number | null;
} {
  const soldText = cleanText(
    $(".summary .kitchen-ticket-bar__v2--remaining, .summary .kitchen-ticket-bar__remaining")
      .first()
      .text(),
  );
  const soldTickets = soldText ? extractKitchenDrawTickets(soldText) : null;

  const maxEntries = extractKitchenDrawTableNumber($, "Max Entries");
  const entriesReceived = extractKitchenDrawTableNumber($, "Entries Received");
  const tableTickets =
    maxEntries > 0 && entriesReceived >= 0
      ? { sold: entriesReceived, max: maxEntries }
      : null;

  return {
    tickets: soldTickets ?? tableTickets,
    maxEntriesPerUser: positiveOrNull(
      extractKitchenDrawTableNumber($, "Max Entries Per Customer"),
    ),
    estimatedPrizeValue: positiveDecimalOrNull(
      extractKitchenDrawTableMoney($, "Prize RRP"),
    ),
  };
}

function extractKitchenDrawTableNumber(
  $: cheerio.CheerioAPI,
  label: string,
): number {
  const value = extractKitchenDrawTableValue($, label);
  return parseNumber(value ?? undefined);
}

function extractKitchenDrawTableMoney(
  $: cheerio.CheerioAPI,
  label: string,
): number | null {
  const value = extractKitchenDrawTableValue($, label);
  if (!value) return null;
  const match = value.match(/£\s*([\d,.]+)/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractKitchenDrawTableValue(
  $: cheerio.CheerioAPI,
  label: string,
): string | null {
  for (const row of $("tr").toArray()) {
    const $row = $(row);
    const heading = cleanText($row.find("th").first().text()).replace(/:$/, "");
    if (heading.localeCompare(label, undefined, { sensitivity: "accent" }) !== 0) {
      continue;
    }

    const value = cleanText($row.find("td").first().text());
    if (value) return value;
  }

  return null;
}

function positiveOrNull(value: number): number | null {
  return value > 0 ? value : null;
}

function positiveDecimalOrNull(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

function extractKitchenDrawCashAlternative(text: string): number | null {
  if (/website\s+credit|voucher|gift\s*card/i.test(text)) return null;
  return extractCashPrizeTitle(text);
}

function extractSiteCashAlternative(
  siteName: string,
  name: string,
  productText: string,
): number | null {
  const titleCash = extractCashPrizeTitle(name);
  const explicit = extractExplicitCashAlternative(productText);

  if (siteName === "winningwaze") {
    const alternateCash = name.match(
      /\bor\s+£\s*([\d,.]+)\s*([km]\b)?\s*(?:cash)?\s*[!?.]*$/i,
    );
    if (alternateCash) {
      return parseCashAmount(alternateCash[1], alternateCash[2]);
    }
  }

  if (siteName === "puravidacompetitions") {
    const mainPrize = extractPuraVidaMainPrize(name, productText);
    if (mainPrize !== null) return mainPrize;
  }

  if (siteName === "cashcity") {
    const mainPrize = extractCashCityMainPrize(productText);
    if (mainPrize !== null) return mainPrize;
  }

  if (siteName === "audrey") {
    const finalPrize = extractAudreyFinalPrize(name);
    if (finalPrize) return finalPrize.isCash ? finalPrize.amount : null;
    if (isAudreyInstantCompetition(name)) return null;
    return titleCash;
  }

  if (["in2win", "ultimatetool"].includes(siteName)) {
    return explicit ?? titleCash;
  }

  if (siteName === "netadeal") {
    return titleCash ?? extractLargeCashAmountFromName(name) ?? explicit;
  }

  if (siteName === "pureprizes") {
    return titleCash ?? extractLargeCashAmountFromName(name) ?? explicit;
  }

  if (siteName === "letswin") {
    return titleCash ?? explicit;
  }

  return titleCash ?? explicit;
}

function extractPuraVidaMainPrize(name: string, productText: string): number | null {
  const explicitMainPrize = productText.match(
    /£\s*([\d,.]+)\s*(k\b)?\s+(?:cash\s+)?(?:main|grand)\s+prize\b/i,
  );
  if (explicitMainPrize) {
    return parseCashAmount(explicitMainPrize[1], explicitMainPrize[2]);
  }

  const headlinePrize = name.match(
    /^(?:win\s+)?£\s*([\d,.]+)\s*(k\b)?\s+for\s+\d+(?:\.\d+)?p\b/i,
  );
  return headlinePrize
    ? parseCashAmount(headlinePrize[1], headlinePrize[2])
    : null;
}

function extractCashCityMainPrize(text: string): number | null {
  const match =
    text.match(/(?:£|&pound;)\s*([\d,.]+)\s*(?:cash\s+)?main\s+prize\b/i) ||
    text.match(/\bmain\s+prize\s*(?:is|of|:)?\s*(?:£|&pound;)\s*([\d,.]+)/i);
  return match ? parseCashAmount(match[1]) : null;
}

function extractAudreyFinalPrize(
  text: string,
): { amount: number; isCash: boolean } | null {
  const drawDay = text.match(
    /£\s*([\d,.]+)\s*((?:[A-Za-z]+\s+){0,3})(?:on\s+(?:the\s+)?draw\s+day|draw\s+day\s+cash)\b/i,
  );
  const jackpot = text.match(/£\s*([\d,.]+)\s*((?:cash\s+)?jackpot)\b/i);
  const match = drawDay ?? jackpot;
  if (!match) return null;

  const amount = parseCashAmount(match[1]);
  if (amount === null) return null;
  return {
    amount,
    isCash: !/voucher|gift\s*card|site\s*credit|store\s*credit/i.test(match[2] ?? ""),
  };
}

function extractGenericWooCategories(
  siteName: string,
  name: string,
  productText: string,
): string[] {
  if (siteName === "monkylondon") return ["car"];
  if (siteName === "audrey" && isAudreyInstantCompetition(name)) {
    return ["instant-win"];
  }
  if (
    siteName === "cashcity" &&
    /\binstant(?:ly|\s+wins?)\b/i.test(`${name} ${productText}`)
  ) {
    return ["instant-win"];
  }
  if (siteName === "boonycompetitions" && /\binstant\s+wins?\b/i.test(`${name} ${productText}`)) {
    return ["instant-win"];
  }
  if (
    siteName === "pureprizes" &&
    /\binstant wins?\b|\bCategory:\s*Instants\b/i.test(`${name} ${productText}`)
  ) {
    return ["instant-win"];
  }
  return [];
}

function isAudreyInstantCompetition(text: string): boolean {
  return /\b(?:spin|scratch)\s*(?:&|and)\s*win\b|\binstant(?:ly|\s+wins?|\s+cash)\b|\bwin\s+right\s+now\b|\bguaranteed\s+win\b|\b100%\s+chance\b|\bcash\s+pots?\b/i.test(text);
}

function extractCoast2CoastCashAlternative(
  name: string,
  productText: string,
  metaDescription: string,
): number | null {
  const explicit = productText.match(
    /Prize\s+Cash\s+Alternative:\s*£\s*([\d,.]+)\s*(k\b)?/i,
  );
  if (explicit) return parseCashAmount(explicit[1], explicit[2]);

  return (
    extractCashPrizeTitle(name) ??
    extractCashPrizeTitle(stripHtml(metaDescription))
  );
}

function stripHtml(value: string): string {
  return cleanText(cheerio.load(`<body>${value}</body>`).text());
}

function extractCashPrizeTitle(text: string): number | null {
  if (isEntryBundlePrize(text)) return null;
  const match = text.match(
    /(?:win\s+)?£\s*([\d,.]+)\s*(k\b)?(?:\.\d{2})?(?:\s+[A-Za-z0-9#+&-]+){0,6}\s+(?:tax[\s-‑–—]*free\s+)?cash\b/i,
  );
  return match ? parseCashAmount(match[1], match[2]) : null;
}

function extractLargeCashAmountFromName(text: string): number | null {
  if (isEntryBundlePrize(text)) return null;
  const amounts = Array.from(text.matchAll(/£\s*([\d,.]+)\s*(k\b)?/gi))
    .map((match) => parseCashAmount(match[1], match[2]) ?? 0)
    .filter((amount) => amount >= 1000);
  return amounts.length > 0 ? Math.max(...amounts) : null;
}

function isEntryBundlePrize(text: string): boolean {
  return /\b\d+\s*(?:x\s*)?(?:entries|tickets)\s+(?:into|for|to|in)\b/i.test(text);
}

function parseCashAmount(value: string, suffix?: string): number | null {
  const amount = parseFloat(value.replace(/,/g, ""));
  if (Number.isNaN(amount)) return null;
  return suffix ? amount * 1000 : amount;
}

function extractRaffleRaysCashAlternative(text: string): number | null {
  const match = text.match(/\bor\s+£\s*([\d,]+)(?:\.\d{2})?\s+cash\b/i);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

function extractJammyCashAlternative(text: string): number | null {
  const titleCash = extractCashPrizeTitle(text);
  if (titleCash) return titleCash;

  const explicit = text.match(/\bor\s+£\s*([\d,]+)(?:\.\d{2})?\s+cash\b/i);
  return explicit ? parseFloat(explicit[1].replace(/,/g, "")) : null;
}

function extractCompetitionFoxCashAlternative(text: string): number | null {
  if (!/\bcash\b/i.test(text)) return null;
  return extractCashPrizeTitle(text);
}

function extractLuckyTurboCashAlternative(text: string): number | null {
  const explicit = text.match(/Cash Alternative:\s*£\s*([\d,]+(?:\.\d{2})?)/i);
  if (explicit) return parseFloat(explicit[1].replace(/,/g, ""));

  if (/Total Prize Value/i.test(text)) return null;
  return extractCashPrizeTitle(text);
}

function extractLuckyTurboPrice(text: string): number {
  const match =
    text.match(/Tickets From\s*£\s*([\d.]+)/i) ||
    text.match(/£\s*([\d.]+)\s*\/\s*ticket/i) ||
    text.match(/left\s*£\s*([\d.]+)\s*Enter/i) ||
    text.match(/%\s*[\d,]+\s*left\s*£\s*([\d.]+)/i);
  return match ? parseFloat(match[1]) : 0;
}

function extractLuckyTurboName(text: string, href: string): string {
  const cashAlt = text.match(/(?:Live\s*Draw|LiveDraw)(.+?)Cash Alternative:/i)?.[1];
  if (cashAlt) return cashAlt.trim();

  const cashPrize = text.match(/(Win\s+£[\d,]+(?:\.\d{2})?.{0,80}?Cash)/i)?.[1];
  if (cashPrize) return cashPrize.trim();

  const slug = slugFromUrl(href);
  return slug ? slug.replace(/-/g, " ") : "Lucky Turbo Competition";
}

function extractRelativeDaysDrawDate(text: string): string | null {
  const days = parseNumber(text.match(/(\d+)\s+days?\s+left/i)?.[1]);
  if (days === 0) return null;

  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(21, 0, 0, 0);
  return date.toISOString();
}

function extractSoldMax(text: string): { sold: number; max: number } | null {
  const remainingMax = text.match(
    /Tickets?\s+remaining:\s*([\d,]+).*?\b([\d,]+)\s*\/\s*([\d,]+)\b/i,
  );
  if (remainingMax) {
    const remaining = parseNumber(remainingMax[1]);
    const displayedRemaining = parseNumber(remainingMax[2]);
    const max = parseNumber(remainingMax[3]);
    if (max > 0 && remaining === displayedRemaining && remaining <= max) {
      return { sold: max - remaining, max };
    }
  }

  const patterns = [
    /\bSold\s*:?[ \t]*([\d,]+)\s+of\s+([\d,]+)\s+entries?\s+allocated\b/i,
    /Tickets\s+Sold\s*:?\s*([\d,]+)\s+of\s+([\d,]+)/i,
    /Sales\s+Progress\s+([\d,]+)\s*\/\s*([\d,]+)/i,
    /Sold:\s*([\d,]+)\s*\/\s*([\d,]+)/i,
    /Only\s*([\d,]+)\s*\/\s*([\d,]+)\s*sold/i,
    /\b([\d,]+)\s*\/\s*([\d,]+)\s+sold\b/i,
    /Tickets\s+Sold:\s*([\d,]+)\s+0\s+([\d,]+)\s+\d+(?:\.\d+)?\s*%\s*Sold/i,
    /Tickets\s+Sold:\s*([\d,]+)\s+0\s+[\d,]+\s+\1\s*\/\s*([\d,]+)/i,
    /\b([\d,]+)\s*\/\s*([\d,]+)\s+tickets?\s+sold\b/i,
    /\b\d+(?:\.\d+)?\s*%\s*(?:sold)?\s*\(?\s*([\d,]+)\s*\/\s*([\d,]+)\s*\)?/i,
    /\b([\d,]+)\s*\/\s*([\d,]+)\s+\d+(?:\.\d+)?\s*%\s*(?:sold)?/i,
    /\b([\d,]+)\s+of\s+([\d,]+)\s+\(\d+(?:\.\d+)?%\)\s+tickets\s+claimed/i,
    /\b([\d,]+)\s+of\s+([\d,]+)\s+tickets\s+sold/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const sold = parseNumber(match[1]);
    const max = parseNumber(match[2]);
    if (max > 0 && sold >= 0 && sold <= max) return { sold, max };
  }

  const duplicateSoldCounter = text.match(
    /Tickets?\s+Sold\s*:\s*([\d,]+)\s+0\s+Tickets?\s+Sold\s+([\d,]+)\s+([\d,]+)\s+Tickets?\s+remaining/i,
  );
  if (duplicateSoldCounter) {
    return {
      sold: parseNumber(duplicateSoldCounter[1]),
      max: parseNumber(duplicateSoldCounter[2]),
    };
  }

  const jackpotStyle = text.match(
    /0\s+Tickets?\s+Sold:\s*([\d,]+)\s+([\d,]+)\s+\d+(?:\.\d+)?%\s+([\d,]+)\s+Tickets?\s+remaining/i,
  );
  if (jackpotStyle) {
    return {
      sold: parseNumber(jackpotStyle[1]),
      max: parseNumber(jackpotStyle[2]),
    };
  }

  const soldMaxPercent = text.match(
    /0\s+Tickets?\s+Sold:\s*([\d,]+)\s+([\d,]+)\s+\d+(?:\.\d+)?%/i,
  );
  if (soldMaxPercent) {
    const sold = parseNumber(soldMaxPercent[1]);
    const max = parseNumber(soldMaxPercent[2]);
    if (max > 0 && sold >= 0 && sold <= max) return { sold, max };
  }

  const soldPercentTotal = text.match(
    /([\d,]+)\s+Tickets?\s+sold\s+\d+(?:\.\d+)?%\s+[\d,]+\s+([\d,]+)/i,
  );
  if (soldPercentTotal) {
    const sold = parseNumber(soldPercentTotal[1]);
    const max = parseNumber(soldPercentTotal[2]);
    if (max > 0 && sold >= 0 && sold <= max) return { sold, max };
  }

  const soldLeft = text.match(/([\d,]+)\s+Tickets?\s+Sold\s+([\d,]+)\s+Tickets?\s+Left/i);
  if (soldLeft) {
    const sold = parseNumber(soldLeft[1]);
    const remaining = parseNumber(soldLeft[2]);
    return { sold, max: sold + remaining };
  }

  const soldRemaining = text.match(/([\d,]+)\s+Tickets?\s+Sold\s+([\d,]+)\s+remaining/i);
  if (soldRemaining) {
    const sold = parseNumber(soldRemaining[1]);
    const remaining = parseNumber(soldRemaining[2]);
    return { sold, max: sold + remaining };
  }

  const soldCommaRemaining = text.match(/\b([\d,]+)\s+sold\s*,?\s*([\d,]+)\s+remaining\b/i);
  if (soldCommaRemaining) {
    const sold = parseNumber(soldCommaRemaining[1]);
    const remaining = parseNumber(soldCommaRemaining[2]);
    return { sold, max: sold + remaining };
  }

  const ticketsSoldRemaining = text.match(
    /\b([\d,]+)\s+Tickets?\s+Sold[\s\S]{0,80}?\b([\d,]+)\s+remaining\b/i,
  );
  if (ticketsSoldRemaining) {
    const sold = parseNumber(ticketsSoldRemaining[1]);
    const remaining = parseNumber(ticketsSoldRemaining[2]);
    return { sold, max: sold + remaining };
  }

  const labelledTicketsRemaining = text.match(
    /Tickets?\s+Sold:\s*([\d,]+)\s+Tickets?\s+Remaining:\s*([\d,]+)/i,
  );
  if (labelledTicketsRemaining) {
    const sold = parseNumber(labelledTicketsRemaining[1]);
    const remaining = parseNumber(labelledTicketsRemaining[2]);
    return { sold, max: sold + remaining };
  }

  const soldRemainingCounters = text.match(
    /0\s+Tickets?\s+Sold:\s*([\d,]+)\s+0\s+Tickets?\s+remaining:\s*([\d,]+)\s+([\d,]+)/i,
  );
  if (soldRemainingCounters) {
    const sold = parseNumber(soldRemainingCounters[1]);
    const remaining = parseNumber(soldRemainingCounters[2]);
    const max = parseNumber(soldRemainingCounters[3]);
    if (max > 0 && sold >= 0 && sold + remaining === max) return { sold, max };
  }

  const soldMaxRemainingCounters = text.match(
    /0\s+Tickets?\s+Sold:\s*([\d,]+)\s+([\d,]+)\s+[\d,]+\s+Tickets?\s+remaining/i,
  );
  if (soldMaxRemainingCounters) {
    const sold = parseNumber(soldMaxRemainingCounters[1]);
    const max = parseNumber(soldMaxRemainingCounters[2]);
    if (max > 0 && sold <= max) return { sold, max };
  }

  const labelledSoldRemaining = text.match(
    /\bTickets?\s+sold:\s*([\d,]+)\s+([\d,]+)\s+remaining\b/i,
  );
  if (labelledSoldRemaining) {
    const sold = parseNumber(labelledSoldRemaining[1]);
    const remaining = parseNumber(labelledSoldRemaining[2]);
    return { sold, max: sold + remaining };
  }

  const zeroAvailable = text.match(
    /\b0\s+Tickets?\s+available:\s*([\d,]+)\s+([\d,]+)\b/i,
  );
  if (zeroAvailable) {
    const remaining = parseNumber(zeroAvailable[1]);
    const max = parseNumber(zeroAvailable[2]);
    if (max > 0 && remaining >= 0 && remaining <= max) {
      return { sold: max - remaining, max };
    }
  }

  const soldAvailable = text.match(/Tickets?\s+sold:\s*([\d,]+).*?Tickets?\s+available:\s*[\d,]+\s+([\d,]+)/i);
  if (soldAvailable) {
    return {
      sold: parseNumber(soldAvailable[1]),
      max: parseNumber(soldAvailable[2]),
    };
  }

  return null;
}

function extractHtmlSoldMax(html: string): { sold: number; max: number } | null {
  const dataTicketsSold = parseNumber(
    html.match(/data-tickets-sold=["']([\d,]+)["']/i)?.[1],
  );
  const dataTicketLimit = parseNumber(
    html.match(/data-ticket-limit=["']([\d,]+)["']/i)?.[1],
  );
  if (dataTicketLimit > 0 && dataTicketsSold >= 0 && dataTicketsSold <= dataTicketLimit) {
    return { sold: dataTicketsSold, max: dataTicketLimit };
  }

  const participantCount = parseNumber(
    html.match(/data-lottery-participant-count=["']([\d,]+)["']/i)?.[1],
  );
  const maxTickets = parseNumber(
    html.match(/data-max-ticket=["']([\d,]+)["']/i)?.[1],
  );
  if (maxTickets > 0 && participantCount >= 0 && participantCount <= maxTickets) {
    return { sold: participantCount, max: maxTickets };
  }

  const $ = cheerio.load(html);
  const $primaryProduct = $(".product[id^='product-']").first();
  const $progress = $primaryProduct
    .find("[class*='refresh-progress'][aria-valuenow][aria-valuemax]")
    .add(".pg-progress[aria-valuenow][aria-valuemax]")
    .add(".wg-single-ticket-progress__track[aria-valuenow][aria-valuemax]")
    .first();
  const ariaSold = parseNumber($progress.attr("aria-valuenow"));
  const ariaMax = parseNumber($progress.attr("aria-valuemax"));
  if (ariaMax > 0 && ariaSold >= 0 && ariaSold <= ariaMax) {
    return { sold: ariaSold, max: ariaMax };
  }

  const ticketsThenSold = html.match(
    /["']tickets["']\s*:\s*([\d,]+)[\s\S]{0,300}?["']soldTickets["']\s*:\s*([\d,]+)/i,
  );
  if (ticketsThenSold) {
    const max = parseNumber(ticketsThenSold[1]);
    const sold = parseNumber(ticketsThenSold[2]);
    if (max > 0 && sold >= 0 && sold <= max) return { sold, max };
  }

  const soldThenTickets = html.match(
    /["']soldTickets["']\s*:\s*([\d,]+)[\s\S]{0,300}?["']tickets["']\s*:\s*([\d,]+)/i,
  );
  if (soldThenTickets) {
    const sold = parseNumber(soldThenTickets[1]);
    const max = parseNumber(soldThenTickets[2]);
    if (max > 0 && sold >= 0 && sold <= max) return { sold, max };
  }

  const decodedHtml = html.replace(/&quot;/gi, '"');
  const costaInventory = decodedHtml.match(
    /["']sold_count["']\s*:\s*([\d,]+)[\s\S]{0,1000}?["']total_tickets["']\s*:\s*([\d,]+)/i,
  );
  if (costaInventory) {
    const sold = parseNumber(costaInventory[1]);
    const max = parseNumber(costaInventory[2]);
    if (max > 0 && sold >= 0 && sold <= max) return { sold, max };
  }

  return null;
}

function extractTicketsSold(text: string): number {
  return parseNumber(text.match(/Tickets?\s+Sold\s*:?\s*([\d,]+)/i)?.[1]);
}

function extractTicketsAvailable(text: string): number {
  return (
    parseNumber(text.match(/([\d,]+)\s+Tickets?\s+Available/i)?.[1]) ||
    parseNumber(text.match(/Tickets?\s+available:\s*([\d,]+)/i)?.[1])
  );
}

function extractTicketsRemaining(text: string): number {
  return (
    parseNumber(text.match(/([\d,]+)\s+Tickets?\s+remaining/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+Tickets?\s+Left/i)?.[1]) ||
    parseNumber(text.match(/Tickets?\s+remaining:\s*([\d,]+)/i)?.[1])
  );
}

function extractExplicitMaxTickets(text: string): number {
  return (
    parseNumber(text.match(/Total\s+ticket\s+pool:\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+Max\s+tickets(?!\s+per\s+user)/i)?.[1]) ||
    parseNumber(text.match(/Maximum\s+tickets:\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/total\s+amount\s+of\s+tickets\s+.*?\(([\d,]+)\)/i)?.[1]) ||
    parseNumber(text.match(/limited\s+to\s+([\d,]+)\s+tickets/i)?.[1]) ||
    parseNumber(text.match(/Ticket\s+Limit\s+([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/Only\s+([\d,]+)\s+tickets\s+available/i)?.[1]) ||
    parseNumber(text.match(/This\s+competition\s+has\s+a\s+maximum\s+of\s+([\d,]+)\s+tickets/i)?.[1]) ||
    parseNumber(text.match(/PRIZE\s+HAS\s+A\s+MAX\s+OF\s+([\d,]+)\s+TICKETS/i)?.[1]) ||
    parseNumber(text.match(/Max\s+Ent(?:r(?:ies|es)|ires):\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+Total\s+Entries/i)?.[1])
  );
}

function extractMaxEntriesPerUser(text: string): number {
  return extractVerifiedMaxEntriesPerUser(text) || 100;
}

function extractVerifiedMaxEntriesPerUser(text: string): number {
  return (
    parseNumber(text.match(/Max\s+([\d,]+)\s+Tickets?\s+Per\s+Person/i)?.[1]) ||
    parseNumber(text.match(/Max\s+([\d,]+)\s+Per\s+(?:Person|User|Customer)\b/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+Max\s+Per\s+(?:Person|User|Customer)\b/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+Max\s+Tickets?\s+Per\s+User/i)?.[1]) ||
    parseNumber(text.match(/Max\s+Tickets?\s+Per\s+User:?\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/Max\s+Per\s+User:?\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/Max\s+Entries\s+Per\s+Customer:?\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/User\s+Ticket\s+Limit:?\s*([\d,]+)/i)?.[1]) ||
    parseNumber(text.match(/Max\s+([\d,]+)\s+tickets?\s+per\s+user/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+Per\s+User/i)?.[1]) ||
    parseNumber(text.match(/([\d,]+)\s+MAX\s+PER\s+PERSON/i)?.[1]) ||
    parseNumber(text.match(/Up\s+to\s+([\d,]+)\s+entries\s+per\s+person/i)?.[1]) ||
    parseNumber(text.match(/maximum\s+of\s+([\d,]+)\s+tickets?\s+per\s+player/i)?.[1]) ||
    parseNumber(text.match(/Limit:\s*([\d,]+)\s+tickets?\s+per\s+person/i)?.[1]) ||
    parseNumber(text.match(/Your\s+maximum\s+purchase\s+limit:\s*([\d,]+)/i)?.[1])
  );
}

function extractQuantityMax(html: string): number | null {
  const quantityMax = html.match(
    /<input\b[^>]*\bname=["']quantity["'][^>]*\bmax=["']([\d,]+)["'][^>]*>/i,
  );
  const max =
    parseNumber(quantityMax?.[1]) ||
    parseNumber(html.match(/\bdata-raffle_mpp=["']([\d,]+)["']/i)?.[1]);
  return max > 0 ? max : null;
}

function extractPrimaryProductText(text: string, name: string): string {
  const start = text.indexOf(name);
  if (start < 0) return text;

  let end = text.length;
  for (const marker of [
    "Related Competition",
    "Related competition",
    "Related competitions",
    "Related Competitions",
    "Related Product",
    "Related product",
    "Related products",
    "Related Products",
    "More competitions",
    "More Competitions",
    "Live Competitions",
    "You may also like",
    "Recently Viewed",
    "Our Lucky Winners",
    "Postal Entry Route",
    "Back To Comps",
    "Back to products",
    "Check These Out",
    "CHECK OUT THESE COMPETITIONS",
    "Check Out These Competitions",
    "Search Tickets",
    "FAQs",
  ]) {
    const markerIndex = text.indexOf(marker, start + name.length);
    if (markerIndex > start && markerIndex < end) end = markerIndex;
  }

  return text.slice(start, end);
}

function extractFullMotionProductText(
  primaryProduct: cheerio.Cheerio<AnyNode>,
  name: string,
): string {
  const scope = primaryProduct.clone();
  scope
    .find(
      ".pg-comp-card, .related, .related-products, .upsells, .cross-sells, " +
        ".live-comps, [data-elementor-type='loop-item']",
    )
    .remove();
  return cleanText(`${name} ${scope.text()}`);
}

function extractBeeTheWinnerProductText(text: string, name: string): string {
  const first = text.indexOf(name);
  if (first < 0) return text;

  const second = text.indexOf(name, first + name.length);
  const start = second > first ? second : first;
  let end = text.length;

  for (const marker of ["Search Tickets", "FAQs"]) {
    const markerIndex = text.indexOf(marker, start + name.length);
    if (markerIndex > start && markerIndex < end) end = markerIndex;
  }

  return text.slice(start, end);
}

function extractDrawDate(html: string, text: string): string | null {
  const dataTime = html.match(
    /data-time=["'](\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?["']/i,
  );
  if (dataTime) {
    return new Date(
      parseInt(dataTime[1], 10),
      parseInt(dataTime[2], 10) - 1,
      parseInt(dataTime[3], 10),
      parseInt(dataTime[4], 10),
      parseInt(dataTime[5], 10),
      parseInt(dataTime[6] ?? "0", 10),
      0,
    ).toISOString();
  }

  const endsAt = html
    .replace(/&quot;/gi, '"')
    .match(/["']ends_at["']\s*:\s*["']([^"']+)["']/i);
  if (endsAt) {
    const parsed = new Date(endsAt[1].replace(" ", "T"));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const alpineEndDate = html.match(/\bendDate:\s*["']([^"']+)["']/i);
  if (alpineEndDate) {
    const parsed = new Date(alpineEndDate[1]);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const epochDataTime = html.match(/data-time=["'](\d{10,13})["']/i);
  if (epochDataTime) {
    const raw = Number(epochDataTime[1]);
    const millis = raw > 9_999_999_999 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }

  const flagshipOnlineClose = html.match(
    /data-fc-online-close-at=["'](\d{10,13})["']/i,
  );
  if (flagshipOnlineClose) {
    const raw = Number(flagshipOnlineClose[1]);
    const millis = raw > 9_999_999_999 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }

  const deadline = html.match(
    /(?:data-deadline|data-end-timestamp|data-pg-countdown)=["'](\d{10,13})["']/i,
  );
  if (deadline) {
    const raw = Number(deadline[1]);
    const millis = raw > 9_999_999_999 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }

  const endTimestamp = html.match(/["']endTimestamp["']\s*:\s*["']?(\d{10,13})/i);
  if (endTimestamp) {
    const raw = Number(endTimestamp[1]);
    const millis = raw > 9_999_999_999 ? raw : raw * 1000;
    return new Date(millis).toISOString();
  }

  const dataEndDate = html.match(
    /data-end(?:date|-date)=["'](\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?["']/i,
  );
  if (dataEndDate) {
    return new Date(
      parseInt(dataEndDate[1], 10),
      parseInt(dataEndDate[2], 10) - 1,
      parseInt(dataEndDate[3], 10),
      parseInt(dataEndDate[4], 10),
      parseInt(dataEndDate[5], 10),
      parseInt(dataEndDate[6] ?? "0", 10),
      0,
    ).toISOString();
  }

  const dataEndTime = html.match(
    /data-end-time=["'](\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?["']/i,
  );
  if (dataEndTime) {
    return new Date(
      parseInt(dataEndTime[1], 10),
      parseInt(dataEndTime[2], 10) - 1,
      parseInt(dataEndTime[3], 10),
      parseInt(dataEndTime[4], 10),
      parseInt(dataEndTime[5], 10),
      parseInt(dataEndTime[6] ?? "0", 10),
      0,
    ).toISOString();
  }

  const countdownDate = html.match(/data-end-date-time=["'](\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::\d{2})?["']/i);
  if (countdownDate) {
    return new Date(
      parseInt(countdownDate[1], 10),
      parseInt(countdownDate[2], 10) - 1,
      parseInt(countdownDate[3], 10),
      parseInt(countdownDate[4], 10),
      parseInt(countdownDate[5], 10),
      0,
      0,
    ).toISOString();
  }

  const epochCountdown = html.match(/data-time=["'](\d{10})["']/i)?.[1];
  if (epochCountdown) {
    const unixSeconds = parseInt(epochCountdown, 10);
    if (Number.isFinite(unixSeconds) && unixSeconds > 0) {
      return new Date(unixSeconds * 1000).toISOString();
    }
  }

  const drawClosesIn = text.match(
    /\bDRAW\s+CLOSES\s+IN\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\b/i,
  );
  if (drawClosesIn) {
    return dateFromParts(
      drawClosesIn[1],
      drawClosesIn[2],
      drawClosesIn[3],
      drawClosesIn[4],
      drawClosesIn[5],
    );
  }

  const relativeCountdown = parseRelativeCountdownDrawDate(text);
  if (relativeCountdown) return relativeCountdown;

  const numericDash = text.match(/Draw Date\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (numericDash) {
    const year = numericDash[3].length === 2 ? `20${numericDash[3]}` : numericDash[3];
    return new Date(
      parseInt(year, 10),
      parseInt(numericDash[2], 10) - 1,
      parseInt(numericDash[1], 10),
      21,
      0,
      0,
      0,
    ).toISOString();
  }

  const iso = html.match(/DateTime\.fromISO\("([^"]+)"/)?.[1];
  if (iso) return iso;

  const embeddedDrawDate = html.match(/"DrawDate":"([^"]+)"/i)?.[1];
  if (embeddedDrawDate) return new Date(embeddedDrawDate).toISOString();

  const prizeDrawn = text.match(/Prize\s+Drawn\s+on\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i);
  if (prizeDrawn) {
    const year = prizeDrawn[3].length === 2 ? `20${prizeDrawn[3]}` : prizeDrawn[3];
    return new Date(
      parseInt(year, 10),
      parseInt(prizeDrawn[2], 10) - 1,
      parseInt(prizeDrawn[1], 10),
      21,
      0,
      0,
      0,
    ).toISOString();
  }

  const prizeWillBeDrawn = text.match(
    /prize\s+will\s+be\s+drawn\s+on\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})/i,
  );
  if (prizeWillBeDrawn) {
    const year = prizeWillBeDrawn[3].length === 2
      ? `20${prizeWillBeDrawn[3]}`
      : prizeWillBeDrawn[3];
    return new Date(
      parseInt(year, 10),
      parseInt(prizeWillBeDrawn[2], 10) - 1,
      parseInt(prizeWillBeDrawn[1], 10),
      parseInt(prizeWillBeDrawn[4], 10),
      parseInt(prizeWillBeDrawn[5], 10),
      0,
      0,
    ).toISOString();
  }

  const close = text.match(
    /Close date:\s*[A-Za-z]{3}\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+@?\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (close) return dateFromParts(close[1], close[2], close[3], close[4], close[5], close[6]);

  const liveDraw = text.match(
    /Live draw\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{2,4})\s+@\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (liveDraw) {
    const year = liveDraw[3].length === 2 ? `20${liveDraw[3]}` : liveDraw[3];
    return dateFromParts(liveDraw[1], liveDraw[2], year, liveDraw[4], liveDraw[5], liveDraw[6]);
  }

  const liveDrawOn = text.match(
    /Live\s+draw\s+on\s+([A-Za-z]+)\s+(\d{1,2})(?:,)?\s+(\d{4}),?\s+(\d{1,2}):([\d]{2})\s*(AM|PM)?/i,
  );
  if (liveDrawOn) {
    return dateFromParts(
      liveDrawOn[2],
      liveDrawOn[1],
      liveDrawOn[3],
      liveDrawOn[4],
      liveDrawOn[5],
      liveDrawOn[6],
    );
  }

  const liveDrawNoYear = text.match(
    /Live\s+Draw:\s+[A-Za-z]+\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i,
  );
  if (liveDrawNoYear) {
    const candidate = dateFromParts(
      liveDrawNoYear[1],
      liveDrawNoYear[2],
      String(new Date().getFullYear()),
      liveDrawNoYear[3],
      liveDrawNoYear[4] ?? "00",
      liveDrawNoYear[5],
    );
    if (!candidate) return null;
    const date = new Date(candidate);
    if (date.getTime() < Date.now()) {
      date.setFullYear(date.getFullYear() + 1);
    }
    return date.toISOString();
  }

  const drawThisWeekNoYear = text.match(
    /draw\s+this\s+[A-Za-z]+\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|pm|am)?/i,
  );
  if (drawThisWeekNoYear) {
    const candidate = dateFromParts(
      drawThisWeekNoYear[1],
      drawThisWeekNoYear[2],
      String(new Date().getFullYear()),
      drawThisWeekNoYear[3],
      drawThisWeekNoYear[4] ?? "00",
      drawThisWeekNoYear[5],
    );
    if (!candidate) return null;
    const date = new Date(candidate);
    if (date.getTime() < Date.now()) {
      date.setFullYear(date.getFullYear() + 1);
    }
    return date.toISOString();
  }

  const entriesClose = text.match(
    /Entries\s+close\s+[A-Za-z]+\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  if (entriesClose) {
    const candidate = dateFromParts(
      entriesClose[1],
      entriesClose[2],
      String(new Date().getFullYear()),
      entriesClose[3],
      entriesClose[4],
      entriesClose[5],
    );
    if (!candidate) return null;
    const date = new Date(candidate);
    if (date.getTime() < Date.now()) {
      date.setFullYear(date.getFullYear() + 1);
    }
    return date.toISOString();
  }

  const drawOnNoYear = text.match(
    /Draw\s+on\s+[A-Za-z]+,\s+(\d{1,2})\s+([A-Za-z]{3,9})/i,
  );
  if (drawOnNoYear) {
    const candidate = dateFromParts(
      drawOnNoYear[1],
      drawOnNoYear[2],
      String(new Date().getFullYear()),
      "20",
      "00",
    );
    if (!candidate) return null;
    const date = new Date(candidate);
    if (date.getTime() < Date.now()) {
      date.setFullYear(date.getFullYear() + 1);
    }
    return date.toISOString();
  }

  const liveDrawDateTime = text.match(
    /Live\s+draw\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s*,?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (liveDrawDateTime) {
    return dateFromParts(
      liveDrawDateTime[1],
      liveDrawDateTime[2],
      liveDrawDateTime[3],
      liveDrawDateTime[4],
      liveDrawDateTime[5],
      liveDrawDateTime[6],
    );
  }

  const drawDateAt = text.match(
    /Draw\s+Date:?\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i,
  );
  if (drawDateAt) {
    return dateFromParts(
      drawDateAt[1],
      drawDateAt[2],
      drawDateAt[3],
      drawDateAt[4],
      drawDateAt[5],
      drawDateAt[6],
    );
  }

  const endDateLabel = text.match(
    /\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\s+End\s+Date\b/i,
  );
  if (endDateLabel) {
    return dateFromParts(
      endDateLabel[1],
      endDateLabel[2],
      endDateLabel[3],
      endDateLabel[4],
      endDateLabel[5],
      endDateLabel[6],
    );
  }

  const lotteryEndsMonthFirst = text.match(
    /Lottery\s+ends\s+on:?\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(UTC\s*[^)]*\)/i,
  );
  if (lotteryEndsMonthFirst) {
    return new Date(
      `${lotteryEndsMonthFirst[1]} ${lotteryEndsMonthFirst[2]}, ${lotteryEndsMonthFirst[3]} ${lotteryEndsMonthFirst[4]}:${lotteryEndsMonthFirst[5]} ${lotteryEndsMonthFirst[6]} UTC`,
    ).toISOString();
  }

  const competitionEndsMonthFirst = text.match(
    /Competition\s+Ends\s+In\s+[A-Za-z]+,\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  if (competitionEndsMonthFirst) {
    return dateFromParts(
      competitionEndsMonthFirst[2],
      competitionEndsMonthFirst[1],
      competitionEndsMonthFirst[3],
      competitionEndsMonthFirst[4],
      competitionEndsMonthFirst[5],
      competitionEndsMonthFirst[6],
    );
  }

  const endsDateTime = text.match(
    /\b(?:competition\s+)?(?:ends?|closes?)\s*:?[ \t]*(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?(?:\s+(UTC|GMT))?/i,
  );
  if (endsDateTime) {
    if (endsDateTime[7]) {
      const meridiem = endsDateTime[6] ? ` ${endsDateTime[6]}` : "";
      return new Date(
        `${endsDateTime[1]} ${endsDateTime[2]} ${endsDateTime[3]} ${endsDateTime[4]}:${endsDateTime[5]}${meridiem} UTC`,
      ).toISOString();
    }
    return dateFromParts(
      endsDateTime[1],
      endsDateTime[2],
      endsDateTime[3],
      endsDateTime[4],
      endsDateTime[5],
      endsDateTime[6],
    );
  }

  const endsNumericDateTime = text.match(
    /\b(?:competition\s+)?(?:ends?|closes?)\s*:?[ \t]*(?:on\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );
  if (endsNumericDateTime) {
    return dateFromNumericParts(
      endsNumericDateTime[1],
      endsNumericDateTime[2],
      endsNumericDateTime[3],
      endsNumericDateTime[4],
      endsNumericDateTime[5] ?? "00",
      endsNumericDateTime[6],
    );
  }

  const endsDateOnly = text.match(
    /\b(?:competition\s+)?(?:ends?|closes?)\s*:?[ \t]*(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\b/i,
  );
  if (endsDateOnly) {
    return dateFromParts(
      endsDateOnly[1],
      endsDateOnly[2],
      endsDateOnly[3],
      "00",
      "00",
    );
  }

  const endsNoYear = text.match(
    /Competition\s+ends?\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/i,
  );
  if (endsNoYear) {
    return dateFromParts(
      endsNoYear[4],
      endsNoYear[5],
      String(new Date().getFullYear()),
      endsNoYear[1],
      endsNoYear[2] ?? "00",
      endsNoYear[3],
    );
  }

  const lotteryEnds = text.match(
    /Lottery\s+ends?:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/i,
  );
  if (lotteryEnds) {
    return dateFromNumericParts(
      lotteryEnds[1],
      lotteryEnds[2],
      lotteryEnds[3],
      lotteryEnds[4],
      lotteryEnds[5],
    );
  }

  const drawNumeric = text.match(
    /\bDraw\s*:?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s*@?\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i,
  );
  if (drawNumeric) {
    const year = drawNumeric[3]
      ? drawNumeric[3].length === 2
        ? `20${drawNumeric[3]}`
        : drawNumeric[3]
      : String(new Date().getFullYear());
    return dateFromNumericParts(
      drawNumeric[1],
      drawNumeric[2],
      year,
      drawNumeric[4],
      drawNumeric[5] ?? "00",
      drawNumeric[6],
    );
  }

  const drawText = text.match(
    /Draw\s*:?[ \t]+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})/i,
  );
  if (drawText) {
    return dateFromParts(
      drawText[1],
      drawText[2],
      drawText[3],
      drawText[4],
      drawText[5],
    );
  }

  const drawOrdinal = text.match(
    /Draw\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+@\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i,
  );
  if (drawOrdinal) {
    return dateFromParts(
      drawOrdinal[1],
      drawOrdinal[2],
      drawOrdinal[3],
      drawOrdinal[4],
      drawOrdinal[5],
      drawOrdinal[6],
    );
  }

  const numeric = text.match(/Draw Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (numeric) {
    const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
    return new Date(
      parseInt(year, 10),
      parseInt(numeric[2], 10) - 1,
      parseInt(numeric[1], 10),
      21,
      0,
      0,
      0,
    ).toISOString();
  }

  const competitionEndsText = text.match(
    /Competition\s+Ends?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i,
  );
  if (competitionEndsText) {
    return dateFromParts(
      competitionEndsText[1],
      competitionEndsText[2],
      competitionEndsText[3],
      competitionEndsText[4],
      competitionEndsText[5],
      competitionEndsText[6],
    );
  }

  const competitionEndsComma = text.match(
    /Competition\s+ends:\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i,
  );
  if (competitionEndsComma) {
    return dateFromParts(
      competitionEndsComma[2],
      competitionEndsComma[1],
      competitionEndsComma[3],
      competitionEndsComma[4],
      competitionEndsComma[5],
      competitionEndsComma[6],
    );
  }

  const endDateComma = text.match(
    /End\s+date:\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/i,
  );
  if (endDateComma) {
    return dateFromParts(
      endDateComma[2],
      endDateComma[1],
      endDateComma[3],
      endDateComma[4],
      endDateComma[5],
      endDateComma[6],
    );
  }

  const bareMonthDateTime = text.match(
    /\b([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)\b/i,
  );
  if (bareMonthDateTime) {
    return dateFromParts(
      bareMonthDateTime[2],
      bareMonthDateTime[1],
      bareMonthDateTime[3],
      bareMonthDateTime[4],
      bareMonthDateTime[5],
      bareMonthDateTime[6],
    );
  }

  return null;
}

function extractScheduledEventEndDate(html: string): string | null {
  const $ = cheerio.load(html);

  for (const script of $("script[type='application/ld+json']").toArray()) {
    const raw = $(script).text().trim();
    if (!raw) continue;

    try {
      const value = JSON.parse(raw) as unknown;
      const objects = flattenJsonLd(value);
      for (const object of objects) {
        const type = object["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (!types.some((item) => item === "EventScheduled")) continue;

        const endDate = object.endDate;
        if (typeof endDate !== "string" || endDate.trim() === "") continue;
        const timestamp = new Date(endDate).getTime();
        if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
      }
    } catch {
      continue;
    }
  }

  return null;
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap((item) => flattenJsonLd(item));
  if (!value || typeof value !== "object") return [];

  const object = value as Record<string, unknown>;
  return [
    object,
    ...flattenJsonLd(object["@graph"]),
  ];
}

function extractUtcSlashDataTime(html: string): string | null {
  const dataTime = html.match(
    /data-time=["'](\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?["']/i,
  );
  if (!dataTime) return null;

  return new Date(
    Date.UTC(
      parseInt(dataTime[1], 10),
      parseInt(dataTime[2], 10) - 1,
      parseInt(dataTime[3], 10),
      parseInt(dataTime[4], 10),
      parseInt(dataTime[5], 10),
      parseInt(dataTime[6] ?? "0", 10),
      0,
    ),
  ).toISOString();
}

function parseRelativeCountdownDrawDate(text: string): string | null {
  const countdown = text.match(
    /\bENDS\s+IN:\s*(?:(\d+)\s*DAYS?\s*(?:\||,)?\s*)?(?:(\d+)\s*HRS?\s*(?:\||,)?\s*)?(?:(\d+)\s*MIN(?:S|UTES?)?\b)/i,
  );
  if (!countdown) return null;

  const days = parseNumber(countdown[1]);
  const hours = parseNumber(countdown[2]);
  const minutes = parseNumber(countdown[3]);
  const durationMs =
    ((days * 24 * 60) + (hours * 60) + minutes) * 60 * 1000;
  if (durationMs <= 0) return null;

  return new Date(Date.now() + durationMs).toISOString();
}

function dateFromParts(
  dayValue: string,
  monthValue: string,
  yearValue: string,
  hourValue: string,
  minuteValue: string,
  meridiemValue?: string,
): string | null {
  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const month = months.findIndex((name) =>
    name.startsWith(monthValue.toLowerCase()),
  );
  if (month < 0) return null;

  let hour = parseInt(hourValue, 10);
  const meridiem = meridiemValue?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(
    parseInt(yearValue, 10),
    month,
    parseInt(dayValue, 10),
    hour,
    parseInt(minuteValue, 10),
    0,
    0,
  ).toISOString();
}

function dateFromText(text: string): string | null {
  const candidate = new Date(text);
  if (Number.isNaN(candidate.getTime())) return null;
  return candidate.toISOString();
}

function dateFromNumericParts(
  dayValue: string,
  monthValue: string,
  yearValue: string,
  hourValue: string,
  minuteValue: string,
  meridiemValue?: string,
): string {
  let hour = parseInt(hourValue, 10);
  const meridiem = meridiemValue?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(
    parseInt(yearValue, 10),
    parseInt(monthValue, 10) - 1,
    parseInt(dayValue, 10),
    hour,
    parseInt(minuteValue, 10),
    0,
    0,
  ).toISOString();
}

function parseJammyDrawDate(
  $card: cheerio.Cheerio<AnyNode>,
  text: string,
): string | null {
  const date = $card.find(".clockdiv[data-date]").first().attr("data-date");
  if (date) {
    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (/\bDRAW\s+TODAY\b/i.test(text)) {
    const today = new Date();
    today.setHours(22, 0, 0, 0);
    return today.toISOString();
  }

  if (/\bDRAW\s+TOMORROW\b/i.test(text)) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(22, 0, 0, 0);
    return tomorrow.toISOString();
  }

  const labelled = text.match(
    /\bDRAW\s+[A-Z]{3}\s+(\d{1,2})(?:ST|ND|RD|TH)\s+([A-Z]+)\b/i,
  );
  if (!labelled) return null;

  const parsed = dateFromParts(
    labelled[1],
    labelled[2],
    String(new Date().getFullYear()),
    "22",
    "00",
  );
  return parsed && new Date(parsed).getTime() > Date.now() ? parsed : null;
}

function parseCompetitionFoxDrawDate(name: string): string | null {
  const match = name.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (!match) return null;

  const date = new Date(
    new Date().getFullYear(),
    parseInt(match[2], 10) - 1,
    parseInt(match[1], 10),
    21,
    0,
    0,
    0,
  );
  return date.toISOString();
}

function parseNumber(value: string | undefined): number {
  return value ? parseInt(value.replace(/,/g, ""), 10) : 0;
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseNumber(value);
  return 0;
}

function decimalFromUnknown(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function absoluteUrl(config: StaticListSiteConfig, href: string): string {
  const normalized = href.trim();
  if (normalized.startsWith("http")) return normalized;
  return normalized.startsWith("/")
    ? `${config.baseUrl}${normalized}`
    : `${config.baseUrl}/${normalized}`;
}

function parseCompetitionPlatformDrawDate(text: string): string | null {
  const match = text.match(/Draw\s+Time\s+(\d{1,2})\s+([A-Za-z]+)\s+at\s+(\d{1,2}):(\d{2})/i);
  if (!match) return null;

  const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const month = months.indexOf(match[2].toLowerCase());
  if (month < 0) return null;

  return new Date(
    new Date().getFullYear(),
    month,
    parseInt(match[1], 10),
    parseInt(match[3], 10),
    parseInt(match[4], 10),
    0,
    0,
  ).toISOString();
}

function unescapeEmbeddedJson(value: string | undefined): string | null {
  return value
    ? value.replace(/\\u0026/g, "&").replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : null;
}

function parseTwoFatLadiesDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return new Date(value.replace(" ", "T")).toISOString();
}

function slugFromUrl(url: string): string | null {
  const path = url.split("?")[0].replace(/\/$/, "");
  const slug = path.substring(path.lastIndexOf("/") + 1);
  return slug ? slugify(slug) : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
