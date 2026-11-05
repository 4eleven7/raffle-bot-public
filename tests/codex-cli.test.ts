import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodexJson, startCodexThread } from "../src/codex-cli.js";

test("Codex CLI runner uses ChatGPT auth, read-only mode, stdin, and an output schema", async () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-codex-"));
  const command = join(directory, "codex");
  const argsPath = join(directory, "args.txt");
  const promptPath = join(directory, "prompt.txt");
  const schemaPath = join(directory, "schema.json");
  writeFileSync(schemaPath, JSON.stringify({ type: "object" }));
  writeFileSync(command, `#!/bin/zsh
print -l -- "$@" > ${JSON.stringify(argsPath)}
cat > ${JSON.stringify(promptPath)}
[[ -z "\${OPENAI_API_KEY:-}" ]] || exit 64
[[ -z "\${TELEGRAM_BOT_TOKEN:-}" ]] || exit 65
print -r -- '{"ok":true}'
`);
  chmodSync(command, 0o755);

  const previousKey = process.env.OPENAI_API_KEY;
  const previousTelegram = process.env.TELEGRAM_BOT_TOKEN;
  process.env.OPENAI_API_KEY = "must-not-reach-codex";
  process.env.TELEGRAM_BOT_TOKEN = "must-not-reach-codex";
  try {
    const output = await runCodexJson("review this", schemaPath, 2_000, { command });
    assert.deepEqual(output, { ok: true });
    assert.equal(readFileSync(promptPath, "utf8"), "review this");
    const args = readFileSync(argsPath, "utf8").trim().split("\n");
    assert.deepEqual(args.slice(0, 2), ["exec", "--ephemeral"]);
    assert.ok(args.includes("--ignore-user-config"));
    assert.ok(args.includes("--ignore-rules"));
    assert.ok(args.includes("hooks"));
    assert.ok(args.includes("plugins"));
    assert.ok(args.includes("read-only"));
    assert.ok(args.includes("--output-schema"));
    assert.ok(args.includes(schemaPath));
    assert.equal(args.at(-1), "-");
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousTelegram === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousTelegram;
  }
});

test("Codex CLI runner stops a timed-out process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-codex-timeout-"));
  const command = join(directory, "codex");
  const schemaPath = join(directory, "schema.json");
  writeFileSync(schemaPath, JSON.stringify({ type: "object" }));
  writeFileSync(command, "#!/bin/zsh\nsleep 5\n");
  chmodSync(command, 0o755);

  await assert.rejects(
    runCodexJson("review this", schemaPath, 50, { command }),
    /timed out/i,
  );
});

test("Codex CLI runner caps concurrent processes at two", async () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-codex-concurrency-"));
  const command = join(directory, "codex");
  const eventsPath = join(directory, "events.txt");
  const schemaPath = join(directory, "schema.json");
  writeFileSync(schemaPath, JSON.stringify({ type: "object" }));
  writeFileSync(command, `#!/bin/zsh
print start >> ${JSON.stringify(eventsPath)}
sleep 0.2
print end >> ${JSON.stringify(eventsPath)}
print -r -- '{"ok":true}'
`);
  chmodSync(command, 0o755);

  await Promise.all([
    runCodexJson("one", schemaPath, 2_000, { command }),
    runCodexJson("two", schemaPath, 2_000, { command }),
    runCodexJson("three", schemaPath, 2_000, { command }),
  ]);

  const events = readFileSync(eventsPath, "utf8").trim().split("\n");
  assert.deepEqual(events.slice(0, 2), ["start", "start"]);
  assert.ok(events.indexOf("end") < events.lastIndexOf("start"));
});

test("Codex CLI starts a persistent read-only thread without leaking bot credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "raffle-codex-thread-"));
  const command = join(directory, "codex");
  const argsPath = join(directory, "args.txt");
  const promptPath = join(directory, "prompt.txt");
  const logPath = join(directory, "thread.log");
  writeFileSync(command, `#!/bin/zsh
print -l -- "$@" > ${JSON.stringify(argsPath)}
cat > ${JSON.stringify(promptPath)}
[[ -z "\${TELEGRAM_BOT_TOKEN:-}" ]] || exit 65
print -r -- '{"type":"thread.started","thread_id":"thread-123"}'
`);
  chmodSync(command, 0o755);

  const previousTelegram = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "must-not-reach-codex";
  try {
    const launch = await startCodexThread("check this hostile $(raffle)", {
      command,
      cwd: directory,
      logPath,
    });
    assert.equal((await launch.done).code, 0);
    assert.equal(readFileSync(promptPath, "utf8"), "check this hostile $(raffle)");
    const args = readFileSync(argsPath, "utf8").trim().split("\n");
    assert.deepEqual(args.slice(0, 2), ["--search", "exec"]);
    assert.ok(args.includes("--json"));
    assert.ok(args.includes("read-only"));
    assert.ok(args.includes("-C"));
    assert.ok(args.includes(directory));
    assert.ok(!args.includes("--ephemeral"));
    assert.equal(args.at(-1), "-");
    assert.match(readFileSync(logPath, "utf8"), /thread-123/);
  } finally {
    if (previousTelegram === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = previousTelegram;
  }
});
