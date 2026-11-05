import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { SiteAdapter } from "../adapter.js";
import type { RawCompetition } from "../../types.js";
import type { RafflexSiteConfig } from "../rafflex/rafflex-site-config.js";
import { parsePage as parseRafflexPage } from "../rafflex/rafflex-parser.js";
import { fetchRenderedHtml } from "./browser-pool.js";

/**
 * Browser-based Rafflex adapter for Cloudflare-protected sites.
 * Uses Playwright to render the page, then tries multiple parsing strategies.
 */
export class BrowserRafflexAdapter implements SiteAdapter {
  readonly siteName: string;
  readonly scanCost = "browser";

  constructor(private readonly config: RafflexSiteConfig) {
    this.siteName = config.siteName;
  }

  async fetchAll(signal?: AbortSignal): Promise<RawCompetition[]> {
    const url = `${this.config.baseUrl}${this.config.listPath}`;
    const html = await this.fetchCompetitionListHtml(url, signal);
    const $ = cheerio.load(html);
    let competitions: RawCompetition[] = [];

    const prizeFlow = this.parsePrizeFlowCards($);
    if (prizeFlow.length > 0) {
      return this.withExtraCompetitionPaths(prizeFlow, signal);
    }

    // Strategy 1: Northern-style (.comp-title, .comp-price, .prog-count-label)
    const northern = this.parseNorthernLayout($);
    if (northern.length > 0) {
      competitions = removeWinnerTickerRows(northern);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const detailOnly = await this.parseDetailOnlyLinks($, signal);
    if (detailOnly.length > 0) {
      return this.withExtraCompetitionPaths(removeWinnerTickerRows(detailOnly), signal);
    }

    // Strategy 1b: newer RaffleX landing pages render competition fields as
    // adjacent text blocks rather than clean card containers.
    const lineCards = this.parseLineCards($);
    if (lineCards.length > 0) {
      competitions = removeWinnerTickerRows(lineCards);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const heroCards = this.parseHeroPriceCards($);
    if (heroCards.length > 0) {
      competitions = removeWinnerTickerRows(heroCards);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const obsidianCards = this.parseObsidianCards($);
    if (obsidianCards.length > 0) {
      competitions = removeWinnerTickerRows(obsidianCards);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const skyline = this.parseSkylineCards($);
    if (skyline.length > 0) {
      competitions = removeWinnerTickerRows(skyline);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const epic = this.parseEpicCards($);
    if (epic.length > 0) {
      competitions = removeWinnerTickerRows(epic);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const dreamCash = this.parseDreamCashCards($);
    if (dreamCash.length > 0) {
      competitions = removeWinnerTickerRows(dreamCash);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const chaotic = this.parseChaoticCards($);
    if (chaotic.length > 0) {
      competitions = removeWinnerTickerRows(chaotic);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    const standard = parseRafflexPage(html, this.config);

    // Prefer complete structured product snapshots only when they contain more
    // supportable rows than the standard parser. This repairs themes such as
    // Phantom without replacing an equally complete, proven card parse. Bounty
    // has stale repeated snapshot titles and Elite Carp omits economics, so
    // those two remain on their rendered-card/detail paths.
    const embedded = ["bounty", "elitecarpcompetitions"].includes(this.config.siteName)
      ? []
      : parseEmbeddedProducts(html, this.config.siteName);
    if (
      countSupportableEconomics(embedded) > countSupportableEconomics(standard)
    ) {
      competitions = removeWinnerTickerRows(embedded);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    // Strategy 2: Standard Rafflex parser (Carp Gear, That Prize Guy)
    if (standard.length > 0 && standard.some((c) => c.ticketsSold > 0)) {
      // Check if names look valid (not just dates or short labels)
      const goodNames = standard.filter(
        (c) => c.name.length > 10 && !c.name.match(/^[A-Z][a-z]{2}\s+\d/),
      );
      if (goodNames.length > standard.length * 0.5) {
        competitions = removeWinnerTickerRows(standard);
        await this.enrichMissingDetails(competitions, signal);
        return this.withExtraCompetitionPaths(competitions, signal);
      }
      // Names are bad — first try page-local fixes, but do not throw away a
      // richer economics parse for a weaker fallback that only has nicer text.
      this.enrichNames($, standard);
      const tailwind = this.parseTailwindCards($);
      competitions = removeWinnerTickerRows(
        shouldPreferTailwindCards(tailwind, standard) ? tailwind : standard,
      );
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    // Strategy 3: Tailwind card layout (Lancashire, Bounty, Cosmic, Ruby, Dynamite)
    const tailwind = this.parseTailwindCards($);
    if (tailwind.length > 0) {
      competitions = removeWinnerTickerRows(tailwind);
      await this.enrichMissingDetails(competitions, signal);
      return this.withExtraCompetitionPaths(competitions, signal);
    }

    // Fallback to standard if Tailwind found nothing
    competitions = removeWinnerTickerRows(standard);
    await this.enrichMissingDetails(competitions, signal);
    return filterSupportableCompetitions(
      await this.withExtraCompetitionPaths(competitions, signal),
    );
  }

  private async fetchCompetitionListHtml(
    url: string,
    signal?: AbortSignal,
  ): Promise<string> {
    let html = await fetchRenderedHtml(url, 'a[href*="/competition"]', signal);
    if (
      this.config.extraCompetitionPaths?.length ||
      hasDiscoverableCompetitionData(html, this.config.siteName) ||
      hasExplicitEmptyCompetitionState(html)
    ) {
      return html;
    }

    // No links and no explicit empty state is an incomplete rendered load, not
    // proof that the operator has zero raffles. Retry once, then surface a
    // transient timeout so stale rows are retained by the scan pipeline.
    html = await fetchRenderedHtml(url, 'a[href*="/competition"]', signal);
    if (
      hasDiscoverableCompetitionData(html, this.config.siteName) ||
      hasExplicitEmptyCompetitionState(html)
    ) {
      return html;
    }

    throw new Error(
      `[${this.config.siteName}] timed out waiting for rendered competition links`,
    );
  }

  private async parseDetailOnlyLinks(
    $: cheerio.CheerioAPI,
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    if (!DETAIL_ONLY_RAFFLEX_SITES.has(this.config.siteName)) return [];

    const links = this.config.extraCompetitionPaths?.length
      ? this.config.extraCompetitionPaths.map((path) => ({
        url: path.startsWith("http") ? path : `${this.config.baseUrl}${path}`,
      }))
      : uniqueCompetitionLinks($, this.config.baseUrl).slice(0, 24);

    const competitions = await mapWithConcurrency(links, 6, async (link) => {
      signal?.throwIfAborted();
      try {
        const html = await fetchRenderedHtml(link.url, "body", signal);
        return parseGenericRafflexDetail(
          html,
          this.config.siteName,
          link.url,
        );
      } catch {
        signal?.throwIfAborted();
        return null;
      }
    });

    return competitions.filter(
      (competition): competition is RawCompetition => competition !== null,
    );
  }

  private async withExtraCompetitionPaths(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<RawCompetition[]> {
    for (const competition of competitions) {
      normalizeFreeEntryCategories(
        competition.categories,
        competition.entryPrice,
      );
    }

    if (!this.config.extraCompetitionPaths?.length) {
      // Chaotic's current cards expose a price and a rounded sold percentage,
      // but no deterministic ticket total. Preserve those rows so the scan is
      // classified partial instead of falsely reporting an empty operator.
      return this.config.siteName === "chaotic"
        ? competitions
        : filterSupportableCompetitions(competitions);
    }

    const bySourceId = new Map(competitions.map((competition) => [competition.sourceId, competition]));
    for (const path of this.config.extraCompetitionPaths) {
      signal?.throwIfAborted();
      const url = path.startsWith("http") ? path : `${this.config.baseUrl}${path}`;
      const sourceId = url.match(/\/competition\/([\w-]+)/)?.[1];
      if (!sourceId) continue;

      try {
        const html = await fetchRenderedHtml(url, "body", signal);
        const competition = this.config.siteName === "dreamcash"
          ? parseDreamCashDetail(html, this.config.siteName, url)
          : parseGenericRafflexDetail(html, this.config.siteName, url);
        if (competition) {
          bySourceId.set(competition.sourceId, {
            ...bySourceId.get(competition.sourceId),
            ...competition,
          });
        }
      } catch {
        signal?.throwIfAborted();
        // Keep the discovered list if an extra detail page is unavailable.
      }
    }

    return filterSupportableCompetitions(Array.from(bySourceId.values()));
  }

  private async enrichMissingDetails(
    competitions: RawCompetition[],
    signal?: AbortSignal,
  ): Promise<void> {
    await enrichRafflexCompetitionDetails(
      competitions,
      (url) => fetchRenderedHtml(url, "body", signal),
      signal,
    );
  }

  /** Fix bad names by looking up h2 elements near each competition link */
  private enrichNames($: cheerio.CheerioAPI, comps: RawCompetition[]): void {
    // Build a map of slug → h2 name from the page
    const nameMap = new Map<string, string>();
    $('a[href*="/competition/"]').each((_i, el) => {
      const href = $(el).attr("href") || "";
      const slug = href.match(/\/competition\/([\w-]+)/)?.[1];
      if (!slug || nameMap.has(slug)) return;

      // Look for h2 in the closest parent card
      const card = $(el).closest("div.flex, div.rounded-lg, div.border");
      const h2 = card.find("h2").first().text().trim();
      if (h2 && h2.length > 5) {
        nameMap.set(slug, h2);
      }
    });

    for (const comp of comps) {
      const betterName = nameMap.get(comp.sourceId);
      if (betterName) comp.name = betterName;
    }
  }

  /** Northern Competitions — uses .comp-title, .comp-price, .prog-count-label.
   *  Elements are siblings in the DOM (no clean card containers), so we
   *  collect each array and zip by index. */
  private parseNorthernLayout($: cheerio.CheerioAPI): RawCompetition[] {
    const titleElements = $("h3.comp-title").toArray();
    const titles = titleElements.map((el) => $(el).text().trim());
    const counts = $("span.prog-count-label").map((_i, el) => $(el).text().trim()).get();
    const prices = $("span.comp-price").map((_i, el) => $(el).text().trim()).get();

    if (titles.length === 0) return [];

    // Deduplicated competition links in page order
    const seen = new Set<string>();
    const links: string[] = [];
    $('a[href*="/competition/"]').each((_i, el) => {
      const href = $(el).attr("href") || "";
      const slug = href.match(/\/competition\/([\w-]+)/)?.[1];
      if (slug && !seen.has(slug)) { seen.add(slug); links.push(href); }
    });

    // Match titles to links by fuzzy slug matching
    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    const seenSourceIds = new Set<string>();

    for (let i = 0; i < titles.length; i++) {
      const name = titles[i];
      const countText = counts[i] || "";
      const priceText = prices[i] || "";
      const cardText = $(titleElements[i]).parent().parent().parent().text().replace(/\s+/g, " ").trim();

      // Match title to link by slug similarity
      const nameWords = name.toLowerCase().replace(/[£,]/g, "").split(/\s+/);
      let bestLink = links[i] || ""; // fallback: same index
      let bestScore = 0;
      for (const link of links) {
        const slug = link.match(/\/competition\/([\w-]+)/)?.[1] || "";
        const slugWords = slug.split("-");
        const score = nameWords.filter((w) => slugWords.some((s) => s.includes(w) || w.includes(s))).length;
        if (score > bestScore) { bestScore = score; bestLink = link; }
      }

      const slugMatch = bestLink.match(/\/competition\/([\w-]+)/);
      if (!slugMatch) continue;

      const sourceId = slugMatch[1];
      if (seenSourceIds.has(sourceId)) continue;
      seenSourceIds.add(sourceId);
      const url = bestLink.startsWith("http") ? bestLink : `${this.config.baseUrl}${bestLink}`;

      // Tickets
      let ticketsSold = 0;
      let maxTickets = 0;
      const slashMatch = countText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
      if (slashMatch) {
        ticketsSold = parseInt(slashMatch[1].replace(/,/g, ""), 10);
        maxTickets = parseInt(slashMatch[2].replace(/,/g, ""), 10);
      }

      // Price
      let entryPrice = 0;
      const pMatch = priceText.match(/£([\d.]+)/);
      if (pMatch) entryPrice = parseFloat(pMatch[1]);

      // Cash alternative from name
      let cashAlternative: number | null = null;
      const cashMatch = name.match(/£([\d,.]+)\s*(?:Cash|Final|draw\s*prize)/i);
      if (cashMatch) {
        cashAlternative = parseCashAmount(cashMatch[1]);
      }

      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url,
        name,
        entryPrice,
        ticketsSold,
        maxTickets,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative,
        drawDate: parseDrawDate(cardText),
        isAutoDraw: name.toLowerCase().includes("instant win"),
        categories: [],
        scrapedAt: now,
      });
    }

    return competitions;
  }

  /** Tailwind card layout — handles Lancashire, Bounty, Cosmic, Ruby, Dynamite */
  private parseTailwindCards($: cheerio.CheerioAPI): RawCompetition[] {
    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    const seen = new Set<string>();

    // Ruby exposes the authoritative title and decimal entry price on hidden
    // lucky-item records. Its visible cards currently associate prize amounts
    // such as £25/£30 with the price element, so parsing the card alone turns
    // 25p and free entries into £25/£30 entries.
    const rubyExactCards = new Map<string, { title: string; entryPrice: number }>();
    if (this.config.siteName === "ruby") {
      $(".rbLuckyItem[data-url][data-title][data-price]").each((_i, el) => {
        const dataUrl = $(el).attr("data-url") ?? "";
        const sourceId = dataUrl.match(/\/competition\/([\w-]+)/)?.[1];
        const title = $(el).attr("data-title")?.trim() ?? "";
        const entryPrice = Number($(el).attr("data-price"));
        if (!sourceId || !title || !Number.isFinite(entryPrice) || entryPrice < 0) return;
        rubyExactCards.set(sourceId, { title, entryPrice });
      });
    }

    // Pre-build sold data maps by walking up from data elements to their link
    const soldMap = new Map<string, { sold: number; max: number }>();

    // Ruby: span with "22413/150000 sold"
    $("span").each((_i, el) => {
      const t = $(el).text().trim();
      const m = t.match(/^([\d,]+)\s*\/\s*([\d,]+)\s*sold$/i);
      if (!m) return;
      const slug = findNearestSlug($, $(el));
      if (slug) {
        soldMap.set(slug, {
          sold: parseInt(m[1].replace(/,/g, ""), 10),
          max: parseInt(m[2].replace(/,/g, ""), 10),
        });
      }
    });

    $('a[href*="/competition/"]').each((_i, el) => {
      try {
        const $link = $(el);
        const href = $link.attr("href") || "";
        const slugMatch = href.match(/\/competition\/([\w-]+)/);
        if (!slugMatch) return;

        const sourceId = slugMatch[1];
        if (seen.has(sourceId)) return;
        seen.add(sourceId);
        const rubyExactCard = rubyExactCards.get(sourceId);

        const $card = selectRafflexCard($, $link);

        const cardText = $card.text().replace(/\s+/g, " ").trim();
        if (cardText.length < 10) return;
        if (
          cardText.includes("Live Instant Winners") ||
          /\bwon!\b/i.test($link.text())
        ) {
          return;
        }

        const url = href.startsWith("http") ? href : `${this.config.baseUrl}${href}`;

        // ── Name ──
        // Ruby: p.spring-title
        // Cosmic: p with font-bold + text-white (the long descriptive one)
        // Bounty: h2
        // Lancashire: h3, h2, h4
        const name =
          rubyExactCard?.title ||
          $card.find("p.spring-title").first().text().trim() ||
          $card.find("h3, h2, h4").filter((_j, h) => {
            const t = $(h).text().trim();
            return t.length > 5 &&
              !t.match(/^£/) &&
              !t.match(/^\d/) &&
              !t.match(/^(Per Ticket|Entry|Max Tickets)$/i);
          }).first().text().trim() ||
          $card.find("p").filter((_j, p) => {
            const t = $(p).text().trim();
            const cls = $(p).attr("class") || "";
            return t.length > 10 && cls.includes("font-bol") && !t.match(/Per Ticket/i);
          }).first().text().trim() ||
          sourceId.replace(/-/g, " ");

        // ── Tickets ──
        let ticketsSold = 0;
        let maxTickets = 0;

        // Pre-built sold map (Ruby "X/Y sold" spans)
        const mapped = soldMap.get(sourceId);
        if (mapped) {
          ticketsSold = mapped.sold;
          maxTickets = mapped.max;
        }

        // Try "X / Y" pattern in card text
        if (ticketsSold === 0) {
          const slashMatch = cardText.match(/([\d,]+)\s*\/\s*([\d,]+)/);
          if (slashMatch) {
            const s = parseInt(slashMatch[1].replace(/,/g, ""), 10);
            const m = parseInt(slashMatch[2].replace(/,/g, ""), 10);
            if (m > s && m >= 50) {
              ticketsSold = s;
              maxTickets = m;
            }
          }
        }

        // ── Price ──
        let entryPrice = rubyExactCard?.entryPrice ?? 0;
        // Ruby: span.spring-price-current
        if (!rubyExactCard) {
          const springPrice = $card.find(".spring-price-current").text().trim();
          if (springPrice) {
            const m = springPrice.match(/£([\d.]+)/);
            if (m) entryPrice = parseFloat(m[1]);
          }
          if (entryPrice === 0) {
            const penceMatch = cardText.match(/(\d+)p\s*per\s*(?:ticket|entry)/i);
            const poundMatch = cardText.match(/£([\d.]+)\s*per\s*(?:ticket|entry)/i);
            if (penceMatch) entryPrice = parseInt(penceMatch[1], 10) / 100;
            else if (poundMatch) entryPrice = parseFloat(poundMatch[1]);
          }
          if (entryPrice === 0) entryPrice = parseRafflexEntryPrice(cardText);
          // Cosmic/Dynamite: standalone £ amount as first price span
          if (entryPrice === 0) {
            const priceSpan = $card.find("span").filter((_j, s) => {
              const t = $(s).text().trim();
              return !!t.match(/^£[\d.]+$/) && !t.match(/^£\d{3,}/); // Small amounts only
            }).last(); // Last one is sale price if there's a strikethrough
            const m = priceSpan.text().trim().match(/£([\d.]+)/);
            if (m) entryPrice = parseFloat(m[1]);
          }
        }

        // Ruby's explicit free-draw labels are authoritative even if a hidden
        // lucky-item record is temporarily absent. The visible price element
        // can contain the prize value rather than an entry price.
        if (
          this.config.siteName === "ruby" &&
          /\bfree\s+(?:draw|to\s+enter|spin)\b/i.test(name)
        ) {
          entryPrice = 0;
        }

        const categories: string[] = [];
        normalizeFreeEntryCategories(categories, entryPrice);

        // ── Cash alternative ──
        const cashAlternative = extractCashAlternative(
          `${name} ${cardText} ${titleFromSlug(sourceId)}`,
        );

        // ── Draw date ──
        const drawDate = parseDrawDate(cardText);

        competitions.push({
          sourceId,
          siteName: this.config.siteName,
          url,
          name,
          entryPrice,
          ticketsSold,
          maxTickets,
          maxEntriesPerUser: 100,
          maxEntriesPerUserSource: "fallback",
          cashAlternative,
          drawDate,
          isAutoDraw:
            cardText.toLowerCase().includes("auto draw") ||
            cardText.toLowerCase().includes("instant win"),
          categories,
          scrapedAt: now,
        });
      } catch { /* skip */ }
    });

    return competitions;
  }

  private parseLineCards($: cheerio.CheerioAPI): RawCompetition[] {
    const supported = new Set([
      "corecompetitions",
      "gridchance",
      "drawly",
      "prizeflow",
      "flightmode",
      "bliss",
      "vaultwin",
      "collectible",
      "prizepit",
      "prizevaultni",
      "bolabee",
      "luxurious",
      "mcbride",
      "rkvault",
      "thevault",
      "elitecarpcompetitions",
      "gallowaygiveaways",
      "4x4giveaways",
      "phatstax",
      "gamechangercomps",
      "onthepodiumprizes",
      "gameoncomps",
      "itsworthapunt",
      "dtcompetitions",
      "smoothcompetitions",
      "spherecompetitions",
      "prizecircleuk",
    ]);
    if (!supported.has(this.config.siteName)) return [];

    const links = uniqueCompetitionLinks($, this.config.baseUrl);
    if (links.length === 0) return [];

    const lines = $("body")
      .text()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const competitions: RawCompetition[] = [];
    const used = new Set<string>();
    const now = new Date().toISOString();

    for (let i = 0; i < lines.length; i++) {
      if (!isRafflexDateLine(lines[i])) continue;

      const name = lines[i + 1] ?? "";
      if (name.length < 5 || /^(Entry|Max Tickets|Instant Wins|Enter)$/i.test(name)) continue;

      const window = lines.slice(i, i + 18);
      if (!window.some((line) => /PER TICKET|per ticket/i.test(line))) continue;

      const price = parseRafflexLinePrice(window);
      const exactInventory = window
        .join(" ")
        .match(/([\d,]+)\s*\/\s*([\d,]+)\s*(?:tickets?\s*)?sold/i);
      const ticketsSold = exactInventory ? parseNumber(exactInventory[1]) : 0;
      const maxTickets = exactInventory ? parseNumber(exactInventory[2]) : 0;

      const link = bestLinkForName(name, links, used);
      if (!link) continue;
      used.add(link.sourceId);

      competitions.push({
        sourceId: link.sourceId,
        siteName: this.config.siteName,
        url: link.url,
        name,
        entryPrice: price,
        ticketsSold,
        maxTickets,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: extractCashAlternative(`${name} ${window.join(" ")}`),
        drawDate: parseDrawDate(lines[i]),
        isAutoDraw: window.join(" ").toLowerCase().includes("instant win"),
        categories: [],
        scrapedAt: now,
      });
    }

    return competitions;
  }

  private parsePrizeFlowCards($: cheerio.CheerioAPI): RawCompetition[] {
    if (this.config.siteName !== "prizeflow") return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    $("section.pf-fc").each((_i, element) => {
      const card = $(element);
      const href = card.find('a[href*="/competition/"]').first().attr("href") || "";
      const sourceId = href.match(/\/competition\/([\w-]+)/)?.[1];
      const name = card.find(".pf-fc__title").first().text().replace(/\s+/g, " ").trim();
      const entryPriceText = card.find(".pf-fc__stat").filter((_j, stat) =>
        /entry price/i.test($(stat).find(".pf-fc__stat-label").text())
      ).first().find(".pf-fc__stat-value").text();
      const entryPrice = parseRafflexEntryPrice(entryPriceText);
      const progressText = card.find(".pf-fc__progress-bottom").text().replace(/\s+/g, " ");
      const sold = parseNumber(progressText.match(/([\d,]+)\s+entries?\s+sold/i)?.[1]);
      const remaining = parseNumber(progressText.match(/([\d,]+)\s+remaining/i)?.[1]);
      const maxTickets = sold + remaining;
      const drawDate = parseDrawDate(
        card.find("[data-pf-end]").first().attr("data-pf-end") || "",
      );
      if (!sourceId || !name || entryPrice <= 0 || maxTickets <= 0 || drawDate === null) {
        return;
      }

      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url: href.startsWith("http") ? href : `${this.config.baseUrl}${href}`,
        name,
        entryPrice,
        ticketsSold: sold,
        maxTickets,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: null,
        drawDate,
        isAutoDraw: /instant/i.test(card.text()),
        categories: [],
        scrapedAt: now,
      });
    });

    return competitions;
  }

  private parseHeroPriceCards($: cheerio.CheerioAPI): RawCompetition[] {
    const supported = new Set(["quest", "competitionsne"]);
    if (!supported.has(this.config.siteName)) return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    const seen = new Set<string>();

    $('a[href*="/competition/"]').each((_i, el) => {
      const href = $(el).attr("href") || "";
      const sourceId = href.match(/\/competition\/([\w-]+)/)?.[1];
      if (!sourceId || seen.has(sourceId)) return;

      const $link = $(el);
      const card = selectRafflexCard($, $link);
      const text = card.text().replace(/\s+/g, " ").trim();
      const salePenceMatch = text.match(/(?:^|\s)(\d+)p\s*per\s*(?:ticket|entry)/i);
      const entryPrice = salePenceMatch
        ? parseInt(salePenceMatch[1], 10) / 100
        : parseRafflexEntryPrice(text);
      const name = card
        .find("p.text-center, h3, h2")
        .map((_j, node) => $(node).text().replace(/\s+/g, " ").trim())
        .get()
        .find((candidate) => candidate.length > 5 && !/Enter Here!?/i.test(candidate));
      if (!name || entryPrice <= 0) return;

      seen.add(sourceId);
      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url: href.startsWith("http") ? href : `${this.config.baseUrl}${href}`,
        name,
        entryPrice,
        ticketsSold: 0,
        maxTickets: 0,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: extractCashAlternative(text),
        drawDate: null,
        isAutoDraw: /instant/i.test(text),
        categories: [],
        scrapedAt: now,
      });
    });

    return competitions;
  }

  private parseObsidianCards($: cheerio.CheerioAPI): RawCompetition[] {
    if (this.config.siteName !== "feelgoodcompetitions") return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    const seen = new Set<string>();

    $('a#obsidian-card[href*="/competition/"]').each((_i, el) => {
      const card = $(el);
      const href = card.attr("href") || "";
      const sourceId = href.match(/\/competition\/([\w-]+)/)?.[1];
      if (!sourceId || seen.has(sourceId)) return;

      const text = card.text().replace(/\s+/g, " ").trim();
      const name =
        card.find("h2").first().text().replace(/\s+/g, " ").trim() ||
        card.find("img[alt]").first().attr("alt")?.replace(/\s+/g, " ").trim() ||
        titleFromSlug(sourceId);
      if (!name || text.length < 20) return;

      const slashMatch = text.match(/([\d,]+)\s*\/\s*([\d,]+)/);
      const ticketsSold = slashMatch ? parseNumber(slashMatch[1]) : 0;
      const maxTickets = slashMatch ? parseNumber(slashMatch[2]) : 0;
      const salePenceMatch = text.match(/(?:^|\s)(\d+)p\s*per\s*(?:ticket|entry)/i);
      const entryPrice = salePenceMatch
        ? parseInt(salePenceMatch[1], 10) / 100
        : parseRafflexEntryPrice(text);
      const drawDate = parseDrawDate(text);
      if (entryPrice <= 0 || drawDate === null) return;

      seen.add(sourceId);
      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url: href.startsWith("http") ? href : `${this.config.baseUrl}${href}`,
        name,
        entryPrice,
        ticketsSold,
        maxTickets,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: extractCashAlternative(`${name} ${text}`),
        drawDate,
        isAutoDraw: /instant/i.test(text),
        categories: [],
        scrapedAt: now,
      });
    });

    return competitions;
  }

  private parseSkylineCards($: cheerio.CheerioAPI): RawCompetition[] {
    if (this.config.siteName !== "skyline") return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];

    $(".sky-exact-card").each((_i, el) => {
      const card = $(el);
      const title = card.find(".sky-exact-title").first().text().trim();
      const onclick = card.find(".sky-exact-img-wrap").attr("onclick") || "";
      const url = onclick.match(/window\.location\.href='([^']+)'/)?.[1];
      const sourceId = url?.match(/\/competition\/([\w-]+)/)?.[1];
      const entryPrice =
        parseRafflexEntryPrice(card.text()) ||
        parseMoneyValue(card.find(".sky-exact-price").first().text());
      if (!title || !url || !sourceId || entryPrice <= 0) return;

      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url,
        name: title,
        entryPrice,
        ticketsSold: 0,
        maxTickets: 0,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: extractCashAlternative(title),
        drawDate: null,
        isAutoDraw: false,
        categories: [],
        scrapedAt: now,
      });
    });

