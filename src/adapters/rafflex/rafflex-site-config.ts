export interface RafflexSiteConfig {
  siteName: string;
  displayName: string;
  baseUrl: string;
  listPath: string;
  extraCompetitionPaths?: string[];
  userAgent: string;
  fetchDelayMs: number;
}
