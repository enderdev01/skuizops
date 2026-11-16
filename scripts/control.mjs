#!/usr/bin/env node
// This repo's lever: check the environment and verify the plugin and marketplace.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { commitViolation } from "../plugins/skuizops/scripts/branch-guard.mjs";
import { trustFile } from "../plugins/skuizops/scripts/scope.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const json = argv.includes("--json");
const args = argv.filter((a) => a !== "--json");

const HELP = `Usage: node scripts/control.mjs <command> [--json]

Commands:
  doctor    Check node, git hooks and the current branch
  verify    Run plugin tests, validate the marketplace and the plugin, syntax-check every .mjs
  bench     Run each guard and the Stop gate as their hooks do, in a throwaway repo on "main": verdict, message, median latency

Every command exits 0 on success and 1 on failure. Add --json for machine-readable output.`;

function run(cmd, cmdArgs) {
  const start = Date.now();
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: "utf8" });
  return { ok: r.status === 0, ms: Date.now() - start, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

// Same result as run(), without blocking: verify runs its steps at once.
function runAsync(cmd, cmdArgs) {
  const start = Date.now();
  return new Promise((done) => {
    const child = spawn(cmd, cmdArgs, { cwd: root });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (d) => (output += d));
    child.on("error", (e) => done({ ok: false, ms: Date.now() - start, output: e.message }));
    child.on("close", (status) => done({ ok: status === 0, ms: Date.now() - start, output: output.trim() }));
  });
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
    if (!existsSync(file)) return `.githooks/${name} is missing. Copy it from the skuizops plugin templates/githooks`;
    if (!(statSync(file).mode & 0o111)) return `.githooks/${name} is not executable. Run: chmod +x .githooks/${name}`;
    if (!readFileSync(file, "utf8").includes(guard)) return `.githooks/${name} does not run ${guard}. Restore it from the skuizops plugin templates/githooks`;
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

async function verify() {
  const files = [...mjsFiles("plugins"), ...mjsFiles("scripts"), ...mjsFiles("bin")];
  const start = Date.now();
  const syntaxStep = Promise.all(files.map((f) => runAsync("node", ["--check", f]))).then((syntax) => ({
    ok: syntax.every((s) => s.ok),
    ms: Date.now() - start,
    output: syntax.map((s) => s.output).filter(Boolean).join("\n"),
  }));
  const names = ["plugin tests", "bin tests", "validate marketplace", "validate plugin", `syntax check (${files.length} files)`];
  const results = await Promise.all([
    runAsync("node", ["--test", "plugins/skuizops/scripts/"]),
    runAsync("node", ["--test", "bin/"]),
    runAsync("claude", ["plugin", "validate", root]),
    runAsync("claude", ["plugin", "validate", join(root, "plugins", "skuizops")]),
    syntaxStep,
  ]);
  const steps = results.map((r, i) => ({ step: names[i], ...r }));
  const text = steps
    .map((s) => `${s.ok ? "ok  " : "FAIL"} ${s.step} (${s.ms}ms)${s.ok ? "" : `\n${s.output.split("\n").slice(-20).join("\n")}`}`)
    .join("\n");
  report(steps.every((s) => s.ok), { steps: steps.map(({ output, ...s }) => (s.ok ? s : { ...s, output })) }, text);
}

// Each case is one real hook invocation: [guard script, mode, what the agent tried, expect a block?].
const BENCH_RUNS = 20;
const bash = (command) => ({ tool_input: { command } });
const edit = (file_path) => ({ tool_input: { file_path } });
const BENCH_CASES = [
  ["branch-guard.mjs", "claude", bash('git commit -m "quick fix"'), true],
  ["branch-guard.mjs", "claude", bash("git push origin main"), true],
  ["branch-guard.mjs", "claude", bash('git commit --no-verify -m "skip hooks"'), true],
  ["branch-guard.mjs", "claude", bash("git config core.hooksPath /dev/null"), true],
  ["branch-guard.mjs", "claude", bash("bash -c 'git commit -m x'"), true],
  ["branch-guard.mjs", "claude", bash("git status"), false],
  ["branch-guard.mjs", "claude", bash("npm test"), false],
  ["path-guard.mjs", "bash", bash("rm -rf .githooks"), true],
  ["path-guard.mjs", "bash", bash("echo done > notes.txt"), false],
  ["path-guard.mjs", "", edit(".githooks/pre-commit"), true],
  ["path-guard.mjs", "", edit("src/app.js"), false],
  ["background-guard.mjs", "", { agent_id: "kiwi", tool_input: { command: "npm run dev", run_in_background: true } }, true],
  ["background-guard.mjs", "", { tool_input: { command: "npm run dev", run_in_background: true } }, false],
  ["attribution-guard.mjs", "", "feat: add login\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n", true],
  ["attribution-guard.mjs", "", "feat: add login\n", false],
];

// The Stop gate on a dirty tree of a trusted throwaway project whose verify only counts its runs:
// what a stop costs when the tree changed (verify runs) and when it did not (verify is skipped).
function benchGate(repo, env) {
  const home = join(repo, "home");
  const counter = join(home, "runs");
  const gateEnv = { ...env, HOME: home };
  mkdirSync(dirname(trustFile(gateEnv)), { recursive: true });
  writeFileSync(trustFile(gateEnv), `${repo}\n`);
  mkdirSync(join(repo, "scripts"));
  writeFileSync(join(repo, "scripts", "control.mjs"), `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(counter)}, "x");\n`);
  writeFileSync(join(repo, ".gitignore"), "home\n");
  spawnSync("git", ["-c", "user.name=bench", "-c", "user.email=bench@example.com", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo });
  const runs = () => (existsSync(counter) ? readFileSync(counter, "utf8").length : 0);
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  return [["dirty tree, changed since the last pass", true], ["dirty tree, unchanged since the last pass", false]].map(([tried, change]) => {
    const before = runs();
    const times = [];
    let r;
    for (let i = 0; i < BENCH_RUNS; i++) {
      if (change) writeFileSync(join(repo, "notes.txt"), `${i}`);
      const start = process.hrtime.bigint();
      r = spawnSync("node", [join(root, "plugins", "skuizops", "scripts", "verify-gate.mjs")], { cwd: repo, env: gateEnv, encoding: "utf8", input: JSON.stringify({ cwd: repo }) });
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    const verified = runs() - before;
    return { guard: "verify-gate", tried, blocked: r.status !== 0, verdict: verified ? "verify" : "skip ", ok: r.status === 0 && verified === (change ? BENCH_RUNS : 0), ms: Math.round(median(times)), message: r.stderr.trim() };
  });
}

function bench() {
  const repo = mkdtempSync(join(tmpdir(), "skuizops-bench-"));
  // The Claude hooks only act under the scope roots: add the throwaway repo to them.
  const env = { ...process.env, SKUIZOPS_ROOTS: repo, CLAUDE_PROJECT_DIR: repo };
  const msgFile = join(repo, "COMMIT_MSG");
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  let rows;
  try {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    rows = BENCH_CASES.map(([guard, mode, input, expectBlock]) => {
      const isMsg = typeof input === "string";
      if (isMsg) writeFileSync(msgFile, input);
      const guardArgs = [join(root, "plugins", "skuizops", "scripts", guard), ...(isMsg ? [msgFile] : mode ? [mode] : [])];
      const times = [];
      let r;
      for (let i = 0; i < BENCH_RUNS; i++) {
        const start = process.hrtime.bigint();
        r = spawnSync("node", guardArgs, { cwd: repo, env, encoding: "utf8", input: isMsg ? "" : JSON.stringify({ cwd: repo, ...input }) });
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
      }
      const blocked = r.status !== 0;
      const tried = isMsg ? `commit message ending in ${JSON.stringify(input.trim().split("\n").pop())}` : (input.tool_input.command ?? `Edit ${input.tool_input.file_path}`);
      return { guard: guard.replace(".mjs", ""), tried, blocked, ok: blocked === expectBlock, ms: Math.round(median(times)), message: r.stderr.trim() };
    });
    rows.push(...benchGate(repo, env));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  const text = rows
    .map((r) => `${r.ok ? "ok  " : "FAIL"} ${r.verdict ?? (r.blocked ? "BLOCK" : "allow")} ${String(r.ms).padStart(3)}ms  ${r.guard.padEnd(17)} ${r.tried}${r.message ? `\n       -> ${r.message}` : ""}`)
    .join("\n");
  report(rows.every((r) => r.ok), { runs: BENCH_RUNS, node: process.versions.node, rows }, `${text}\n\nmedian of ${BENCH_RUNS} runs per case, node ${process.versions.node}`);
}

const [command] = args;
if (command === "doctor") doctor();
else if (command === "verify") await verify();
else if (command === "bench") bench();
else {
  process.stdout.write(`${HELP}\n`);
  process.exit(command && command !== "--help" && command !== "help" ? 1 : 0);
}
