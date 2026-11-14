// Parallel sessions: tells a session that another live one already holds its checkout, so it works in its own
// worktree. Never blocks. Registry: one file per session in <git common dir>/skuizops-sessions.
//   node sessions.mjs start|end|touch    Claude Code SessionStart / SessionEnd / PreToolUse hook, JSON on stdin
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { inScope, isMain, projectDir } from "./scope.mjs";

export const MAX_SESSIONS = 4;
// shortcut: mtime liveness, an idle session older than 12 h looks dead and a crashed one looks alive until then; upgrade to a pid or heartbeat check if that bites.
const DEAD_AFTER_MS = 12 * 60 * 60 * 1000;

// `live` holds every live entry of the repo, this session's included: { id, tree, branch, started }.
export function message(live, id) {
  const me = live.find((s) => s.id === id);
  if (!me) return "";
  const lines = [];
  const earlier = live.filter((s) => s.id !== id && s.tree === me.tree && s.started < me.started);
  if (earlier.length) {
    const branches = [...new Set(earlier.map((s) => s.branch))].join(", ");
    lines.push(
      `skuizops: ${earlier.length} other live session(s) already use this checkout (branch: ${branches}). Do not edit files, switch branches or commit in this checkout. Do every change in your own git worktree created from the repository's default branch, following the "Worktrees" section of your instructions. Reading files here is fine.`,
    );
  }
  if (live.length > MAX_SESSIONS) lines.push(`skuizops: warning, more than ${MAX_SESSIONS} sessions are live on this repository.`);
  return lines.join("\n");
}

// Applies one mode to the registry and returns what the hook prints.
export function run(mode, registry, id, { tree, branch }, now = Date.now()) {
  if (!/^[\w-]+$/.test(id ?? "")) return "";
  const file = (name) => join(registry, `${name}.json`);
  mkdirSync(registry, { recursive: true });
  if (mode === "end") return rmSync(file(id), { force: true }), "";
  if (mode === "touch") {
    try {
      utimesSync(file(id), new Date(now), new Date(now));
    } catch {
      writeFileSync(file(id), JSON.stringify({ tree, branch, started: now }));
    }
    return "";
  }
  if (mode !== "start") return "";
  const live = [];
  for (const name of readdirSync(registry).filter((n) => n.endsWith(".json"))) {
    try {
      if (now - statSync(file(name.slice(0, -5))).mtimeMs > DEAD_AFTER_MS) rmSync(file(name.slice(0, -5)), { force: true });
      else if (name !== `${id}.json`) live.push({ id: name.slice(0, -5), ...JSON.parse(readFileSync(file(name.slice(0, -5)), "utf8")) });
    } catch {}
  }
  // SessionStart also fires on resume and compact: keep the original start time.
  let started = now;
  try {
    started = JSON.parse(readFileSync(file(id), "utf8")).started ?? now;
  } catch {}
  writeFileSync(file(id), JSON.stringify({ tree, branch, started }));
  return message([...live, { id, tree, branch, started }], id);
}

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });

function main(mode) {
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    const cwd = projectDir(input);
    if (!input.session_id || !inScope(cwd)) return;
    const common = git(cwd, "rev-parse", "--git-common-dir");
    const top = git(cwd, "rev-parse", "--show-toplevel");
    if (common.status !== 0 || top.status !== 0) return;
    const branch = git(cwd, "symbolic-ref", "--short", "-q", "HEAD");
    const text = run(mode, join(resolve(cwd, common.stdout.trim()), "skuizops-sessions"), input.session_id, {
      tree: top.stdout.trim(),
      branch: branch.status === 0 ? branch.stdout.trim() : "detached",
    });
    if (text) process.stdout.write(`${text}\n`);
  } catch {}
}

if (isMain(import.meta.url)) main(process.argv[2]);
