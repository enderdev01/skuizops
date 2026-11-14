// The Stop gate runs the project's own code only when the human trusted the project.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verdict } from "./verify-gate.mjs";

const gate = fileURLToPath(new URL("./verify-gate.mjs", import.meta.url));

function setup(trusted, { pass = false, git = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "gate-"));
  const project = join(home, "DEV", "app");
  const counter = join(home, "counter");
  mkdirSync(join(project, "scripts"), { recursive: true });
  const body = `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(counter)}, "x"); console.log("ran"); process.exit(${pass ? 0 : 1});\n`;
  writeFileSync(join(project, "scripts", "control.mjs"), body);
  if (trusted) {
    mkdirSync(join(home, ".config", "skuizops"), { recursive: true });
    writeFileSync(join(home, ".config", "skuizops", "trusted-projects"), `${project}\n`);
  }
  const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project, SKUIZOPS_ROOTS: "" };
  const sh = (...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: project, env, encoding: "utf8" });
  if (git) {
    sh("init", "-q");
    sh("add", "-A");
    sh("commit", "-q", "-m", "init");
  }
  const run = (input = {}) => spawnSync("node", [gate], { input: JSON.stringify(input), env, encoding: "utf8" });
  const runs = () => (existsSync(counter) ? readFileSync(counter, "utf8").length : 0);
  return { project, run, runs, sh };
}

describe("verify gate trust", () => {
  it("does not run an untrusted project's code and tells the human how to trust it", () => {
    const r = setup(false).run();
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout + r.stderr, /\bran\b/);
    assert.match(JSON.parse(r.stdout).systemMessage, /not trusted.*trusted-projects/);
  });
  it("runs a trusted project's verify and blocks on failure (not a git repo)", () => {
    const r = setup(true).run();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Project verify is failing[\s\S]*ran/);
  });
});

describe("verdict", () => {
  it("is null when verify passed", () => assert.equal(verdict({ status: 0, stdout: "", stderr: "" }), null));
  it("carries the output tail on failure", () => {
    const out = Array.from({ length: 60 }, (_, i) => `line${i}`).join("\n");
    const v = verdict({ status: 1, stdout: out, stderr: "" });
    assert.match(v, /line59/);
    assert.doesNotMatch(v, /line0\b/);
  });
  it("reports a timeout", () => {
    assert.match(verdict({ status: null, error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" }), /timed out/);
  });
});

describe("verify gate flow", () => {
  it("failing verify blocks on a clean tree with no recorded commit", () => {
    const t = setup(true, { git: true });
    assert.equal(t.run().status, 2);
  });
  it("failing verify blocks on a dirty tree", () => {
    const t = setup(true, { git: true });
    writeFileSync(join(t.project, "dirty.txt"), "x");
    assert.equal(t.run().status, 2);
  });
  it("stop_hook_active still verifies, warns with a systemMessage and exits 0", () => {
    const r = setup(true, { git: true }).run({ stop_hook_active: true });
    assert.equal(r.status, 0);
    assert.match(JSON.parse(r.stdout).systemMessage, /still failing/);
  });
  it("records HEAD after a clean pass, skips next time, verifies after a new commit", () => {
    const t = setup(true, { pass: true, git: true });
    assert.equal(t.run().status, 0);
    assert.equal(t.runs(), 1);
    const head = t.sh("rev-parse", "HEAD").stdout.trim();
    assert.equal(readFileSync(join(t.project, ".git", "skuizops-verified"), "utf8").trim(), head);
    assert.equal(t.run().status, 0);
    assert.equal(t.runs(), 1);
    writeFileSync(join(t.project, "a.txt"), "a");
    t.sh("add", "-A");
    t.sh("commit", "-q", "-m", "more");
    assert.equal(t.run().status, 0);
    assert.equal(t.runs(), 2);
  });
  it("a dirty tree verifies once, skips while unchanged, verifies again after any change", () => {
    const t = setup(true, { pass: true, git: true });
    writeFileSync(join(t.project, "dirty.txt"), "x");
    assert.equal(t.run().status, 0);
    assert.equal(t.run().status, 0);
    assert.equal(t.runs(), 1);
    writeFileSync(join(t.project, "dirty.txt"), "y"); // untracked file content
    t.run();
    assert.equal(t.runs(), 2);
    appendFileSync(join(t.project, "scripts", "control.mjs"), "// edit\n"); // tracked file
    t.run();
    assert.equal(t.runs(), 3);
    writeFileSync(join(t.project, "new.txt"), ""); // new empty untracked file
    t.run();
    assert.equal(t.runs(), 4);
    t.sh("add", "-A");
    t.sh("commit", "-q", "-m", "all"); // same content, now clean on a new HEAD
    t.run();
    assert.equal(t.runs(), 5);
    t.run();
    assert.equal(t.runs(), 5);
  });
  it("every kind of change to a dirty tree verifies again", () => {
    const t = setup(true, { pass: true, git: true });
    const control = join(t.project, "scripts", "control.mjs");
    writeFileSync(join(t.project, "tracked.txt"), "a");
    t.sh("add", "-A");
    t.sh("commit", "-q", "-m", "tracked");
    writeFileSync(join(t.project, "loose.txt"), "x");
    t.run();
    const changes = {
      "stage, then edit again": () => { appendFileSync(control, "// one\n"); t.sh("add", "-A"); appendFileSync(control, "// two\n"); },
      "delete a tracked file": () => rmSync(join(t.project, "tracked.txt")),
      "rename an untracked file": () => renameSync(join(t.project, "loose.txt"), join(t.project, "moved.txt")),
      "chmod +x a tracked file": () => chmodSync(control, 0o755),
    };
    let expected = 1;
    for (const [name, change] of Object.entries(changes)) {
      change();
      t.run();
      assert.equal(t.runs(), ++expected, name);
      t.run();
      assert.equal(t.runs(), expected, `${name}: unchanged afterwards`);
    }
  });
  it("a failing dirty tree is never recorded", () => {
    const t = setup(true, { git: true });
    writeFileSync(join(t.project, "dirty.txt"), "x");
    assert.equal(t.run().status, 2);
    const again = t.run({ stop_hook_active: true });
    assert.equal(again.status, 0);
    assert.match(JSON.parse(again.stdout).systemMessage, /still failing/);
    assert.equal(t.runs(), 2);
    assert.equal(existsSync(join(t.project, ".git", "skuizops-verified")), false);
  });
  it("a repo with no commit verifies on every stop", () => {
    const t = setup(true, { pass: true });
    t.sh("init", "-q");
    assert.equal(t.run().status, 0);
    const r = t.run();
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.equal(t.runs(), 2);
  });
});
