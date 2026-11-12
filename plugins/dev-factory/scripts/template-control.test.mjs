// Tests for templates/control.mjs: copy it into a throwaway project and run `doctor --json`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const template = fileURLToPath(new URL("../templates/control.mjs", import.meta.url));
const major = Number(process.versions.node.split(".")[0]);

function doctor(files) {
  const dir = mkdtempSync(join(tmpdir(), "control-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(template, join(dir, "scripts", "control.mjs"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const r = spawnSync("node", ["scripts/control.mjs", "doctor", "--json"], { cwd: dir, encoding: "utf8" });
  return JSON.parse(r.stdout).checks.find((c) => c.name.startsWith("node matches"));
}

describe("doctor: node pin", () => {
  it("passes when .nvmrc pins the running major", () => assert.equal(doctor({ ".nvmrc": `v${major}.0.0\n` }).ok, true));
  it("fails when .nvmrc pins another major, and says how to switch", () => {
    const check = doctor({ ".nvmrc": `${major - 2}\n` });
    assert.equal(check.ok, false);
    assert.match(check.fix, new RegExp(`pins Node ${major - 2} .*nvm use`));
  });
  it("reads .node-version", () => assert.equal(doctor({ ".node-version": `${major + 1}` }).ok, false));
  it("reads an exact engines.node range", () =>
    assert.equal(doctor({ "package.json": JSON.stringify({ engines: { node: `^${major - 2}.1.0` } }) }).ok, false));
  it("accepts a newer Node for a >= range", () =>
    assert.equal(doctor({ "package.json": JSON.stringify({ engines: { node: `>=${major - 2}` } }) }).ok, true));
  it("skips the check when nothing pins Node", () => assert.equal(doctor({}), undefined));
  it("skips an alias it cannot compare, like lts/*", () => assert.equal(doctor({ ".nvmrc": "lts/*" }), undefined));
});

const guards = { "pre-commit": "branch-guard.mjs", "pre-merge-commit": "branch-guard.mjs", "pre-push": "branch-guard.mjs", "commit-msg": "attribution-guard.mjs" };

// Builds a temp repo with .githooks stubs; `stubs` maps name -> { text, mode } or null (missing).
function hooksCheck({ hooksPath = ".githooks", stubs = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "control-hooks-"));
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, ".githooks"));
  copyFileSync(template, join(dir, "scripts", "control.mjs"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  if (hooksPath) spawnSync("git", ["config", "core.hooksPath", hooksPath], { cwd: dir });
  for (const [name, guard] of Object.entries(guards)) {
    const stub = stubs[name] === undefined ? { text: `#!/bin/sh\nexec node ${guard}\n`, mode: 0o755 } : stubs[name];
    if (stub) writeFileSync(join(dir, ".githooks", name), stub.text, { mode: stub.mode });
  }
  const r = spawnSync("node", ["scripts/control.mjs", "doctor", "--json"], { cwd: dir, encoding: "utf8" });
  return JSON.parse(r.stdout).checks.find((c) => c.name === "git hooks");
}

describe("doctor: git hooks", () => {
  it("is ok with four executable stubs that run their guard", () => assert.equal(hooksCheck().ok, true));
  it("fails when a stub is missing and names it", () => {
    const check = hooksCheck({ stubs: { "pre-push": null } });
    assert.equal(check.ok, false);
    assert.match(check.fix, /pre-push.*missing/);
  });
  it("fails when a stub is not executable and names it", () => {
    const check = hooksCheck({ stubs: { "pre-merge-commit": { text: "#!/bin/sh\nexec node branch-guard.mjs\n", mode: 0o644 } } });
    assert.equal(check.ok, false);
    assert.match(check.fix, /pre-merge-commit.*not executable/);
  });
  it("fails when a stub does not run its guard and names it", () => {
    const check = hooksCheck({ stubs: { "commit-msg": { text: "#!/bin/sh\nexit 0\n", mode: 0o755 } } });
    assert.equal(check.ok, false);
    assert.match(check.fix, /commit-msg.*attribution-guard\.mjs/);
  });
  it("fails with the config fix when the hooks path is unset", () => {
    const check = hooksCheck({ hooksPath: null });
    assert.equal(check.ok, false);
    assert.equal(check.fix, "git config core.hooksPath .githooks");
  });
});
