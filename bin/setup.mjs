#!/usr/bin/env node
// One-command setup for a human: npx github:enderdev01/la-fruteria
// Installs or updates the marketplace and plugin, turns on its auto-update, sets the git hooks and the trust entry, then relaunches Claude Code.
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { installHooks } from "../plugins/dev-factory/scripts/install-hooks.mjs";
import { isMain, isTrusted } from "../plugins/dev-factory/scripts/scope.mjs";
import { trust } from "../plugins/dev-factory/scripts/trust.mjs";

const run = promisify(execFile);
const MARKETPLACE = "factory-marketplace";
const PLUGIN = `dev-factory@${MARKETPLACE}`;
const REPO = "enderdev01/la-fruteria";

// --- pure helpers (tested) ---

export const encodeProjectDir = (dir) => dir.replace(/[^A-Za-z0-9]/g, "-");
export const pickMarketplaceAction = (list) => (list.some((m) => m.name === MARKETPLACE) ? "update" : "add");
export const pickPluginAction = (list) => (list.some((p) => p.id === PLUGIN) ? "update" : "install");
export const pluginVersion = (list) => list.find((p) => p.id === PLUGIN)?.version ?? null;

const LEMON = "dev-factory:lemon";
const WEB_DEPS = ["vite", "next", "react", "react-dom", "vue", "svelte", "@sveltejs/kit", "nuxt", "astro", "@angular/core", "solid-js", "preact", "@remix-run/react"];

