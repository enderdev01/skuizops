#!/usr/bin/env node
// This repo's lever: check the environment and verify the plugin and marketplace.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commitViolation } from "../plugins/dev-factory/scripts/branch-guard.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const args = argv.filter((a) => a !== "--json");

const HELP = `Usage: node scripts/control.mjs <command> [--json]

Commands:
  doctor    Check node, git hooks and the current branch
  verify    Run plugin tests, validate the marketplace and the plugin, syntax-check every .mjs

Every command exits 0 on success and 1 on failure. Add --json for machine-readable output.`;

function run(cmd, cmdArgs) {
  const start = Date.now();
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, ms: Date.now() - start, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

function report(ok, data, text) {
  process.stdout.write(json ? `${JSON.stringify({ ok, ...data }, null, 2)}\n` : `${text}\n`);
  process.exit(ok ? 0 : 1);
}

function mjsFiles(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
    .map((e) => join(dir, e.parentPath ? e.parentPath.slice(join(root, dir).length) : "", e.name));
}

// First .githooks stub that is missing, not executable or does not run its guard, else null.
function hookProblem() {
  const guards = { "pre-commit": "branch-guard.mjs", "pre-merge-commit": "branch-guard.mjs", "pre-push": "branch-guard.mjs", "commit-msg": "attribution-guard.mjs" };
  for (const [name, guard] of Object.entries(guards)) {
    const file = join(root, ".githooks", name);
    if (!existsSync(file)) return `.githooks/${name} is missing. Copy it from the dev-factory plugin templates/githooks`;
    if (!(statSync(file).mode & 0o111)) return `.githooks/${name} is not executable. Run: chmod +x .githooks/${name}`;
    if (!readFileSync(file, "utf8").includes(guard)) return `.githooks/${name} does not run ${guard}. Restore it from the dev-factory plugin templates/githooks`;
  }
  return null;
}

function doctor() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const hooksPath = run("git", ["config", "--get", "core.hooksPath"]);
  const branch = run("git", ["symbolic-ref", "--short", "-q", "HEAD"]);
  const branchProblem = commitViolation(branch.ok ? branch.output : null);
  const checks = [
    { name: "node", ok: major > 22 || (major === 22 && minor >= 18), fix: "Install Node 22.18+" },
    { name: "git hooks", ok: hooksPath.output === ".githooks" && !hookProblem(), fix: hooksPath.output === ".githooks" ? hookProblem() : "git config core.hooksPath .githooks" },
    { name: "work branch (feat/, fix/, hotfix/)", ok: !branchProblem, fix: branchProblem },
  ];
  const text = checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}${c.ok ? "" : `  ->  ${c.fix}`}`).join("\n");
  report(checks.every((c) => c.ok), { checks }, text);
}

function verify() {
  const files = [...mjsFiles("plugins"), ...mjsFiles("scripts")];
  const syntax = files.map((f) => run("node", ["--check", f]));
  const steps = [
    { step: "plugin tests", ...run("node", ["--test", "plugins/dev-factory/scripts/"]) },
    { step: "validate marketplace", ...run("claude", ["plugin", "validate", root]) },
    { step: "validate plugin", ...run("claude", ["plugin", "validate", join(root, "plugins", "dev-factory")]) },
    {
      step: `syntax check (${files.length} files)`,
      ok: syntax.every((s) => s.ok),
      ms: syntax.reduce((t, s) => t + s.ms, 0),
      output: syntax.map((s) => s.output).filter(Boolean).join("\n"),
    },
  ];
  const text = steps
    .map((s) => `${s.ok ? "ok  " : "FAIL"} ${s.step} (${s.ms}ms)${s.ok ? "" : `\n${s.output.split("\n").slice(-20).join("\n")}`}`)
    .join("\n");
  report(steps.every((s) => s.ok), { steps: steps.map(({ output, ...s }) => (s.ok ? s : { ...s, output })) }, text);
}

const [command] = args;
if (command === "doctor") doctor();
else if (command === "verify") verify();
else {
  process.stdout.write(`${HELP}\n`);
  process.exit(command && command !== "--help" && command !== "help" ? 1 : 0);
}
