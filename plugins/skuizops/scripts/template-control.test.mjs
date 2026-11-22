// Tests for templates/control.mjs: copy it into a throwaway project and run `doctor --json`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { treeState } from "./verify-gate.mjs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
function shotProject(app, { pw = false, dir = mkdtempSync(join(tmpdir(), "control-shot-")) } = {}) {
  mkdirSync(join(dir, "scripts"));
  const src = readFileSync(template, "utf8");
  const patched = app ? src.replace("const APP = { start: null, url: null, expect: null };", `const APP = ${JSON.stringify({ expect: "MYAPP", ...app })};`) : src;
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

// Runs `screenshot` without blocking the event loop, so an in-process server can answer.
// `route: null` omits the route argument.
async function runShot(app, { extra = [], cwd, route = "/", dir: given } = {}) {
  const dir = shotProject(app, { pw: true, dir: given });
  const child = spawn("node", [join(dir, "scripts", "control.mjs"), "screenshot", ...(route === null ? [] : [route]), ...extra, "--json"], { cwd: cwd ?? dir });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  const status = await new Promise((r) => child.on("close", r));
  return { status, out: JSON.parse(stdout), dir };
}

// Serves `body` (a string, or a self-contained (req, res) handler) on a free port from a child process whose cwd is the project,
// as a real dev server would, then runs `screenshot` against it.
async function shotAgainst(body, app = {}, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "control-shot-"));
  const handler = typeof body === "function" ? body.toString() : `(_, res) => res.end(${JSON.stringify(body)})`;
  const server = spawn("node", ["-e", `const s = require('http').createServer(${handler}).listen(0, '127.0.0.1', () => console.log(s.address().port))`], { cwd: dir });
  try {
    const port = await new Promise((r) => server.stdout.once("data", (d) => r(Number(d))));
    const url = `http://127.0.0.1:${port}`;
    const r = await runShot({ start: null, url, ...app }, { ...opts, dir });
    return { ...r, stillUp: await fetch(url).then(() => true, () => false) };
  } finally {
    server.kill();
  }
}

const gone = (pid) => {
  try { process.kill(pid, 0); return false; } catch { return true; }
};

