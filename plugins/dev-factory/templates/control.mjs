#!/usr/bin/env node
// Verification CLI: the lever agents use to check their own work.
// Every command supports --json. Exit 0 on success, 1 on failure.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const args = argv.filter((a) => a !== "--json");

const HELP = `Usage: node scripts/control.mjs <command> [--json]

Commands:
  doctor    Check the environment is ready (node, deps, git hooks, branch)
  verify    Run the project's typecheck, lint and test npm scripts that exist; report each step

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

async function doctor() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  const hooksPath = run("git", ["config", "--get", "core.hooksPath"]);
  const branch = run("git", ["symbolic-ref", "--short", "-q", "HEAD"]);
  const isRepo = run("git", ["rev-parse", "--is-inside-work-tree"]).ok;

  let branchProblem = null;
  try {
    const { commitViolation } = await import("./guard/branch-guard.mjs");
    branchProblem = commitViolation(branch.ok ? branch.output : null);
  } catch {
    branchProblem = "scripts/guard/branch-guard.mjs is missing. Copy it from the dev-factory plugin (see the create-verification-skill skill)";
  }

  const checks = [
    { name: "node", ok: major > 22 || (major === 22 && minor >= 18), fix: "Install Node 22.18+" },
    ...(existsSync(join(root, "package.json"))
      ? [{ name: "dependencies", ok: existsSync(join(root, "node_modules")), fix: "npm install" }]
      : []),
    { name: "git repository", ok: isRepo, fix: "git init" },
    { name: "git hooks", ok: hooksPath.output === ".githooks", fix: "git config core.hooksPath .githooks" },
    { name: "work branch (feat/, fix/, hotfix/)", ok: isRepo && !branchProblem, fix: branchProblem ?? "git init" },
  ];
  const ok = checks.every((c) => c.ok);
  const text = checks.map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}${c.ok ? "" : `  ->  ${c.fix}`}`).join("\n");
  report(ok, { checks }, text);
}

function verify() {
  let scripts = {};
  try {
    scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts ?? {};
  } catch {}
  const names = ["typecheck", "lint", "test"].filter((name) => scripts[name]);
  if (names.length === 0) {
    report(false, { error: "no typecheck, lint or test script" }, "FAIL no typecheck, lint or test script in package.json  ->  add at least one, then re-run verify");
  }
  const steps = names.map((step) => ({ step, ...run("npm", ["run", step, "--silent"]) }));
  const ok = steps.every((s) => s.ok);
  const text = steps
    .map((s) => `${s.ok ? "ok  " : "FAIL"} ${s.step} (${s.ms}ms)${s.ok ? "" : `\n${s.output.split("\n").slice(-20).join("\n")}`}`)
    .join("\n");
  report(ok, { steps: steps.map(({ output, ...s }) => (s.ok ? s : { ...s, output })) }, text);
}

// Add one function per user-facing feature, then register it below. Example:
//
// function greet(lineArgs) {
//   const name = lineArgs[0];
//   if (!name) report(false, { error: "no name" }, "Error: pass a name, e.g. greet Ada");
//   report(true, { greeting: `Hello, ${name}` }, `Hello, ${name}`);
// }
// ...and in the dispatch: else if (command === "greet") greet(rest);
// Also add the command to HELP and a row to .claude/verification/features/README.md.

const [command] = args;
if (command === "doctor") await doctor();
else if (command === "verify") verify();
else {
  process.stdout.write(`${HELP}\n`);
  process.exit(command && command !== "--help" && command !== "help" ? 1 : 0);
}
