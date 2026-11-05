import test from "node:test";
import assert from "node:assert/strict";
import { BROWSER_RAFFLEX_SITES } from "../src/adapters/browser/browser-site-config.js";
import { CLICK12WIN_SITES } from "../src/adapters/click12win/click12win-site-config.js";
import { COMPETITION_ENGINE_SITES } from "../src/adapters/competitionengine/competitionengine-site-config.js";
import { HWD_SITES } from "../src/adapters/hwd/hwd-site-config.js";
import { HwdAdapter } from "../src/adapters/hwd/hwd-adapter.js";
import { REFFLE_SITES } from "../src/adapters/reffle/reffle-site-config.js";
import { SHOPIFY_SITES } from "../src/adapters/shopify/shopify-site-config.js";
import { STATIC_LIST_SITES } from "../src/adapters/static-list/static-list-site-config.js";
import { StaticListAdapter } from "../src/adapters/static-list/static-list-adapter.js";
import { WCLOTTERY_SITES } from "../src/adapters/wclottery/wclottery-site-config.js";
import { WCLotteryAdapter } from "../src/adapters/wclottery/wclottery-adapter.js";
import { ZAP_SITES } from "../src/adapters/zap/zap-site-config.js";
import { COMPWATCH_SITES } from "../src/adapters/compwatch/compwatch-site-config.js";
import { CompWatchAdapter } from "../src/adapters/compwatch/compwatch-adapter.js";
import { checkSiteRegistry, getAdapter, getAdapterNames, getRegisteredSites, registerAdapter } from "../src/adapters/registry.js";

interface DirectSiteConfig {
  siteName: string;
  baseUrl: string;
}

const directConfigs: DirectSiteConfig[] = [
  ...BROWSER_RAFFLEX_SITES,
  ...CLICK12WIN_SITES,
  ...COMPETITION_ENGINE_SITES,
  ...HWD_SITES,
  ...REFFLE_SITES,
  ...SHOPIFY_SITES,
  ...STATIC_LIST_SITES,
  ...WCLOTTERY_SITES,
  ...ZAP_SITES,
];

const oneOffDirectConfigs: DirectSiteConfig[] = [
  { siteName: "brickitcomps", baseUrl: "https://brickitcomps.co.uk" },
  { siteName: "click", baseUrl: "https://www.clickcompetitions.co.uk" },
];

test("runtime host integrity includes every custom adapter and rejects duplicate aliases", () => {
  assert.doesNotThrow(checkSiteRegistry);
  const sites = getRegisteredSites();
  assert.equal(sites.length, getAdapterNames().length);
  assert.ok(sites.every((site) => site.operatorHosts.length > 0));
  assert.equal(sites.find((site) => site.siteName === "vaultnine")?.operatorHosts[0], "vaultninecompetitions.co.uk");
  assert.throws(() => registerAdapter({ siteName: "duplicate-twojs", async fetchAll() { return []; } },
    "https://WWW.2JSCOMPETITIONS.COM.:443/another-path"), /Duplicate operator/);
  assert.equal(getAdapter("duplicate-twojs"), undefined, "failed registration must not change the registry");
  const existing = getAdapter("twojs");
  assert.throws(() => registerAdapter({ siteName: "twojs", async fetchAll() { return []; } },
    "https://unrelated.example"), /Conflicting operator/);
  assert.equal(getAdapter("twojs"), existing, "a reused key must not replace another operator");
  assert.doesNotThrow(checkSiteRegistry);
});

function operatorKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  const hostname = url.hostname.replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${hostname}${pathname}`;
}

test("one direct operator URL is not registered under multiple site keys", () => {
  const siteNamesByOperator = new Map<string, Set<string>>();
  for (const config of directConfigs) {
    const key = operatorKey(config.baseUrl);
    const siteNames = siteNamesByOperator.get(key) ?? new Set<string>();
    siteNames.add(config.siteName);
    siteNamesByOperator.set(key, siteNames);
  }

  const aliases = [...siteNamesByOperator]
    .filter(([, siteNames]) => siteNames.size > 1)
    .map(([operator, siteNames]) => `${operator}: ${[...siteNames].sort().join(", ")}`)
    .sort();

  assert.deepEqual(aliases, []);
});

test("every adapter configured to render pages runs in the browser lane", () => {
  const renderedAdapters = [
    ...HWD_SITES.filter((config) => config.requiresBrowser)
      .map((config) => new HwdAdapter(config)),
    ...WCLOTTERY_SITES.filter((config) => config.renderListPage)
      .map((config) => new WCLotteryAdapter(config)),
    ...STATIC_LIST_SITES.filter((config) => config.siteName === "puravidacompetitions")
      .map((config) => new StaticListAdapter(config)),
  ];

  assert.ok(renderedAdapters.length > 0);
  assert.deepEqual(
    renderedAdapters.map((adapter) => [adapter.siteName, adapter.scanCost]),
    renderedAdapters.map((adapter) => [adapter.siteName, "browser"]),
  );
});

test("operators with verified dead domains are not registered", () => {
  assert.equal(
    directConfigs.some((config) => config.siteName === "teetimeticket"),
    false,
  );
});

test("direct adapters override CompWatch fallbacks", () => {
  const directSiteNames = new Set(directConfigs.map((config) => config.siteName));
  for (const config of COMPWATCH_SITES) {
    if (!directSiteNames.has(config.siteName)) continue;
    assert.ok(getAdapter(config.siteName));
    assert.equal(
      getAdapter(config.siteName) instanceof CompWatchAdapter,
      false,
      `${config.siteName} is still using its CompWatch fallback`,
    );
  }
});

test("CompWatch fallbacks reuse the direct site key for the same operator", () => {
  const directSiteNameByOperator = new Map(
    [...directConfigs, ...oneOffDirectConfigs]
      .map((config) => [operatorKey(config.baseUrl), config.siteName]),
  );
  const aliases = COMPWATCH_SITES.flatMap((config) => {
    const directSiteName = directSiteNameByOperator.get(operatorKey(config.operatorUrl));
    return directSiteName && directSiteName !== config.siteName
      ? [`${config.operatorUrl}: ${config.siteName} -> ${directSiteName}`]
      : [];
  }).sort();

  assert.deepEqual(aliases, []);
});

test("Game Changing routes the requested DJI raffle through detail parsing", () => {
  const config = WCLOTTERY_SITES.find(
    (site) => site.siteName === "gamechanginggiveaways",
  );

  assert.ok(
    config?.extraDetailPaths?.includes(
      "/product/dji-air-3s-fly-more-combo-dji-rc-2-or-1100-cash-alt-06-09-2026/",
    ),
  );
});

test("static-list config omits the dead Redclaw adapter", () => {
  assert.equal(
    STATIC_LIST_SITES.some((config) => config.siteName === "redclaw"),
    false,
  );
});
