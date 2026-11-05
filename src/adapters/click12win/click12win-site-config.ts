export interface Click12WinSiteConfig {
  siteName: string;
  displayName: string;
  baseUrl: string;
  apiBaseUrl: string;
  userAgent: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const CLICK12WIN_SITES: Click12WinSiteConfig[] = [
  {
    siteName: "mrwish",
    displayName: "Mr Wish Competitions",
    baseUrl: "https://www.mrwishcompetitions.co.uk",
    apiBaseUrl: "https://api.mrwishcompetitions.co.uk/api/v1",
    userAgent: UA,
  },
];
