# Raffle Bot

**This project is no longer maintained.** You can fork it, but issues and pull requests will get no reply.

Raffle Bot watches UK prize-raffle websites. It records each raffle's price, tickets sold, total tickets and close date. It then works out the chance of a win and the expected return. It can send a Telegram alert when a raffle passes your limits.

It only reads public pages and public APIs. It does not buy tickets or log in to any site.

## What you need

- macOS. Linux should work, but it is not tested.
- Node 24 (`.node-version` has the exact version)
- Chromium from Playwright, for the sites that need a browser
- Optional: a Telegram bot, for alerts
- Optional: the Codex CLI, for prize valuation and alert review

## Set up

```bash
git clone <repository-url> raffle-bot
cd raffle-bot
npm ci
npx playwright install chromium
cp .env.example .env
cp raffle-bot.config.example.json raffle-bot.config.json
```

Edit `.env`. You can leave every value empty for a first run. `.env.example` explains each value.

Six sites need a public Supabase key. Each of these sites publishes its key in its own web client. Without the key, the bot reports that site as failed and scans the others.

`raffle-bot.config.json` holds the limits: maximum spend, minimum win chance, minimum return, and scan timing.

## Run

Scan one site and show the ranked results:

```bash
npm run scan -- --site hikguru
```

Scan every site once:

```bash
npm run scan
```

Keep watching and send alerts:

```bash
npm run watch
```

Show the stored raffles, or see every command:

```bash
npm run list
npm run dev -- --help
```

The database, logs and review files go in `data/`. Git ignores that folder and `.env`.

## Check

```bash
npm test
npm run typecheck
npm run replay:alerts
```

The tests use no network. `replay:alerts` runs saved synthetic cases through the alert rules.

## Add a site

Each site has a config entry or a small adapter in `src/adapters/`. `src/adapters/registry.ts` lists them all. To check whether a host is already supported:

```bash
npm run dev -- sites example.co.uk
```

A site is useful only if it publishes the price, the exact sold and total ticket counts, and the close date. The bot does not guess these values.

## Codex automations

