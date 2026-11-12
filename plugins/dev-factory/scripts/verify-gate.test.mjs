// The Stop gate runs the project's own code only when the human trusted the project.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    mkdirSync(join(home, ".config", "dev-factory"), { recursive: true });
    writeFileSync(join(home, ".config", "dev-factory", "trusted-projects"), `${project}\n`);
  }
  const env = { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project, DEV_FACTORY_ROOTS: "" };
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
    assert.equal(readFileSync(join(t.project, ".git", "dev-factory-verified"), "utf8").trim(), head);
    assert.equal(t.run().status, 0);
    assert.equal(t.runs(), 1);
    writeFileSync(join(t.project, "a.txt"), "a");
    t.sh("add", "-A");
    t.sh("commit", "-q", "-m", "more");
    assert.equal(t.run().status, 0);
    assert.equal(t.runs(), 2);
  });
  it("a dirty tree verifies and does not record HEAD", () => {
    const t = setup(true, { pass: true, git: true });
    writeFileSync(join(t.project, "dirty.txt"), "x");
    assert.equal(t.run().status, 0);
    assert.equal(existsSync(join(t.project, ".git", "dev-factory-verified")), false);
  });
});
