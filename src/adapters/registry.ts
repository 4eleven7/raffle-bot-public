import type { SiteAdapter } from "./adapter.js";
import { ZapAdapter } from "./zap/zap-adapter.js";
import { ZAP_SITES } from "./zap/zap-site-config.js";
import { ShopifyAdapter } from "./shopify/shopify-adapter.js";
import { SHOPIFY_SITES } from "./shopify/shopify-site-config.js";
import { EliteAdapter } from "./elite/elite-adapter.js";
import { McKinneyAdapter } from "./mckinney/mckinney-adapter.js";
import { DreamCarAdapter } from "./dreamcar/dreamcar-adapter.js";
import { ClickAdapter } from "./click/click-adapter.js";
import { BearAdapter } from "./bear/bear-adapter.js";
import { HighPeakAdapter } from "./highpeak/highpeak-adapter.js";
import { TwdAdapter } from "./twd/twd-adapter.js";
import { HwdAdapter } from "./hwd/hwd-adapter.js";
import { HWD_SITES } from "./hwd/hwd-site-config.js";
import { WCLotteryAdapter } from "./wclottery/wclottery-adapter.js";
import { WCLOTTERY_SITES } from "./wclottery/wclottery-site-config.js";
import { HorsepowerAdapter } from "./horsepower/horsepower-adapter.js";
import { RaffleeAdapter } from "./rafflee/rafflee-adapter.js";
import { BrowserRafflexAdapter } from "./browser/browser-rafflex-adapter.js";
import { BROWSER_RAFFLEX_SITES } from "./browser/browser-site-config.js";
import { HotDrawAdapter } from "./hotdraw/hotdraw-adapter.js";
import { ReffleAdapter } from "./reffle/reffle-adapter.js";
import { REFFLE_SITES } from "./reffle/reffle-site-config.js";
import { StaticListAdapter } from "./static-list/static-list-adapter.js";
import { STATIC_LIST_SITES } from "./static-list/static-list-site-config.js";
import { CompWatchAdapter } from "./compwatch/compwatch-adapter.js";
import { COMPWATCH_SITES } from "./compwatch/compwatch-site-config.js";
import { TechDropAdapter } from "./techdrop/techdrop-adapter.js";
import { PremierPrizeAdapter } from "./premier/premier-adapter.js";
import { GoWinzoAdapter } from "./gowinzo/gowinzo-adapter.js";
import { PodiumPrizeAdapter } from "./podium/podium-adapter.js";
import { WolfAdapter } from "./wolf/wolf-adapter.js";
import { PtmAdapter } from "./ptm/ptm-adapter.js";
import { VannyCampersAdapter } from "./vanny/vanny-adapter.js";
import { InItToWinItAdapter } from "./inittowinit/inittowinit-adapter.js";
import { StealthAdapter } from "./stealth/stealth-adapter.js";
import { KarmaAdapter } from "./karma/karma-adapter.js";
import { NobleAdapter } from "./noble/noble-adapter.js";
import { GardenWorxAdapter } from "./gardenworx/gardenworx-adapter.js";
import { RaforteAdapter } from "./raforte/raforte-adapter.js";
import { CompetitionEngineAdapter } from "./competitionengine/competitionengine-adapter.js";
import { COMPETITION_ENGINE_SITES } from "./competitionengine/competitionengine-site-config.js";
import { CaCarsAdapter } from "./cacars/cacars-adapter.js";
import { MaxGiveawaysAdapter } from "./maxgiveaways/maxgiveaways-adapter.js";
import { RegalCompetitionsAdapter } from "./regal/regal-adapter.js";
import { WinWinkAdapter } from "./winwink/winwink-adapter.js";
import { CashGiveawayAdapter } from "./cashgiveaway/cashgiveaway-adapter.js";
import { TommyFrenchAdapter } from "./tommyfrench/tommyfrench-adapter.js";
import { WinnerStreakAdapter } from "./winnerstreak/winnerstreak-adapter.js";
import { Click12WinAdapter } from "./click12win/click12win-adapter.js";
import { CLICK12WIN_SITES } from "./click12win/click12win-site-config.js";
import { PhaseAdapter } from "./phase/phase-adapter.js";
import { RaffleRevolutionAdapter } from "./rafflerevolution/rafflerevolution-adapter.js";
import { GolfGearGiveawaysAdapter } from "./golfgear/golfgear-adapter.js";
import { StrikeBigDrawsAdapter } from "./strikebigdraws/strikebigdraws-adapter.js";
import { CentralCompetitionsAdapter } from "./central/central-adapter.js";
import { AlphaAdapter } from "./alpha/alpha-adapter.js";
import { WinMeAPrizeAdapter } from "./winmeaprize/winmeaprize-adapter.js";
import { PMCompetitionsAdapter } from "./pmcompetitions/pmcompetitions-adapter.js";
import { BrickitCompsAdapter } from "./brickitcomps/brickitcomps-adapter.js";
import { MentalMoneyAdapter } from "./mentalmoney/mentalmoney-adapter.js";
import { CulchieCompsAdapter } from "./culchiecomps/culchiecomps-adapter.js";
import { KingOfCompsAdapter } from "./kingofcomps/kingofcomps-adapter.js";
import { PrizleAdapter } from "./prizle/prizle-adapter.js";
import { GrailWatchAdapter } from "./grailwatch/grailwatch-adapter.js";
import { TixWinBrixAdapter } from "./tixwinbrix/tixwinbrix-adapter.js";
import { CalibreClubAdapter } from "./calibreclub/calibreclub-adapter.js";
import { BullpenAdapter } from "./bullpen/bullpen-adapter.js";
import { GloriousAdapter } from "./glorious/glorious-adapter.js";
import { LuxePrizesAdapter } from "./luxeprizes/luxeprizes-adapter.js";
import { JambalaAdapter } from "./jambala/jambala-adapter.js";
import { BullionCompsAdapter } from "./bullioncomps/bullioncomps-adapter.js";
import { NicheCompetitionsAdapter } from "./nichecompetitions/nichecompetitions-adapter.js";
import { WynzoAdapter } from "./wynzo/wynzo-adapter.js";
import { TopDrawAdapter } from "./topdraw/topdraw-adapter.js";
import { EnduroTicketsAdapter } from "./endurotickets/endurotickets-adapter.js";
import { GoldenDreamDrawAdapter } from "./goldendreamdraw/goldendreamdraw-adapter.js";
import { AurumCompetitionsAdapter } from "./aurum/aurum-adapter.js";
import { NerdCompetitionsAdapter } from "./nerd/nerd-adapter.js";
import { WeeklyWinAdapter } from "./weeklywin/weeklywin-adapter.js";
import { LexeraAdapter } from "./lexera/lexera-adapter.js";
import { RoyalWinAdapter } from "./royalwin/royalwin-adapter.js";
import { OddsUpAdapter } from "./oddsup/oddsup-adapter.js";
import { AshleyAutomotiveAdapter } from "./ashley/ashley-adapter.js";
import { DiamondDrawsAdapter } from "./diamond/diamond-adapter.js";
import { LowCostAdapter } from "./lowcost/lowcost-adapter.js";
import { LuxeroAdapter } from "./luxero/luxero-adapter.js";
import { MatrixAdapter } from "./matrix/matrix-adapter.js";
import { TGCompsAdapter } from "./tgcomps/tgcomps-adapter.js";
import { SovereignDrawAdapter } from "./shopify/sovereign-adapter.js";
import { CompetiownAdapter } from "./competiown/competiown-adapter.js";
import { FlatOutAdapter } from "./flatout/flatout-adapter.js";
import { AllForGiveawaysAdapter } from "./allforgiveaways/allforgiveaways-adapter.js";
import { QuidsInCompsAdapter } from "./quidsincomps/quidsincomps-adapter.js";
import { LuckyNumberPinkAdapter } from "./luckynumberpink/luckynumberpink-adapter.js";
import { StormDjsAdapter } from "./stormdjs/stormdjs-adapter.js";
import { VaultNineAdapter } from "./vaultnine/vaultnine-adapter.js";
import { EmpireCompetitionsUkAdapter } from "./empirecompetitionsuk/empirecompetitionsuk-adapter.js";
import { WinTheMomentAdapter } from "./winthemoment/winthemoment-adapter.js";
import { WaypointWinsAdapter } from "./waypointwins/waypointwins-adapter.js";
import { CashGrabAdapter } from "./cashgrab/cashgrab-adapter.js";
import {
  CrownEagleAdapter,
  DIRECT_DETAIL_SITES,
  DirectDetailAdapter,
  SixForGoldAdapter,
} from "./direct/direct-adapter.js";