Two daily [Codex](https://github.com/openai/codex) tasks kept the bot useful. One reviews past alerts and fixes proven faults. The other finds new sites. Both are optional and need the `codex` command, logged in.

They share one ledger, `data/site-ledger.md`. It is a Markdown table with at least these columns:

```markdown
| operator_host | decision | recheck_on |
| --- | --- | --- |
| example.co.uk | defer | 2027-01-15 |
```

Decisions are `add-direct`, `add-direct-parser-fix`, `add-custom`, `add-compwatch-fallback`, `health-debug-first`, `defer`, `complete`, `duplicate` and `reject`. `npm run dev -- site-queue data/site-ledger.md` lists the rows that are due. Add `--health` to list the repairs that are due.

Save each prompt below as a file outside the repository. Then schedule it, for example with cron. Both tasks need network access to read live sites, and the discovery task also needs web search:

```bash
30 6 * * * cd /path/to/raffle-bot && codex exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true - < /path/to/review-alerts.md
30 9 * * * cd /path/to/raffle-bot && codex --search exec --sandbox workspace-write -c sandbox_workspace_write.network_access=true - < /path/to/find-new-sites.md
```

These tasks edit the code, so review their changes. Run only one at a time.

### Review raffle alerts

```text
Review raffle-bot as a real-world evaluation loop. Add confirmed cases to its replay harness, and make narrow fixes that the evidence supports. The production database is read-only for this task. Do not discard unrelated changes.

Review each completed daily JSONL file that has not been reviewed, in data/alert-reviews, data/raffle-observations, data/site-health-reviews and data/telegram-feedback. Keep a separate last-reviewed date for each feed in data/review-notes.md. Never treat the current day as complete. Report exact row and parse-failure counts.

First run: npm run --silent replay:alerts. Policy and regression cases are the quality gate. Classification probes are evaluator coverage, not production defects.

Alert decisions: report candidates, suppressions by exact reason, reviewer results, Telegram results and every sent item. An approved alert that failed to send is a missed alert. Call a suppression wrong only when independent evidence proves it, not because the numbers look good. Join alerts to close observations by evaluationId and canonicalUrl. A row with decisionCoverageExpected=true and no final decision is a coverage gap.

Close times and sites: report per-site draw-date drift, raffles still visible after their close, and raffles sold out early. One missing row does not prove a closure or a parser fault. Require repeated successful scans or an exact live page, and ignore partial or failed scans. Prefer parser fixes to per-site time offsets.

Telegram feedback: deduplicate by updateId and join each event to its sent raffle. "entered" is positive evidence. "other" is ambiguous, and one such event cannot justify a change. "removed" is neutral.

Site health: report incidents, reminders and recoveries, and check the current state in the database, read-only. Do not call a site broken from one transient error. A site failure sent to Telegram is a defect, because Telegram is for opportunities only.

Repairs: run npm run dev -- site-queue data/site-ledger.md --health. Handle at most five due sites or 30 minutes. Check the live source first. Mark a row complete only after a verified repair, or when current evidence disproves the fault. Otherwise record the exact blocker and a new recheck date. Test scans must use a temporary database (RAFFLE_BOT_DB_PATH).

For each confirmed fault:
1. Add the smallest synthetic case to fixtures/alert-replay/synthetic.v1.json, or a focused failing test. Use no tokens, chat ids, user ids or personal data.
2. See it fail, then make the smallest fix. Do not weaken a safety gate to pass a test.
3. Run the focused test, npm run --silent replay:alerts, npm test, npm run build and git diff --check.
4. If a check fails, fix the failure or revert only your own change. If no change is justified, say so.

Never change a broad alert threshold from one event. Require repeated evidence from completed days or a clear correctness fault.

Write the full report to data/reports/<YYYY-MM-DD>.md and finish with a short summary of coverage, replay result, sent and missed alerts, close-time accuracy, feedback, site health, fixes and open doubts.
```

### Find new sites

```text
Add the highest-potential new UK raffle sites to raffle-bot. There is no quota. Do not discard unrelated changes. The ledger is data/site-ledger.md, and you update its rows in place.

A site is supported only if a public page or API gives the URL and prize name, the entry price, the exact sold or remaining count, the exact total tickets, and the close or draw date. A rounded percentage, a guess, an LLM result or a per-user limit is not a ticket count. Prize value may be estimated, but a valuation must never supply price, ticket counts or dates.

Every run:
1. Run npm run dev -- sites --check. Before you inspect a candidate, run npm run dev -- sites <host> and check its aliases. If the host is registered, use its existing site key and record any fault as a repair for the alert review task. Do not add a second spelling.
2. Run npm run dev -- site-queue data/site-ledger.md. Spend at most 20 minutes or 10 inspections on due rows.
3. Search the web broadly: raffle directories, social adverts, prize types and platform footprints. Stop after two empty batches, 50 inspections or 75 minutes, and keep 15 minutes for checks.
4. Before you decide to add a site, save its raffles as JSON and run npm run dev -- triage <file>. Old ledger scores cannot authorise new work. "Potential" assumes no more sales, so it must never replace live grading or invent sales history.
5. Use the smallest path that works: an existing adapter config, then a small parser fallback, then a browser adapter, then a public detail page or API, then extra detail paths, then a small custom adapter. Register the site in src/adapters/registry.ts and add a test.
6. Run npm test, npm run typecheck and npm run --silent replay:alerts on the final batch. Use a temporary database for test scans (RAFFLE_BOT_DB_PATH).
7. Mark each verified addition complete with its site key and clear recheck_on. Give duplicates and rejects no recheck date. Leave unprocessed rows unchanged.

Report additions, recheck outcomes, repairs passed on, deferrals and failed checks.
```

## Before you use it

Site layouts change, so some adapters will fail over time. Check each site's terms before you scan it. The expected return is an estimate, and raffles are a form of gambling. Do not spend money you cannot lose.

## Licence

MIT. See `LICENSE`.
