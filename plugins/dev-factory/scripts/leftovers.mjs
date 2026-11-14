// Leftovers notice: tells the orchestrator about leftovers of earlier sessions in this checkout (installer backups,
// merged local branches, merged clean worktrees) so it asks the human whether to clean them. Never deletes anything,
// never blocks; no leftovers, no git repo or any error prints nothing. No network.
//   node leftovers.mjs    Claude Code SessionStart hook, JSON on stdin
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isProtected } from "./branch-guard.mjs";
import { inScope, isMain, projectDir } from "./scope.mjs";

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};
const lines = (text) => (text ?? "").split("\n").filter(Boolean);

// Returns { backups, branches, worktrees }: backup paths relative to root, branch names, absolute worktree paths.
export function leftovers(root) {
  const backups = [];
  for (const dir of [".githooks", "scripts/guard"]) {
    try {
      for (const name of readdirSync(join(root, dir))) if (/\.local-\d{8}-\d{6}$/.test(name)) backups.push(`${dir}/${name}`);
    } catch {}
  }
  const base = [git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"), "origin/develop", "origin/main", "origin/master"]
    .filter(Boolean)
    .find((ref) => git(root, "rev-parse", "--verify", "-q", `${ref}^{commit}`) !== null);
  if (!base) return { backups, branches: [], worktrees: [] };
  const merged = lines(git(root, "branch", "--merged", base, "--format=%(refname:short)"));
  const trees = git(root, "worktree", "list", "--porcelain")?.split("\n\n").map((block) => ({
    path: /^worktree (.+)$/m.exec(block)?.[1],
    branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1],
  })) ?? [];
  const current = git(root, "symbolic-ref", "--short", "-q", "HEAD");
  const checkedOut = new Set(trees.map((t) => t.branch));
  const branches = merged.filter((b) => b !== current && !isProtected(b) && !checkedOut.has(b));
  const worktrees = trees
    .slice(1)
    .filter((t) => t.branch && merged.includes(t.branch) && !isProtected(t.branch) && git(t.path, "status", "--porcelain") === "")
    .map((t) => t.path);
  return { backups, branches, worktrees };
}

export function message({ backups, branches, worktrees }) {
  if (!backups.length && !branches.length && !worktrees.length) return "";
  const found = [
    backups.length && `${backups.length} installer backup file(s) (${backups.join(", ")})`,
    branches.length && `${branches.length} merged local branch(es) (${branches.join(", ")})`,
    worktrees.length && `${worktrees.length} merged clean worktree(s) (${worktrees.join(", ")})`,
  ].filter(Boolean);
  return `dev-factory: earlier sessions left leftovers in this checkout: ${found.join("; ")}. List them to the human and ask whether to clean them. Only on a yes, run \`git worktree remove <path>\` (never \`--force\`) and \`git branch -d <name>\` (never \`-D\`); the guard blocks deleting backup files, so show the human the \`rm\` command for the backups instead. Never delete anything without a yes.`;
}

function main() {
  try {
    const cwd = projectDir(JSON.parse(readFileSync(0, "utf8") || "{}"));
    if (!inScope(cwd)) return;
    const top = git(cwd, "rev-parse", "--show-toplevel");
    const text = top && message(leftovers(resolve(top)));
    if (text) process.stdout.write(`${text}\n`);
  } catch {}
}

if (isMain(import.meta.url)) main();