const adapters: Map<string, SiteAdapter> = new Map();
const operatorHosts = new Map<string, Set<string>>();
const operatorOwners = new Map<string, string>();

export function normalizeOperatorHost(value: string): string {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error(`Invalid operator URL: ${value}`);
  }
  return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

export function registerAdapter(adapter: SiteAdapter, operatorUrls: string | string[]): void {
  const previousHosts = operatorHosts.get(adapter.siteName);
  const incomingHosts = (typeof operatorUrls === "string" ? [operatorUrls] : operatorUrls).map(normalizeOperatorHost);
  if (previousHosts && !incomingHosts.some((host) => previousHosts.has(host))) {
    throw new Error(`Conflicting operator for existing site key: ${adapter.siteName}`);
  }
  const hosts = new Set([...(previousHosts ?? []), ...incomingHosts]);
  if (hosts.size === 0) throw new Error(`Missing operator host: ${adapter.siteName}`);
  for (const host of hosts) {
    const owner = operatorOwners.get(host);
    if (owner && owner !== adapter.siteName) {
      throw new Error(`Duplicate operator ${host}: ${owner}, ${adapter.siteName}`);
    }
  }
  for (const host of hosts) operatorOwners.set(host, adapter.siteName);
  operatorHosts.set(adapter.siteName, hosts);
  adapters.set(adapter.siteName, adapter);
}

