export interface HwdSiteConfig {
  siteName: string;
  displayName: string;
  baseUrl: string;
  listPath: string;
  /** Paginated path with {page} placeholder. Null if all items on one page. Uses ?paged= format. */
  paginatedPath: string | null;
  itemsPerPage: number;
  userAgent: string;
  fetchDelayMs: number;
  requiresBrowser?: boolean;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const HWD_SITES: HwdSiteConfig[] = [
  {
    siteName: "a9",
    displayName: "A9 Competitions",
    baseUrl: "https://www.a9competitions.co.uk",
    listPath: "/live-competitions/",
    paginatedPath: "/live-competitions/?paged={page}",
    itemsPerPage: 15,
    userAgent: UA,
    fetchDelayMs: 500,
    requiresBrowser: true,
  },
  {
    siteName: "guitarfrenzy",
    displayName: "Guitar Frenzy",
    baseUrl: "https://guitarfrenzy.co.uk",
    listPath: "/competitions/",
    paginatedPath: null,
    itemsPerPage: 10,
    userAgent: UA,
    fetchDelayMs: 500,
  },
  {
    siteName: "alltech",
    displayName: "AllTech Competitions",
    baseUrl: "https://alltechcompetitions.co.uk",
    listPath: "/live-competitions/",
    paginatedPath: null,
    itemsPerPage: 15,
    userAgent: UA,
    fetchDelayMs: 500,
  },
  {
    siteName: "pokerraffles",
    displayName: "Poker Raffles",
    baseUrl: "https://www.pokerraffles.com",
    listPath: "/",
    paginatedPath: null,
    itemsPerPage: 15,
    userAgent: UA,
    fetchDelayMs: 500,
  },
  {
    siteName: "sccompetitions",
    displayName: "SC Competitions",
    baseUrl: "https://www.sccompetitions.co.uk",
    listPath: "/",
    paginatedPath: null,
    itemsPerPage: 15,
    userAgent: UA,
    fetchDelayMs: 500,
  },
];
