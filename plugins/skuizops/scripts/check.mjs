// Read-only check of a project's skuizops configuration. Never writes, creates or deletes a file.
//   node check.mjs           print one row per check (ok / FAIL -> fix / info), exit 1 when any is FAIL
//   node check.mjs report    same rows, always exit 0 (/skuizops:check: a non-zero exit shows as "Shell command failed")
//   node check.mjs notice    SessionStart hook: one line only when a check FAILs; never fails the session
//   a trailing `codex` argument (host) skips the Claude-only checks: plugin installed/enabled, default agent
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sources } from "./install-hooks.mjs";
import { inScope, isMain, isTrusted, mainWorktree, projectDir, real } from "./scope.mjs";

const ID = "skuizops@juicebar";
const LEMON = "skuizops:lemon";
const INSTALL = "npx github:enderdev01/skuizops";
const HOOKS = "/skuizops:install-hooks";

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const ok = (name, text) => ({ status: "ok", name, text });
const fail = (name, text) => ({ status: "fail", name, text });
const info = (name, text) => ({ status: "info", name, text });

export function format({ status, name, text }) {
  if (status === "ok") return `ok   ${name}${text ? ` (${text})` : ""}`;
  if (status === "fail") return `FAIL ${name}  ->  ${text}`;
  return `info ${name}: ${text}`;
}

// Settings of the project: { settings } or { problem } when the file is not a JSON object. A missing file is {}.
function projectSettings(project) {
  const file = join(project, ".claude", "settings.json");
  if (!existsSync(file)) return { settings: {} };
  const settings = readJson(file);
  return settings && typeof settings === "object" && !Array.isArray(settings) ? { settings } : { problem: "invalid JSON" };
}

function pluginRow(home, project, version) {
  const entry = readJson(join(home, ".claude", "plugins", "installed_plugins.json"))?.plugins?.[ID]?.[0];
  const flags = [join(home, ".claude", "settings.json"), join(project, ".claude", "settings.json")].map((f) => readJson(f)?.enabledPlugins?.[ID]);
  if (!entry) return fail("plugin", `not installed. Run the installer: ${INSTALL}`);
  if (!flags.includes(true) || flags.includes(false)) return fail("plugin", `installed but not enabled. Run the installer: ${INSTALL}`);
  return ok("plugin", `v${version}`);
}

function agentRow({ settings, problem }, pluginRoot) {
  const fix = `set "agent": "${LEMON}" in .claude/settings.json`;
  if (problem) return fail("default agent", `.claude/settings.json is ${problem}: fix it, then ${fix}`);
  const agent = settings.agent;
  if (agent === undefined) return fail("default agent", `no agent is set: ${fix}`);
  if (typeof agent !== "string") return fail("default agent", `agent must be a string: ${fix}`);
  if (agent.startsWith("dev-factory:")) return fail("default agent", `${agent} is the old name: ${fix}`);
  const name = agent.startsWith("skuizops:") ? agent.slice("skuizops:".length) : null;
  if (name === null) return info("default agent", `${agent} (not a skuizops agent, not checked)`);
  if (!/^[\w-]+$/.test(name) || !existsSync(join(pluginRoot, "agents", `${name}.md`))) return fail("default agent", `${agent} does not exist: ${fix}`);
  return ok("default agent", agent);
}

// Problems of the git hooks and of the guard copies, compared by content with what the plugin installs now.
function hookProblems(project) {
  const hooks = [];
  const guards = [];
  const path = spawnSync("git", ["-C", project, "config", "--local", "--get", "core.hooksPath"], { encoding: "utf8" });
  if (path.stdout?.trim() !== ".githooks") hooks.push("core.hooksPath is not .githooks");
  // The manifest is untracked: a linked worktree reads the one of its main worktree.
  const manifest = readJson(join(project, ".githooks", ".skuizops.json")) ?? readJson(join(mainWorktree(project) ?? project, ".githooks", ".skuizops.json"));
  if (!manifest?.files) return { hooks: [...hooks, "no .githooks/.skuizops.json manifest"], guards: ["no manifest"] };
  for (const { from, rel, mode } of sources()) {
    const file = join(project, rel);
    const isGuard = rel.startsWith("scripts/guard/");
    let problem = null;
    try {
      const current = sha(readFileSync(file));
      if (current !== sha(readFileSync(from))) problem = `${rel} ${current === manifest.files[rel] ? "is outdated" : "was edited"}`;
      else if (mode && !(statSync(file).mode & 0o111)) problem = `${rel} is not executable`;
    } catch {
      problem = `${rel} is missing`;
    }
    if (problem) (isGuard ? guards : hooks).push(problem);
  }
  return { hooks, guards, installedBy: manifest.version };
}

