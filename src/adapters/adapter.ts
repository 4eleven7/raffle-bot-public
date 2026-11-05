import type { RawCompetition } from "../types.js";

export interface SiteAdapter {
  readonly siteName: string;
  readonly scanCost?: "normal" | "browser" | "heavy";
  fetchAll(signal?: AbortSignal): Promise<RawCompetition[]>;
}
