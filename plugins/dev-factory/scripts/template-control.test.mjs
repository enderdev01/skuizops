// Tests for templates/control.mjs: copy it into a throwaway project and run `doctor --json`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// Copies the template into a temp project, optionally patching its APP line and stubbing the project's Playwright.
function shotProject(app, { pw = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "control-shot-"));
  mkdirSync(join(dir, "scripts"));
  const src = readFileSync(template, "utf8");
  const patched = app ? src.replace("const APP = { start: null, url: null };", `const APP = ${JSON.stringify(app)};`) : src;
  assert.notEqual(patched === src, Boolean(app));
  writeFileSync(join(dir, "scripts", "control.mjs"), patched);
  if (pw) {
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(dir, "node_modules", ".bin", "playwright"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return dir;
}

// Runs `screenshot <route> ...extra --json` in a fresh project.
function screenshot(app, { env = {}, pw = true, route = "/", extra = [] } = {}) {
  const dir = shotProject(app, { pw });
  return spawnSync("node", ["scripts/control.mjs", "screenshot", route, ...extra, "--json"], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
}

const gone = (pid) => {
  try { process.kill(pid, 0); return false; } catch { return true; }
};

describe("screenshot", () => {
  it("fails and points at APP when it is not set", () => {
    const r = screenshot(null);
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /APP/);
  });
  it("fails fast when the start command exits and the url never answers", () => {
    const r = screenshot({ start: ["node", "-e", ""], url: "http://127.0.0.1:1" }, { env: { CONTROL_START_TIMEOUT_MS: "1500" } });
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, "app did not start");
  });
  it("fails at once, with its output, when the start command dies", () => {
    const t = Date.now();
    const r = screenshot({ start: ["node", "-e", "console.error('boom'); process.exit(3)"], url: "http://127.0.0.1:1" });
    assert.equal(r.status, 1);
    assert.ok(Date.now() - t < 5000);
    assert.match(r.stdout, /boom/);
  });
  it("names the install hint and starts no server when Playwright is missing", () => {
    const marker = join(mkdtempSync(join(tmpdir(), "control-marker-")), "started");
    const r = screenshot({ start: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`], url: "http://127.0.0.1:1" }, { pw: false });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).fix, /npm i -D playwright && npx playwright install chromium/);
    assert.equal(existsSync(marker), false);
  });
  it("rejects a non-numeric --wait", () => {
    const r = screenshot({ start: null, url: "http://127.0.0.1:1" }, { extra: ["--wait", "abc"] });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /--wait/);
  });
  it("rejects a bare --wait", () => {
    const r = screenshot({ start: null, url: "http://127.0.0.1:1" }, { extra: ["--wait"] });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /--wait/);
  });
  it("rejects a non-numeric CONTROL_START_TIMEOUT_MS", () => {
    const r = screenshot({ start: null, url: "http://127.0.0.1:1" }, { env: { CONTROL_START_TIMEOUT_MS: "abc" } });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /CONTROL_START_TIMEOUT_MS/);
  });
  for (const route of ["http://other/", "//other/", "/\\other/"]) {
    it(`rejects a route that leaves APP's origin: ${route}`, () => {
      const r = screenshot({ start: null, url: "http://127.0.0.1:1" }, { route });
      assert.equal(r.status, 1);
      assert.match(JSON.parse(r.stdout).error, /route/);
    });
  }
  it("rejects a --wait too large for the Playwright timeout", () => {
    const r = screenshot({ start: null, url: "http://127.0.0.1:1" }, { extra: ["--wait", "99999999999999999999"] });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /--wait/);
  });
  it("kills the server it started when interrupted", async () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), "control-pid-")), "pid");
    const dir = shotProject({ start: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`], url: "http://127.0.0.1:1" }, { pw: true });
    const child = spawn("node", ["scripts/control.mjs", "screenshot", "/", "--json"], { cwd: dir, stdio: "ignore" });
    for (let i = 0; i < 50 && !existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
    const pid = Number(readFileSync(pidFile, "utf8"));
    child.kill("SIGTERM");
    for (let i = 0; i < 30 && !gone(pid); i++) await new Promise((r) => setTimeout(r, 100));
    if (!gone(pid)) process.kill(pid, "SIGKILL");
    assert.equal(gone(pid), true);
  });
});
