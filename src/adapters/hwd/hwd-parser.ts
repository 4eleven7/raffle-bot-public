import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawCompetition } from "../../types.js";
import type { HwdSiteConfig } from "./hwd-site-config.js";

/** Extract max ticket data from the random_number_generator JS variable */
function extractRaffleData(
  html: string,
): Map<string, { max: number; name: string }> {
  const data = new Map<string, { max: number; name: string }>();
  const match = html.match(
    /var\s+random_number_generator\s*=\s*(\{[\s\S]*?\});\s*(?:\n|<\/script>)/,
  );
  if (!match) return data;

  try {
    const parsed = JSON.parse(match[1]);
    const raffles = parsed.raffles;
    if (raffles && typeof raffles === "object") {
      for (const [id, raffle] of Object.entries(raffles)) {
        const r = raffle as { max?: string; name?: string };
        if (r.max) {
          data.set(id, {
            max: parseInt(r.max, 10),
            name: r.name || "",
          });
        }
      }
    }
  } catch {
    // Skip if JSON parsing fails
  }

  return data;
}

/** Parse an HWD competitions listing page into RawCompetition[] */
export function parsePage(
  html: string,
  config: HwdSiteConfig,
): RawCompetition[] {
  const $ = cheerio.load(html);
  const competitions: RawCompetition[] = [];
  const now = new Date().toISOString();
  const raffleData = extractRaffleData(html);

  $("li.product, div.product").each((_i, el) => {
    try {
      const $el = $(el);
      const comp = parseProductCard($, $el, raffleData, now, config);
      if (comp) competitions.push(comp);
    } catch {
      // Skip unparseable cards
    }
  });

  return competitions;
}

function parseProductCard(
  $: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<AnyNode>,
  raffleData: Map<string, { max: number; name: string }>,
  now: string,
  config: HwdSiteConfig,
): RawCompetition | null {
  // Source ID from post-XXXXX class
  const classes = $el.attr("class") || "";
  const postMatch = classes.match(/post-(\d+)/);
  const sourceId = postMatch?.[1] ?? "";
  if (!sourceId) return null;

  // Competition URL
  const link =
    $el.find("a[href*='/competition/']").first().attr("href") || "";
  const url = link.startsWith("http") ? link : `${config.baseUrl}${link}`;
  if (!link) return null;

  // Name
  const name =
    $el.find("h2.woocommerce-loop-product__title").text().trim() ||
    $el.find("h2").first().text().trim();
  if (!name) return null;

  // Entry price: "£2.99"
  const priceText = $el.find("span.price, .price").first().text();
  const priceMatch = priceText.match(/£([\d,.]+)/);
  const entryPrice = priceMatch
    ? parseFloat(priceMatch[1].replace(",", ""))
    : 0;

  // Tickets left: "3949 Tickets Left" or "4684 Left"
  const cardText = $el.text();
  const leftMatch = cardText.match(/([\d,]+)\s*(?:Tickets\s*)?Left/i);
  const ticketsLeft = leftMatch
    ? parseInt(leftMatch[1].replace(/,/g, ""), 10)
    : 0;

  // Max tickets from random_number_generator (if available)
  const raffle = raffleData.get(sourceId);
  const maxTickets = raffle ? raffle.max : 0;
  const ticketsSold = maxTickets > 0 ? maxTickets - ticketsLeft : 0;

  // Cash alternative from name: "OR £300" or "or £X,XXX"
  let cashAlternative: number | null = null;
  const cashMatch =
    name.match(/or\s+£([\d,]+)/i) ||
    name.match(/£([\d,]+)\s*(?:Tax\s*Free\s*)?Cash/i);
  if (cashMatch) {
    cashAlternative = parseFloat(cashMatch[1].replace(/,/g, ""));
  }

  // Categories from product_cat-XXX classes
  const categories: string[] = [];
  const catMatches = classes.match(/product_cat-([^\s]+)/g);
  if (catMatches) {
    for (const c of catMatches) {
      const cat = c.replace("product_cat-", "");
      if (cat !== "all") categories.push(cat.replace(/-/g, " "));
    }
  }

  // Auto draw detection
  const isAutoDraw =
    name.toLowerCase().includes("auto draw") ||
    cardText.toLowerCase().includes("auto draw");

  return {
    sourceId,
    siteName: config.siteName,
    url,
    name,
    entryPrice,
    ticketsSold,
    maxTickets,
    maxEntriesPerUser: 100,
    cashAlternative,
    drawDate: null, // Not available on listing pages
    isAutoDraw,
    categories,
    scrapedAt: now,
  };
}

/** Extract total page count from pagination */
export function extractTotalPages(
  html: string,
  config: HwdSiteConfig,
): number {
  const $ = cheerio.load(html);

  // HWD uses ?paged=N — look for pagination links
  const pages = $("a.page-numbers, .page-numbers a")
    .map((_i, el) => {
      const num = parseInt($(el).text(), 10);
      return isNaN(num) ? 0 : num;
    })
    .get();

  if (pages.length > 0) return Math.max(...pages);

  // Fallback: check result count text
  const resultText = $(".woocommerce-result-count").text();
  const totalMatch = resultText.match(/of\s+(\d+)\s+results/);
  if (totalMatch) {
    const total = parseInt(totalMatch[1], 10);
    return Math.ceil(total / config.itemsPerPage);
  }

  return 1;
}