    return competitions;
  }

  private parseEpicCards($: cheerio.CheerioAPI): RawCompetition[] {
    if (this.config.siteName !== "epic") return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];

    $(".pc-card").each((_i, el) => {
      const card = $(el);
      const name = card.find(".pc-title").first().text().trim();
      const url = card.find('a[href*="/competition/"]').first().attr("href");
      const sourceId = url?.match(/\/competition\/([\w-]+)/)?.[1];
      const entryPrice =
        parseRafflexEntryPrice(card.text()) ||
        parseMoneyValue(card.find(".pc-img-price").first().text());
      const sold = parseNumber(
        card.find(".pc-progress-lbl").first().text().match(/([\d,]+)/)?.[1],
      );
      if (!name || !url || !sourceId || entryPrice <= 0) return;
      const countdownText = card.html() ?? "";
      const drawDate = parseCountdownSeconds(
        countdownText.match(/raffleCountdown\((\d+)\)/)?.[1],
      );

      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url,
        name,
        entryPrice,
        ticketsSold: sold,
        maxTickets: 0,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: extractCashAlternative(card.find(".pc-cash").first().text()),
        drawDate,
        isAutoDraw: /instant/i.test(card.text()),
        categories: [],
        scrapedAt: now,
      });
    });

    return competitions;
  }

  private parseDreamCashCards($: cheerio.CheerioAPI): RawCompetition[] {
    if (this.config.siteName !== "dreamcash") return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    const seen = new Set<string>();

    $(".dcg-product-card").each((_i, el) => {
      const card = $(el);
      const href = card.find('a[href*="/competition/"]').first().attr("href");
      const sourceId = href?.match(/\/competition\/([\w-]+)/)?.[1];
      if (!href || !sourceId || seen.has(sourceId)) return;

      const text = card.text().replace(/\s+/g, " ").trim();
      const entryPrice = parseMoneyValue(card.find(".dcg-price").first().text());
      const soldPct = parseFloat(
        card.find(".dcg-percent").first().text().match(/([\d.]+)%/)?.[1] ?? "0",
      );
      if (entryPrice <= 0 || soldPct <= 0) return;

      seen.add(sourceId);
      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url: href,
        name: titleFromSlug(sourceId),
        entryPrice,
        ticketsSold: 0,
        maxTickets: 0,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: extractCashAlternative(titleFromSlug(sourceId)),
        drawDate: parseDrawDate(text),
        isAutoDraw: /instant/i.test(text),
        categories: [],
        scrapedAt: now,
      });
    });

    return competitions;
  }

  private parseChaoticCards($: cheerio.CheerioAPI): RawCompetition[] {
    if (this.config.siteName !== "chaotic") return [];

    const now = new Date().toISOString();
    const competitions: RawCompetition[] = [];
    const seen = new Set<string>();

    $('a[href*="/competition/"].cursor-pointer.relative, a[href*="/competition/"].w-full.relative').each((_i, el) => {
      const link = $(el);
      const href = link.attr("href") || "";
      const sourceId = href.match(/\/competition\/([\w-]+)/)?.[1];
      if (!href || !sourceId || seen.has(sourceId)) return;

      const card = link.closest("div.relative.rounded-xl").length > 0
        ? link.closest("div.relative.rounded-xl")
        : link.closest("div.flex.flex-col.items-center");
      const priceText = card.find(".bg-red-600 .text-white").first().text().trim() || card.text();
      const cashAltText = card.find("span").filter((_j, node) => {
        const text = $(node).text().replace(/\s+/g, " ").trim();
        return /cash alternative|main draw/i.test(text);
      }).first().text().trim();

      const entryPrice =
        parseRafflexEntryPrice(priceText) ||
        (/^\d+p$/i.test(priceText) ? parseInt(priceText, 10) / 100 : 0) ||
        (/^£\s*[\d.]+$/i.test(priceText) ? parseFloat(priceText.replace(/[^\d.]/g, "")) : 0);
      if (entryPrice <= 0) return;

      seen.add(sourceId);
      competitions.push({
        sourceId,
        siteName: this.config.siteName,
        url: href.startsWith("http") ? href : `${this.config.baseUrl}${href}`,
        name: card.find("img[alt]").first().attr("alt")?.trim() || titleFromSlug(sourceId),
        entryPrice,
        ticketsSold: 0,
        maxTickets: 0,
        maxEntriesPerUser: 100,
        maxEntriesPerUserSource: "fallback",
        cashAlternative: extractCashAlternative(cashAltText),
        drawDate: null,
        isAutoDraw: /scratch|instant|auto draw/i.test(card.text()),
        categories: [],
        scrapedAt: now,
      });
    });

    return competitions;
  }
}