// Sets "agent": "dev-factory:lemon" in <root>/.claude/settings.json without ever overwriting what the user has.
export function setLemonAgent(root) {
  const file = join(root, ".claude", "settings.json");
  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      settings = null;
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { status: "fail", message: "fix .claude/settings.json (invalid JSON) and re-run" };
    if (settings.agent === LEMON) return { status: "skip", message: "already set" };
    if (settings.agent !== undefined) return { status: "skip", message: `kept your agent ${settings.agent}` };
  }
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...settings, agent: LEMON }, null, 2)}\n`);
  return { status: "ok", message: "set" };
}

// Turns on Claude Code's auto-update for this marketplace in the user's settings (what /plugin > Marketplaces
// toggles), so new versions reach every session without re-running the setup. Never overrides an explicit false.
export function setAutoUpdate(home) {
  const file = join(home, ".claude", "settings.json");
  const json = (path) => JSON.parse(readFileSync(path, "utf8"));
  let settings = {};
  if (existsSync(file)) {
    try {
      settings = json(file);
    } catch {
      settings = null;
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { status: "fail", message: "fix ~/.claude/settings.json (invalid JSON) and re-run" };
  }
  const entry = settings.extraKnownMarketplaces?.[MARKETPLACE];
  if (entry?.autoUpdate === true) return { status: "skip", message: "already on" };
  if (entry?.autoUpdate === false) return { status: "skip", message: "kept your setting (off)" };
  let source = entry?.source;
  try {
    source ??= json(join(home, ".claude", "plugins", "known_marketplaces.json"))[MARKETPLACE].source;
  } catch {}
  if (!source) return { status: "skip", message: "marketplace source unknown, turn it on in /plugin > Marketplaces" };
  const next = { ...settings, extraKnownMarketplaces: { ...settings.extraKnownMarketplaces, [MARKETPLACE]: { ...entry, source, autoUpdate: true } } };
  mkdirSync(join(home, ".claude"), { recursive: true });
  // Write then rename: a crash mid-write must not truncate the user's settings.
  writeFileSync(`${file}.dev-factory-tmp`, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(`${file}.dev-factory-tmp`, file);
  return { status: "ok", message: "on" };
}

const readPackage = (root) => {
  try {
    return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
};
export const hasWebUi = (pkg) => WEB_DEPS.some((d) => d in { ...pkg?.dependencies, ...pkg?.devDependencies });
export const hasPlaywright = (pkg) => "playwright" in { ...pkg?.dependencies, ...pkg?.devDependencies };
// Package manager by lockfile (files: names present in the project root) -> [command, ...args] that adds playwright as a dev dependency.
export function playwrightInstallCommand(files) {
  const has = (f) => files.includes(f);
  if (has("pnpm-lock.yaml")) return ["pnpm", "add", "-D", "playwright"];
  if (has("yarn.lock")) return ["yarn", "add", "-D", "playwright"];
  if (has("bun.lock") || has("bun.lockb")) return ["bun", "add", "-d", "playwright"];
  return ["npm", "install", "-D", "playwright"];
}

export const firstErrorLine = (text) => {
  const lines = String(text).split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /error|ERR!|failed/i.test(l)) ?? lines[0] ?? "install failed";
};

export function welcomePrompt({ oldVersion, newVersion, backups = [], configured = [] }) {
  const what = !oldVersion ? `installed v${newVersion}` : oldVersion !== newVersion ? `updated from v${oldVersion} to v${newVersion}` : `confirmed up to date at v${newVersion}`;
  const saved = backups.length ? ` These files had local edits and were backed up before being replaced: ${backups.join(", ")}. Tell the user where the backups are.` : "";
  const conf = configured.length ? ` The setup also did this: ${configured.join("; ")}. Mention it in one line. Settings changed, so the lemon orchestrator applies to NEW sessions, not this one: tell the user to open a new session to get it.` : "";
  return `dev-factory was just ${what} in this project by the setup command.${saved}${conf} Greet the user in one short line in the language they have been using in this session (Spanish if there is no history), say what changed in one or two lines, and if the project has no .claude/verification directory, suggest running the create-verification-skill skill. Do not run any command.`;
}

export function hasSession(cwd, home = homedir()) {
  try {
    return readdirSync(join(home, ".claude", "projects", encodeProjectDir(realpathSync(cwd)))).some((f) => f.endsWith(".jsonl"));
  } catch {
    return false;
  }
}

// --- display ---

const fancy = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (fancy ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => paint(32, s);
const yellow = (s) => paint(33, s);
const red = (s) => paint(31, s);
const dim = (s) => paint(2, s);
const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const MARK = { ok: green("✓"), skip: yellow("•"), fail: red("✗") };
const out = (s) => process.stdout.write(`${s}\n`);

// fn(ui) returns { status: "ok" | "skip", text?, details? } or throws. 
async function step(label, fn) {
  let timer;
  let i = 0;
  const clear = () => fancy && process.stdout.write("\r\x1b[2K");
  const pause = () => {
    clearInterval(timer);
    clear();
  };
  if (fancy) timer = setInterval(() => process.stdout.write(`\r\x1b[2K${paint(36, FRAMES[i++ % FRAMES.length])} ${label}`), 80);
  let result;
  try {
    result = await fn({ pause });
  } catch (error) {
    pause();
    out(`${MARK.fail} ${label}`);
    out(dim(`    ${String(error.stderr || error.message || error).trim().split("\n").join("\n    ")}`));
    return { status: "fail" };
  }
  pause();
  out(`${MARK[result.status]} ${label}${result.text ? ` ${dim(result.text)}` : ""}`);
  for (const d of result.details ?? []) out(dim(`    ${d}`));
  return result;
}

const claude = (...args) => run("claude", args, { maxBuffer: 1 << 24 });
const claudeJson = async (...args) => JSON.parse((await claude(...args)).stdout);
const gitRoot = async (cwd) => {
  try {
    return (await run("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).stdout.trim();
  } catch {
    return null;
  }
};

async function main() {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  out(`\n${paint("1;35", "dev-factory")} ${dim(`v${version}`)}\n`);
  const cwd = process.cwd();
  const env = { oldVersion: null, newVersion: null, backups: [], configured: [] };
  let failed = false;
  const track = (r) => (failed ||= r.status === "fail");

  try {
    await run("claude", ["--version"]);
  } catch {
    out(`${MARK.fail} Claude Code not found`);
    out(dim("    Install Claude Code first: https://claude.com/claude-code"));
    process.exit(1);
  }

  track(await step("Marketplace", async () => {
    const action = pickMarketplaceAction(await claudeJson("plugin", "marketplace", "list", "--json"));
    await (action === "add" ? claude("plugin", "marketplace", "add", REPO) : claude("plugin", "marketplace", "update", MARKETPLACE));
    return { status: "ok", text: action === "add" ? "added" : "updated" };
  }));

  track(await step("Plugin", async () => {
    const before = await claudeJson("plugin", "list", "--json");
    env.oldVersion = pluginVersion(before);
    await claude("plugin", pickPluginAction(before), PLUGIN);
    env.newVersion = pluginVersion(await claudeJson("plugin", "list", "--json"));
    if (!env.newVersion) throw new Error(`${PLUGIN} is not listed after the install`);
    if (!env.oldVersion) return { status: "ok", text: `installed v${env.newVersion}` };
    if (env.oldVersion !== env.newVersion) return { status: "ok", text: `v${env.oldVersion} → v${env.newVersion}` };
    return { status: "skip", text: `already up to date (v${env.newVersion})` };
  }));

  track(await step("Auto-update", async () => {
    const r = setAutoUpdate(homedir());
    if (r.status === "fail") throw new Error(r.message);
    if (r.status === "ok") env.configured.push("turned on auto-update for the dev-factory marketplace, so new versions install on their own");
    return { status: r.status, text: r.message };
  }));

  const root = await gitRoot(cwd);
  track(await step("Git hooks", async () => {
    if (!root) return { status: "skip", text: "not a git repository" };
    const { actions, backups } = installHooks(cwd);
    env.backups = backups;
    const changes = actions.filter((a) => /^(Updated|Installed|Backed up|Replaced)/.test(a));
    const upToDate = actions.filter((a) => a.endsWith("is up to date")).length;
    return { status: changes.length ? "ok" : "skip", text: changes.length ? "" : "up to date", details: upToDate ? [...changes, `${upToDate} files up to date`] : changes };
  }));

  const project = root ?? cwd;
  track(await step("Trust", async () => {
    if (isTrusted(project)) return { status: "skip", text: "already trusted" };
    trust(project);
    env.configured.push("trusted the project");
    return { status: "ok", text: `trusted ${project}` };
  }));

  track(await step("Lemon orchestrator", async () => {
    const r = setLemonAgent(project);
    if (r.status === "fail") throw new Error(r.message);
    env.configured.push(r.status === "ok" ? "set lemon as the default agent in .claude/settings.json" : `lemon: ${r.message}`);
    return { status: r.status, text: r.message };
  }));

  track(await step("Playwright", async () => {
    const pkg = readPackage(project);
    if (!hasWebUi(pkg)) return { status: "skip", text: "no web UI detected" };
    const had = hasPlaywright(pkg);
    try {
      if (!had) {
        const [cmd, ...cmdArgs] = playwrightInstallCommand(readdirSync(project));
        await run(cmd, cmdArgs, { cwd: project, maxBuffer: 1 << 24 });
      }
      await run("npx", ["playwright", "install", "chromium"], { cwd: project, maxBuffer: 1 << 24 });
    } catch (error) {
      throw new Error(firstErrorLine(error.stderr || error.message));
    }
    env.configured.push(had ? "Playwright was already installed" : "installed Playwright and Chromium");
    return had ? { status: "skip", text: "already installed" } : { status: "ok", text: "installed" };
  }));

  out("");
  if (failed) {
    out(red("Finished with errors"));
    process.exit(1);
  }
  out(green("All set"));

  if (process.env.CLAUDECODE) {
    out("Exit Claude and run `claude --continue` to load the update.");
    return;
  }
  const prompt = welcomePrompt(env);
  const args = [...(hasSession(cwd) ? ["--continue"] : []), prompt];
  if (!process.stdin.isTTY) {
    out(`Run: claude ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    return;
  }
  const child = spawn("claude", args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (isMain(import.meta.url)) await main();