/** Complete runtime identity, including custom adapters and overwritten fallback aliases. */
export function getRegisteredSites() {
  return getAllAdapters().map((adapter) => ({
    siteName: adapter.siteName,
    operatorHosts: [...operatorHosts.get(adapter.siteName)!].sort(),
    adapter: adapter.constructor.name,
    source: adapter instanceof CompWatchAdapter ? "compwatch" : "direct",
    scanCost: adapter.scanCost ?? "normal",
  }));
}

export function checkSiteRegistry(): void {
  const owners = new Map<string, string>();
  for (const site of getRegisteredSites()) {
    for (const host of site.operatorHosts) {
      const owner = owners.get(host);
      if (owner && owner !== site.siteName) {
        throw new Error(`Duplicate operator ${host}: ${owner}, ${site.siteName}`);
      }
      owners.set(host, site.siteName);
    }
  }
}

export function getAdapter(name: string): SiteAdapter | undefined {
  return adapters.get(name);
}

export function getAllAdapters(): SiteAdapter[] {
  return Array.from(adapters.values());
}

export function getAdapterNames(): string[] {
  return Array.from(adapters.keys());
}

// CompWatch is explicit fallback support. Every direct adapter below
// overwrites the same site key when it exists.
for (const config of COMPWATCH_SITES) {
  registerAdapter(new CompWatchAdapter(config), config.operatorUrl);
}

