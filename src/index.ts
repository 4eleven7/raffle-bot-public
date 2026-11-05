#!/usr/bin/env node
import { Command } from "commander";
import { runScan } from "./cli/scan.js";
import { runList, runScenario, runHistory } from "./cli/list.js";
import { runWatch } from "./cli/watch.js";
import { runTrends } from "./cli/trends.js";
import { runReplayAlerts } from "./cli/replay-alerts.js";
import { runSites, runTriage, runSiteQueue } from "./cli/site-discovery.js";
import { runStatus } from "./cli/status.js";
import { runSources } from "./cli/sources.js";
import { runEntries, runRecordEntry, runRecordOutcome, runRecordSpend } from "./cli/outcomes.js";

const program = new Command();

program
  .name("raffle-bot")
  .description("Competition monitoring and one-shot raffle risk tool")
  .version("1.0.0");

program.command("sites [host]")
  .description("Check registry integrity and output operator identities as JSON")
  .option("--check", "Output a compact integrity summary instead of the full host index")
  .action(runSites);

program.command("status")
  .description("Show watcher health, useful coverage, alert decisions, live value candidates, and repair priorities")
  .option("--days <days>", "Decision reporting period, up to 90 days", "1")
  .option("--json", "Output the complete report as JSON")
  .action(runStatus);

program.command("sources")
  .description("Review source yield and identify temporary reductions in routine monitoring")
  .option("--json", "Output evidence for every registered source")
  .option("--write-policy <path>", "Write reviewed redundant marks to a configuration file; preserve other settings")
  .action(runSources);

program.command("entries")
  .description("Show recorded entries, actual spending, and settled returns")
  .option("--json", "Output as JSON")
  .action(runEntries);

program.command("record-entry <sourceId>")
  .description("Record actual total spend for one raffle and draw date; repeat to correct the total")
  .requiredOption("--site <site>", "Registered site key")
  .requiredOption("--spent <gbp>", "Actual total spend in GBP")
  .option("--draw-date <date>", "ISO draw date; defaults to the stored draw")
  .action(runRecordEntry);

program.command("record-spend <entryKey> <gbp>")
  .description("Set actual total spend for an entry recorded through Telegram or the CLI")
  .action(runRecordSpend);

program.command("record-outcome <entryKey>")
  .description("Record a settled result and actual cash received or realised sale proceeds")
  .requiredOption("--result <result>", "won or lost")
  .requiredOption("--received <gbp>", "Actual return in GBP; zero for a loss")
  .action(runRecordOutcome);

program.command("triage <file>")
  .description("Grade saved raffle JSON for current economics and optimistic discovery potential")
  .action(runTriage);

program.command("site-queue <file>")
  .description("Read due discovery or health rows from a candidate ledger file")
  .option("--health", "Select pending health repairs instead of discovery candidates")
  .action(runSiteQueue);

program
  .command("scan")
  .description("Scan competitions, calculate EV, and display ranked results")
  .option("-s, --site <name>", "Site to scan (default: all)")
  .option("--sort <key>", "Sort by: score, ev, price, closing, winprob, sold", "score")
  .option("--min-ev <value>", "Minimum EV per ticket to display", parseFloat)
  .option("-n, --limit <count>", "Max results to show", parseInt)
  .option("-c, --concurrency <count>", "Sites to scan in parallel", parseInt)
  .option("--json", "Output as JSON")
  .action(runScan);

program
  .command("list")
  .description("List stored competitions with filters")
  .option("-s, --site <name>", "Filter by site")
  .option("--sort <key>", "Sort by: score, ev, price, closing, winprob", "score")
  .option("--min-ev <value>", "Minimum EV filter", parseFloat)
  .option("--closing-within <time>", "e.g. 2h, 24h, 3d")
  .option("-n, --limit <count>", "Max results", parseInt)
  .action(runList);

program
  .command("watch")
  .description("Continuously monitor competitions and alert on risk-filtered raffles")
  .option("-s, --site <name>", "Site to watch")
  .option("-i, --interval <time>", "Scan interval e.g. 5m, 30s")
  .option("-c, --concurrency <count>", "Sites to scan in parallel", parseInt)
  .option("--no-table", "Hide the results table")
  .action(runWatch);

program
  .command("scenario <sourceId>")
  .description("Show EV scenarios for different ticket counts")
  .option("-t, --tickets <counts>", "Comma-separated ticket counts", "1,2,3,5,10,15,20,25,50")
  .option("-s, --site <name>", "Site name", "pristine")
  .action((sourceId: string, options: { tickets: string; site: string }) => {
    const counts = options.tickets.split(",").map(Number).filter((n) => n > 0);
    runScenario(sourceId, counts, options.site);
  });

program
  .command("history <sourceId>")
  .description("Show ticket sale history for a competition")
  .option("-s, --site <name>", "Site name", "pristine")
  .action((sourceId: string, options: { site: string }) => {
    runHistory(sourceId, options.site);
  });

program
  .command("replay-alerts")
  .description("Run the deterministic synthetic alert-decision harness")
  .option(
    "-f, --fixture <path>",
    "Synthetic replay dataset",
    "fixtures/alert-replay/synthetic.v1.json",
  )
  .option("--json", "Output the complete replay report as JSON")
  .action(runReplayAlerts);

program
  .command("trends")
  .description("Analyze ticket sale velocity and predict undersold competitions")
  .option("-s, --site <name>", "Filter by site")
  .option("--closing-within <time>", "Only show comps closing within e.g. 6h, 24h", "24h")
  .option("-n, --limit <count>", "Max results to show", parseInt, 20)
  .action(runTrends);

program.parse();
