import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, join } from "node:path";

const activeProcessGroups = new Set<number>();
let shutdownHooksInstalled = false;
let activeCodexProcesses = 0;
const codexWaiters: Array<() => void> = [];

export type CodexJsonRunner = (
  prompt: string,
  schemaPath: string,
  timeoutMs: number,
) => Promise<unknown>;

export interface CodexThreadLaunch {
  pid: number;
  logPath: string;
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export async function startCodexThread(
  prompt: string,
  options: { command?: string; cwd?: string; logPath?: string } = {},
): Promise<CodexThreadLaunch> {
  if (!prompt.trim()) throw new Error("Codex thread prompt is required");
  const command = options.command ?? process.env.RAFFLE_BOT_CODEX_COMMAND ?? "codex";
  const cwd = options.cwd ?? process.cwd();
  const logPath = options.logPath ?? join(cwd, "data", "codex-site-fixes.log");
  const args = [
    "--search",
    "exec",
    "--json",
    "--ignore-user-config",
    "--ignore-rules",
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "--disable",
    "skill_search",
    "--disable",
    "multi_agent",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-C",
    cwd,
    "-",
  ];

  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(command, args, {
      cwd,
      env: chatGptEnvironment(),
      detached: true,
      stdio: ["pipe", logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }

  const started = new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => child.once("close", (code, signal) => resolve({ code, signal })),
  );
  child.stdin?.on("error", () => {});
  child.stdin?.end(prompt);
  await started;
  child.unref();
  return { pid: child.pid!, logPath, done };
}

export async function runCodexJson(
  prompt: string,
  schemaPath: string,
  timeoutMs: number,
  options: { command?: string } = {},
): Promise<unknown> {
  const totalTimeoutMs = timeoutMs * 2;
  const deadline = Date.now() + totalTimeoutMs;
  const release = await acquireCodexSlot(totalTimeoutMs);
  try {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`Codex CLI timed out after ${totalTimeoutMs}ms`);
    return await runCodexJsonNow(prompt, schemaPath, Math.min(timeoutMs, remainingMs), options);
  } finally {
    release();
  }
}

async function runCodexJsonNow(
  prompt: string,
  schemaPath: string,
  timeoutMs: number,
  options: { command?: string },
): Promise<unknown> {
  const command = options.command ?? process.env.RAFFLE_BOT_CODEX_COMMAND ?? "codex";
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--disable",
    "hooks",
    "--disable",
    "plugins",
    "--disable",
    "skill_search",
    "--disable",
    "multi_agent",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--color",
    "never",
    "-C",
    "/tmp",
    "--output-schema",
    schemaPath,
    "-",
  ];

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: "/tmp",
      env: chatGptEnvironment(),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    if (child.pid !== undefined) {
      activeProcessGroups.add(child.pid);
      installShutdownHooks();
    }

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(stdout);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child.pid);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.stdin.on("error", () => {});
    child.once("error", (error) => finish(new Error(`Codex CLI failed: ${error.message}`)));
    child.once("close", (code, signal) => {
      if (child.pid !== undefined) activeProcessGroups.delete(child.pid);
      if (timedOut) {
        finish(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        const detail = stderr.trim().slice(-500);
        finish(new Error(`Codex CLI exited with ${code ?? signal}${detail ? `: ${detail}` : ""}`));
        return;
      }
      finish();
    });
    child.stdin.end(prompt);
  });

  try {
    return JSON.parse(output.trim()) as unknown;
  } catch {
    throw new Error("Codex CLI returned malformed JSON");
  }
}

async function acquireCodexSlot(timeoutMs: number): Promise<() => void> {
  if (activeCodexProcesses >= 2) {
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        const index = codexWaiters.indexOf(resume);
        if (index >= 0) codexWaiters.splice(index, 1);
        reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      codexWaiters.push(resume);
    });
  }
  activeCodexProcesses++;
  return () => {
    activeCodexProcesses--;
    codexWaiters.shift()?.();
  };
}

function chatGptEnvironment(): NodeJS.ProcessEnv {
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is required for Codex ChatGPT login");
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    CODEX_HOME: process.env.CODEX_HOME ?? join(home, ".codex"),
    PATH: process.env.PATH,
  };
  for (const key of ["TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "NO_COLOR"] as const) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const killActive = () => {
    for (const pid of activeProcessGroups) killProcessGroup(pid);
    activeProcessGroups.clear();
  };
  process.on("exit", killActive);
  installSignalHook("SIGINT", 130, killActive);
  installSignalHook("SIGTERM", 143, killActive);
}

function installSignalHook(
  signal: NodeJS.Signals,
  exitCode: number,
  killActive: () => void,
): void {
  const exitsElsewhere = process.listenerCount(signal) > 0;
  process.on(signal, () => {
    killActive();
    if (!exitsElsewhere) process.exit(exitCode);
  });
}
