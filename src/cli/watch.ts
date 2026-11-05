import { getAdapter, getAllAdapters } from "../adapters/registry.js";
import { startMonitor } from "../monitor/monitor.js";
import { CONFIG } from "../config.js";
import { normalizeConcurrency } from "../utils/concurrency.js";
import type { SiteAdapter } from "../adapters/adapter.js";

export interface WatchOptions {
  site?: string;
  interval?: string;
  table?: boolean;
  concurrency?: number;
}

export async function runWatch(options: WatchOptions): Promise<void> {
  const registeredAdapters = getAllAdapters();
  const adapters = options.site
    ? [getAdapter(options.site)].filter((adapter): adapter is SiteAdapter => adapter !== undefined)
    : registeredAdapters;

  if (adapters.length === 0) {
    console.error("No adapters available");
    return;
  }

  const intervalMs = options.interval
    ? parseInterval(options.interval)
    : CONFIG.monitor.defaultIntervalMs;

  await startMonitor(
    adapters.filter((a) => a !== undefined),
    {
      intervalMs,
      showTable: options.table ?? true,
      registeredSiteNames: registeredAdapters.map((adapter) => adapter.siteName),
      concurrency: options.site
        ? 1
        : normalizeConcurrency(options.concurrency, CONFIG.monitor.scanConcurrency),
    },
  );
}

function parseInterval(s: string): number {
  const match = s.match(/^(\d+)\s*(m|s|h)$/);
  if (!match) return CONFIG.monitor.defaultIntervalMs;
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return val * 1000;
    case "m": return val * 60 * 1000;
    case "h": return val * 60 * 60 * 1000;
    default: return val * 60 * 1000;
  }
}
