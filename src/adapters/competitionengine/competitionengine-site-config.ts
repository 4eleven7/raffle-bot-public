export interface CompetitionEngineSiteConfig {
  siteName: string;
  displayName: string;
  baseUrl: string;
  listPath: string;
  userAgent: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const COMPETITION_ENGINE_SITES: CompetitionEngineSiteConfig[] = [
  {
    siteName: "winnerwinnercompetitions",
    displayName: "Winner Winner Competitions",
    baseUrl: "https://winnerwinnercompetitions.co.uk",
    listPath: "/competitions",
    userAgent: UA,
  },
  {
    siteName: "s2acompetitions",
    displayName: "S2A Competitions",
    baseUrl: "https://s2acompetitions.co.uk",
    listPath: "/competitions",
    userAgent: UA,
  },
  {
    siteName: "winthisnow",
    displayName: "Win this Now Competitions",
    baseUrl: "https://winthisnowcompetitions.co.uk",
    listPath: "/competitions",
    userAgent: UA,
  },
  {
    siteName: "madmac",
    displayName: "Mad Mac",
    baseUrl: "https://madmaccompetitions.com",
    listPath: "/competitions",
    userAgent: UA,
  },
  {
    siteName: "vortex",
    displayName: "Vortex Competitions",
    baseUrl: "https://vortexcompetitions.com",
    listPath: "/competitions",
    userAgent: UA,
  },
  {
    siteName: "mpower",
    displayName: "MPower Competitions",
    baseUrl: "https://mpowercompetitions.co.uk",
    listPath: "/",
    userAgent: UA,
  },
  {
    siteName: "crazycatcomps",
    displayName: "Crazy Cat Comps",
    baseUrl: "https://crazycatcomps.co.uk",
    listPath: "/competitions",
    userAgent: UA,
  },
  {
    siteName: "houseofhopecomps",
    displayName: "House of Hope Comps",
    baseUrl: "https://www.houseofhopecomps.co.uk",
    listPath: "/",
    userAgent: UA,
  },
];
