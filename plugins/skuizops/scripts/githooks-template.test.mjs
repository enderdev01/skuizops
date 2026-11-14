// The git hook templates pick the guard installed with the plugin, or fall back to the repo copy.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scripts = fileURLToPath(new URL(".", import.meta.url));
const templates = fileURLToPath(new URL("../templates/githooks/", import.meta.url));
const GUARDS = ["branch-guard.mjs", "scope.mjs", "attribution-guard.mjs"];

// A fake install: real guards, or a guard that allows everything.
function install(home, marketplace, version, { fake = false, files = GUARDS } = {}) {
  const dir = join(home, ".claude", "plugins", "cache", marketplace, "skuizops", version, "scripts");
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    if (fake) writeFileSync(join(dir, f), "process.exit(0);\n");
    else copyFileSync(join(scripts, f), join(dir, f));
  }
  return join(dir, "..");
}

// installed_plugins.json: the user-scope entry of skuizops points at installPath.
function register(home, installPath) {
  const file = join(home, ".claude", "plugins", "installed_plugins.json");
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  const entry = { scope: "user", installPath, version: "x" };
  writeFileSync(file, JSON.stringify({ version: 2, plugins: { "skuizops@juicebar": [entry] } }));
}

function repo({ withCopy = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), "hooks-"));
  const dir = join(home, "repo");
  const git = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8", env: { ...process.env, HOME: home } });
  mkdirSync(dir);
  git("init", "-q");
  cpSync(templates, join(dir, ".githooks"), { recursive: true });
  if (withCopy) {
    mkdirSync(join(dir, "scripts", "guard"), { recursive: true });
    for (const f of GUARDS) copyFileSync(join(scripts, f), join(dir, "scripts", "guard", f));
  }
  git("config", "core.hooksPath", ".githooks");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  const commit = (branch, msg = "feat: x") => {
    git("switch", "-qc", branch);
    return git("commit", "-q", "--allow-empty", "-m", msg);
  };
  return { home, commit };
}

describe("git hook templates", () => {
  it("use the installed guard even when the repo copy is gone", () => {
    const r = repo({ withCopy: false });
    register(r.home, install(r.home, "juicebar", "0.4.0"));
    assert.equal(r.commit("main").status, 1);
  });
  it("ignore a skuizops installed from another marketplace", () => {
    const r = repo();
    register(r.home, install(r.home, "juicebar", "0.4.0"));
    install(r.home, "aa-other", "9.9.9", { fake: true });
    assert.equal(r.commit("main").status, 1);
  });
  it("use the installed version, never a newer directory next to it", () => {
    const r = repo();
    register(r.home, install(r.home, "juicebar", "0.4.0"));
    install(r.home, "juicebar", "0.10.0", { fake: true });
    assert.equal(r.commit("main").status, 1);
    const r2 = repo();
    register(r2.home, install(r2.home, "juicebar", "0.4.0", { fake: true }));
    install(r2.home, "juicebar", "0.10.0");
    assert.equal(r2.commit("main").status, 0);
  });
  it("fall back to the repo copy when the installed entry is orphaned", () => {
    const r = repo();
    const p = install(r.home, "juicebar", "0.4.0", { fake: true });
    writeFileSync(join(p, ".orphaned_at"), "1");
    register(r.home, p);
    assert.equal(r.commit("main").status, 1);
  });
  it("fall back when installPath is outside the cache", () => {
    const r = repo();
    const p = join(r.home, "elsewhere");
    mkdirSync(join(p, "scripts"), { recursive: true });
    for (const f of GUARDS) writeFileSync(join(p, "scripts", f), "process.exit(0);\n");
    register(r.home, p);
    assert.equal(r.commit("main").status, 1);
    // The same directory, spelled as a path that starts inside the cache and climbs out of it.
    register(r.home, `${join(r.home, ".claude", "plugins", "cache")}/../../../elsewhere`);
    assert.equal(r.commit("main").status, 1);
  });
  it("fall back without installed_plugins.json, and fail when no fallback exists", () => {
    assert.equal(repo().commit("main").status, 1);
    assert.notEqual(repo({ withCopy: false }).commit("feat/x").status, 0);
  });
  it("skip an old install that lacks the guard, instead of failing every commit", () => {
    const r = repo();
    register(r.home, install(r.home, "juicebar", "0.3.0", { files: ["branch-guard.mjs", "scope.mjs"] }));
    assert.equal(r.commit("feat/x").status, 0);
    assert.equal(r.commit("fix/y", "fix: y\n\nCo-Authored-By: Claude <noreply@anthropic.com>").status, 1);
  });
  it("fall back to the repo copy without the plugin", () => {
    const r = repo();
    assert.equal(r.commit("main").status, 1);
    assert.equal(r.commit("feat/ok").status, 0);
  });
});