export async function enrichRafflexCompetitionDetails(
  competitions: RawCompetition[],
  fetchDetailHtml: (url: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<void> {
  normalizeClutchCurrentPrizeValues(competitions);
  const repeatedTitles = findRepeatedCompetitionTitles(competitions);
  const quarantined = new Set<RawCompetition>();

  await mapWithConcurrency(competitions, 6, async (competition) => {
    signal?.throwIfAborted();
    const identityRefresh =
      repeatedTitles.has(normalizeCompetitionTitle(competition.name)) ||
      hasTitleSlugIdentityMismatch(competition);
    const boundedDetailRepair = AUTHORITATIVE_DETAIL_REPAIR_SITES.has(competition.siteName);
    const scopedCashRepair = competition.siteName === "bounty";
    const refreshFromDetail = shouldRefreshFromDetail(competition, identityRefresh);
    const preserveStructuredTitle = STRUCTURED_PRODUCT_TITLE_SITES.has(
      competition.siteName,
    );
    const hasExplicitEntryPrice = competition.entryPrice > 0 || (
      preserveStructuredTitle &&
      competition.entryPrice === 0 &&
      (
        /\bfree\b/i.test(competition.name) ||
        competition.categories.some((category) => /\bfree\b/i.test(category))
      )
    );
    if (
      !refreshFromDetail &&
      hasExplicitEntryPrice &&
      competition.maxTickets > 0 &&
      competition.drawDate !== null &&
      (!isBadName(competition.name) || preserveStructuredTitle)
    ) {
      return;
    }

    try {
      const html = await fetchDetailHtml(competition.url);
      const detail = parseRafflexDetail(
        html,
        boundedDetailRepair || scopedCashRepair,
        scopedCashRepair ? competition.name : undefined,
      );
      const authoritativeDetail =
        detail.name !== null &&
        titleMatchesCompetitionSlug(detail.name, competition.sourceId);
      const requiresAuthoritativeDetail = identityRefresh || boundedDetailRepair;
      if (requiresAuthoritativeDetail && !authoritativeDetail) {
        quarantined.add(competition);
        return;
      }
      const authoritativeIdentityRepair = requiresAuthoritativeDetail && authoritativeDetail;
      if (
        detail.name &&
        shouldReplaceCompetitionName(
          competition.name,
          detail.name,
          authoritativeIdentityRepair,
        ) &&
        !(
          competition.siteName === "feelgoodcompetitions" &&
          !isPlaceholderCompetitionName(competition.name) &&
          !authoritativeIdentityRepair
        )
      ) {
        competition.name = detail.name;
      }
      if (
        detail.entryPrice > 0 &&
        (
          competition.entryPrice <= 0 ||
          refreshFromDetail ||
          (
            competition.cashAlternative !== null &&
            competition.entryPrice === competition.cashAlternative
          )
        )
      ) {
        competition.entryPrice = detail.entryPrice;
      }
      if (detail.ticketsSold > 0 && (competition.ticketsSold <= 0 || refreshFromDetail)) {
        competition.ticketsSold = detail.ticketsSold;
      }
      if (detail.maxTickets > 0 && (competition.maxTickets <= 0 || refreshFromDetail)) {
        competition.maxTickets = detail.maxTickets;
      }
      if (detail.drawDate !== null && (competition.drawDate === null || refreshFromDetail)) {
        competition.drawDate = detail.drawDate;
      }
      if (
        detail.maxEntriesPerUser > 0 &&
        (
          competition.maxEntriesPerUser <= 0 ||
          competition.maxEntriesPerUserSource !== "site" ||
          refreshFromDetail
        )
      ) {
        competition.maxEntriesPerUser = detail.maxEntriesPerUser;
        competition.maxEntriesPerUserSource = detail.maxEntriesPerUserSource;
      }
      if (authoritativeIdentityRepair || scopedCashRepair) {
        competition.cashAlternative = detail.cashAlternative;
      } else if (identityRefresh) {
        // Identity-triggered rows only accept cash from a matching detail page.
      } else if (
        detail.cashAlternative !== null &&
        (
          competition.cashAlternative === null ||
          competition.cashAlternative > detail.cashAlternative * 10
        )
      ) {
        competition.cashAlternative = detail.cashAlternative;
      }
    } catch {
      signal?.throwIfAborted();
      if (identityRefresh || boundedDetailRepair) {
        quarantined.add(competition);
      }
    }
  });

  normalizeClutchCurrentPrizeValues(competitions);

  if (quarantined.size > 0) {
    competitions.splice(
      0,
      competitions.length,
      ...competitions.filter((competition) => !quarantined.has(competition)),
    );
  }
}

/** Walk up from an element to find the nearest competition link slug */
function findNearestSlug(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
): string | null {
  let p = $el;
  for (let j = 0; j < 6; j++) {
    p = p.parent();
    const link = p.find('a[href*="/competition/"]').first().attr("href");
    if (link) {
      return link.match(/\/competition\/([\w-]+)/)?.[1] ?? null;
    }
  }
  return null;
}

function selectRafflexCard(
  $: cheerio.CheerioAPI,
  $link: cheerio.Cheerio<AnyNode>,
): cheerio.Cheerio<AnyNode> {
  const candidates: cheerio.Cheerio<AnyNode>[] = [];
  const push = ($candidate: cheerio.Cheerio<AnyNode>) => {
    if ($candidate.length > 0) candidates.push($candidate.first());
  };

  push($link.closest(".rbCard"));
  push($link.closest("div.rounded-lg"));
  push($link.closest("div.border"));
  push($link.closest("div.flex"));
  push($link);

  let $parent = $link.parent();
  for (let i = 0; i < 6 && $parent.length > 0; i += 1) {
    push($parent);
    $parent = $parent.parent();
  }

  return candidates
    .filter(($candidate) => uniqueCompetitionLinkCount($, $candidate) <= 1)
    .sort((a, b) => scoreRafflexCard(b.text()) - scoreRafflexCard(a.text()))[0] ?? $link;
}

function uniqueCompetitionLinkCount(
  $: cheerio.CheerioAPI,
  $candidate: cheerio.Cheerio<AnyNode>,
): number {
  const hrefs = new Set<string>();
  $candidate
    .find('a[href*="/competition/"]')
    .add($candidate.filter('a[href*="/competition/"]'))
    .each((_i, link) => {
      const href = $(link).attr("href");
      if (href) hrefs.add(href);
    });
  return hrefs.size;
}

function scoreRafflexCard(text: string): number {
  let score = 0;
  if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text)) score += 4;
  if (/Draw On/i.test(text)) score += 5;
  if (/\d[\d,]*\s*\/\s*\d[\d,]*\s*sold/i.test(text)) score += 5;
  if (/\d+p\b|£[\d.]+\s*per\s*(?:ticket|entry)/i.test(text)) score += 4;
  if (/Cash\s*Alt|Cash\s*Alternative/i.test(text)) score += 2;
  if (text.length > 0 && text.length < 800) score += 1;
  return score;
}

