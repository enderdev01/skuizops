#!/usr/bin/env node
// One-command setup for a human: npx github:enderdev01/la-fruteria
// Installs or updates the marketplace and plugin, the git hooks and the trust entry, then relaunches Claude Code.
import { execFile, spawn } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
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

export function welcomePrompt({ oldVersion, newVersion, backups = [] }) {
  const what = !oldVersion ? `installed v${newVersion}` : oldVersion !== newVersion ? `updated from v${oldVersion} to v${newVersion}` : `confirmed up to date at v${newVersion}`;
  const saved = backups.length ? ` These files had local edits and were backed up before being replaced: ${backups.join(", ")}. Tell the user where the backups are.` : "";
  return `dev-factory was just ${what} in this project by the setup command.${saved} Greet the user in one short line in the language they have been using in this session (Spanish if there is no history), say what changed in one or two lines, and if the project has no .claude/verification directory, suggest running the create-verification-skill skill. Do not run any command.`;
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

// fn(ui) returns { status: "ok" | "skip", text?, details? } or throws. ui.pause() stops the spinner (before asking something).
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
  const env = { oldVersion: null, newVersion: null, backups: [] };
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
  track(await step("Trust", async ({ pause }) => {
    if (isTrusted(project)) return { status: "skip", text: "already trusted" };
    if (!process.stdin.isTTY) return { status: "skip", text: "not asked (no terminal)" };
    pause();
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question("Trust this project so dev-factory runs its tests? [y/N] ");
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) return { status: "skip", text: "not trusted" };
    trust(project);
    return { status: "ok", text: "trusted" };
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