// What remains of the old name dev-factory, read from the rename commit: files, settings keys, user config.
function oldNames(project, home, { settings }, installed) {
  const found = [];
  if (existsSync(join(project, ".githooks", ".dev-factory.json"))) found.push("delete .githooks/.dev-factory.json");
  if (typeof settings?.agent === "string" && settings.agent.startsWith("dev-factory:")) found.push(`change "agent": "${settings.agent}" to "${LEMON}" in .claude/settings.json`);
  for (const key of Object.keys(settings?.env ?? {})) {
    if (key.startsWith("DEV_FACTORY_")) found.push(`rename env.${key} to env.${key.replace("DEV_FACTORY_", "SKUIZOPS_")} in .claude/settings.json`);
  }
  if (existsSync(join(home, ".config", "dev-factory"))) found.push("move ~/.config/dev-factory/trusted-projects to ~/.config/skuizops and delete ~/.config/dev-factory");
  if (existsSync(join(home, ".claude", "dev-factory-update-check.json"))) found.push("delete ~/.claude/dev-factory-update-check.json");
  for (const id of Object.keys(installed ?? {})) if (id.startsWith("dev-factory@")) found.push(`uninstall the old plugin ${id}`);
  return found;
}

// A session opened in a subfolder of a repo reads that folder's settings, hooks and trust, not the repo's.
function rootRow(project) {
  const r = spawnSync("git", ["-C", project, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  const top = r.status === 0 ? r.stdout.trim() : "";
  if (!top || real(top) === real(project)) return [];
  return [fail("project root", `this session runs in a subfolder of the repo: start it from the repo root (cd '${top.replace(/'/g, `'\\''`)}'). The other rows are checked for this subfolder.`)];
}

// Returns one row per check: { status: "ok" | "fail" | "info", name, text }.
// host "codex" skips the Claude-only rows (plugin installed/enabled, default agent).
export function check({ project, home = homedir(), env = process.env, pluginRoot = fileURLToPath(new URL("..", import.meta.url)), host = "claude" }) {
  const { version } = readJson(join(pluginRoot, ".claude-plugin", "plugin.json")) ?? {};
  const config = projectSettings(project);
  const { hooks, guards, installedBy } = hookProblems(project);
  const installed = readJson(join(home, ".claude", "plugins", "installed_plugins.json"))?.plugins;
  const old = oldNames(project, home, config, installed);
  const claudeOnly = host === "codex" ? [] : [pluginRow(home, project, version), agentRow(config, pluginRoot)];
  return [
    ...rootRow(project),
    ...claudeOnly,
    hooks.length ? fail("git hooks", `${HOOKS} (${hooks.join("; ")})`) : ok("git hooks", installedBy === version ? undefined : `installed by v${installedBy}, identical to v${version}`),
    guards.length ? fail("project guards", `${HOOKS} (${guards.join("; ")})`) : ok("project guards"),
    isTrusted(project, { ...env, HOME: home }) ? ok("trusted project") : fail("trusted project", "/skuizops:trust"),
    old.length ? fail("old-name leftovers", old.join("; ")) : ok("old-name leftovers"),
    info("effective language", env.SKUIZOPS_LANG || "es (default)"),
    existsSync(join(project, ".claude", "verification"))
      ? info("verification map", ".claude/verification exists")
      : info("verification map", "none: run the create-verification-skill skill to map how to verify this project"),
  ];
}

export function notice(rows) {
  const failed = rows.filter((r) => r.status === "fail").map((r) => r.name);
  return failed.length ? `skuizops: this project's setup is incomplete (${failed.join(", ")}). Mention it to the human, who fixes it with /skuizops:check. It does not block your task: carry on.` : "";
}

function main() {
  const quiet = process.argv[2] === "notice";
  try {
    const project = projectDir(quiet ? JSON.parse(readFileSync(0, "utf8") || "{}") : {});
    if (quiet && !inScope(project)) return;
    const rows = check({ project, host: process.argv.includes("codex") ? "codex" : "claude" });
    if (quiet) {
      const text = notice(rows);
      if (text) process.stdout.write(`${text}\n`);
      return;
    }
    process.stdout.write(`${rows.map(format).join("\n")}\n`);
    if (process.argv[2] !== "report" && rows.some((r) => r.status === "fail")) process.exitCode = 1;
  } catch (error) {
    if (!quiet) {
      process.stderr.write(`skuizops: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}

if (isMain(import.meta.url)) main();
