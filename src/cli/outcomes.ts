import { getCompetition } from "../storage/database.js";
import { canonicalCompetitionUrl } from "../alerts/canonical-url.js";
import { makeOpportunityAlertKey } from "../alerts/telegram.js";
import { getEntryResults, recordActualEntry, recordActualOutcome, recordActualSpend } from "../storage/outcomes.js";

export function runRecordEntry(sourceId: string, options: {site: string; spent: string; drawDate?: string}) {
  const comp = getCompetition(sourceId, options.site);
  if (!comp) throw new Error("Competition not found; use record-spend with a key from entries for an existing entry");
  const drawDate = options.drawDate ?? comp.drawDate;
  if (!drawDate || !Number.isFinite(Date.parse(drawDate))) throw new Error("An exact draw date is required");
  const entryKey = makeOpportunityAlertKey({...comp, drawDate});
  recordActualEntry({entryKey, canonicalUrl: canonicalCompetitionUrl(comp.url), siteName: comp.siteName, sourceId, raffleName: comp.name}, Number(options.spent));
  console.log(`Recorded actual spend for ${entryKey}`);
}

export function runRecordSpend(entryKey: string, amount: string) {
  recordActualSpend(entryKey, Number(amount));
  console.log(`Recorded actual spend for ${entryKey}`);
}

export function runRecordOutcome(entryKey: string, options: {result: string; received: string}) {
  if (options.result !== "won" && options.result !== "lost") throw new Error("Result must be won or lost");
  recordActualOutcome(entryKey, options.result, Number(options.received));
  console.log(`Recorded ${options.result} and actual return for ${entryKey}`);
}

export function runEntries(options: {json?: boolean}) {
  const report = getEntryResults();
  if (options.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log(`Entries: ${report.totals.entries}; won ${report.totals.won}; lost ${report.totals.lost}; pending ${report.totals.pending}`);
  console.log(`Known spend £${report.totals.knownSpend.toFixed(2)}; missing spend on ${report.totals.missingSpend} entries`);
  console.log(`Fully recorded settled entries: ${report.totals.fullyRecordedSettledEntries}; realised net £${report.totals.realisedNet.toFixed(2)}`);
  for (const e of report.entries) console.log(`${e.entry_key} | ${e.raffle_name} | ${e.outcome} | spent ${e.spent ?? "unknown"} | received ${e.received ?? "unknown"}`);
}
