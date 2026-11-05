import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawCompetition } from "../../types.js";
import type { WCLotterySiteConfig } from "./wclottery-site-config.js";

/** Parse a WC Lottery listing page. Handles multiple site layouts. */
export function parsePage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  if (config.siteName === "unlockd") {
    const competition = parseUnlockdDetail(html, config, absoluteConfigUrl(config, config.listPath));
    return competition ? [competition] : [];
  }
  if (config.siteName === "classy") return parseClassyPage(html, config);
  if (config.siteName === "chronowin") return parseChronoPage(html, config);
  if (config.siteName === "properwins") return parseProperWinsPage(html, config);
  if (config.siteName === "agrigiveaways") return parseAgriGiveawaysPage(html, config);
  if (config.siteName === "funandgames") return parseFunAndGamesPage(html, config);
  if (config.siteName === "cultcomps") return parseCultCompsPage(html, config);
  if (config.siteName === "trailtuff") return parseTrailTuffPage(html, config);
  if (config.siteName === "ultimatewins") return parseUltimateWinsPage(html, config);

  const $ = cheerio.load(html);
  const competitions: RawCompetition[] = [];
  const now = new Date().toISOString();

  // Strategy 1: Woo product cards (Blaze, Live Giveaways, Fore Comps)
  $(".product.type-product, li.product").each((_i, el) => {
    try {
      const comp = parseProductCard($, $(el), config, now);
      if (comp) competitions.push(comp);
    } catch { /* skip */ }
  });

  // Strategy 2: article.w-grid-item cards (Click12Win)
  if (competitions.length === 0) {
    $('article[class*="post-"]').each((_i, el) => {
      try {
        const comp = parseGridCard($, $(el), config, now);
        if (comp) competitions.push(comp);
      } catch { /* skip */ }
    });
  }

  // Strategy 3: Elementor loop-item cards (Cumbria Jewellery/Cash)
  if (competitions.length === 0) {
    $('[data-elementor-type="loop-item"][class*="product"]').each((_i, el) => {
      try {
        const comp = parseElementorLoopCard($, $(el), config, now);
        if (comp) competitions.push(comp);
      } catch { /* skip */ }
    });
  }

  // Strategy 4: Nera Competition Websites cards (Luxora Draws)
  if (competitions.length === 0) {
    $(".nera-product-listing .prize-card-aos-wrap").each((_i, el) => {
      try {
        const comp = parseNeraProductCard($, $(el), config, now);
        if (comp) competitions.push(comp);
      } catch { /* skip */ }
    });
  }

  return dedup(competitions).map(stripPaidFreeEntryCategory);
}

function parseUltimateWinsPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const competitions: RawCompetition[] = [];

  $(".product.type-product").each((_index, element) => {
    const $card = $(element);
    const href = $card.find('a[href*="/competitions/"]').first().attr("href") ?? "";
    const url = absoluteConfigUrl(config, href);
    const sourceId = url.match(/\/competitions\/([^/?#]+)/)?.[1] ?? "";
    const name = $card.find("h2").first().text().replace(/\s+/g, " ").trim();
    const entryPrice = parseEntryPriceText($card.find(".ts-badge-value").first().text());
    const ticketsSold = parseInteger($card.find(".ts-progress-sold").first().text());
    const maxTickets = parseInteger($card.find(".ts-progress-max").first().text());
    if (!sourceId || !url || !name || maxTickets <= 0 || ticketsSold > maxTickets) return;

    competitions.push({
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: extractCashAlternativeFromName(name),
      drawDate: null,
      isAutoDraw: /instant wins?/i.test(name),
      categories: [],
      scrapedAt: now,
    });
  });

  return dedup(competitions);
}

function parseNeraProductCard(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  config: WCLotterySiteConfig,
  now: string,
): RawCompetition | null {
  const link = $el.find('a[href*="/product/"]').first().attr("href")?.trim() ?? "";
  const cleanLink = link.split(/[?#]/, 1)[0] ?? link;
  const sourceId = cleanLink.match(/\/product\/([\w%-]+)\/?$/)?.[1] ?? "";
  const url = link.startsWith("http") ? link : `${config.baseUrl}${link}`;
  const name =
    $el.find(".prize-name").first().text().trim() ||
    $el.find("img[alt]").first().attr("alt")?.trim() ||
    $el.find("a[aria-label]").first().attr("aria-label")?.replace(/^View\s+/i, "").trim() ||
    "";

  const cardText = $el.text().replace(/\s+/g, " ");
  const soldMatch = cardText.match(/([\d,]+)\s+tickets?\s+sold/i);
  const remainingMatch = cardText.match(/([\d,]+)\s+remaining/i);
  const soldRaw = soldMatch?.[1] ?? $el.attr("data-popularity");
  const ticketsSold = parseInteger(soldRaw);
  const remaining = parseInteger(remainingMatch?.[1]);
  const maxTickets = remainingMatch ? ticketsSold + remaining : 0;
  const entryPrice = numberFromUnknown($el.attr("data-price"));
  const endTimestamp = Number($el.attr("data-end-date"));
  const drawDate = Number.isFinite(endTimestamp) && endTimestamp > 0
    ? new Date(endTimestamp * 1000).toISOString()
    : extractDrawDateFromCard($el);

  if (
    !sourceId ||
    !name ||
    soldRaw === undefined ||
    !remainingMatch ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    entryPrice < 0 ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: extractCashAlternativeFromCard($el, name),
    drawDate,
    isAutoDraw: /\binstant wins?\b/i.test(name),
    categories: parseNeraCategories($el),
    scrapedAt: now,
  };
}

function parseNeraCategories($el: cheerio.Cheerio<AnyNode>): string[] {
  const raw = $el.attr("data-categories") ?? "";
  try {
    const categories: unknown = JSON.parse(raw);
    if (Array.isArray(categories)) {
      return categories.filter(
        (category): category is string => typeof category === "string" && category.length > 0,
      );
    }
  } catch { /* use the visible category */ }

  const category = $el.find(".prize-cat").first().text().trim().toLowerCase();
  return category ? [category] : [];
}

function parseNeraLotteryProduct(html: string): {
  entryPrice: number;
  ticketsSold: number;
  maxTickets: number;
  maxEntriesPerUser: number;
  drawDate: string | null;
} | null {
  const match = html.match(/\bneraLotteryProduct\s*=\s*(\{[^;]+\})\s*;/);
  if (!match) return null;

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const payload = parsed as Record<string, unknown>;
    const entryPrice = numberFromUnknown(payload.price);
    const ticketsSold = numberFromUnknown(payload.soldTickets);
    const maxTickets = numberFromUnknown(payload.maxTickets);
    const maxEntriesPerUser = numberFromUnknown(payload.maxPerUser);
    const endTimestamp = numberFromUnknown(payload.endTimestamp);
    const drawDate = endTimestamp > 0
      ? new Date(endTimestamp > 9_999_999_999 ? endTimestamp : endTimestamp * 1000).toISOString()
      : typeof payload.endDate === "string"
        ? parseLocalDateTime(payload.endDate)
        : null;

    if (
      entryPrice < 0 ||
      ticketsSold < 0 ||
      maxTickets <= 0 ||
      ticketsSold > maxTickets
    ) {
      return null;
    }

    return {
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser,
      drawDate,
    };
  } catch {
    return null;
  }
}

function parseAgriGiveawaysPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const competitions: RawCompetition[] = [];

  $(".product__card").each((_index, element) => {
    const $card = $(element);
    const href = $card.find('a[href*="/competitions/"]').first().attr("href") ?? "";
    const url = absoluteConfigUrl(config, href);
    const sourceId = url.match(/\/competitions\/([^/]+)\/?$/)?.[1] ?? "";
    const name = $card.find("h3").first().text().replace(/\s+/g, " ").trim();
    const progress = $card.find("[aria-valuenow][aria-valuemax]").first();
    const ticketsSold = parseInteger(progress.attr("aria-valuenow"));
    const maxTickets = parseInteger(progress.attr("aria-valuemax"));
    const entryPrice = parseEntryPriceText($card.text());
    if (!sourceId || !name || entryPrice <= 0 || maxTickets <= 0 || ticketsSold > maxTickets) return;

    competitions.push({
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: extractCashAlternativeFromName(name),
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: now,
    });
  });

  return competitions;
}

function parseFunAndGamesPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const competitions: RawCompetition[] = [];

  $(".rws-live-comp-card").each((_index, element) => {
    const $card = $(element);
    const href = $card.find('a[href*="/competitions/"]').first().attr("href") ?? "";
    const url = absoluteConfigUrl(config, href);
    const sourceId = $card.find("[data-rws-progress-product]").first().attr("data-rws-progress-product") ?? "";
    const name = $card.find("h3").first().text().replace(/\s+/g, " ").trim();
    const ticketText = $card.find("[data-rws-progress-sold]").first().text();
    const soldMax = parseSlashTicketText(ticketText);
    const entryPrice = parseEntryPriceText($card.find(".rws-price--sale, .rws-price").first().text());
    const endTimestamp = Number($card.find("[data-rws-end]").first().attr("data-rws-end"));
    const drawDate = Number.isFinite(endTimestamp) ? new Date(endTimestamp * 1000).toISOString() : null;
    if (!sourceId || !url || !name || !soldMax || entryPrice <= 0 || drawDate === null) return;

    competitions.push({
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice,
      ticketsSold: soldMax.ticketsSold,
      maxTickets: soldMax.maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: extractCashAlternativeFromName(name),
      drawDate,
      isAutoDraw: /instant win/i.test(name),
      categories: [],
      scrapedAt: now,
    });
  });

  return competitions;
}

function parseCultCompsPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const competitions: RawCompetition[] = [];
  const seen = new Set<string>();

  $(".comp-card, .hero-featured-card").each((_index, element) => {
    const $card = $(element);
    const href =
      $card.attr("data-card-href") ??
      $card.find('a[href*="draw.php?id="]').first().attr("href") ??
      "";
    const url = absoluteConfigUrl(config, href);
    if (!url || seen.has(url)) return;
    seen.add(url);

    const name = $card.find(".comp-card__title, .hero-featured-card__title").first().text().replace(/\s+/g, " ").trim();
    const entryPrice = parseEntryPriceText($card.find(".comp-card__price-amount, .hero-featured-card__price").first().text());
    const soldMax = parseSlashTicketText($card.find(".comp-card__meta, .hero-featured-card__meta").first().text());
    const endTimestamp = Number($card.find("[data-countdown]").first().attr("data-countdown"));
    const drawDate = Number.isFinite(endTimestamp) ? new Date(endTimestamp).toISOString() : null;
    const sourceId = new URL(url).searchParams.get("id") ?? "";
    if (!sourceId || !name || entryPrice <= 0 || !soldMax || drawDate === null) return;

    competitions.push({
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice,
      ticketsSold: soldMax.ticketsSold,
      maxTickets: soldMax.maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: extractCashAlternativeFromName(name),
      drawDate,
      isAutoDraw: /instant win/i.test($card.text()),
      categories: [],
      scrapedAt: now,
    });
  });

  return competitions;
}

function parseTrailTuffPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const competitions: RawCompetition[] = [];

  $(".global-product").each((_index, element) => {
    const $card = $(element);
    const href = $card.find('a[href*="/competition/"]').first().attr("href") ?? "";
    const url = absoluteConfigUrl(config, href);
    const sourceId = url.match(/\/competition\/([^/]+)\/?$/)?.[1] ?? "";
    const name = humanizeSlug(sourceId);
    const entryPrice = parseEntryPriceText($card.text());
    if (!sourceId || !url || !name || entryPrice <= 0) return;

    competitions.push({
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: extractCashAlternativeFromName(name),
      drawDate: null,
      isAutoDraw: /instant wins?/i.test(name),
      categories: [],
      scrapedAt: now,
    });
  });

  return dedup(competitions);
}

function absoluteConfigUrl(config: WCLotterySiteConfig, href: string): string {
  if (href.startsWith("http")) return href;
  return `${config.baseUrl}${href.startsWith("/") ? href : `/${href}`}`;
}

function parseSlashTicketText(text: string): { ticketsSold: number; maxTickets: number } | null {
  const match = text.replace(/\s+/g, " ").match(/([\d,]+)\s*\/\s*([\d,]+)/);
  if (!match) return null;
  const ticketsSold = parseInteger(match[1]);
  const maxTickets = parseInteger(match[2]);
  return maxTickets > 0 && ticketsSold >= 0 && ticketsSold <= maxTickets
    ? { ticketsSold, maxTickets }
    : null;
}

