export interface ShopifySiteConfig {
  siteName: string;
  displayName: string;
  baseUrl: string;
  operatorUrls?: string[];
  /** Collection paths to scan, in priority order */
  collections: string[];
  /** Fetch product pages linked from the collection and parse their detail counts. */
  detailPageScan?: boolean;
  userAgent: string;
  fetchDelayMs: number;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const SHOPIFY_SITES: ShopifySiteConfig[] = [
  {
    siteName: "giveawayguys",
    displayName: "The Giveaway Guys",
    baseUrl: "https://thegiveawayguys.co.uk",
    collections: ["/collections/ending-soon", "/collections/all"],
    userAgent: UA,
    fetchDelayMs: 500,
  },
  {
    siteName: "winlife",
    displayName: "Win Life Comps",
    baseUrl: "https://winlifecomps.co.uk",
    collections: ["/collections/current-competitions", "/collections/all"],
    userAgent: UA,
    fetchDelayMs: 500,
  },
  {
    siteName: "horizonprizes",
    displayName: "Horizon Premium Prizes",
    baseUrl: "https://horizonprizes.co.uk",
    operatorUrls: [
      "https://horizonprizes.co.uk",
      "https://www.horizonprizes.co.uk",
    ],
    collections: ["/"],
    detailPageScan: true,
    userAgent: UA,
    fetchDelayMs: 500,
  },
];