function parseRafflexDetail(
  html: string,
  scopedCash = false,
  expectedName?: string,
): {
  name: string | null;
  entryPrice: number;
  ticketsSold: number;
  maxTickets: number;
  maxEntriesPerUser: number;
  maxEntriesPerUserSource: "site" | "fallback";
  cashAlternative: number | null;
  drawDate: string | null;
} {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const primaryText = text
    .split("Free Postal Entry")[0]
    ?.split("Make sure to follow our Facebook page")[0]
    ?.trim() || text;
  const soldMatch =
    primaryText.match(/\bSold\s+([\d,]+)\s*\/\s*([\d,]+)(?:\s+Online)?\b/i) ||
    primaryText.match(/\bTickets?\s+Sold\s+([\d,]+)\s*(?:\/|of)\s*([\d,]+)\b/i) ||
    primaryText.match(/\b([\d,]+)\s*\/\s*([\d,]+)\s+(?:Online|Tickets?\s+Sold)\b/i);
  const maxPerMatch =
    html.match(/Max\s*<strong>([\d,]+)<\/strong>\s*tickets\s+per\s+person/i) ||
    primaryText.match(/\bMax\s+([\d,]+)(?:\s+tickets?)?\s+(?:per\s+user|per\s+person)\b/i);
  const maxTickets = soldMatch
    ? parseInt(soldMatch[2].replace(/,/g, ""), 10)
    : 0;
  const ticketsSold = soldMatch
    ? parseInt(soldMatch[1].replace(/,/g, ""), 10)
    : 0;
  const entryPrice = /\bfree\s+(?:to\s+enter|per\s+(?:ticket|entry))\b/i.test(primaryText)
    ? 0
    : parseStructuredRafflexPrice(html) ||
      parseRafflexEntryPrice(primaryText) ||
      parseRafflexEntryPrice(text);
  const explicitEndDraw = extractExplicitEndDrawValue(
    `${$("meta[name='description']").attr("content") ?? ""} ${primaryText}`,
  );

  const detailName = extractDetailName($, expectedName);
  return {
    name: detailName,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: maxPerMatch ? parseInt(maxPerMatch[1].replace(/,/g, ""), 10) : 0,
    maxEntriesPerUserSource: maxPerMatch ? "site" : "fallback",
    cashAlternative: explicitEndDraw ?? (
      scopedCash
        ? extractScopedDetailCashAlternative($, detailName)
        : extractCashAlternative(primaryText)
    ),
    drawDate: parseLiveDrawDateFromHtml(html) || parseDrawDate(primaryText),
  };
}