function humanizeSlug(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function stripPaidFreeEntryCategory(competition: RawCompetition): RawCompetition {
  if (competition.entryPrice <= 0) return competition;
  return {
    ...competition,
    categories: competition.categories.filter(
      (category) => !/^free(?:[-_\s](?:entry|draw|raffle|ticket)s?)?$/i.test(category.trim()),
    ),
  };
}

function parseChronoPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const link = $('a[href*="/product/"]').first().attr("href") ?? "";
  const url = link.startsWith("http") ? link : `${config.baseUrl}${link}`;
  const sourceId = url.match(/\/product\/([\w%-]+)\/?$/)?.[1] ?? "";
  const text = $("body").text().replace(/\s+/g, " ");
  const name = text.match(/Win\s+This\s+(.+?)\s+Time\s+Left\s+to\s+End:/i)?.[1]?.trim() ?? "";
  const ticketMatch = text.match(
    /([\d,]+)\s*\/\s*([\d,]+)\s+Tickets?\s+Remaining/i,
  );
  const entryPrice = parseEntryPriceText(
    text.match(/for\s+just\s+£\s*[\d,.]+/i)?.[0] ?? "",
  );
  const estimatedPrizeValue = extractSiteEstimatedPrizeValue(text);

  if (!sourceId || !url || !name || !ticketMatch || entryPrice <= 0) return [];

  const remaining = parseInteger(ticketMatch[1]);
  const maxTickets = parseInteger(ticketMatch[2]);
  const drawDate = parseEndsText(text);
  if (maxTickets <= 0 || remaining < 0 || remaining > maxTickets || drawDate === null) {
    return [];
  }

  return [{
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold: maxTickets - remaining,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: null,
    estimatedPrizeValue: estimatedPrizeValue?.estimatedPrizeValue ?? null,
    valuationSource: estimatedPrizeValue?.valuationSource ?? null,
    valuationConfidence: estimatedPrizeValue?.valuationConfidence ?? null,
    valuationNotes: estimatedPrizeValue?.valuationNotes ?? null,
    drawDate,
    isAutoDraw: false,
    categories: ["watch", "luxury"],
    scrapedAt: now,
  }];
}

function parseProperWinsPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const competitions: RawCompetition[] = [];

  $(".pwv43-card").each((_index, element) => {
    const $card = $(element);
    const link = $card.find('a[href*="/product/"]').first().attr("href") ?? "";
    const cleanLink = link.split(/[?#]/, 1)[0] ?? link;
    const sourceId = cleanLink.match(/\/product\/([\w%-]+)\/?$/)?.[1] ?? "";
    const name = $card.find("h3").first().text().replace(/\s+/g, " ").trim();
    if (!sourceId || !name || !link) return;

    const url = link.startsWith("http") ? link : `${config.baseUrl}${link}`;
    const entryPrice = extractEntryPriceEvidence($card) ?? 0;
    competitions.push({
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice,
      // Proper Wins exposes the exact ticket pool on the detail page, so the
      // homepage card intentionally remains incomplete until enrichment.
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: extractCashAlternativeFromName(name),
      drawDate: null,
      isAutoDraw: $card.hasClass("pwv43-card--instant-card") || /instant/i.test($card.text()),
      categories: [],
      scrapedAt: now,
    });
  });

  return dedup(competitions);
}

function parseClassyPage(
  html: string,
  config: WCLotterySiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const now = new Date().toISOString();
  const productLinks = Array.from(
    new Set(
      $('a[href*="/product/"]')
        .map((_i, el) => String($(el).attr("href") ?? ""))
        .get()
        .filter((href) => href.includes("wcct_selector=1")),
    ),
  );
  const titleCandidates = $("h2")
    .map((_i, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((text) => /\bwin\b|odds\s*booster/i.test(text));
  const priceCandidates = $("h2")
    .map((_i, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((text) => /ticket\s+price|entry\s+price/i.test(text))
    .map((text) => parseEntryPriceText(text))
    .filter((price) => price > 0);
  const valueCandidates = $("h2")
    .map((_i, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get()
    .filter((text) => /\bvalue\s*:/i.test(text))
    .map((text) => parseEntryPriceText(text))
    .filter((value) => value > 0);
  const competitions: RawCompetition[] = [];

  $(".lty-lottery-progress-bar").each((index, el) => {
    const href = productLinks[index];
    if (!href) return;

    const url = classyAbsoluteUrl(config, href.split("?")[0]);
    const sourceId = url.match(/\/product\/([^/]+)\/?$/)?.[1] ?? "";
    if (!sourceId) return;

    const $progress = $(el);
    const text = $progress.text().replace(/\s+/g, " ").trim();
    const ticketsSold = parseInteger(text.match(/Tickets\s+Sold:\s*([\d,]+)/i)?.[1]);
    const maxTickets = parseInteger($progress.find(".lty-progress-bar-end").text());
    if (maxTickets <= 0 || ticketsSold < 0 || ticketsSold > maxTickets) return;

    const $scope = $progress.closest(".e-con-inner");
    const name = titleCandidates[index] ?? humanizeSlug(sourceId);
    competitions.push({
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice: priceCandidates[index] ?? 0,
      ticketsSold,
      maxTickets,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: extractCashAlternativeFromName(name),
      estimatedPrizeValue: valueCandidates[index] ?? null,
      valuationSource: valueCandidates[index] ? "site_estimate" : null,
      valuationConfidence: valueCandidates[index] ? "medium" : null,
      valuationNotes: valueCandidates[index]
        ? "Classy homepage states the prize value"
        : null,
      drawDate: extractDrawDateFromCard($scope.length > 0 ? $scope : $progress),
      isAutoDraw: false,
      categories: [],
      scrapedAt: now,
    });
  });

  return dedup(competitions);
}

function parseInteger(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? "").replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function classyAbsoluteUrl(config: WCLotterySiteConfig, href: string): string {
  if (href.startsWith("http")) return href;
  return `${config.baseUrl}${href.startsWith("/") ? href : `/${href}`}`;
}

export function enrichCompetitionFromDetail(
  competition: RawCompetition,
  html: string,
): RawCompetition {
  if (competition.siteName === "dreamwins") {
    return parseDreamWinsDetail(html, competition);
  }
  if (competition.siteName === "adrenalinerush") {
    return parseAdrenalineRushDetail(html, competition);
  }
  if (competition.siteName === "jammy") {
    return parseJammyDetail(html, competition);
  }
  if (competition.siteName === "trailtuff") {
    return parseTrailTuffDetail(html, competition);
  }
  if (competition.siteName === "watchesofwales" || competition.siteName === "watchesofwhitby") {
    return parseWatchesOfWalesDetail(html, competition);
  }
  if (competition.siteName === "676competitions") {
    return parseSixSeventySixDetail(html, competition);
  }
  if (competition.siteName === "leicahunter") {
    return parseLeicaHunterDetail(html, competition);
  }
  if (competition.siteName === "ultimatewins") {
    return parseUltimateWinsDetail(html, competition);
  }

  const $ = cheerio.load(html);
  const $scope = currentProductCashScope(detailScope($));
  const text = $scope.text().replace(/\s+/g, " ");
  const neraProduct = parseNeraLotteryProduct(html);
  const properWinsDetail = competition.siteName === "properwins"
    ? parseProperWinsDetail($, $scope)
    : null;

  const progress = $scope.find("progress").first();
  const progressValue = parseInt((progress.attr("value") ?? "").replace(/,/g, ""), 10);
  const progressMax = parseInt((progress.attr("max") ?? "").replace(/,/g, ""), 10);

  let ticketsSold = competition.ticketsSold;
  let maxTickets = competition.maxTickets;
  if (properWinsDetail) {
    ticketsSold = properWinsDetail.ticketsSold;
    maxTickets = properWinsDetail.maxTickets;
  }
  if (!Number.isNaN(progressValue) && !Number.isNaN(progressMax) && progressMax > 0) {
    ticketsSold = progressValue;
    maxTickets = progressMax;
  }

  // Tackle exposes its total in the listing card and the sold count only as
  // a labelled value on the detail page.
  if (ticketsSold === 0 && maxTickets > 0) {
    const tackleSoldText = $(".lty-tickets-sold").first().text();
    const labelledText = (competition.siteName === "tackle" && tackleSoldText
      ? tackleSoldText
      : ($scope.html() ?? "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ");
    const explicitSoldMatch = labelledText.match(/Tickets\s+Sold\s*:\s*([\d,]+)/i);
    const explicitSold = parseInteger(explicitSoldMatch?.[1]);
    if (explicitSoldMatch && explicitSold >= 0 && explicitSold <= maxTickets) {
      ticketsSold = explicitSold;
    }
  }

  if (maxTickets <= 0) {
    const progressClass = `zapc-refresh-progress-${competition.sourceId}`;
    const zapProgress = $scope
      .find("[aria-valuemax]")
      .filter((_i, el) =>
        ($(el).attr("class") ?? "").split(/\s+/).includes(progressClass),
      )
      .first();
    const sold = parseInteger(zapProgress.attr("aria-valuenow"));
    const total = parseInteger(zapProgress.attr("aria-valuemax"));
    if (total > 0 && sold >= 0 && sold <= total) {
      ticketsSold = sold;
      maxTickets = total;
    }
  }

  if (maxTickets <= 0) {
    const soldMax = parseSoldMaxTicketText(
      $scope.find(".wc-comps-tickets-sold").first().text() || text,
    );
    if (soldMax !== null) {
      ticketsSold = soldMax.ticketsSold;
      maxTickets = soldMax.maxTickets;
    }
  }

  if (maxTickets <= 0) {
    const percentSoldMax = text.match(
      /Tickets?\s+sold\s*:\s*\d+(?:\.\d+)?%\s*\(([\d,]+)\s*\/\s*([\d,]+)\)/i,
    );
    if (percentSoldMax) {
      const sold = parseInt(percentSoldMax[1].replace(/,/g, ""), 10);
      const total = parseInt(percentSoldMax[2].replace(/,/g, ""), 10);
      if (!Number.isNaN(sold) && !Number.isNaN(total) && total > sold) {
        ticketsSold = sold;
        maxTickets = total;
      }
    }
  }

  if (maxTickets <= 0) {
    const ltySold = parseInt(
      ($scope.find(".lty-tickets-sold b").first().text() ||
        text.match(/Tickets\s+Sold\s*:\s*([\d,]+)/i)?.[1] ||
        "").replace(/,/g, ""),
      10,
    );
    const ltyMax = parseInt(
      $scope.find(".lty-progress-bar-end").first().text().replace(/,/g, ""),
      10,
    );
    const remaining = parseInt(
      (text.match(/([\d,]+)\s+Tickets\s+remaining/i)?.[1] ?? "").replace(/,/g, ""),
      10,
    );

    if (!Number.isNaN(ltySold) && ltySold >= 0) {
      ticketsSold = ltySold;
      if (!Number.isNaN(ltyMax) && ltyMax > 0) {
        maxTickets = ltyMax;
      } else if (!Number.isNaN(remaining) && remaining >= 0) {
        maxTickets = ltySold + remaining;
      }
    }
  }

  // Lottery for WooCommerce detail pages can render the sold count as the
  // progress bar start value, with only a generic "Tickets Sold" label.
  if (maxTickets <= 0) {
    const noticeMatch = $scope
      .find(".lty-progress-bar-notice")
      .first()
      .text()
      .match(/[\d,]+/);
    const ltyProgressNotice = parseInteger(
      noticeMatch?.[0],
    );
    const ltyProgressMax = parseInteger(
      $scope.find(".lty-progress-bar-end").first().text(),
    );
    if (noticeMatch && ltyProgressMax > 0 && ltyProgressNotice >= 0 && ltyProgressNotice <= ltyProgressMax) {
      ticketsSold = ltyProgressNotice;
      maxTickets = ltyProgressMax;
    }
  }

  // Some Lottery for WooCommerce sites use the progress bar notice itself
  // for the numeric sold count and leave the start value at zero.
  if (maxTickets <= 0) {
    const noticeMatch = $scope
      .find(".lty-progress-bar-notice")
      .first()
      .text()
      .match(/[\d,]+/);
    const ltyProgressSold = parseInteger(
      $scope.find(".lty-progress-bar-start").first().text(),
    );
    const ltyProgressMax = parseInteger(
      $scope.find(".lty-progress-bar-end").first().text(),
    );
    if (!noticeMatch && ltyProgressMax > 0 && ltyProgressSold >= 0) {
      ticketsSold = ltyProgressSold;
      maxTickets = ltyProgressMax;
    }
  }

  // ChronoWin renders remaining/total ticket counts as "X/Y Tickets
  // Remaining" on the product detail page.
  if (maxTickets <= 0) {
    const remainingSlash = text.match(
      /([\d,]+)\s*\/\s*([\d,]+)\s+Tickets?\s+remaining/i,
    );
    if (remainingSlash) {
      const remaining = parseInteger(remainingSlash[1]);
      const total = parseInteger(remainingSlash[2]);
      if (total > 0 && remaining >= 0 && remaining <= total) {
        ticketsSold = total - remaining;
        maxTickets = total;
      }
    }
  }

  if (maxTickets <= 0) {
    const entriesMatch = text.match(/\bEntries\s+([\d,]+)\s*\/\s*([\d,]+)/i);
    if (entriesMatch) {
      const sold = parseInt(entriesMatch[1].replace(/,/g, ""), 10);
      const total = parseInt(entriesMatch[2].replace(/,/g, ""), 10);
      if (!Number.isNaN(sold) && !Number.isNaN(total) && total > 0) {
        ticketsSold = sold;
        maxTickets = total;
      }
    }
  }

  if (competition.siteName === "youcouldwin" && maxTickets <= 0) {
    const total = parseInteger(text.match(/(?:^|[^\d])([\d,]+)\s+Tickets\b/i)?.[1]);
    const sold = parseInteger(text.match(/(?:^|[^\d])([\d,]+)\s+Sold\b/i)?.[1]);
    if (total > 0 && sold >= 0 && sold <= total) {
      ticketsSold = sold;
      maxTickets = total;
    }
  }

  if (maxTickets <= 0) {
    const remaining = parseRemainingBeforeMax(text);
    if (remaining !== null && ticketsSold > 0) {
      maxTickets = ticketsSold + remaining;
    }
  }

  // Brick Drop renders its exact ticket counts in an ARIA progress bar rather
  // than a standard Woo Lottery progress element.
  if (maxTickets <= 0) {
    const brickDropProgress = $scope.find(
      ".aihc-ecb-progress-bar-container[aria-valuenow][aria-valuemax]",
    ).first();
    const sold = parseInteger(brickDropProgress.attr("aria-valuenow"));
    const total = parseInteger(brickDropProgress.attr("aria-valuemax"));
    if (total > 0 && sold >= 0 && sold <= total) {
      ticketsSold = sold;
      maxTickets = total;
    }
  }

  // Danubian renders the authoritative ticket pair as plain text instead of
  // a WC Lottery progress element.
  if (competition.siteName === "danubiancompetitions" && ticketsSold === 0) {
    const ticketMatch = [...text.matchAll(/\b([\d,]+)\s*\/\s*([\d,]+)\b/g)]
      .find((match) => parseInteger(match[1]) <= parseInteger(match[2]));
    const sold = parseInteger(ticketMatch?.[1]);
    const total = parseInteger(ticketMatch?.[2]);
    if (ticketMatch && total > 0 && sold >= 0 && sold <= total) {
      ticketsSold = sold;
      maxTickets = total;
    }
  }

  // Tickets 2 Treasure labels sold tickets and the fixed pool separately.
  if (competition.siteName === "tickets2treasure") {
    const total = parseInteger(
      text.match(/\b(?:This\s+)?Competition\s+is\s+limited\s+to\s+([\d,]+)\s+tickets?\b/i)?.[1],
    );
    const sold = parseInteger(text.match(/\bTickets\s+sold\s*:\s*([\d,]+)\b/i)?.[1]);
    if (total > 0 && sold >= 0 && sold <= total) {
      ticketsSold = sold;
      maxTickets = total;
    }
  }

  // Plum exposes the exact remaining count and the complete ticket range in
  // its server-rendered ticket tabs, but not an X/Y progress element.
  if (maxTickets <= 0) {
    const remainingMatch = $scope
      .find(".loop-progress-bar")
      .text()
      .match(/([\d,]+)\s+Left/i);
    const remaining = parseInteger(remainingMatch?.[1]);
    const tabMaximum = Math.max(
      ...$scope
        .find(".lty-lottery-ticket-tab")
        .map((_index, element) => {
          const range = $(element).text().match(/-\s*([\d,]+)/);
          return parseInteger(range?.[1]);
        })
        .get(),
    );
    if (remainingMatch && tabMaximum > 0 && remaining >= 0 && remaining <= tabMaximum) {
      ticketsSold = tabMaximum - remaining;
      maxTickets = tabMaximum;
    }
  }

  // Plum Equestrian exposes its ticket pool in labelled metadata and the
  // remaining count in a JTX progress bar rather than a WC Lottery progress
  // element.
  if (maxTickets <= 0) {
    const totalMatch = text.match(/(?:MAX|TOTAL)\s+TICKETS\s*([\d,]+)/i);
    const remainingMatch = text.match(/([\d,]+)\s+tickets\s+remaining\b/i);
    const total = parseInteger(totalMatch?.[1]);
    const remaining = parseInteger(remainingMatch?.[1]);
    if (total > 0 && remaining >= 0 && remaining <= total) {
      ticketsSold = total - remaining;
      maxTickets = total;
    }
  }

  const detailPrice = properWinsDetail?.entryPrice ?? extractEntryPriceEvidence($scope);
  const $title = $scope.find(".product_title, h1").first();
  const detailName = $title.text().trim();
  const $detailCashScope = currentProductCashScope($scope);
  const detailCashAlternative =
    extractCashAlternativeFromCard($detailCashScope, competition.name) ??
    extractCashAlternativeFromName($title.text().trim());
  const siteEstimate =
    extractSiteEstimatedPrizeValue(text) ??
    (competition.siteName === "punterprizes"
      ? parsePunterPrizeValue(text)
      : competition.siteName === "properwins"
        ? parseProperWinsPrizeValue($)
        : competition.siteName === "golfgearraffles"
      ? extractGolfGearMainPrizeValue(text)
      : competition.siteName === "brickdrop"
        ? extractBrickDropPrizeValue(competition)
        : competition.siteName === "garilla"
          ? extractGarillaPrizeValue(detailName)
        : competition.siteName === "365competition"
            ? extract365CompetitionPrizeValue(text)
            : competition.siteName === "offgrid" ||
                competition.siteName === "luxuryrarewhisky" ||
                competition.siteName === "tackle" ||
                competition.siteName === "agrigiveaways" ||
                competition.siteName === "cultcomps" ||
                competition.siteName === "funandgames"
              ? manualEstimateForNewSite(competition)
              : null);
  const jtxMetadataDrawDate = parseJtxMetadataDrawDate($, $scope);
  const perOrderLimitMatch =
    text.match(/User\s+Ticket\s+Limit\s*:?\s*([\d,]+)/i) ??
    text.match(/Max\s+Entries\s+Per\s+(?:Person|User|Customer)\s*:\s*([\d,]+)/i) ??
    text.match(/([\d,]+)\s+tickets?\s+per\s+order\s+limit/i) ??
    text.match(/([\d,]+)\s+Max\s+Per\s+(?:Person|User|Customer)\b/i) ??
    text.match(/Max\s+([\d,]+)\s+Per\s+(?:Person|User|Customer)\b/i) ??
    text.match(/Max\s+Per\s+(?:Person|User|Customer):?\s*([\d,]+)/i) ??
    text.match(/([\d,]+)\s+Max\s+Entries\s+Per\s+(?:Person|User|Customer)\b/i) ??
    text.match(/([\d,]+)\s+tickets?\s+per\s+(?:person|user|customer)\b/i) ??
    text.match(
      /maximum\s+(?:amount|number)\s+of\s+tickets?\s+per\s+(?:person|user|customer)\s+is\s+([\d,]+)/i,
    );
  const perOrderLimit = parseInt(
    perOrderLimitMatch?.[1]?.replace(/,/g, "") ?? "",
    10,
  );
  const twoJsSliderLimit = competition.siteName === "twojs"
    ? parseInteger($scope.find("input[data-rangeslider][max]").first().attr("max"))
    : 0;
  const properWinsLimit = properWinsDetail?.maxEntriesPerUser ?? 0;
  const resolvedEntryPrice = neraProduct?.entryPrice ?? detailPrice ?? competition.entryPrice;
  const categories = competition.siteName === "tickets2treasure" &&
      resolvedEntryPrice === 0 &&
      /\bfree\b/i.test(text)
    ? [...new Set([...competition.categories, "free"])]
    : competition.siteName === "adwin"
      ? competition.categories.filter((category) => !/instant\s+win/i.test(category))
      : competition.categories;

  return {
    ...competition,
    name: competition.siteName === "adwin"
      ? (isPriceOnlyTitle(competition.name) && detailName ? detailName : competition.name)
        .replace(/\s*\+\s*[\d,]+\s+instant\s+wins?\b.*$/i, "")
        .trim()
      : isPriceOnlyTitle(competition.name) && detailName ? detailName : competition.name,
    entryPrice: resolvedEntryPrice,
    ticketsSold: neraProduct
      ? Math.max(competition.ticketsSold, ticketsSold, neraProduct.ticketsSold)
      : ticketsSold,
    maxTickets: neraProduct
      ? Math.max(competition.maxTickets, maxTickets, neraProduct.maxTickets)
      : maxTickets,
    maxEntriesPerUser:
      twoJsSliderLimit ||
      neraProduct?.maxEntriesPerUser ||
      perOrderLimit ||
      properWinsLimit ||
      competition.maxEntriesPerUser,
    maxEntriesPerUserSource:
      twoJsSliderLimit > 0 ||
      (neraProduct?.maxEntriesPerUser ?? 0) > 0 ||
      perOrderLimit > 0 ||
      properWinsLimit > 0
      ? "site"
      : competition.maxEntriesPerUserSource ?? "fallback",
    cashAlternative: competition.cashAlternative ?? detailCashAlternative,
    estimatedPrizeValue: competition.estimatedPrizeValue ?? siteEstimate?.estimatedPrizeValue,
    valuationSource: competition.valuationSource ?? siteEstimate?.valuationSource,
    valuationConfidence: competition.valuationConfidence ?? siteEstimate?.valuationConfidence,
    valuationNotes: competition.valuationNotes ?? siteEstimate?.valuationNotes,
    drawDate:
      neraProduct?.drawDate ??
      properWinsDetail?.drawDate ??
      extractDrawDateFromCard($scope) ??
      parsePlumClosingDate(text) ??
      jtxMetadataDrawDate ??
      parseJtxDrawDate(text) ??
      parseCountdownDataDate($scope) ??
      parseScheduledDrawDate(text) ??
      parseDrawText(text) ??
      competition.drawDate,
    categories,
  };
}

function parseUltimateWinsDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const $scope = $(".product.type-product").first();
  if (!$scope.length) return competition;

  const text = $scope.text().replace(/\s+/g, " ").trim();
  const title = $scope.find("h2").first().text().replace(/\s+/g, " ").trim();
  const name = title.replace(/^Win This\s+/i, "").trim() || competition.name;
  const priceElement = $scope.find(".woocommerce-Price-amount").first();
  const entryPrice = priceElement.length
    ? parseEntryPriceText(priceElement.text())
    : competition.entryPrice;
  const soldText = $scope.find(".ts-progress-sold").first().text();
  const maxText = $scope.find(".ts-progress-max").first().text();
  const progressMatch = text.match(/Sold\s+[\d.]+%\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const ticketsSold = parseInteger(soldText || progressMatch?.[1]);
  const maxTickets = parseInteger(maxText || progressMatch?.[2]);
  const maxEntries = parseInteger(text.match(/Max\s+Entries\s+PP\s*([\d,]+)/i)?.[1]);
  const drawDate = parseUltimateWinsClosingDate(text);

  if (
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null
  ) {
    return competition;
  }

  const siteEstimate = extractSiteEstimatedPrizeValue(text);
  return {
    ...competition,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntries || competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntries > 0
      ? "site"
      : competition.maxEntriesPerUserSource,
    cashAlternative: competition.cashAlternative ?? extractCashAlternativeFromName(name),
    estimatedPrizeValue: competition.estimatedPrizeValue ?? siteEstimate?.estimatedPrizeValue,
    valuationSource: competition.valuationSource ?? siteEstimate?.valuationSource,
    valuationConfidence: competition.valuationConfidence ?? siteEstimate?.valuationConfidence,
    valuationNotes: competition.valuationNotes ?? siteEstimate?.valuationNotes,
    drawDate,
  };
}

function parseUltimateWinsClosingDate(text: string): string | null {
  const match = text.match(
    /Fixed\s+closing\s+date:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(am|pm)/i,
  );
  if (!match) return null;

  const month = monthNumber(match[2]);
  if (month === null) return null;

  let hour = Number(match[4]);
  const meridiem = match[6].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(
    Number(match[3]),
    month,
    Number(match[1]),
    hour,
    Number(match[5]),
    0,
    0,
  ).toISOString();
}

function parseAdrenalineRushDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const $product = $(".product-type-vhs-competition").first();
  const text = $product.text().replace(/\s+/g, " ");
  const title = $("title").text().replace(/\s+[-–—]\s+Adrenaline Rush Competitions.*$/i, "").trim();
  const soldMax = parseSlashTicketText($product.find(".vhs-percentage-sold__details__total").first().text());
  const entryPrice = parseEntryPriceText(text.match(/£\s*[\d,.]+\s*PER ENTRY/i)?.[0] ?? text);
  const drawDate = parseLocalDateTime($product.find(".vhs-countdown-timer").first().attr("data-end-date-time") ?? "");
  const maxEntries = parseInteger(text.match(/([\d,]+)\s+MAX TICKETS PER PERSON/i)?.[1]);
  const prizeMatch = title.match(/£\s*([\d,.]+)\s*(k)?\b/i);
  const prizeValue = prizeMatch ? parseCashAmount(prizeMatch[1], prizeMatch[2]) : 0;
  if (!title || !soldMax || entryPrice <= 0 || drawDate === null) return competition;

  return {
    ...competition,
    name: title,
    entryPrice,
    ticketsSold: soldMax.ticketsSold,
    maxTickets: soldMax.maxTickets,
    maxEntriesPerUser: maxEntries || competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : competition.maxEntriesPerUserSource,
    cashAlternative: extractCashAlternativeFromName(title),
    estimatedPrizeValue: prizeValue || competition.estimatedPrizeValue,
    valuationSource: prizeValue > 0 ? "site_estimate" : competition.valuationSource,
    valuationConfidence: prizeValue > 0 ? "high" : competition.valuationConfidence,
    valuationNotes: prizeValue > 0
      ? "Adrenaline Rush title states the prize value"
      : competition.valuationNotes,
    drawDate,
    isAutoDraw: /instant win/i.test(`${title} ${text}`),
  };
}

function parseJammyDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");
  const name = $("h1, .product_title").first().text().replace(/\s+/g, " ").trim() || competition.name;
  const sold = parseInteger($(".tps-split-sold .big").first().text());
  const remaining = parseInteger($(".tps-split-remaining .big").first().text());
  const entryPrice = parseEntryPriceText(text.match(/Each Ticket Costs:?\s*£\s*[\d,.]+/i)?.[0] ?? text);
  const visibleDate = text.match(
    /DRAW\s+(?:DATE|ENDS)\s*:?\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s*(?:[·•]|at)?\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i,
  );
  const visibleDrawDate = visibleDate
    ? parseNaturalDateTime(
      `${visibleDate[2]} ${visibleDate[1]}, ${visibleDate[3]}`,
      visibleDate[4],
    )
    : null;
  const rawDate = $(".clockdiv[data-date]").first().attr("data-date") ?? "";
  const naturalDate = rawDate.match(
    /([A-Za-z]+\s+\d{1,2},\s+\d{4}),?\s+(\d{1,2}:\d{2}\s*(?:am|pm))/i,
  );
  const drawDate = visibleDrawDate ?? (
    naturalDate
      ? parseNaturalDateTime(naturalDate[1], naturalDate[2])
      : parseLocalDateTime(rawDate)
  );
  const maxEntries = parseInteger(text.match(/Max\s+([\d,]+)\s*\([^)]*\)\s*Per Player/i)?.[1]);
  if (entryPrice <= 0 || remaining < 0 || sold < 0 || sold + remaining <= 0 || drawDate === null) {
    return competition;
  }

  return {
    ...competition,
    name,
    entryPrice,
    ticketsSold: sold,
    maxTickets: sold + remaining,
    maxEntriesPerUser: maxEntries || competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : competition.maxEntriesPerUserSource,
    cashAlternative: extractCashAlternativeFromName(name),
    drawDate,
    isAutoDraw: /auto draw|instant win/i.test(text),
  };
}

function parseTrailTuffDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");
  const name = $("h1").first().text().replace(/\s+/g, " ").trim() || competition.name;
  const entryPrice = parseEntryPriceText(text.match(/£\s*[\d,.]+\s*\/\s*ticket/i)?.[0] ?? text);
  const ticketsSold = parseInteger(text.match(/Tickets\s+Sold:\s*([\d,]+)/i)?.[1]);
  const total = parseInteger(text.match(/lottery\s+is\s+limited\s+to\s+([\d,]+)\s+tickets/i)?.[1]);
  const drawMatch = text.match(/Lottery\s+ends:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s+(\d{1,2}:\d{2}\s*(?:am|pm))/i);
  const drawDate = drawMatch ? parseNaturalDateTime(drawMatch[1], drawMatch[2]) : null;
  if (!name || entryPrice <= 0 || total <= 0 || ticketsSold < 0 || ticketsSold > total || drawDate === null) {
    return competition;
  }

  return {
    ...competition,
    name,
    entryPrice,
    ticketsSold,
    maxTickets: total,
    cashAlternative: extractCashAlternativeFromName(name),
    drawDate,
    isAutoDraw: /instant wins?/i.test(name),
  };
}

function parseCountdownDataDate($scope: cheerio.Cheerio<AnyNode>): string | null {
  const value = $scope.find(".tick[data-date], [data-date]").first().attr("data-date");
  return value ? parseLocalDateTime(value) : null;
}

function parseNaturalDateTime(dateText: string, timeText: string): string | null {
  const match = dateText.match(/([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!match) return null;
  const timeMatch = timeText.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const meridiem = timeMatch[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const month = monthNumber(match[1]);
  if (month === null) return null;
  return new Date(Number(match[3]), month, Number(match[2]), hour, minute, 0, 0).toISOString();
}

function isPriceOnlyTitle(value: string): boolean {
  return /^£\s*[\d,.]+(?:\s+PER\s+ENTRY)?$/i.test(value.trim());
}

export function parseLpeDetailPage(
  html: string,
  config: WCLotterySiteConfig,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const rawSettings = $(".lpe-widget[data-settings]").first().attr("data-settings");
  if (!rawSettings) return null;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(rawSettings);
  } catch {
    return null;
  }

  const name = String(settings.product_name ?? "").trim();
  const sourceId = String(settings.product_id ?? "").trim();
  const entryPrice = numberFromUnknown(settings.ticket_price);
  const ticketsSold = numberFromUnknown(settings.sold_tickets);
  const maxTickets =
    numberFromUnknown(settings.total_tickets) ||
    numberFromUnknown(settings.max_tickets);
  const endDate = String(settings.competition_end ?? "").trim();
  const drawDate = endDate ? parseLocalDateTime(endDate) : null;

  if (
    !name ||
    !sourceId ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold >= maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  const maxEntriesPerUser = numberFromUnknown(settings.max_tickets_per_user);
  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntriesPerUser || 100,
    maxEntriesPerUserSource: maxEntriesPerUser > 0 ? "site" : "fallback",
    cashAlternative: extractCashAlternativeFromName(name),
    drawDate,
    isAutoDraw: /\binstant wins?\b/i.test(name),
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

export function parseDetailPage(
  html: string,
  config: WCLotterySiteConfig,
  url: string,
): RawCompetition | null {
  if (config.siteName === "unlockd") return parseUnlockdDetail(html, config, url);
  if (config.siteName === "dreamwins") {
    const parsed = parseDreamWinsDetail(html, {
      sourceId: "",
      siteName: config.siteName,
      url,
      name: "",
      entryPrice: 0,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: false,
      categories: [],
      scrapedAt: new Date().toISOString(),
    });
    return parsed.sourceId ? parsed : null;
  }
  if (config.siteName === "winaclassic") {
    return parseWinAClassicDetail(html, config, url);
  }
  const $ = cheerio.load(html);
  const $scope = detailScope($);
  const name = $scope.find(".product_title, h1").first().text().trim();
  if (!name) return null;

  const sourceId =
    String(wcLotteryPageId(html) ?? "").trim() ||
    $scope.find('button[name="add-to-cart"]').first().attr("value")?.trim() ||
    ($scope.attr("class") ?? "").match(/post-(\d+)/)?.[1] ||
    url.match(/\/product\/([\w%-]+)\/?$/)?.[1] ||
    "";
  if (!sourceId) return null;

  return enrichCompetitionFromDetail(
    {
      sourceId,
      siteName: config.siteName,
      url,
      name,
      entryPrice: 0,
      ticketsSold: 0,
      maxTickets: 0,
      maxEntriesPerUser: 100,
      maxEntriesPerUserSource: "fallback",
      cashAlternative: null,
      drawDate: null,
      isAutoDraw: /\binstant wins?\b/i.test(name),
      categories: categoriesFromClasses($scope.attr("class") ?? ""),
      scrapedAt: new Date().toISOString(),
    },
    html,
  );
}

function parseUnlockdDetail(
  html: string,
  config: WCLotterySiteConfig,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const name =
    $("h2.elementor-heading-title")
      .filter((_index, element) => /^Win\b/i.test($(element).text().trim()))
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim() ||
    $("h1").first().text().replace(/\s+/g, " ").trim();
  const sourceId = url.match(/\/product\/([\w-]+)\/?$/)?.[1] ?? "";
  const ticketMatch = text.match(/([\d,]+)\s*\/\s*([\d,]+)\s+Tickets\s+Sold/i);
  const entryPrice = parseEntryPriceText(
    text.match(/Per\s+Ticket\s+Price\s*£\s*[\d,.]+/i)?.[0] ?? "",
  );
  const drawDate = parseUnlockdClosingDate(text);
  const prizeValue = parseCashAmount(name.match(/£\s*([\d,.]+)/)?.[1] ?? "");
  const ticketsSold = parseInteger(ticketMatch?.[1]);
  const maxTickets = parseInteger(ticketMatch?.[2]);
  if (!sourceId || !name || entryPrice <= 0 || maxTickets <= 0 || ticketsSold > maxTickets || drawDate === null) {
    return null;
  }

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: parseInteger(text.match(/Max\s+([\d,]+)\s+Tickets\/User/i)?.[1]) || 100,
    maxEntriesPerUserSource: "site",
    cashAlternative: null,
    estimatedPrizeValue: prizeValue > 0 ? prizeValue : null,
    valuationSource: prizeValue > 0 ? "site_estimate" : null,
    valuationConfidence: prizeValue > 0 ? "high" : null,
    valuationNotes: prizeValue > 0 ? "UnlockD title states the voucher value" : null,
    drawDate,
    isAutoDraw: false,
    categories: ["unlockd"],
    scrapedAt: new Date().toISOString(),
  };
}

function parseUnlockdClosingDate(text: string): string | null {
  const match = text.match(
    /Closing\s+Date[A-Za-z]+\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})/i,
  );
  if (!match) return null;
  const month = monthNumber(match[2]);
  if (month === null) return null;
  return new Date(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  ).toISOString();
}

function parseWatchesOfWalesDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const $scope = detailScope($);
  const text = $("body").text().replace(/\s+/g, " ");
  const name = $("h1").first().text().trim() || competition.name;
  const ticketMatch =
    text.match(/([\d,]+)\s*\/\s*([\d,]+)\s+tickets?\s+sold/i) ??
    text.match(/tickets?\s+sold\s*:?\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  const progressSold = parseInteger(
    $(".lty-progress-bar-notice").first().text().match(/Tickets\s+Sold\s*:\s*([\d,]+)/i)?.[1],
  );
  const progressTotal = parseInteger($(".lty-progress-bar-end").first().text());
  const totalAvailable = parseInteger(
    text.match(/TOTAL\s+TICKETS\s+AVAILABLE\s*:\s*([\d,]+)/i)?.[1],
  );
  const ticketsSold = ticketMatch
    ? parseInteger(ticketMatch[1])
    : progressSold || competition.ticketsSold;
  const maxTickets = ticketMatch
    ? parseInteger(ticketMatch[2])
    : progressTotal || totalAvailable || competition.maxTickets;
  const entryPrice = extractEntryPriceEvidence($scope) ?? competition.entryPrice;
  const drawDate =
    parseWatchesOfWalesDrawDate(text) ??
    extractDrawDateFromCard($scope) ??
    competition.drawDate;
  const maxEntries =
    parseWclotteryMaxEntries(text) ||
    parseInteger(text.match(/MAXIMUM\s+TICKETS\s+PER\s+CUSTOMER\s*:?\s*([\d,]+)/i)?.[1]);
  const siteEstimate = extractSiteEstimatedPrizeValue(text);

  return {
    ...competition,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntries || competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : competition.maxEntriesPerUserSource,
    estimatedPrizeValue: competition.estimatedPrizeValue ?? siteEstimate?.estimatedPrizeValue,
    valuationSource: competition.valuationSource ?? siteEstimate?.valuationSource,
    valuationConfidence: competition.valuationConfidence ?? siteEstimate?.valuationConfidence,
    valuationNotes: competition.valuationNotes ?? siteEstimate?.valuationNotes,
    drawDate,
  };
}

function parseSixSeventySixDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ");
  const name = $("h1").first().text().trim() || competition.name;
  const ticketMatch = text.match(
    /TICKETS\s+SOLD\s*(?:[\d.]+%\s*)?([\d,]+)\s+sold\s+([\d,]+)\s+of\s+([\d,]+)\s+remaining/i,
  );
  const ticketsSold = ticketMatch ? parseInteger(ticketMatch[1]) : competition.ticketsSold;
  const maxTickets = ticketMatch ? parseInteger(ticketMatch[3]) : competition.maxTickets;
  const drawDate = parseSixSeventySixDrawDate(text) ?? competition.drawDate;
  const maxEntries = parseInteger(text.match(/Max\s+([\d,]+)\s+tickets?\s+per\s+person/i)?.[1]);
  const cashAlternative = extractCashAlternativeFromDetailText(text);

  return {
    ...competition,
    name,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntries || competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : competition.maxEntriesPerUserSource,
    cashAlternative,
    drawDate,
    isAutoDraw: /instant\s+wins?/i.test(text),
  };
}

function parseSixSeventySixDrawDate(text: string): string | null {
  const match = text.match(
    /DRAW(?:\s+\/\s*END\s+DATE)?\s+[A-Za-z]{3},?\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})/i,
  );
  if (!match) return null;

  const month = monthNumber(match[2]);
  if (month === null) return null;
  return new Date(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  ).toISOString();
}

function extractCashAlternativeFromDetailText(text: string): number | null {
  const match = text.match(/cash\s+alternative[^£]{0,80}£\s*([\d,]+)/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function parseLeicaHunterDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const $scope = currentProductCashScope(detailScope($));
  const text = $scope.text().replace(/\s+/g, " ");
  const name = $scope.find(".product_title, h1").first().text().trim() || competition.name;
  const soldMatch = text.match(/Tickets\s+Sold\s*:?\s*([\d,]+)/i);
  const progressStart = parseInteger($scope.find(".lty-progress-bar-start").first().text());
  const ticketsSold = soldMatch ? parseInteger(soldMatch[1]) : progressStart || competition.ticketsSold;
  const progressEnd = parseInteger($scope.find(".lty-progress-bar-end").first().text());
  const totalMatch = text.match(/(?:Total|Maximum)\s+Tickets\s*:?\s*([\d,]+)/i);
  const maxTickets =
    progressEnd || parseInteger(totalMatch?.[1]) || competition.maxTickets;
  const entryPrice = extractEntryPriceEvidence($scope) ?? competition.entryPrice;
  const drawDate =
    parseLeicaHunterDrawDate(text) ??
    extractDrawDateFromCard($scope) ??
    competition.drawDate;
  const maxEntries = parseWclotteryMaxEntries(text);
  const siteEstimate = extractSiteEstimatedPrizeValue(text);

  return {
    ...competition,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntries || competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : competition.maxEntriesPerUserSource,
    estimatedPrizeValue: competition.estimatedPrizeValue ?? siteEstimate?.estimatedPrizeValue,
    valuationSource: competition.valuationSource ?? siteEstimate?.valuationSource,
    valuationConfidence: competition.valuationConfidence ?? siteEstimate?.valuationConfidence,
    valuationNotes: competition.valuationNotes ?? siteEstimate?.valuationNotes,
    drawDate,
  };
}

function parseWclotteryMaxEntries(text: string): number {
  const match =
    text.match(/([\d,]+)\s+tickets?\s+per\s+order\s+limit/i) ??
    text.match(/Max\s+Entries\s+PP\s*([\d,]+)/i) ??
    text.match(/([\d,]+)\s+Max\s+Per\s+(?:Person|User|Customer)\b/i) ??
    text.match(/Max\s+([\d,]+)\s+Per\s+(?:Person|User|Customer)\b/i) ??
    text.match(/Max\s+Entries?\s+Per\s+(?:Person|User|Customer)\s*:?\s*([\d,]+)/i);
  return parseInteger(match?.[1]);
}

function parseWatchesOfWalesDrawDate(text: string): string | null {
  const match = text.match(
    /(?:closing\s+date|competition\s+(?:closes?|ends?)|draw\s+date)\s*:?\s*(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  ) ?? text.match(
    /(?:competition\s+ends?|closing\s+date|draw\s+date)[^\d]*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})[^\d]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (!match) return null;

  return localNaturalDateTime(
    Number(match[3]),
    match[2],
    Number(match[1]),
    Number(match[4]),
    Number(match[5] ?? "0"),
    match[6],
  );
}

function parseLeicaHunterDrawDate(text: string): string | null {
  const match = text.match(
    /live\s+draw\s*:\s*[A-Za-z]+\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s*[-–—]\s*(\d{1,2}):(\d{2})\s*(am|pm)?\s*\((GMT|BST)\)/i,
  );
  if (!match) return null;

  const month = monthNumber(match[2]);
  if (month === null) return null;
  let hour = Number(match[3]);
  const meridiem = match[5]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  const utcHour = hour - (match[6].toUpperCase() === "BST" ? 1 : 0);
  return new Date(
    Date.UTC(new Date().getFullYear(), month, Number(match[1]), utcHour, Number(match[4]), 0, 0),
  ).toISOString();
}

function localNaturalDateTime(
  year: number,
  monthText: string,
  day: number,
  hourText: number,
  minute: number,
  meridiemText: string,
): string | null {
  const month = monthNumber(monthText);
  if (month === null) return null;
  let hour = hourText;
  const meridiem = meridiemText.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return new Date(year, month, day, hour, minute, 0, 0).toISOString();
}

function parseWinAClassicDetail(
  html: string,
  config: WCLotterySiteConfig,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const $scope = detailScope($);
  const text = $("body").text().replace(/\s+/g, " ");
  const name = $scope.find(".product_title, h1").first().text().trim();
  if (!name) return null;

  const sourceId =
    String(wcLotteryPageId(html) ?? "").trim() ||
    $scope.find('button[name="add-to-cart"]').first().attr("value")?.trim() ||
    ($scope.attr("class") ?? "").match(/post-(\d+)/)?.[1] ||
    url.match(/\/all-competitions\/([^/]+)\/?$/)?.[1] ||
    "";
  const entryPrice = extractEntryPriceEvidence($scope) ?? 0;
  const labelledTicketCounts = text.match(
    /Tickets\s+sold\s*:\s*([\d,]+)\s*\/\s*([\d,]+)/i,
  );
  const compactTicketCounts = text.match(
    /([\d,]+)\s+sold\s+([\d,]+)\s+remaining/i,
  );
  const ticketsSold = parseInteger(labelledTicketCounts?.[1] ?? compactTicketCounts?.[1]);
  const maxTickets = labelledTicketCounts
    ? parseInteger(labelledTicketCounts[2])
    : compactTicketCounts
      ? ticketsSold + parseInteger(compactTicketCounts[2])
      : 0;
  const drawDate =
    extractDrawDateFromCard($scope) ??
    parseCountdownDataDate($scope) ??
    parseScheduledDrawDate(text) ??
    parseDrawText(text);
  const maxEntries = parseInteger(
    text.match(/Max\s+Entries\s+Per\s+Person\s*:\s*([\d,]+)/i)?.[1],
  );
  const siteEstimate = extractSiteEstimatedPrizeValue(text);

  if (
    !sourceId ||
    entryPrice <= 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxEntries || 100,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : "fallback",
    cashAlternative:
      extractCashAlternativeFromCard($scope, name) ?? extractCashAlternativeFromName(name),
    estimatedPrizeValue: siteEstimate?.estimatedPrizeValue ?? null,
    valuationSource: siteEstimate?.valuationSource ?? null,
    valuationConfidence: siteEstimate?.valuationConfidence ?? null,
    valuationNotes: siteEstimate?.valuationNotes ?? null,
    drawDate,
    isAutoDraw: /auto\s+draw|instant\s+win/i.test(text),
    categories: categoriesFromClasses($scope.attr("class") ?? ""),
    scrapedAt: new Date().toISOString(),
  };
}

function parseDreamWinsDetail(
  html: string,
  competition: RawCompetition,
): RawCompetition {
  const $ = cheerio.load(html);
  const $product = $(".product-type-vhs-competition").first();
  const productText = $product.text().replace(/\s+/g, " ").trim();
  const name = $("h1").first().text().replace(/\s+/g, " ").trim() || competition.name;
  const sourceId =
    $product.attr("class")?.match(/post-(\d+)/)?.[1] ??
    (competition.sourceId ||
      competition.url.match(/\/competition\/([^/]+)/)?.[1] ||
      "");
  const soldMax = parseSlashTicketText(
    $product.find(".vhs-percentage-sold__details__total").first().text() || productText,
  );
  const entryPrice = parseEntryPriceText(productText);
  const drawDate = parseLocalDateTime(
    $product.find(".vhs-countdown-timer").first().attr("data-end-date-time") ?? "",
  );
  const maxEntries = parseInteger(
    productText.match(/([\d,]+)\s+Max\s+Per\s+Person/i)?.[1],
  );
  const prizeDetails = $product
    .find(".product-accordion-item")
    .filter((_index, element) => /prize\s+details/i.test($(element).find(".product-accordionHeader").text()))
    .first()
    .text();
  const prizeValue = parseCashAmount(prizeDetails.match(/£\s*([\d,]+)/)?.[1] ?? "");

  if (!sourceId || !name || !soldMax || entryPrice <= 0 || drawDate === null) {
    return competition;
  }

  return {
    ...competition,
    sourceId,
    name,
    entryPrice,
    ticketsSold: soldMax.ticketsSold,
    maxTickets: soldMax.maxTickets,
    maxEntriesPerUser: maxEntries || competition.maxEntriesPerUser,
    maxEntriesPerUserSource: maxEntries > 0 ? "site" : competition.maxEntriesPerUserSource,
    estimatedPrizeValue: prizeValue > 0 ? prizeValue : competition.estimatedPrizeValue,
    valuationSource: prizeValue > 0 ? "site_estimate" : competition.valuationSource,
    valuationConfidence: prizeValue > 0 ? "high" : competition.valuationConfidence,
    valuationNotes: prizeValue > 0 ? "Dream Wins prize details state the main cash prize" : competition.valuationNotes,
    drawDate,
    isAutoDraw: /instant win/i.test(productText),
  };
}

function detailScope($: cheerio.CheerioAPI): cheerio.Cheerio<AnyNode> {
  const $jtx = $(".jtx-single-product-container-inner").first();
  if ($jtx.length > 0) return $jtx;

  const $wcct = $(".wcct-wrap").first();
  if ($wcct.length > 0) return $wcct;

  const $product = $(".product")
    .filter((_index, element) => $(element).find(".product_title, h1").length > 0)
    .last();
  return $product.length > 0 ? $product : $("body");
}

function parseProperWinsDetail(
  $: cheerio.CheerioAPI,
  $scope: cheerio.Cheerio<AnyNode>,
): {
  ticketsSold: number;
  maxTickets: number;
  maxEntriesPerUser: number;
  entryPrice: number;
  drawDate: string | null;
} | null {
  const $picker = $scope.find("[data-pw-picker]").first();
  const maxTickets = parseInteger($picker.attr("data-total"));
  const remaining = parseInteger($picker.attr("data-remaining"));
  if (maxTickets <= 0 || remaining < 0 || remaining > maxTickets) return null;

  const entryPrice = Number.parseFloat($picker.attr("data-unit-price") ?? "");
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;

  return {
    ticketsSold: maxTickets - remaining,
    maxTickets,
    maxEntriesPerUser: parseInteger($picker.attr("data-effective-max")),
    entryPrice,
    drawDate: parseProperWinsDrawDate($),
  };
}

function parseProperWinsDrawDate($: cheerio.CheerioAPI): string | null {
  const description = $("meta[name=description]").attr("content") ?? "";
  const match = description.match(
    /Draw\s+date:\s*([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)\b/i,
  );
  if (!match) return null;

  const [, monthText, dayText, yearText, hourText, minuteText, meridiemText] = match;
  const month = monthNumber(monthText);
  if (month === null) return null;

  let hour = Number(hourText);
  const meridiem = meridiemText.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(
    Number(yearText),
    month,
    Number(dayText),
    hour,
    Number(minuteText),
    0,
    0,
  ).toISOString();
}

function parsePunterPrizeValue(
  text: string,
): Pick<RawCompetition, "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"> | null {
  const match = text.match(
    /(?:end|final)\s+prize\s+draw\s+for\s+£\s*([\d,.]+)/i,
  );
  const value = Number.parseFloat((match?.[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;

  return {
    estimatedPrizeValue: value,
    valuationSource: "site_estimate",
    valuationConfidence: "high",
    valuationNotes: "Punter Prizes detail page states the final draw amount",
  };
}

function parseProperWinsPrizeValue(
  $: cheerio.CheerioAPI,
): Pick<RawCompetition, "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"> | null {
  const description = $("meta[name=description]").attr("content") ?? "";
  const match = description.match(/End\s+draw\s+amount:\s*£\s*([\d,.]+)/i);
  const value = Number.parseFloat((match?.[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;

  return {
    estimatedPrizeValue: value,
    valuationSource: "site_estimate",
    valuationConfidence: "high",
    valuationNotes: "Proper Wins detail metadata states the end draw amount",
  };
}

export function isClosedCompetitionDetailPage(html: string): boolean {
  const $ = cheerio.load(html);
  const $scope = detailScope($);
  const classes = $scope.attr("class") ?? "";
  if (/\b(?:competition-closed|competition-finished|product_cat-complete)\b/i.test(classes)) {
    return true;
  }

  return /please\s+wait\s+for\s+the\s+result/i.test(
    $scope.find(".lty-waiting-result-message").text(),
  );
}

function currentProductCashScope(
  $scope: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  const $cashScope = $scope.clone();
  $cashScope
    .find(
      [
        ".related",
        ".related-products",
        ".upsells",
        ".cross-sells",
        ".live-comps",
        ".products",
        ".jet-listing-grid__item",
        '[data-elementor-type="loop-item"]',
      ].join(", "),
    )
    .remove();
  if ($scope.is(".product")) {
    $cashScope.find(".product").remove();
  }
  $cashScope.find("script, style").remove();
  return $cashScope;
}

/** Parse li.product card — covers Blaze (data attributes) and Live Giveaways (WC Lottery classes) */
function parseProductCard(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  config: WCLotterySiteConfig,
  now: string,
): RawCompetition | null {
  // URL + source ID
  const link =
    $el.find('a.product-info[href*="/product/"]').first().attr("href") ||
    $el.find('a[href*="/product/"]').first().attr("href") ||
    $el.find("a").first().attr("href") ||
    "";
  if (!link) return null;

  // Extract slug from various URL patterns: /competition/, /competitions/, /product/
  const cleanLink = link.split(/[?#]/, 1)[0] ?? link;
  const slugMatch = cleanLink.match(/\/(?:competitions?|product|raffles?|shop)\/([\w%-]+)\/?$/);
  const sourceId = slugMatch?.[1] ?? "";
  if (!sourceId) return null;

  const url = link.startsWith("http") ? link : `${config.baseUrl}${link}`;

  // Post ID fallback
  const classes = $el.attr("class") || "";
  if (/\b(?:competition-closed|competition-finished|product_cat-complete)\b/i.test(classes)) {
    return null;
  }
  const postMatch = classes.match(/post-(\d+)/);

  // Name
  const galaxyName = config.siteName === "galaxycomps"
    ? $el.find("h2").map((_index, element) => $(element).text().replace(/\s+/g, " ").trim()).get()
      .find((text) => text.length > 0 && !/total tickets|% sold|per entry|^£/i.test(text)) ?? ""
    : "";
  const name =
    galaxyName ||
    $el.find(".elementor-element-d58edd4 .elementor-heading-title").first().text().trim() ||
    $el.find("h2").first().text().trim() ||
    $el.find("h3").first().text().trim() ||
    $el.find("a.product-info").first().text().trim() ||
    $el.find('[class*="title"]').first().text().trim() ||
    $el.find(".woocommerce-loop-product__title").first().text().trim();
  if (!name) return null;

  // Skip closed competitions
  if ($el.attr("data-closed") === "true") return null;

  // ── Ticket data ──

  let ticketsSold = 0;
  let maxTickets = 0;

  // Strategy A: data attributes (Blaze)
  const dataPop = $el.attr("data-popularity");
  if (dataPop) {
    ticketsSold = parseInt(dataPop, 10) || 0;
  }

  // Strategy B: <progress> element (Live Giveaways)
  if (ticketsSold === 0) {
    const progress = $el.find("progress").first();
    const val = progress.attr("value");
    const max = progress.attr("max");
    if (val && max) {
      ticketsSold = parseInt(val, 10) || 0;
      maxTickets = parseInt(max, 10) || 0;
    }
  }

  // Strategy C: .lottery-sold / .lottery-remaining classes
  if (ticketsSold === 0) {
    const soldText = $el.find(".lottery-sold").text().trim();
    const remainText = $el.find(".lottery-remaining").text().trim();
    if (soldText) {
      ticketsSold = parseInt(soldText.replace(/,/g, ""), 10) || 0;
      if (remainText) {
        const remaining = parseInt(remainText.replace(/,/g, ""), 10) || 0;
        maxTickets = ticketsSold + remaining;
      }
    }
  }

  // Strategy C2: Game Changing Giveaways exposes "Tickets sold: X/Y".
  if (ticketsSold === 0) {
    const soldMax = parseSoldMaxTicketText(
      $el.find(".wc-comps-tickets-sold").first().text() || $el.text(),
    );
    if (soldMax !== null) {
      ticketsSold = soldMax.ticketsSold;
      maxTickets = soldMax.maxTickets;
    }
  }

  // Lottery for WooCommerce's stock card layout separates the sold label and
  // total into adjacent progress-bar spans instead of rendering X/Y text.
  if (ticketsSold === 0) {
    const ltySold = parseInteger(
      $el.find(".lty-progress-bar-notice").first().text().match(/Tickets?\s+Sold\s*:?\s*([\d,]+)/i)?.[1],
    );
    const ltyMax = parseInteger($el.find(".lty-progress-bar-end").first().text());
    if (ltyMax > 0 && ltySold >= 0 && ltySold <= ltyMax) {
      ticketsSold = ltySold;
      maxTickets = ltyMax;
    }
  }

  // Strategy D: .progress-sold with "X/Y" format (Supreemlife, EasyLiving, Clover)
  if (ticketsSold === 0) {
    const progressSold = $el.find(".progress-sold").text().trim();
    const slashMatch = progressSold.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    if (slashMatch) {
      ticketsSold = parseInt(slashMatch[1].replace(/,/g, ""), 10);
      maxTickets = parseInt(slashMatch[2].replace(/,/g, ""), 10);
    }
  }

  // Strategy E: .tickets-sold-text with "X/Y" format (Blaze JS-rendered fallback)
  if (ticketsSold === 0) {
    const ticketText = $el.find(".tickets-sold-text").text().trim();
    const slashMatch = ticketText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    if (slashMatch) {
      ticketsSold = parseInt(slashMatch[1].replace(/,/g, ""), 10);
      maxTickets = parseInt(slashMatch[2].replace(/,/g, ""), 10);
    }
  }

  // Strategy F: "Tickets Sold: X of Y" text (The Car Competition)
  if (ticketsSold === 0) {
    const cardText = $el.text();
    const soldOfMatch = cardText.match(/Tickets?\s+Sold:\s*([\d,]+)\s+of\s+([\d,]+)/i);
    if (soldOfMatch) {
      ticketsSold = parseInt(soldOfMatch[1].replace(/,/g, ""), 10);
      maxTickets = parseInt(soldOfMatch[2].replace(/,/g, ""), 10);
    }
  }

  // Strategy G: Generic "X/Y" anywhere in card text (last resort)
  if (ticketsSold === 0) {
    const cardText = $el.text();
    const slashMatch = cardText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
    if (slashMatch) {
      const sold = parseInt(slashMatch[1].replace(/,/g, ""), 10);
      const max = parseInt(slashMatch[2].replace(/,/g, ""), 10);
      // Sanity check: max should be larger than sold
      if (max > sold && max >= 100) {
        ticketsSold = sold;
        maxTickets = max;
      }
    }
  }

  if (maxTickets <= 0) {
    const cardText = $el.text().replace(/\s+/g, " ");
    const remaining = parseRemainingBeforeMax(cardText);
    if (remaining !== null && ticketsSold > 0) {
      maxTickets = ticketsSold + remaining;
    }
  }

  // ── Entry price ──

  let entryPrice = 0;
  const dataPrice = $el.attr("data-price");
  if (dataPrice) {
    entryPrice = parseFloat(dataPrice) || 0;
  }
  if (entryPrice === 0) {
    entryPrice = extractEntryPrice($el);
  }

  // ── Draw date ──

  const drawDate = extractDrawDateFromCard($el);

  // ── Cash alternative ──

  const cashAlternative = extractCashAlternativeFromCard($el, name);

  // ── Categories ──

  const categories: string[] = [];
  const catMatch = classes.match(/product_cat-([^\s]+)/g);
  if (catMatch) {
    for (const c of catMatch) {
      const cat = c.replace("product_cat-", "");
      if (!["live", "template-instant-win"].includes(cat)) {
        categories.push(cat.replace(/-/g, " "));
      }
    }
  }

  if (categories.some((category) => /past|closed|finished|failed/i.test(category))) {
    return null;
  }
  if (categories.some((category) => /\bapp only\b/i.test(category))) {
    return null;
  }

  const isAutoDraw =
    name.toLowerCase().includes("auto draw") ||
    name.toLowerCase().includes("instant win");

  return {
    sourceId: postMatch?.[1] ?? sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative,
    drawDate,
    isAutoDraw,
    categories,
    scrapedAt: now,
  };
}

/** Parse article.w-grid-item card (Click12Win grid layout) */
function parseGridCard(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  config: WCLotterySiteConfig,
  now: string,
): RawCompetition | null {
  const classes = $el.attr("class") || "";
  if (/\b(?:competition-closed|competition-finished|product_cat-complete)\b/i.test(classes)) {
    return null;
  }
  const postMatch = classes.match(/post-(\d+)/);
  if (!postMatch) return null;

  const link =
    $el.find('a[href*="/product/"]').first().attr("href") ||
    $el.find('a[href*="/competition/"], a[href*="/competitions/"]').first().attr("href") ||
    "";
  if (!link) return null;
  if (/\/winner\//i.test(link)) return null;

  const sourceId = postMatch[1];
  const url = link.startsWith("http") ? link : `${config.baseUrl}${link}`;

  // Name — first meaningful heading or link text
  const name =
    $el.find("h2, h3").first().text().trim() ||
    $el.find("a").first().text().trim();
  if (!name) return null;

  // Tickets: "Sold: 241/2300" in span.wc-comps-tickets-sold
  let ticketsSold = 0;
  let maxTickets = 0;
  const soldText =
    $el.find(".wc-comps-tickets-sold").text() ||
    $el.find(".wcl-progress-meter .current").text() ||
    $el.text();
  const slashMatch =
    soldText.match(/Sold:\s*([\d,]+)\s*\/\s*([\d,]+)/i) ||
    soldText.match(/([\d,]+)\s*\/\s*([\d,]+)\s*Sold/i);
  if (slashMatch) {
    ticketsSold = parseInt(slashMatch[1].replace(/,/g, ""), 10);
    maxTickets = parseInt(slashMatch[2].replace(/,/g, ""), 10);
  }

  if (ticketsSold === 0) {
    const progress = $el.find("progress").first();
    const val = progress.attr("value");
    const max = progress.attr("max");
    if (val && max) {
      ticketsSold = parseInt(val.replace(/,/g, ""), 10) || 0;
      maxTickets = parseInt(max.replace(/,/g, ""), 10) || 0;
    }
  }

  // Price
  const entryPrice = extractEntryPrice($el);

  const cashAlternative = extractCashAlternativeFromCard($el, name);

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative,
    drawDate: extractDrawDateFromCard($el),
    isAutoDraw: name.toLowerCase().includes("instant win"),
    categories: [],
    scrapedAt: now,
  };
}

/** Parse Elementor product loop cards with countdown and progress widgets. */
function parseElementorLoopCard(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  config: WCLotterySiteConfig,
  now: string,
): RawCompetition | null {
  const classes = $el.attr("class") || "";
  const postMatch = classes.match(/post-(\d+)/);
  const link = $el.find('a[href*="/product/"]').first().attr("href") || "";
  if (!link) return null;

  const slugMatch = link.match(/\/product\/([\w%-]+)\/?$/);
  const sourceId = postMatch?.[1] ?? slugMatch?.[1] ?? "";
  if (!sourceId) return null;

  const url = link.startsWith("http") ? link : `${config.baseUrl}${link}`;
  const name =
    $el.find(".elementor-element-d58edd4 .elementor-heading-title").first().text().trim() ||
    $el.find("h2, h3").first().text().trim() ||
    $el.find("a").first().text().trim();
  if (!name) return null;

  let ticketsSold = 0;
  let maxTickets = 0;
  const progressText =
    $el.find(".elementor-progress-text").first().text() ||
    $el.find(".elementor-progress-wrapper").first().attr("aria-valuetext") ||
    "";
  const slashMatch = progressText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
  if (slashMatch) {
    ticketsSold = parseInt(slashMatch[1].replace(/,/g, ""), 10);
    maxTickets = parseInt(slashMatch[2].replace(/,/g, ""), 10);
  }

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice: extractEntryPrice($el),
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: extractCashAlternativeFromCard($el, name),
    drawDate: extractDrawDateFromCard($el),
    isAutoDraw: name.toLowerCase().includes("instant win"),
    categories: categoriesFromClasses(classes),
    scrapedAt: now,
  };
}

function parseCashAmount(value: string, suffix?: string): number {
  const amount = parseFloat(value.replace(/,/g, ""));
  if (Number.isNaN(amount)) return 0;
  return suffix ? amount * 1000 : amount;
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = parseFloat(value.replace(/,/g, ""));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function wcLotteryPageId(html: string): string | null {
  const match = html.match(/\bwc_lottery_data\s*=\s*(\{[^;]+\})/);
  if (!match) return null;

  try {
    const data = JSON.parse(match[1]);
    return typeof data.page_id === "string" || typeof data.page_id === "number"
      ? String(data.page_id)
      : null;
  } catch {
    return null;
  }
}

function extractEntryPrice($el: cheerio.Cheerio<AnyNode>): number {
  return extractEntryPriceEvidence($el) ?? 0;
}

function extractEntryPriceEvidence($el: cheerio.Cheerio<AnyNode>): number | null {
  const scopedSelectors = [
    ".loop-price",
    ".price",
    "[class*=price]",
  ];

  for (const selector of scopedSelectors) {
    const $scope = $el.find(selector).first();
    if (!$scope.length) continue;

    // Some free-entry product pages contain related paid-product cards inside
    // the main product. Preserve an explicit zero/free price instead of
    // falling through to a related card's price.
    const scopeText = $scope.text();
    if (/\bfree\b/i.test(scopeText) || /£\s*0(?:[.,]0+)?(?:\s|$)/.test(scopeText)) {
      return 0;
    }

    const salePrice = parseEntryPriceText(
      $scope.find("ins .woocommerce-Price-amount, ins").last().text(),
    );
    if (salePrice > 0) return salePrice;

    const amountPrice = parseEntryPriceText(
      $scope.find(".woocommerce-Price-amount").last().text(),
    );
    if (amountPrice > 0) return amountPrice;

    const textPrice = parseEntryPriceText($scope.text());
    if (textPrice > 0) return textPrice;
  }

  const amountText = $el.find(".woocommerce-Price-amount").first().text();
  if (/£\s*0(?:[.,]0+)?(?:\s|$)/.test(amountText)) return 0;
  const amountPrice = parseEntryPriceText(amountText);
  if (amountPrice > 0) return amountPrice;

  const scopedTicketPrice = parsePerTicketPriceText($el.text());
  if (scopedTicketPrice > 0) return scopedTicketPrice;

  return null;
}

function parseEntryPriceText(text: string): number {
  const perTicketPrice = parsePerTicketPriceText(text);
  if (perTicketPrice > 0) return perTicketPrice;

  const poundMatch = text.match(/£\s*([\d,.]+)/);
  if (poundMatch) {
    const value = parseFloat(poundMatch[1].replace(/,/g, ""));
    return Number.isNaN(value) ? 0 : value;
  }

  const penceMatch = text.match(/\b(\d+)p\b/i);
  if (penceMatch) return parseInt(penceMatch[1], 10) / 100;

  return 0;
}

function parsePerTicketPriceText(text: string): number {
  const normalised = text.replace(/\s+/g, " ");
  const poundPerTicketMatch = normalised.match(
    /£\s*([\d,.]+)\s*(?:\/\s*)?(?:per\s*)?(?:ticket|entry)\b/i,
  );
  if (poundPerTicketMatch) {
    const value = parseFloat(poundPerTicketMatch[1].replace(/,/g, ""));
    return Number.isNaN(value) ? 0 : value;
  }

  const pencePerTicketMatch = normalised.match(
    /\b(\d+(?:\.\d+)?)\s*p\s*(?:\/\s*)?(?:per\s*)?(?:ticket|entry)\b/i,
  );
  if (!pencePerTicketMatch) return 0;

  const value = parseFloat(pencePerTicketMatch[1]);
  return Number.isNaN(value) ? 0 : value / 100;
}

function parseRemainingBeforeMax(text: string): number | null {
  const remainingMatch = text.match(/([\d,]+)\s+remaining\s+Max\s+\d+\s+p\/p/i);
  if (!remainingMatch) return null;

  const remaining = parseInt(remainingMatch[1].replace(/,/g, ""), 10);
  return Number.isNaN(remaining) || remaining < 0 ? null : remaining;
}

function parseSoldMaxTicketText(
  text: string,
): { ticketsSold: number; maxTickets: number } | null {
  const match = text.match(
    /(?:Tickets?\s+sold|Sold)\s*:?\s*([\d,]+)\s*\/\s*([\d,]+)/i,
  ) ?? text.match(/([\d,]+)\s+of\s+([\d,]+)\s+Tickets?\s+Sold\b/i);
  if (!match) return null;

  const ticketsSold = parseInt(match[1].replace(/,/g, ""), 10);
  const maxTickets = parseInt(match[2].replace(/,/g, ""), 10);
  if (
    Number.isNaN(ticketsSold) ||
    Number.isNaN(maxTickets) ||
    ticketsSold < 0 ||
    maxTickets <= ticketsSold
  ) {
    return null;
  }

  return { ticketsSold, maxTickets };
}

function extractDrawDateFromCard($el: cheerio.Cheerio<AnyNode>): string | null {
  const wxgEnd = $el.is("[data-wxg-countdown][data-end]")
    ? $el.attr("data-end")
    : $el.find("[data-wxg-countdown][data-end]").first().attr("data-end");
  if (wxgEnd) {
    const raw = Number(wxgEnd);
    if (Number.isFinite(raw)) {
      const millis = raw > 9_999_999_999 ? raw : raw * 1000;
      return new Date(millis).toISOString();
    }
  }

  const dataEnd =
    attrFromSelfOrChild($el, "data-end-date") ??
    attrFromSelfOrChild($el, "data-enddate");
  if (dataEnd) {
    const parsed = parseLocalDateTime(dataEnd);
    if (parsed) return parsed;
  }

  const $dataTime = $el.is("[data-time]") ? $el : $el.find("[data-time]").first();
  const dataTime = $dataTime.attr("data-time");
  const dataTimeLabel = $dataTime
    .closest(".lty-lottery-date-ranges")
    .find(".lty-lottery-time-left-label")
    .first()
    .text()
    .trim();
  if (dataTime && !/^Start(?:s|ing(?: in)?)?:?$/i.test(dataTimeLabel)) {
    const raw = Number(dataTime);
    if (!Number.isNaN(raw)) {
      const millis = raw > 9_999_999_999 ? raw : raw * 1000;
      return new Date(millis).toISOString();
    }

    const parsed = parseLocalDateTime(dataTime);
    if (parsed) return parsed;
  }

  const dataDate = attrFromSelfOrChild($el, "data-date");
  if (dataDate) {
    const raw = Number(dataDate);
    if (!Number.isNaN(raw)) {
      const millis = raw > 9_999_999_999 ? raw : raw * 1000;
      return new Date(millis).toISOString();
    }
  }

  const textDate = parseEndsText($el.text().replace(/\s+/g, " "));
  if (textDate) return textDate;

  return null;
}

function attrFromSelfOrChild(
  $el: cheerio.Cheerio<AnyNode>,
  attr: string,
): string | undefined {
  return $el.attr(attr) ?? $el.find(`[${attr}]`).first().attr(attr);
}

function parseLocalDateTime(value: string): string | null {
  const match = value.match(
    /(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
    0,
  ).toISOString();
}

function parseEndsText(text: string): string | null {
  const embeddedIso = parseEmbeddedIsoCountdown(text);
  if (embeddedIso) return embeddedIso;

  const explicitDate = parseExplicitDrawDate(text);
  if (explicitDate) return explicitDate;

  const fullDateMatch = text.match(
    /\bCompetition\s+ends\s+on:\s+([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)\b/i,
  );
  if (fullDateMatch) {
    const [, monthText, dayText, yearText, hourText, minuteText, meridiemText] = fullDateMatch;
    const month = monthNumber(monthText);
    if (month === null) return null;

    let hour = Number(hourText);
    const meridiem = meridiemText.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    return new Date(
      Number(yearText),
      month,
      Number(dayText),
      hour,
      Number(minuteText),
      0,
      0,
    ).toISOString();
  }

  const match = text.match(
    /\bENDS?\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i,
  );
  if (!match) return parseDrawText(text);

  const [, dayText, monthText, hourText, minuteText, meridiemText] = match;
  const month = monthNumber(monthText);
  if (month === null) return null;

  let hour = Number(hourText);
  const minute = Number(minuteText ?? "0");
  const meridiem = meridiemText?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  const now = new Date();
  let date = new Date(now.getFullYear(), month, Number(dayText), hour, minute, 0, 0);
  if (date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    date = new Date(now.getFullYear() + 1, month, Number(dayText), hour, minute, 0, 0);
  }
  return date.toISOString();
}

function parseExplicitDrawDate(text: string): string | null {
  const monthFirstMatch = text.match(
    /\b(?:Draw\s+Date|Competition\s+Ends?|ENDS?)(?:\s+on)?\s*:?\s*([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(am|pm))?/i,
  );
  if (monthFirstMatch) {
    const [, monthText, dayText, yearText, hourText, minuteText, meridiemText] = monthFirstMatch;
    const month = monthNumber(monthText);
    if (month === null) return null;

    let hour = Number(hourText ?? "20");
    const minute = Number(minuteText ?? "0");
    const meridiem = meridiemText?.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    return new Date(
      Number(yearText),
      month,
      Number(dayText),
      hour,
      minute,
      0,
      0,
    ).toISOString();
  }

  const numericMeridiemMatch = text.match(
    /\b(?:Draw\s+Date|Competition\s+Ends?)\s*:?[\s]*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)\b/i,
  );
  if (numericMeridiemMatch) {
    const [, dayText, monthText, yearText, hourText, minuteText, meridiemText] = numericMeridiemMatch;
    let hour = Number(hourText);
    const meridiem = meridiemText.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    return new Date(
      Number(yearText),
      Number(monthText) - 1,
      Number(dayText),
      hour,
      Number(minuteText),
      0,
      0,
    ).toISOString();
  }

  const numericMatch = text.match(
    /\b(?:Draw\s+Date|Competition\s+Ends?)\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\b/i,
  );
  if (numericMatch) {
    const [, dayText, monthText, yearText, hourText, minuteText] = numericMatch;
    return new Date(
      Number(yearText),
      Number(monthText) - 1,
      Number(dayText),
      Number(hourText),
      Number(minuteText),
      0,
      0,
    ).toISOString();
  }

  const match = text.match(
    /\b(?:Draw\s+Date|Competition\s+Ends?)\s*:?\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i,
  );
  if (!match) return null;

  const [, dayText, monthText, yearText, hourText, minuteText, meridiemText] = match;
  const month = monthNumber(monthText);
  if (month === null) return null;

  let hour = Number(hourText ?? "20");
  const minute = Number(minuteText ?? "0");
  const meridiem = meridiemText?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(Number(yearText), month, Number(dayText), hour, minute, 0, 0).toISOString();
}

function parseJtxDrawDate(text: string): string | null {
  const match = text.match(
    /\bDRAW\s+DATE\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(\d{1,2}):(\d{2})(?=\D|$)/i,
  );
  if (!match) return null;

  return parseLocalDateTime(
    `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")} ${match[4].padStart(2, "0")}:${match[5]}`,
  );
}

function parseJtxMetadataDrawDate(
  $: cheerio.CheerioAPI,
  $scope: cheerio.Cheerio<AnyNode>,
): string | null {
  let drawDate: string | null = null;
  $scope.find(".jtx-lottery-ticket-meta-box").each((_index, element) => {
    if (drawDate !== null) return;

    const $box = $(element);
    if (!/draw\s+date/i.test($box.find("h4").first().text())) return;

    const value = $box.find(".jtx-lottery-ticket-meta-span, span").first().text();
    const match = value.match(
      /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/,
    );
    if (!match) return;

    drawDate = parseLocalDateTime(
      `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")} ${match[4].padStart(2, "0")}:${match[5]}`,
    );
  });

  return drawDate;
}

function parsePlumClosingDate(text: string): string | null {
  const match = text.match(
    /Closing\s+Date:\s*([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)/i,
  );
  if (!match) return null;

  const month = monthNumber(match[1]);
  if (month === null) return null;

  let hour = Number(match[4]);
  const meridiem = match[6].toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(
    Number(match[3]),
    month,
    Number(match[2]),
    hour,
    Number(match[5]),
    0,
    0,
  ).toISOString();
}

function parseEmbeddedIsoCountdown(text: string): string | null {
  const match = text.match(/fromISO\("([^"]+)"/);
  if (!match) return null;

  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDrawText(text: string): string | null {
  const timedMatch = text.match(
    /\bDraw\s+[A-Za-z]{3,9}\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (timedMatch) {
    const [, dayText, monthText, hourText, minuteText, meridiemText] = timedMatch;
    const month = monthNumber(monthText);
    if (month === null) return null;

    let hour = Number(hourText);
    const minute = Number(minuteText ?? "0");
    const meridiem = meridiemText.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;

    return futureDateForMonthDay(month, Number(dayText), hour, minute).toISOString();
  }

  const dateMatch = text.match(
    /\bDraw\s+(?:[A-Za-z]{3,9}|Tomorrow|Today)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\b/i,
  );
  if (dateMatch) {
    const [, dayText, monthText] = dateMatch;
    const month = monthNumber(monthText);
    if (month === null) return null;
    return futureDateForMonthDay(month, Number(dayText), 20, 0).toISOString();
  }

  const relativeMatch = text.match(/\bDraw\s+(Today|Tomorrow)\b/i);
  if (relativeMatch) {
    const date = new Date();
    if (relativeMatch[1].toLowerCase() === "tomorrow") {
      date.setDate(date.getDate() + 1);
    }
    date.setHours(20, 0, 0, 0);
    return date.toISOString();
  }

  return null;
}

function futureDateForMonthDay(
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const now = new Date();
  let date = new Date(now.getFullYear(), month, day, hour, minute, 0, 0);
  if (date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    date = new Date(now.getFullYear() + 1, month, day, hour, minute, 0, 0);
  }
  return date;
}

function parseScheduledDrawDate(text: string): string | null {
  const match = text.match(
    /scheduled draw date for this competition is\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
  );
  if (!match) return null;

  const [, day, month, year, hourText, minuteText, meridiemText] = match;
  let hour = Number(hourText);
  const meridiem = meridiemText.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour,
    Number(minuteText ?? "0"),
    0,
    0,
  ).toISOString();
}

function monthNumber(value: string): number | null {
  const key = value.slice(0, 3).toLowerCase();
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
  return months[key] ?? null;
}

function extractCashAlternativeFromCard(
  $el: cheerio.Cheerio<AnyNode>,
  name: string,
): number | null {
  const cashTextSelectors = [
    ".cash-alt-loop",
    ".single-cash-alt",
    ".alt_prize",
    ".alternate_prize",
    ".post_custom_field",
    ".w-post-elm-value",
    "[class*=cash-alt]",
    "[class*=cash_alternative]",
  ];

  for (const selector of cashTextSelectors) {
    const text = $el.find(selector).first().text().trim();
    if (!text) continue;

    const cashAlternative = extractCashAlternativeFromText(text);
    if (cashAlternative !== null) return cashAlternative;
  }

  return extractCashAlternativeFromText($el.text()) ?? extractCashAlternativeFromName(name);
}

function extractCashAlternativeFromText(text: string): number | null {
  const explicitCash =
    text.match(/\bCash\s+Alternative\s*(?::|-|–)?\s*(?:Alt\s*)?£?\s*([\d,.]+)\s*(k)?\b/i) ||
    text.match(/\bCash\s+(?:Alt|Option)\s*(?::|-|–)?\s*£?\s*([\d,.]+)\s*(k)?\b/i) ||
    text.match(/\bCash\s+Alt\s*(?::|-|–)?\s*£?\s*([\d,.]+)\s*(k)?\b/i) ||
    text.match(/\bPrize\s*(?::|-|–)?\s*£?\s*([\d,.]+)\s*(k)?\s+Cash\b/i) ||
    text.match(/£\s*([\d,.]+)\s*(k)?\s+cash\s+alternative\b/i) ||
    text.match(/\bProducts\s+mentioned\s+in\s+£\s*([\d,.]+)\s*(k)?\s+Cash\b/i) ||
    text.match(/^\s*or\s*£\s*([\d,.]+)\s*(k)?\*?\s*$/i);
  if (!explicitCash) return null;

  const val = parseCashAmount(explicitCash[1], explicitCash[2]);
  return val >= 50 ? val : null;
}

function manualEstimateForNewSite(
  competition: RawCompetition,
): Pick<
  RawCompetition,
  "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"
> | null {
  const estimates: Record<string, number> = {
    "offgrid:37326": 900,
    "offgrid:37329": 250,
    "offgrid:37328": 90,
    "offgrid:37349": 300,
    "luxuryrarewhisky:109672": 350,
    "luxuryrarewhisky:109653": 300,
    "luxuryrarewhisky:109621": 1200,
    "luxuryrarewhisky:109593": 800,
    "luxuryrarewhisky:109583": 500,
    "luxuryrarewhisky:109567": 300,
    "luxuryrarewhisky:109500": 900,
    "tackle:270801": 60,
    "tackle:270798": 150,
    "tackle:270796": 400,
    "tackle:270800": 75,
    "tackle:270804": 150,
    "tackle:270802": 120,
    "tackle:270797": 600,
    "tackle:270799": 50,
    "tackle:271268": 500,
    "tackle:265871": 100,
    "agrigiveaways:husqvarna-ts-112-garden-tractor": 2038.8,
    "agrigiveaways:yeti-35-cool-box": 250,
    "agrigiveaways:traxxas-trx-4m-land-rover-defender": 173.04,
    "cultcomps:36": 209,
    "cultcomps:40": 33,
    "cultcomps:41": 89.99,
    "funandgames:457615": 649.99,
  };
  const value = estimates[`${competition.siteName}:${competition.sourceId}`];
  if (!value) return null;

  return {
    estimatedPrizeValue: value,
    valuationSource: "manual_estimate",
    valuationConfidence: "low",
    valuationNotes: "Conservative manual estimate for a recognizable operator-listed prize",
  };
}

function extractSiteEstimatedPrizeValue(text: string): Pick<
  RawCompetition,
  "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"
> | null {
  const worth =
    text.match(/\bprize\s+worth\s+(?:up\s+to\s+)?£\s*([\d,.]+)\s*(k)?(?=\D|$)/i) ||
    text.match(/\bworth\s+(?:up\s+to\s+)?£\s*([\d,.]+)\s*(k)?(?=\D|$)/i) ||
    text.match(/\bvalue\s*:\s*£\s*([\d,.]+)\s*(k)?(?=\D|$)/i) ||
    text.match(/£\s*([\d,.]+)\s*(k)?\s+worth\s+of\b/i) ||
    text.match(/\busual\s+£\s*([\d,.]+)\s*(k)?\s+retail\s+price\b/i);
  if (!worth) return null;

  const value = parseCashAmount(worth[1], worth[2]);
  if (value < 50) return null;

  return {
    estimatedPrizeValue: Math.round(value * 0.85),
    valuationSource: "site_estimate",
    valuationConfidence: "medium",
    valuationNotes: "Detail page states retail worth",
  };
}

function extractGolfGearMainPrizeValue(text: string): Pick<
  RawCompetition,
  "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"
> | null {
  const match = text.match(/\bmain\s+prize\s+(?:of\s+)?(?:a\s+)?£\s*([\d,.]+)\s*(k)?\b/i);
  if (!match) return null;

  const value = parseCashAmount(match[1], match[2]);
  if (value < 50) return null;

  return {
    estimatedPrizeValue: Math.round(value * 0.85),
    valuationSource: "site_estimate",
    valuationConfidence: "medium",
    valuationNotes: "Golf Gear Raffles detail page states the main prize value",
  };
}

function extractBrickDropPrizeValue(competition: RawCompetition): Pick<
  RawCompetition,
  "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"
> | null {
  if (/\b40793\b/.test(competition.name)) {
    return {
      estimatedPrizeValue: 20,
      valuationSource: "manual_estimate",
      valuationConfidence: "medium",
      valuationNotes: "Manual UK retail estimate for LEGO set 40793.",
    };
  }

  if (/\b76917\b/.test(competition.name)) {
    return {
      estimatedPrizeValue: 19.99,
      valuationSource: "manual_estimate",
      valuationConfidence: "medium",
      valuationNotes: "Manual UK retail estimate for LEGO set 76917.",
    };
  }

  return null;
}

function extractGarillaPrizeValue(detailName: string): Pick<
  RawCompetition,
  "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"
> | null {
  const match = detailName.match(/\bTUI\s+Gift\s+Card\s*\(\s*£\s*([\d,.]+)\s*\)/i);
  if (!match) return null;

  const value = parseCashAmount(match[1], undefined);
  if (value <= 0) return null;

  return {
    estimatedPrizeValue: value,
    valuationSource: "site_estimate",
    valuationConfidence: "high",
    valuationNotes: "Garilla states the exact gift-card value in the product title.",
  };
}

function extract365CompetitionPrizeValue(text: string): Pick<
  RawCompetition,
  "estimatedPrizeValue" | "valuationSource" | "valuationConfidence" | "valuationNotes"
> | null {
  if (!/\b72423\b/.test(text)) return null;

  return {
    estimatedPrizeValue: 109.99,
    valuationSource: "manual_estimate",
    valuationConfidence: "high",
    valuationNotes: "Manual UK retail estimate for LEGO set 72423 from the official LEGO UK price.",
  };
}

function extractCashAlternativeFromName(name: string): number | null {
  const explicitCash =
    name.match(/£\s*([\d,.]+)\s*(k)?\s*(?:Tax[\s-‑–—]*Free\s*)?Cash/i) ||
    name.match(/\bor\s*£\s*([\d,.]+)\s*(k)?\s*cash\b/i);
  if (explicitCash) {
    const val = parseCashAmount(explicitCash[1], explicitCash[2]);
    return val >= 50 ? val : null;
  }

  const finalPrize = name.match(/£\s*([\d,.]+)\s*(k)?\s+Final\s+Prize\b/i);
  if (finalPrize) {
    const val = parseCashAmount(finalPrize[1], finalPrize[2]);
    return val >= 50 ? val : null;
  }

  if (isNonCashPrizeBundle(name)) return null;

  const genericCash = name.match(/£\s*([\d,.]+)\s*(k)?/i);
  if (!genericCash) return null;

  const val = parseCashAmount(genericCash[1], genericCash[2]);
  return val >= 50 ? val : null;
}

function isNonCashPrizeBundle(name: string): boolean {
  return (
    /\b\d+\s*tickets?\b/i.test(name) ||
    /\b(?:voucher|credit|gift\s*card|site\s*credit)\b/i.test(name) ||
    (
      /\b(?:instant|instants|instant\s*wins?)\b/i.test(name) &&
      /\bmain\s*prize\b/i.test(name)
    ) ||
    /\bscratch[\s-]?cards?\b/i.test(name) ||
    /\bprize\s+pool\b/i.test(name) ||
    /\bworth\s+£/i.test(name)
  );
}

function categoriesFromClasses(classes: string): string[] {
  const catMatch = classes.match(/product_cat-([^\s]+)/g);
  if (!catMatch) return [];

  return catMatch
    .map((category) => category.replace("product_cat-", "").replace(/-/g, " "))
    .filter((category) => !["live", "template instant win"].includes(category));
}

function dedup(comps: RawCompetition[]): RawCompetition[] {
  const seen = new Set<string>();
  return comps.filter((c) => {
    if (seen.has(c.sourceId)) return false;
    seen.add(c.sourceId);
    return true;
  });
}