// Every test here uses its own temp project and port, so they run at once.
describe("screenshot", { concurrency: true }, () => {
  it("fails and points at APP when it is not set", () => {
    const r = screenshot(null);
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /APP/);
  });
  it("fails and points at APP.expect when it is not set", () => {
    const r = screenshot({ start: null, url: "http://127.0.0.1:1", expect: null });
    assert.equal(r.status, 1);
    assert.match(JSON.parse(r.stdout).error, /APP\.expect/);
  });
  it("refuses another app on the port, starts nothing and leaves that app running", async () => {
    const marker = join(mkdtempSync(join(tmpdir(), "control-marker-")), "started");
    const r = await shotAgainst("<h1>other app</h1>", { start: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`] });
    assert.equal(r.status, 1);
    assert.equal(r.out.error, "port taken");
    assert.match(r.out.detail, /lsof/);
    assert.equal(existsSync(marker), false);
    assert.equal(r.stillUp, true);
  });
  it("captures when the running page contains APP.expect", async () => {
    const r = await shotAgainst("<title>MYAPP</title>");
    assert.equal(r.status, 0);
    assert.equal(r.out.ok, true);
  });
  it("waits for a page whose body streams in after the headers", async () => {
    const r = await shotAgainst((_, res) => { res.write("<title>"); setTimeout(() => res.end("MYAPP</title>"), 2500); });
    assert.equal(r.status, 0);
  });
  it("names the HTTP status when the page lacks APP.expect", async () => {
    const r = await shotAgainst((_, res) => { res.statusCode = 500; res.end("boom"); });
    assert.equal(r.out.error, "port taken");
    assert.match(r.out.detail, /HTTP 500/);
  });
  it("refuses an app it started that lacks APP.expect, and stops it", async () => {
    const probe = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => probe.once("listening", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const pidFile = join(mkdtempSync(join(tmpdir(), "control-pid-")), "pid");
    const start = ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); require('http').createServer((q, s) => s.end('other')).listen(${port}, '127.0.0.1')`];
    const r = await runShot({ start, url: `http://127.0.0.1:${port}` });
    assert.equal(r.out.error, "not the app");
    const pid = Number(readFileSync(pidFile, "utf8"));
    for (let i = 0; i < 30 && !gone(pid); i++) await new Promise((res) => setTimeout(res, 100));
    if (!gone(pid)) process.kill(pid, "SIGKILL");
    assert.equal(gone(pid), true);
  });
  it("captures / when no route is given, into one fixed file per project", async () => {
    const r = await shotAgainst((req, res) => res.end(req.url === "/" ? "<title>MYAPP</title>" : "wrong route"), {}, { route: null });
    assert.equal(r.status, 0);
    assert.equal(r.out.file, join(tmpdir(), `${basename(r.dir)}-screenshot.png`));
  });
  it("writes a relative --out into the caller's directory, as an absolute path", async () => {
    const caller = realpathSync(mkdtempSync(join(tmpdir(), "control-caller-")));
    const r = await shotAgainst("<title>MYAPP</title>", {}, { extra: ["--out", "-shot.png"], cwd: caller });
    assert.equal(r.status, 0);
    assert.equal(r.out.file, join(caller, "-shot.png"));
  });
  for (const extra of [["--out"], ["--out", "--full-page"]]) {
    it(`rejects --out without a path: ${extra.join(" ")}`, () => {
      const r = screenshot({ start: null, url: "http://127.0.0.1:1" }, { extra });
      assert.equal(r.status, 1);
      assert.match(JSON.parse(r.stdout).error, /--out/);
    });
  }
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
  for (const port of ["abc", "70000"]) {
    it(`rejects --port ${port}`, () => {
      const r = screenshot({ start: null, url: "http://127.0.0.1:1" }, { extra: ["--port", port] });
      assert.equal(r.status, 1);
      assert.match(JSON.parse(r.stdout).error, /--port/);
    });
  }
  it("with --port and nothing listening, asks for this checkout's server and does not run APP.start", async () => {
    const probe = createServer().listen(0, "127.0.0.1");
    await new Promise((r) => probe.once("listening", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const marker = join(mkdtempSync(join(tmpdir(), "control-marker-")), "started");
    const r = await runShot({ start: ["node", "-e", `require('fs').writeFileSync(${JSON.stringify(marker)}, '')`], url: "http://127.0.0.1:1" }, { extra: ["--port", String(port)] });
    assert.equal(r.status, 1);
    assert.match(r.out.detail, /start this checkout's dev server on port/);
    assert.equal(existsSync(marker), false);
  });
  const hasLsof = !spawnSync("lsof", ["-v"]).error;
  it("refuses a server running from another checkout, naming its directory", { skip: !hasLsof }, async () => {
    const server = createServer((_, res) => res.end("<title>MYAPP</title>")).listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const r = await runShot({ start: null, url: `http://127.0.0.1:${server.address().port}` });
      assert.equal(r.status, 1);
      assert.equal(r.out.error, "other checkout");
      assert.ok(r.out.detail.includes(realpathSync(process.cwd())));
      assert.match(r.out.detail, /--port/);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
  it("accepts a server running from this project on the --port port", { skip: !hasLsof }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "control-shot-"));
    const server = spawn("node", ["-e", `const s = require('http').createServer((_, res) => res.end('<title>MYAPP</title>')).listen(0, '127.0.0.1', () => console.log(s.address().port))`], { cwd: dir });
    try {
      const port = await new Promise((res) => server.stdout.once("data", (d) => res(Number(d))));
      const o = await runShot({ start: null, url: "http://127.0.0.1:1" }, { dir, extra: ["--port", String(port)] });
      assert.notEqual(o.out.error, "other checkout");
      assert.equal(o.status, 0);
      assert.equal(new URL(o.out.url).port, String(port));
    } finally {
      server.kill();
    }
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

describe("verify: step timeout", () => {
  function verifyIn(env) {
    const dir = mkdtempSync(join(tmpdir(), "control-verify-"));
    mkdirSync(join(dir, "scripts"));
    copyFileSync(template, join(dir, "scripts", "control.mjs"));
    const marker = `control-verify-hang-${process.pid}-${Date.now()}`;
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: `node -e "setInterval(()=>{},1000)" ${marker}` } }));
    const start = Date.now();
    const r = spawnSync("node", ["scripts/control.mjs", "verify"], { cwd: dir, encoding: "utf8", env: { ...process.env, ...env } });
    return { r, ms: Date.now() - start, marker };
  }

  it("cuts a step that never ends, kills its whole process group", () => {
    const { r, ms, marker } = verifyIn({ CONTROL_VERIFY_TIMEOUT_MS: "1500" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL test timed out after/);
    assert.ok(ms < 8000, `took ${ms}ms`);
    assert.notEqual(spawnSync("pgrep", ["-f", marker]).status, 0, "a hung process is still running");
  });
  it("rejects a non-numeric CONTROL_VERIFY_TIMEOUT_MS", () => {
    const { r } = verifyIn({ CONTROL_VERIFY_TIMEOUT_MS: "abc" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /CONTROL_VERIFY_TIMEOUT_MS/);
  });
});

function verifyProject(scripts) {
  const dir = mkdtempSync(join(tmpdir(), "control-filter-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(template, join(dir, "scripts", "control.mjs"));
  writeFileSync(join(dir, "count.mjs"), 'import { appendFileSync } from "node:fs"; appendFileSync("ran.txt", process.argv.slice(2).join(" ") + "\\n");\n');
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }));
  const git = (...args) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });
  const run = (...args) => spawnSync("node", ["scripts/control.mjs", "verify", ...args], { cwd: dir, encoding: "utf8" });
  const ran = () => (existsSync(join(dir, "ran.txt")) ? readFileSync(join(dir, "ran.txt"), "utf8") : "");
  return { dir, git, run, ran };
}

describe("verify --changed and the recorded tree", () => {
  it("records the Stop gate's tree state and skips the next full verify", () => {
    const { dir, git, run, ran } = verifyProject({ test: "node count.mjs test" });
    writeFileSync(join(dir, ".gitignore"), "ran.txt\n");
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    writeFileSync(join(dir, "dirty.txt"), "x");
    const first = run();
    assert.equal(first.status, 0, first.stdout);
    assert.match(ran(), /^test\n$/);
    assert.equal(readFileSync(join(dir, ".git", "skuizops-verified"), "utf8").trim(), treeState(dir));
    const second = run();
    assert.equal(second.status, 0, second.stdout);
    assert.match(second.stdout, /tree already verified, skipped/);
    assert.equal(ran(), "test\n");
  });

  it("forwards only matching paths and does not record a filtered pass", () => {
    const { dir, run, ran } = verifyProject({ typecheck: "node count.mjs typecheck", lint: "node count.mjs lint", test: "node count.mjs test" });
    const skipped = run("--changed", "README.md");
    assert.equal(skipped.status, 0, skipped.stdout);
    assert.match(skipped.stdout, /typecheck \(no matching paths\)/);
    assert.match(skipped.stdout, /test \(no matching paths\)/);
    assert.equal(ran(), "");
    assert.equal(existsSync(join(dir, ".git", "skuizops-verified")), false);
    const code = run("--changed", "src/app.ts");
    assert.equal(code.status, 0, code.stdout);
    assert.match(ran(), /typecheck src\/app\.ts/);
    assert.match(ran(), /lint src\/app\.ts/);
    assert.match(ran(), /test src\/app\.ts/);
    const cs = run("--changed", "Assets/Player.cs");
    assert.equal(cs.status, 0, cs.stdout);
    assert.match(ran(), /test Assets\/Player\.cs/);
    assert.doesNotMatch(ran(), /typecheck Assets\/Player\.cs/);
    assert.equal(existsSync(join(dir, ".git", "skuizops-verified")), false);
  });

  it("fails when it cannot list paths, and rejects an unknown flag", () => {
    const { run } = verifyProject({ test: "node -e \"process.exit(0)\"" });
    const listed = run("--changed");
    assert.equal(listed.status, 1);
    assert.match(listed.stdout, /could not list changed paths/);
    const flag = run("--nope");
    assert.equal(flag.status, 1);
    assert.match(flag.stdout, /unknown verify flag/);
  });
});