// Register all adapters
for (const config of ZAP_SITES) {
  registerAdapter(new ZapAdapter(config), config.baseUrl);
}
for (const config of SHOPIFY_SITES) {
  registerAdapter(new ShopifyAdapter(config), config.operatorUrls ?? config.baseUrl);
}
registerAdapter(new EliteAdapter(), "https://elitecompetitions.co.uk");
registerAdapter(new McKinneyAdapter(), "https://mckinneycompetitions.com");
registerAdapter(new DreamCarAdapter(), "https://dreamcargiveaways.co.uk");
registerAdapter(new ClickAdapter(), "https://www.clickcompetitions.co.uk");
registerAdapter(new BearAdapter(), "https://bearcompetitions.com");
registerAdapter(new HighPeakAdapter(), "https://highpeakcomps.co.uk");
registerAdapter(new TwdAdapter(), "https://twdcompetitions.com");
for (const config of HWD_SITES) {
  registerAdapter(new HwdAdapter(config), config.baseUrl);
}
for (const config of WCLOTTERY_SITES) {
  registerAdapter(new WCLotteryAdapter(config), config.baseUrl);
}
registerAdapter(new HorsepowerAdapter(), "https://horsepowercomps.co.uk");
registerAdapter(new RaffleeAdapter(), "https://rafflee.co.uk");
for (const config of REFFLE_SITES) {
  registerAdapter(new ReffleAdapter(config), config.baseUrl);
}
for (const config of BROWSER_RAFFLEX_SITES) {
  registerAdapter(new BrowserRafflexAdapter(config), config.baseUrl);
}
registerAdapter(new HotDrawAdapter(), "https://www.hotdraw.co.uk");
for (const config of STATIC_LIST_SITES) {
  registerAdapter(new StaticListAdapter(config), config.baseUrl);
}
for (const config of COMPETITION_ENGINE_SITES) {
  registerAdapter(new CompetitionEngineAdapter(config), config.baseUrl);
}
for (const config of DIRECT_DETAIL_SITES) {
  registerAdapter(new DirectDetailAdapter(config), config.baseUrl);
}
registerAdapter(new CrownEagleAdapter(), "https://www.cecompetitions.co.uk");
registerAdapter(new SixForGoldAdapter(), "https://6forgold.co.uk");
registerAdapter(new TechDropAdapter(), "https://tech-drop.com");
registerAdapter(new PremierPrizeAdapter(), "https://premierprizecompetitions.co.uk");
registerAdapter(new GoWinzoAdapter(), "https://gowinzo.uk");
registerAdapter(new PodiumPrizeAdapter(), "https://podiumprize.co.uk");
registerAdapter(new WolfAdapter(), "https://wolfcompetitions.co.uk");
registerAdapter(new PtmAdapter(), "https://ptmprizes.co.uk");
registerAdapter(new VannyCampersAdapter(), "https://vannycampers.co.uk");
registerAdapter(new InItToWinItAdapter(), "https://www.inittowinitcompetitions.co.uk");
registerAdapter(new StealthAdapter(), "https://stealthcompetitions.co.uk");
registerAdapter(new KarmaAdapter(), "https://karmacompetitions.co.uk");
registerAdapter(new NobleAdapter(), "https://noblewins.co.uk");
registerAdapter(new GardenWorxAdapter(), "https://gardenworx.co.uk");
registerAdapter(new RaforteAdapter(), "https://raforte.com");
registerAdapter(new CaCarsAdapter(), "https://competition-cacars.dotnetcloud.co.uk");
registerAdapter(new MaxGiveawaysAdapter(), "https://maxgiveaways.co.uk");
registerAdapter(new RegalCompetitionsAdapter(), "https://www.regalcompetitions.com");
registerAdapter(new WinWinkAdapter(), "https://winwink.co.uk");
registerAdapter(new CashGiveawayAdapter(), "https://www.cashgiveaway.co.uk");
registerAdapter(new TommyFrenchAdapter(), "https://www.tommyfrenchcompetitions.com");
registerAdapter(new WinnerStreakAdapter(), "https://www.thewinnerstreak.com");
for (const config of CLICK12WIN_SITES) {
  registerAdapter(new Click12WinAdapter(config), config.baseUrl);
}
registerAdapter(new PhaseAdapter(), "https://phasecompetitions.co.uk");
registerAdapter(new RaffleRevolutionAdapter(), "https://rafflerevolution.com");
registerAdapter(new GolfGearGiveawaysAdapter(), "https://golfgeargiveaways.co.uk");
registerAdapter(new StrikeBigDrawsAdapter(), "https://strikebigdraws.com");
registerAdapter(new CentralCompetitionsAdapter(), "https://www.centralcompetitions.co.uk");
registerAdapter(new AlphaAdapter(), "https://alphacomps.uk");
registerAdapter(new WinMeAPrizeAdapter(), "https://winmeaprize.com");
registerAdapter(new PMCompetitionsAdapter(), "https://pmcompetitions.co.uk");
registerAdapter(new BrickitCompsAdapter(), "https://brickitcomps.co.uk");
registerAdapter(new MentalMoneyAdapter(), "https://www.mentalmoney.com");
registerAdapter(new CulchieCompsAdapter(), "https://culchiecomps.com");
registerAdapter(new KingOfCompsAdapter(), "https://kingofcomps.co.uk");
registerAdapter(new PrizleAdapter(), "https://prizle.co.uk");
registerAdapter(new GrailWatchAdapter(), "https://www.grailwatchclub.com");
registerAdapter(new TixWinBrixAdapter(), "https://tixwinbrix.co.uk");
registerAdapter(new CalibreClubAdapter(), "https://thecalibreclub.com");
registerAdapter(new BullpenAdapter(), "https://bullpencompetitions.com");
registerAdapter(new GloriousAdapter(), "https://www.glorious.co.uk");
registerAdapter(new LuxePrizesAdapter(), "https://www.luxeprizes.co.uk");
registerAdapter(new JambalaAdapter(), "https://www.jambala.co.uk");
registerAdapter(new BullionCompsAdapter(), "https://mintgold.co.uk");
registerAdapter(new NicheCompetitionsAdapter(), "https://www.nichecompetitions.com");
registerAdapter(new WynzoAdapter(), "https://wynzo.co.uk");
registerAdapter(new TopDrawAdapter(), "https://topdrawcompetitions.co.uk");
registerAdapter(new EnduroTicketsAdapter(), "https://endurotickets.com");
registerAdapter(new GoldenDreamDrawAdapter(), "https://goldendreamdraw.uk");
registerAdapter(new AurumCompetitionsAdapter(), "https://aurumcomps.uk");
registerAdapter(new NerdCompetitionsAdapter(), "https://nerdcompetitions.co.uk");
registerAdapter(new WeeklyWinAdapter(), "https://www.theweeklywin.co.uk");
registerAdapter(new LexeraAdapter(), "https://www.lexera.co.uk");
registerAdapter(new RoyalWinAdapter(), "https://royalwin.co.uk");
registerAdapter(new OddsUpAdapter(), "https://www.oddsup.co.uk");
registerAdapter(new AshleyAutomotiveAdapter(), "https://www.ashleyautomotivecomps.co.uk");
registerAdapter(new DiamondDrawsAdapter(), "https://diamonddraws.com");
registerAdapter(new LowCostAdapter(), "https://lowcostcompetitions.co.uk");
registerAdapter(new LuxeroAdapter(), "https://www.luxero.win");
registerAdapter(new MatrixAdapter(), "https://matrixcompetitions.co.uk");
registerAdapter(new TGCompsAdapter(), "https://tgcomps.com");
registerAdapter(new SovereignDrawAdapter(), "https://thesovereigndraw.co.uk");
registerAdapter(new CompetiownAdapter(), "https://competiown.co.uk");
registerAdapter(new FlatOutAdapter(), "https://flatoutcompetitions.co.uk");
registerAdapter(new AllForGiveawaysAdapter(), "https://www.allforgiveaways.com");
registerAdapter(new QuidsInCompsAdapter(), "https://quidsincomps.com");
registerAdapter(new LuckyNumberPinkAdapter(), "https://www.luckynumberpink.co.uk");
registerAdapter(new StormDjsAdapter(), "https://www.storm-djs.com/giveaways");
registerAdapter(new VaultNineAdapter(), "https://vaultninecompetitions.co.uk");
registerAdapter(new EmpireCompetitionsUkAdapter(), "https://empirecompetitionsuk.com");
registerAdapter(new WinTheMomentAdapter(), "https://winthemoment.co.uk");
registerAdapter(new WaypointWinsAdapter(), "https://waypointwins.co.uk");
registerAdapter(new CashGrabAdapter(), "https://cashgrabcompetitions.co.uk");
