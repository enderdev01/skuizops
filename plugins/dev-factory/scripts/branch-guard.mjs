// Branch policy for every agent and every human:
//   - commits only on work branches: `feat/*`, `fix/*`, `hotfix/*`
//   - never commit or push to a protected branch (or anything under it, e.g. release/1.2)
//
// One policy, three entry points:
//   node branch-guard.mjs claude       Claude Code PreToolUse hook (Bash), reads hook JSON on stdin
//   node branch-guard.mjs pre-commit   git pre-commit / pre-merge-commit hook
//   node branch-guard.mjs pre-push     git pre-push hook, reads "<local ref> <sha> <remote ref> <sha>" lines
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PROTECTED = ["develop", "desarrollo", "desa", "main", "master", "production", "prod", "test", "release"];
export const WORK_PREFIXES = ["feat/", "fix/", "hotfix/"];

const shortName = (ref) => ref.replace(/^refs\/heads\//, "");

export function isProtected(ref) {
  const first = shortName(ref).toLowerCase().split("/")[0];
  return PROTECTED.includes(first);
}

export function isWorkBranch(ref) {
  return WORK_PREFIXES.some((prefix) => shortName(ref).startsWith(prefix));
}

export function commitViolation(branch) {
  if (!branch) return "HEAD is detached or unknown. Create a branch first: git switch -c feat/<name> (or fix/, hotfix/)";
  if (isProtected(branch)) return `"${branch}" is a protected branch. Work on a feat/, fix/ or hotfix/ branch: git switch -c feat/<name>`;
  if (!isWorkBranch(branch)) return `"${branch}" is not a feat/, fix/ or hotfix/ branch. Rename it: git branch -m feat/<name>`;
  return null;
}

export function pushViolation(remoteRef) {
  if (isProtected(remoteRef)) return `Pushing to protected branch "${shortName(remoteRef)}" is forbidden. Open a PR from a feat/, fix/ or hotfix/ branch instead.`;
  if (!isWorkBranch(remoteRef)) return `Only feat/, fix/ and hotfix/ branches may be pushed, got "${shortName(remoteRef)}".`;
  return null;
}

// git global options that take a separate value: `git -c k=v commit`, `git -C dir commit`.
const GIT_OPTIONS_WITH_VALUE = ["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"];

// Split `git [global options] <subcommand> [args]` into the subcommand and its arguments.
function parseGit(words) {
  let i = 0;
  while (i < words.length && words[i].startsWith("-")) i += GIT_OPTIONS_WITH_VALUE.includes(words[i]) ? 2 : 1;
  return { sub: words[i], rest: words.slice(i + 1) };
}

// Best-effort check of a shell command before Claude runs it. The git hooks are the authoritative layer.
export function checkCommand(command, currentBranch) {
  if (!/\bgit\b/.test(command)) return null;
  if (/--no-verify\b/.test(command)) return "--no-verify is forbidden: the git hooks enforce the branch policy.";
  // The one allowed form is the setup step: `git config [--local] core.hooksPath .githooks`.
  const withoutSetup = command.replace(/\bgit\s+config\s+(--local\s+)?core\.hooksPath\s+\.githooks(?![^\s;&|])/gi, "");
  if (/core\.hooksPath/i.test(withoutSetup)) return "Changing core.hooksPath is forbidden: it would disable the branch policy.";

  // Quotes and parentheses are dropped so `bash -c 'git commit'` is inspected like `git commit`.
  for (const segment of command.replace(/["'()`]/g, " ").split(/&&|\|\||;|\|/)) {
    const words = segment.trim().split(/\s+/);
    const gitAt = words.findIndex((w) => w === "git" || w.endsWith("/git"));
    if (gitAt === -1) continue;
    const { sub, rest } = parseGit(words.slice(gitAt + 1));
    const args = [sub, ...rest.filter((w) => !w.startsWith("-"))];

    if (sub === "commit" && rest.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w))) {
      return "git commit -n is --no-verify, which is forbidden: the git hooks enforce the branch policy.";
    }
    if (["commit", "merge", "cherry-pick", "revert"].includes(sub)) {
      const problem = commitViolation(currentBranch);
      if (problem) return `git ${sub} blocked: ${problem}`;
    }
    if (sub === "push") {
      if (/\s--(all|mirror)\b/.test(segment)) return "git push --all/--mirror is forbidden.";
      const refspecs = args.slice(2); // after "push <remote>"
      const targets = refspecs.length ? refspecs.map((r) => r.replace(/^\+/, "").split(":").pop()) : [currentBranch ?? ""];
      for (const target of targets) {
        const problem = pushViolation(target === "HEAD" ? (currentBranch ?? "") : target);
        if (problem) return `git push blocked: ${problem}`;
      }
    }
  }
  return null;
}

function currentBranch(cwd) {
  const r = spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function fail(message) {
  process.stderr.write(`Branch policy: ${message}\n`);
  process.exit(2);
}

function main(mode) {
  const stdin = readFileSync(0, "utf8");

  if (mode === "claude") {
    const input = JSON.parse(stdin || "{}");
    const command = input.tool_input?.command ?? "";
    const problem = checkCommand(command, currentBranch(input.cwd ?? process.cwd()));
    if (problem) fail(problem);
    return;
  }
  if (mode === "pre-commit") {
    const problem = commitViolation(currentBranch(process.cwd()));
    if (problem) fail(problem);
    return;
  }
  if (mode === "pre-push") {
    for (const line of stdin.split("\n").filter(Boolean)) {
      const remoteRef = line.split(" ")[2];
      const problem = remoteRef && pushViolation(remoteRef);
      if (problem) fail(problem);
    }
    return;
  }
  fail(`unknown mode "${mode}". Use: claude | pre-commit | pre-push`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv[2]);
