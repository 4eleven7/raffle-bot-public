import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseAlertReplayDataset,
  runAlertReplayDataset,
} from "../alerts/replay.js";

export interface ReplayAlertsOptions {
  fixture?: string;
  json?: boolean;
}

export async function runReplayAlerts(
  options: ReplayAlertsOptions,
): Promise<void> {
  const fixturePath = options.fixture ?? join(
    process.cwd(),
    "fixtures",
    "alert-replay",
    "synthetic.v1.json",
  );
  const dataset = parseAlertReplayDataset(readFileSync(fixturePath, "utf8"));
  const report = await runAlertReplayDataset(dataset);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Alert replay: ${report.passed}/${report.total} scenarios passed (${report.failed} failed)`,
    );
    const policyResults = report.results.filter((result) =>
      result.kind !== "classification_probe"
    );
    const probes = report.results.filter((result) =>
      result.kind === "classification_probe"
    );
    console.log(
      `Policy/regression cases: ${policyResults.filter((result) => result.passed).length}/${policyResults.length} · ` +
      `classification probes: ${probes.filter((result) => result.passed).length}/${probes.length}`,
    );
    for (const result of report.results) {
      const marker = result.passed ? "PASS" : "FAIL";
      console.log(
        `${marker} [${result.kind}] ${result.id}: ${result.classification} · ${result.outcome} · ` +
        `${result.timing.timeToCloseMs}ms to close`,
      );
      for (const failure of result.failures) {
        console.log(`  ${failure}`);
      }
    }
    console.log(
      Object.entries(report.classifications)
        .map(([classification, count]) => `${classification}=${count}`)
        .join(" · "),
    );
  }
  if (report.failed > 0) process.exitCode = 1;
}
