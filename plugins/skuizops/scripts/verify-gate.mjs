// Stop hook: the agent cannot finish while the project verify is red.
// Exit 2 blocks the stop and feeds the failure back to the agent.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inScope, isMain, isTrusted, projectDir, trustHint } from "./scope.mjs";
import { join, resolve } from "node:path";

// null when verify passed, else the failure text. A timeout counts as a failure.
export function verdict(result) {
  if (result.status === 0) return null;
  if (result.error?.code === "ETIMEDOUT") return "Project verify timed out.";
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n");
}

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// Identifies what verify would see: HEAD on a clean tree, else a hash of HEAD, the diff against it and every
// untracked file. null when it cannot tell (no repo, no commit, git failed): then verify always runs.
// Ignored files are not part of it, as they were not for the clean-tree check.
export function treeState(cwd) {
  const head = git(cwd, "rev-parse", "HEAD");
  const status = git(cwd, "status", "--porcelain");
  if (head.status !== 0 || status.status !== 0) return null;
  if (status.stdout.trim() === "") return head.stdout.trim();
  const diff = git(cwd, "diff", "HEAD", "--binary");
  const untracked = git(cwd, "ls-files", "-z", "--others", "--exclude-standard");
  if (diff.status !== 0 || untracked.status !== 0) return null;
  const hash = createHash("sha256").update(head.stdout).update(diff.stdout);
  try {
    for (const file of untracked.stdout.split("\0").filter(Boolean)) hash.update(`\0${file}\0`).update(readFileSync(join(cwd, file)));
  } catch {
    return null;
  }
  return `dirty:${hash.digest("hex")}`;
}

// A change that can modify the check that judges it makes the check unreliable. shortcut: package.json "scripts" edits are not flagged, add if agents start rewiring them.
const CHECK_FILES = /^(scripts\/control\.mjs$|scripts\/guard\/|\.claude\/verification\/|\.claude\/skills\/verify\/|\.githooks\/)|(^|\/)(vitest|jest)\.config\.[^/]+$/;

// Paths changed since the default branch's merge-base (else since HEAD) plus untracked files that match the project's own checks.
// [] on any git error: fail open.
export function changedChecks(cwd) {
  const base = ["origin/HEAD", "origin/main", "origin/develop"].map((ref) => git(cwd, "merge-base", "HEAD", ref)).find((r) => r.status === 0)?.stdout.trim() || "HEAD";
  const diff = git(cwd, "diff", "--name-only", base);
  const untracked = git(cwd, "ls-files", "--others", "--exclude-standard");
  if (diff.status !== 0 || untracked.status !== 0) return [];
  return [...new Set(`${diff.stdout}\n${untracked.stdout}`.split("\n").filter((p) => CHECK_FILES.test(p)))];
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");

  const cwd = projectDir(input);
  // Hooks only act on projects under the scope roots (~/DEV plus SKUIZOPS_ROOTS).
  if (!inScope(cwd)) process.exit(0);

  // Outside a git repo, always verify. Otherwise skip when this exact tree state was already verified.
  const state = treeState(cwd);
  const marker = state ? resolve(cwd, git(cwd, "rev-parse", "--git-path", "skuizops-verified").stdout.trim()) : "";
  if (marker) {
    try {
      if (readFileSync(marker, "utf8").trim() === state) process.exit(0);
    } catch {}
  }

  // Prefer the project's control CLI; else an npm "verify" script; else nothing to run.
  let command;
  if (existsSync(join(cwd, "scripts", "control.mjs"))) command = ["node", ["scripts/control.mjs", "verify"]];
  else {
    let scripts = {};
    try {
      scripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {};
    } catch {}
    if (scripts.verify) command = ["npm", ["run", "verify", "--silent"]];
  }
  if (!command) process.exit(0);
  // The command is the project's own code: run it only for projects the human trusted.
  if (!isTrusted(cwd)) {
    process.stdout.write(
      `${JSON.stringify({ systemMessage: `skuizops: verify skipped, this project is not trusted. To trust it, type /skuizops:trust in this session, or run yourself: ${trustHint(cwd)}` })}\n`,
    );
    process.exit(0);
  }

  const own = changedChecks(cwd);
  const note = own.length ? `This change modifies its own checks (${own.join(", ")}): say so in the PR body and have the human review them.` : "";
  const say = (text) => process.stdout.write(`${JSON.stringify({ systemMessage: text })}\n`);

  // The hook timeout is 300 s: stay below it so a hang is a failure we report, not a kill.
  const failure = verdict(spawnSync(command[0], command[1], { cwd, encoding: "utf8", timeout: 240000 }));
  if (failure === null) {
    if (note) say(`skuizops: ${note}`);
    if (marker) {
      try {
        writeFileSync(marker, `${state}\n`);
      } catch {}
    }
    process.exit(0);
  }

  // Already blocked once this turn: warn but let it stop, so we never block twice.
  if (input.stop_hook_active) {
    say(`skuizops: project verify is still failing.${note && ` ${note}`}`);
    process.exit(0);
  }
  process.stderr.write(
    `Project verify is failing. Fix it before you finish (delegate long logs to fig):\n${failure}${note && `\n${note}`}`,
  );
  process.exit(2);
}

if (isMain(import.meta.url)) main();