function parseGenericRafflexDetail(
  html: string,
  siteName: string,
  url: string,
): RawCompetition | null {
  const trackedProduct = parseKlaviyoViewedProduct(html, siteName, url);
  if (trackedProduct) return trackedProduct;

  const sourceId = url.match(/\/competition\/([\w-]+)/)?.[1];
  const detail = parseRafflexDetail(
    html,
    AUTHORITATIVE_DETAIL_REPAIR_SITES.has(siteName),
  );
  const cashAlternative = siteName === "spherecompetitions"
    ? extractCashAlternative(detail.name ?? "")
    : detail.cashAlternative;
  if (
    !sourceId ||
    !detail.name ||
    detail.entryPrice < 0 ||
    detail.maxTickets <= 0 ||
    detail.drawDate === null
  ) {
    return null;
  }

  return {
    sourceId,
    siteName,
    url,
    name: detail.name,
    entryPrice: detail.entryPrice,
    ticketsSold: detail.ticketsSold,
    maxTickets: detail.maxTickets,
    maxEntriesPerUser: detail.maxEntriesPerUser || 100,
    maxEntriesPerUserSource: detail.maxEntriesPerUserSource,
    cashAlternative,
    drawDate: detail.drawDate,
    isAutoDraw: false,
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

export function parseKlaviyoViewedProduct(
  html: string,
  siteName: string,
  url: string,
): RawCompetition | null {
  const marker = html.search(/klaviyo\.track\(\s*['"]Viewed Product['"]\s*,/i);
  if (marker < 0) return null;

  const json = extractBalancedJsonObject(html, html.indexOf("{", marker));
  if (!json) return null;

  let product: Record<string, unknown>;
  try {
    product = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }

  const sourceId = url.match(/\/competition\/([\w-]+)/)?.[1];
  const name = typeof product.ProductName === "string" ? product.ProductName.trim() : "";
  const entryPrice = asNumber(product.Price);
  const ticketsSold = asNumber(product.TicketsSold);
  const maxTickets = asNumber(product.MaxTickets);
  const drawDate = typeof product.DrawDate === "string"
    ? parseEmbeddedRawDate(product.DrawDate)
    : null;
  if (
    !sourceId ||
    !name ||
    entryPrice < 0 ||
    maxTickets <= 0 ||
    ticketsSold < 0 ||
    ticketsSold > maxTickets ||
    drawDate === null ||
    product.IsActive === false
  ) {
    return null;
  }

  const cashAlternative = asNumber(product.CashAlternative);
  const categories = extractEmbeddedCategories(product.ProductTags);
  normalizeFreeEntryCategories(categories, entryPrice);
  return {
    sourceId,
    siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    maxEntriesPerUserSource: "fallback",
    cashAlternative: cashAlternative > 0 ? cashAlternative : null,
    drawDate,
    isAutoDraw: /auto.?draw/i.test(String(product.GameType ?? "")),
    categories,
    scrapedAt: new Date().toISOString(),
  };
}

function extractBalancedJsonObject(value: string, start: number): string | null {
  if (start < 0 || value[start] !== "{") return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }

  return null;
}

function extractDetailName(
  $: cheerio.CheerioAPI,
  expectedName?: string,
): string | null {
  const headings = $("h1, h2")
    .map((_i, el) => $(el).text().replace(/\s+/g, " ").trim())
    .get();
  if (expectedName) {
    const normalizedExpected = normalizeCompetitionTitle(expectedName);
    const matchingHeading = headings.find(
      (heading) => normalizeCompetitionTitle(heading) === normalizedExpected,
    );
    if (matchingHeading) return matchingHeading;
  }

  const title = $("title")
    .first()
    .text()
    .replace(/\s*\|\s*.+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length > 8 && !isGenericDetailTitle(title)) {
    return title;
  }

  const name = headings.find((text) =>
      text.length > 8 &&
      !isGenericDetailTitle(text),
    );
  return name ?? null;
}

function extractScopedDetailCashAlternative(
  $: cheerio.CheerioAPI,
  detailName = extractDetailName($),
): number | null {
  const titleCash = detailName ? extractCashAlternative(detailName) : null;
  if (titleCash !== null) {
    return titleCash;
  }

  let scope = $("h1, h2")
    .filter((_i, el) =>
      detailName !== null &&
      $(el).text().replace(/\s+/g, " ").trim() === detailName,
    )
    .first();
  if (scope.length === 0) scope = $("h1").first();
  for (let depth = 0; depth < 3 && scope.length > 0; depth += 1) {
    const cashAlternative = extractCashAlternative(
      scope.text().replace(/\s+/g, " ").trim(),
    );
    if (cashAlternative !== null) {
      return cashAlternative;
    }
    scope = scope.parent();
  }

  return null;
}

function isGenericDetailTitle(text: string): boolean {
  return /^(Competition\b.*|Competitions|Instant Winners|Categories|Results|Entry Lists|Join Our Community|Ready to win\?)$/i.test(text);
}

function shouldRefreshFromDetail(
  competition: RawCompetition,
  identityRefresh = false,
): boolean {
  if (
    STRUCTURED_PRODUCT_TITLE_SITES.has(competition.siteName) &&
    competition.entryPrice >= 0 &&
    competition.maxTickets > 0 &&
    competition.drawDate !== null
  ) {
    return false;
  }

  if (identityRefresh) {
    return true;
  }

  if (DETAIL_REFRESH_SITES.has(competition.siteName)) {
    return true;
  }

  if (
    competition.cashAlternative === null &&
    /\b(?:vault|prize\s+(?:pool|pot))\b/i.test(competition.name)
  ) {
    return true;
  }

  if (
    competition.siteName === "bounty" &&
    competition.cashAlternative !== null &&
    !/\b(?:cash|prize|win)\b/i.test(competition.name)
  ) {
    return true;
  }

  if (competition.entryPrice <= 0 || competition.maxTickets <= 0 || competition.drawDate === null) {
    return true;
  }

  if (isPlaceholderCompetitionName(competition.name)) {
    return true;
  }

  if (competition.maxTickets <= competition.ticketsSold) {
    return true;
  }

  return competition.maxTickets <= 25;
}

const DETAIL_ONLY_RAFFLEX_SITES = new Set([
  "gallowaygiveaways",
  "4x4giveaways",
  "phatstax",
  "gamechangercomps",
  "onthepodiumprizes",
  "gameoncomps",
  "itsworthapunt",
  "dtcompetitions",
  "smoothcompetitions",
  "spherecompetitions",
  "ryscompetitions",
]);

const AUTHORITATIVE_DETAIL_REPAIR_SITES = new Set([
  "expcomps",
  "luxurious",
]);

const STRUCTURED_PRODUCT_TITLE_SITES = new Set([
  "carsino",
  "ruby",
]);

const DETAIL_REFRESH_SITES = new Set([
  ...DETAIL_ONLY_RAFFLEX_SITES,
  ...AUTHORITATIVE_DETAIL_REPAIR_SITES,
]);

function shouldReplaceCompetitionName(
  currentName: string,
  detailName: string,
  authoritativeDetail = false,
): boolean {
  if (isPlaceholderCompetitionName(currentName)) {
    return true;
  }

  if (isGenericDetailTitle(detailName)) {
    return false;
  }

  if (authoritativeDetail) {
    return true;
  }

  const currentHasPrizeValue = /£|ps\d+|\b(?:cash|prize|win)\b/i.test(currentName);
  const detailHasPrizeValue = /£|ps\d+|\b(?:cash|prize|win)\b/i.test(detailName);
  if (currentHasPrizeValue && !detailHasPrizeValue) {
    return false;
  }

  return detailName.length > currentName.length;
}

function findRepeatedCompetitionTitles(competitions: RawCompetition[]): Set<string> {
  const urlsByTitle = new Map<string, Set<string>>();
  for (const competition of competitions) {
    const title = normalizeCompetitionTitle(competition.name);
    if (!title) continue;
    const urls = urlsByTitle.get(title) ?? new Set<string>();
    urls.add(competition.url);
    urlsByTitle.set(title, urls);
  }

  return new Set(
    Array.from(urlsByTitle.entries())
      .filter(([, urls]) => urls.size > 1)
      .map(([title]) => title),
  );
}

function normalizeCompetitionTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasTitleSlugIdentityMismatch(competition: RawCompetition): boolean {
  const slugTokens = competitionIdentityTokens(competition.sourceId);
  if (slugTokens.length < 2 || isOpaqueCompetitionSlug(competition.sourceId)) {
    return false;
  }

  const titleTokens = competitionIdentityTokens(competition.name);
  return titleTokens.length > 0 && !tokensOverlap(titleTokens, slugTokens);
}

function titleMatchesCompetitionSlug(title: string, sourceId: string): boolean {
  const slugTokens = competitionIdentityTokens(sourceId);
  const titleTokens = competitionIdentityTokens(title);
  return (
    (slugTokens.length > 0 && tokensOverlap(titleTokens, slugTokens)) ||
    prizeAmountsOverlap(title, sourceId)
  );
}

function competitionIdentityTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) =>
      token.length >= 3 &&
      !IDENTITY_STOP_WORDS.has(token) &&
      !/^\d+$/.test(token) &&
      !/^ps\d+$/.test(token)
    );
}

function tokensOverlap(left: string[], right: string[]): boolean {
  const rightTokens = new Set(right.map(normalizeIdentityToken));
  return left.some((token) => rightTokens.has(normalizeIdentityToken(token)));
}

function prizeAmountsOverlap(left: string, right: string): boolean {
  const rightAmounts = new Set(extractPrizeAmounts(right));
  return extractPrizeAmounts(left).some((amount) => rightAmounts.has(amount));
}

function extractPrizeAmounts(value: string): number[] {
  return Array.from(value.matchAll(/(?:£|\bps)\s*([\d,]+(?:\.\d+)?)/gi))
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter(Number.isFinite);
}

function normalizeIdentityToken(token: string): string {
  return token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function isOpaqueCompetitionSlug(sourceId: string): boolean {
  return (
    /^\d+$/.test(sourceId) ||
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(sourceId)
  );
}

const IDENTITY_STOP_WORDS = new Set([
  "and",
  "cash",
  "competition",
  "competitions",
  "draw",
  "entry",
  "instant",
  "only",
  "prize",
  "raffle",
  "ticket",
  "tickets",
  "the",
  "with",
  "win",
]);

function isPlaceholderCompetitionName(text: string): boolean {
  const trimmed = text.trim();
  return (
    isBadName(trimmed) ||
    /^(?:today|tomorrow)\b/i.test(trimmed) ||
    /^cash alternative$/i.test(trimmed)
  );
}

function parseRafflexEntryPrice(text: string): number {
  if (/\bfree\s+(?:to\s+enter|per\s+(?:ticket|entry))\b/i.test(text)) return 0;

  const exactPriceMatch = text.match(/(?:^|\s)£\s*([\d.]+)(?:\s|$)/);
  if (exactPriceMatch && parseFloat(exactPriceMatch[1]) < 100) {
    return parseFloat(exactPriceMatch[1]);
  }

  const pound =
    text.match(/£\s*([\d.]+)\s*Per\s*(?:Ticket|Entry)/i) ||
    text.match(/£\s*([\d.]+)\s*a\s*(?:ticket|entry)/i) ||
    text.match(/From\s+£\s*([\d.]+)/i);
  if (pound) return parseFloat(pound[1]);

  const pence =
    text.match(/(\d+)p\s*Per\s*(?:Ticket|Entry)/i) ||
    text.match(/(\d+)p\s*a\s*(?:ticket|entry)/i) ||
    text.match(/(\d+)p\s*Entry\b/i) ||
    text.match(/(\d+)p\s*Draw On\b/i) ||
    text.match(/\bfor\s+(\d+)p\b/i);
  return pence ? parseInt(pence[1], 10) / 100 : 0;
}

function parseStructuredRafflexPrice(html: string): number {
  const jsonPrice =
    html.match(/price:\s*\{\s*value:\s*"([\d.]+)"/i)?.[1] ||
    html.match(/"price"\s*:\s*\{\s*"value"\s*:\s*"([\d.]+)"/i)?.[1];
  if (jsonPrice) {
    const parsed = parseFloat(jsonPrice);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const standalonePence = html.match(/>\s*(\d+)p\s*</i)?.[1];
  if (standalonePence) return parseInt(standalonePence, 10) / 100;

  const standalonePound = html.match(/>\s*£\s*([\d.]+)\s*</i)?.[1];
  if (standalonePound) {
    const parsed = parseFloat(standalonePound);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 100) return parsed;
  }

  return 0;
}

function parseLiveDrawDateFromHtml(html: string): string | null {
  const match = html.match(
    /Live draw\s*<strong>(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*@\s*(\d{1,2}):(\d{2})(am|pm)<\/strong>/i,
  );
  if (!match) return null;

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[match[1].toLowerCase().slice(0, 3)];
  if (month === undefined) return null;

  let hours = parseInt(match[3], 10);
  const minutes = parseInt(match[4], 10);
  const meridiem = match[5].toLowerCase();
  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  const date = new Date();
  date.setMonth(month, parseInt(match[2], 10));
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date.toISOString();
}

function isBadName(name: string): boolean {
  return name.trim().length < 10 || /^(Per Ticket|Entry|Enter Here!?|Play Now)$/i.test(name.trim());
}

function uniqueCompetitionLinks(
  $: cheerio.CheerioAPI,
  baseUrl: string,
): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const links: { sourceId: string; url: string }[] = [];
  $('a[href*="/competition"]').each((_i, el) => {
    const href = $(el).attr("href") || "";
    const sourceId = href.match(/\/competitions?\/([\w-]+)/)?.[1];
    if (!sourceId || seen.has(sourceId)) return;
    seen.add(sourceId);
    links.push({
      sourceId,
      url: href.startsWith("http") ? href : `${baseUrl}${href}`,
    });
  });
  return links;
}

function hasDiscoverableCompetitionData(html: string, siteName: string): boolean {
  const $ = cheerio.load(html);
  return uniqueCompetitionLinks($, "https://example.invalid").length > 0 ||
    parseEmbeddedProducts(html, siteName).length > 0;
}

function hasExplicitEmptyCompetitionState(html: string): boolean {
  const text = cheerio.load(html)("body").text().replace(/\s+/g, " ").trim();
  return /\bno\s+(?:(?:live|active|current)\s+)?(?:competitions|raffles)\b/i.test(text) ||
    /\b(?:competitions|raffles)\s+coming\s+soon\b/i.test(text);
}

function isRafflexDateLine(line: string): boolean {
  return /^(Today|Tomorrow)\s+\d{1,2}:\d{2}(?:am|pm)$/i.test(line) ||
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?\s+\d{1,2}:\d{2}(?:am|pm)$/i.test(line);
}

function parseRafflexLinePrice(lines: string[]): number {
  for (const line of lines) {
    const pence = line.match(/^(\d+)p$/i);
    if (pence) return parseInt(pence[1], 10) / 100;
    if (/^Free$/i.test(line)) return 0;
    const pound = line.match(/^£\s*([\d.]+)$/);
    if (pound) return parseFloat(pound[1]);
  }
  return 0;
}

function parseNumberAfterLabel(lines: string[], label: string): number {
  const idx = lines.findIndex((line) => line.toLowerCase() === label.toLowerCase());
  if (idx === -1) return 0;
  return parseNumber(lines[idx + 1]);
}

function parseNumber(value: string | undefined): number {
  return value ? parseInt(value.replace(/,/g, ""), 10) || 0 : 0;
}

function parseMoneyValue(value: string | undefined): number {
  const match = value?.match(/£\s*([\d.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

function bestLinkForName(
  name: string,
  links: { sourceId: string; url: string }[],
  used: Set<string>,
): { sourceId: string; url: string } | null {
  const words = name
    .toLowerCase()
    .replace(/ps\d+/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !["the", "and", "for", "with", "only"].includes(word));

  let best: { sourceId: string; url: string } | null = null;
  let bestScore = 0;
  for (const link of links) {
    if (used.has(link.sourceId)) continue;
    const slugWords = link.sourceId.split("-");
    const score = words.filter((word) =>
      slugWords.some((slugWord) => slugWord.includes(word) || word.includes(slugWord)),
    ).length;
    if (score > bestScore) {
      best = link;
      bestScore = score;
    }
  }
  return best ?? links.find((link) => !used.has(link.sourceId)) ?? null;
}

function extractCashAlternative(text: string): number | null {
  const abbreviated = text.match(
    /£\s*([\d,.]+)\s*(k)\s*(?:tax[\s-]*free\s*)?Cash\s*(?:Alternative|Alt)?\b/i,
  );
  if (abbreviated) return parseCashAmount(abbreviated[1], abbreviated[2]);

  const match =
    text.match(/£\s*([\d,.]+)\s*(?:tax[\s-]*free\s*)?Cash\s*(?:Alternative|Alt)?\b/i) ||
    text.match(/\bor\s+£\s*([\d,.]+)\s*cash\s*alternative\b/i) ||
    text.match(/Cash\s*(?:Alternative|Alt)\s*[:\-]?\s*£\s*([\d,.]+)/i) ||
    text.match(/\bwin\s+£\s*([\d,.]+)\s+(?:cash\s+)?for\s+just\b/i) ||
    text.match(/(?:£|ps)([\d,.]+)\s*(?:cash|end prize|prize)/i);
  return match ? parseCashAmount(match[1]) : null;
}

function normalizeClutchCurrentPrizeValues(competitions: RawCompetition[]): void {
  for (const competition of competitions) {
    if (competition.siteName !== "clutchcomps") continue;
    const match = competition.name.match(
      /(?:£|\bps)\s*([\d,.]+)\s*(?:cash|end\s+draw|end\s+prize)\b/i,
    );
    competition.cashAlternative = match ? parseCashAmount(match[1]) : null;
  }
}

function parseCashAmount(value: string, suffix?: string): number | null {
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return suffix?.toLowerCase() === "k" ? parsed * 1000 : parsed;
}

export function parseDreamCashDetail(
  html: string,
  siteName: string,
  url: string,
): RawCompetition | null {
  const $ = cheerio.load(html);
  const sourceId = url.match(/\/competition\/([\w-]+)/)?.[1];
  const name = $("h1").first().text().replace(/\s+/g, " ").trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const soldMatch = text.match(/([\d,]+)\s*\/\s*([\d,]+)/);
  if (!sourceId || !name || !soldMatch) return null;

  const price =
    parseMoneyValue(text.match(new RegExp(`${escapeRegExp(name)}\\s+£\\s*([\\d.]+)`, "i"))?.[0]) ||
    parseMoneyValue(text.match(/Tickets Total:\s*£\s*([\d.]+)/i)?.[0]);
  if (price <= 0) return null;

  const rrp = parseMoneyValue(text.match(/RRP\s*£\s*([\d,.]+)/i)?.[0]);

  const maxEntriesPerUserMatch = text.match(/1\s*-\s*([\d,]+)\s*Plus/i);

  return {
    sourceId,
    siteName,
    url,
    name,
    entryPrice: price,
    ticketsSold: parseNumber(soldMatch[1]),
    maxTickets: parseNumber(soldMatch[2]),
    maxEntriesPerUser: parseNumber(maxEntriesPerUserMatch?.[1]) || 100,
    maxEntriesPerUserSource: maxEntriesPerUserMatch ? "site" : "fallback",
    cashAlternative: extractCashAlternative(name),
    estimatedPrizeValue: rrp > 0 ? rrp : null,
    valuationSource: rrp > 0 ? "site_estimate" : null,
    valuationConfidence: rrp > 0 ? "high" : null,
    valuationNotes: rrp > 0 ? "RRP stated on competition page" : null,
    drawDate: parseDrawDate(text),
    isAutoDraw: /instant(?:\s|-)?(?:win|reveal)|auto draw/i.test(name),
    categories: [],
    scrapedAt: new Date().toISOString(),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleFromSlug(value: string): string {
  return value
    .replace(/\bps(\d+)/gi, "£$1")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDrawDate(text: string): string | null {
  const relative = text.match(/\b(Today|Tomorrow)\s+(\d{1,2}):(\d{2})(am|pm)\b/i);
  if (relative) {
    const d = new Date();
    if (relative[1].toLowerCase() === "tomorrow") {
      d.setDate(d.getDate() + 1);
    }
    let hours = parseInt(relative[2], 10);
    if (relative[4].toLowerCase() === "pm" && hours < 12) hours += 12;
    if (relative[4].toLowerCase() === "am" && hours === 12) hours = 0;
    d.setHours(hours, parseInt(relative[3], 10), 0, 0);
    return d.toISOString();
  }

  const match = text.match(
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*@?\s*(\d{1,2}):(\d{2})(am|pm)/i,
  );
  if (!match) {
    const shortDate = parseShortDayMonthDate(text);
    if (shortDate) return shortDate;

    const duration = parseDurationDrawDate(text);
    if (duration) return duration;
    return null;
  }

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[match[1].toLowerCase().substring(0, 3)];
  if (month === undefined) return null;

  const day = parseInt(match[2], 10);
  let hours = parseInt(match[3], 10);
  const mins = parseInt(match[4], 10);
  if (match[5].toLowerCase() === "pm" && hours < 12) hours += 12;
  if (match[5].toLowerCase() === "am" && hours === 12) hours = 0;

  const d = new Date();
  d.setMonth(month, day);
  d.setHours(hours, mins, 0, 0);
  if (d.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString();
}

function parseDurationDrawDate(text: string): string | null {
  const match = text.match(
    /\b(?:(\d+)\s*Days?)?\s*(?:(\d+)\s*Hrs?|\b(\d+)\s*Hours?)\s*(?:(\d+)\s*Mins?|\b(\d+)\s*Minutes?)\s*(?:(\d+)\s*Secs?|\b(\d+)\s*Seconds?)\b/i,
  );
  if (!match) return null;

  const days = parseInt(match[1] ?? "0", 10);
  const hours = parseInt(match[2] ?? match[3] ?? "0", 10);
  const minutes = parseInt(match[4] ?? match[5] ?? "0", 10);
  const seconds = parseInt(match[6] ?? match[7] ?? "0", 10);
  const totalSeconds =
    days * 24 * 60 * 60 +
    hours * 60 * 60 +
    minutes * 60 +
    seconds;
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;

  return new Date(Date.now() + totalSeconds * 1000).toISOString();
}

function parseShortDayMonthDate(text: string): string | null {
  const match = text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(\d{1,2})\s+([A-Za-z]{3,9})\b/i);
  if (!match) return null;

  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[match[2].toLowerCase().substring(0, 3)];
  if (month === undefined) return null;

  const d = new Date();
  d.setMonth(month, parseInt(match[1], 10));
  d.setHours(20, 0, 0, 0);
  if (d.getTime() < Date.now() - 24 * 60 * 60 * 1000) {
    d.setFullYear(d.getFullYear() + 1);
  }
  return d.toISOString();
}

function parseCountdownSeconds(value: string | undefined): string | null {
  if (!value) return null;
  const seconds = parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function parseEmbeddedProducts(
  html: string,
  siteName: string,
): RawCompetition[] {
  const now = new Date().toISOString();
  const products = new Map<string, RawCompetition>();

  for (const product of extractProductsFromWireSnapshots(html)) {
    const competition = toRawCompetition(product, siteName, now);
    if (competition) products.set(competition.sourceId, competition);
  }

  if (products.size > 0) {
    return Array.from(products.values());
  }

  for (const product of extractProductsFromInlineJson(html)) {
    const competition = toRawCompetition(product, siteName, now);
    if (competition) products.set(competition.sourceId, competition);
  }

  return Array.from(products.values());
}

function extractProductsFromWireSnapshots(html: string): EmbeddedProduct[] {
  const products: EmbeddedProduct[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/wire:snapshot="([^"]+)"/g)) {
    const raw = decodeHtmlEntities(match[1]);
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(raw);
    } catch {
      continue;
    }

    for (const candidate of walkForProducts(snapshot)) {
      if (seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      products.push(candidate);
    }
  }

  return products;
}

function extractProductsFromInlineJson(html: string): EmbeddedProduct[] {
  const products: EmbeddedProduct[] = [];
  const seen = new Set<string>();
  const pattern =
    /"title":"((?:\\.|[^"])*)".+?"url":"(https?:\\\/\\\/[^"]*\\\/competition\\\/[^"]+)".+?"price_raw":([0-9.]+).+?"cash_alt":"((?:\\.|[^"])*)".+?"draw_date_raw":"((?:\\.|[^"])*)".+?"max_tickets":(\d+).+?"max_per_user":(null|\d+).+?"sold_tickets":(\d+)/g;

  for (const match of html.matchAll(pattern)) {
    const url = decodeJsonString(match[2]);
    if (seen.has(url)) continue;
    seen.add(url);
    products.push({
      title: decodeJsonString(match[1]),
      url,
      priceRaw: Number(match[3]),
      cashAlt: decodeJsonString(match[4]),
      drawDateRaw: decodeJsonString(match[5]),
      maxTickets: Number(match[6]),
      maxPerUser: match[7] === "null" ? 0 : Number(match[7]),
      soldTickets: Number(match[8]),
      categories: [],
      autoDraw: false,
      description: "",
    });
  }

  return products;
}

type EmbeddedProduct = {
  title: string;
  url: string;
  priceRaw: number;
  cashAlt: string | null;
  drawDateRaw: string | null;
  maxTickets: number;
  maxPerUser: number;
  soldTickets: number;
  categories: string[];
  autoDraw: boolean;
  description: string;
};

function walkForProducts(value: unknown): EmbeddedProduct[] {
  const results: EmbeddedProduct[] = [];

  if (Array.isArray(value)) {
    for (const item of value) {
      results.push(...walkForProducts(item));
    }
    return results;
  }

  if (!value || typeof value !== "object") {
    return results;
  }

  const record = value as Record<string, unknown>;
  const product = coerceEmbeddedProduct(record);
  if (product) {
    results.push(product);
  }

  for (const nested of Object.values(record)) {
    results.push(...walkForProducts(nested));
  }

  return results;
}

function coerceEmbeddedProduct(record: Record<string, unknown>): EmbeddedProduct | null {
  const url = typeof record.url === "string" ? record.url : null;
  const title = typeof record.title === "string" ? record.title : null;
  if (!url || !title || !url.includes("/competition/")) {
    return null;
  }

  const priceRaw = asNumber(record.price_raw);
  const maxTickets = asNumber(record.max_tickets);
  const soldTickets = asNumber(record.sold_tickets);
  if (priceRaw < 0 || maxTickets <= 0) {
    return null;
  }

  return {
    title,
    url,
    priceRaw,
    cashAlt: typeof record.cash_alt === "string" ? record.cash_alt : null,
    drawDateRaw:
      typeof record.draw_date_raw === "string"
        ? record.draw_date_raw
        : typeof record.end_date_raw === "string"
          ? record.end_date_raw
          : null,
    maxTickets,
    maxPerUser: asNumber(record.max_per_user),
    soldTickets,
    categories: extractEmbeddedCategories(record.categories),
    autoDraw: Boolean(record.auto_draw),
    description: typeof record.description === "string" ? record.description : "",
  };
}

function toRawCompetition(
  product: EmbeddedProduct,
  siteName: string,
  scrapedAt: string,
): RawCompetition | null {
  if (isWinnersClubEligibilityOnlyBonusDraw(product, siteName)) return null;

  const sourceId = product.url.match(/\/competition\/([\w-]+)/)?.[1];
  if (!sourceId) return null;
  const categories = [...product.categories];
  normalizeFreeEntryCategories(categories, product.priceRaw);

  return {
    sourceId,
    siteName,
    url: product.url,
    name: product.title,
    entryPrice: product.priceRaw,
    ticketsSold: product.soldTickets,
    maxTickets: product.maxTickets,
    maxEntriesPerUser: product.maxPerUser > 0 ? product.maxPerUser : 100,
    maxEntriesPerUserSource: product.maxPerUser > 0 ? "site" : "fallback",
    cashAlternative:
      extractCashAlternative(
        `${product.cashAlt ?? ""} ${product.title} ${titleFromSlug(sourceId)}`,
      ) ?? extractExplicitEndDrawValue(product.description),
    drawDate: parseEmbeddedRawDate(product.drawDateRaw),
    isAutoDraw:
      product.autoDraw ||
      product.categories.some((category) => /instant/i.test(category)),
    categories,
    scrapedAt,
  };
}

function isWinnersClubEligibilityOnlyBonusDraw(
  product: EmbeddedProduct,
  siteName: string,
): boolean {
  return siteName === "winnersclubni" &&
    product.priceRaw >= 100 &&
    /\bgolden ticket bonus draw\b/i.test(product.title) &&
    /\bonly\s+\d+\s+golden ticket holders?\b/i.test(product.title);
}

function parseEmbeddedRawDate(value: string | null): string | null {
  if (!value) return null;
  const normalised = value.replace(" ", "T");
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? parseDrawDate(value) : date.toISOString();
}

function extractEmbeddedCategories(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractEmbeddedCategories(item));
  }
  return typeof value === "string" ? [value] : [];
}

function normalizeFreeEntryCategories(categories: string[], entryPrice: number): void {
  if (entryPrice > 0) {
    for (let index = categories.length - 1; index >= 0; index -= 1) {
      if (/\bfree\b/i.test(categories[index] ?? "")) categories.splice(index, 1);
    }
    return;
  }

  if (
    entryPrice === 0 &&
    !categories.some((category) => /\bfree\b/i.test(category))
  ) {
    categories.push("free");
  }
}

function extractExplicitEndDrawValue(value: string): number | null {
  const match = value.match(
    /(?:£|ps)\s*([\d,.]+)\s*(k)?\s*(?:cash\s*)?(?:end\s+draw|end\s+prize|main\s+draw|final\s+prize)\b/i,
  );
  return match ? parseCashAmount(match[1], match[2]) : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.]/g, "");
    return cleaned ? Number(cleaned) : 0;
  }
  return 0;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value.replace(/\\\//g, "/").replace(/\\"/g, "\"");
  }
}

function removeWinnerTickerRows(comps: RawCompetition[]): RawCompetition[] {
  return comps.filter((comp) => !/\bwon!$/i.test(comp.name.trim()));
}

function shouldPreferTailwindCards(
  tailwind: RawCompetition[],
  standard: RawCompetition[],
): boolean {
  if (tailwind.length === 0) return false;

  const economicsScore = (comps: RawCompetition[]) =>
    comps.filter((comp) => comp.entryPrice > 0 && comp.maxTickets > 0).length;
  const namingScore = (comps: RawCompetition[]) =>
    comps.filter((comp) => !isBadName(comp.name)).length;

  const tailwindEconomics = economicsScore(tailwind);
  const standardEconomics = economicsScore(standard);
  if (standardEconomics > tailwindEconomics) return false;
  if (tailwindEconomics > standardEconomics) return true;

  return namingScore(tailwind) > namingScore(standard);
}

function filterSupportableCompetitions(comps: RawCompetition[]): RawCompetition[] {
  for (const comp of comps) {
    applyExplicitTitlePrizeValue(comp);
  }

  return comps.filter(
    (comp) =>
      comp.url &&
      comp.name &&
      (
        comp.entryPrice > 0 ||
        /\bfree\b/i.test(comp.name) ||
        comp.categories.some((category) => /\bfree\b/i.test(category))
      ) &&
      comp.maxTickets > 0 &&
      comp.drawDate !== null,
  );
}

function countSupportableEconomics(comps: RawCompetition[]): number {
  return comps.filter((comp) =>
    Boolean(comp.url) &&
    Boolean(comp.name) &&
    (
      comp.entryPrice > 0 ||
      /\bfree\b/i.test(comp.name) ||
      comp.categories.some((category) => /\bfree\b/i.test(category))
    ) &&
    comp.maxTickets > 0 &&
    comp.drawDate !== null
  ).length;
}

function applyExplicitTitlePrizeValue(comp: RawCompetition): void {
  if ((comp.estimatedPrizeValue ?? 0) > 0 || (comp.cashAlternative ?? 0) > 0) return;
  if (/\bfree\s+to\s+enter\b/i.test(comp.name) || /\bsite\s+credit\b/i.test(comp.name)) return;
  if (/\b(?:vault|prize\s+(?:pool|pot))\b/i.test(comp.name)) return;

  const explicit = extractExplicitNonCashPrizeValue(comp.name);
  if (explicit === null) return;

  comp.estimatedPrizeValue = explicit;
  comp.valuationSource = "site_estimate";
  comp.valuationConfidence = "medium";
  comp.valuationNotes = "Prize title states approximate prize value";
}

function extractExplicitNonCashPrizeValue(text: string): number | null {
  const matches = Array.from(text.matchAll(/(?:£|ps)\s*([\d,.]+)\s*(k)?/gi));
  for (const match of matches) {
    const amount = parseFloat(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
    if (!Number.isFinite(amount) || amount < 100) continue;

    const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 36);
    if (
      /^\s*(?:cash|tax[- ]?free|end\s+draw|end\s+prize|instant|ticket|tickets|per|entry|for\b|site\s+credit|vault\b)/i.test(after)
    ) {
      continue;
    }

    return amount;
  }

  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  let index = 0;
  const results = new Array<R>(items.length);
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const currentIndex = index;
        const item = items[currentIndex];
        index += 1;
        results[currentIndex] = await worker(item, currentIndex);
      }
    },
  );
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (failure) throw failure.reason;
  return results;
}
