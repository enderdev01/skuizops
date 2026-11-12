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
  const dir = join(home, ".claude", "plugins", "cache", marketplace, "dev-factory", version, "scripts");
  mkdirSync(dir, { recursive: true });
  for (const f of files) {
    if (fake) writeFileSync(join(dir, f), "process.exit(0);\n");
    else copyFileSync(join(scripts, f), join(dir, f));
  }
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
    install(r.home, "factory-marketplace", "0.4.0");
    assert.equal(r.commit("main").status, 1);
  });
  it("ignore a dev-factory installed from another marketplace", () => {
    const r = repo();
    install(r.home, "factory-marketplace", "0.4.0");
    install(r.home, "aa-other", "9.9.9", { fake: true });
    assert.equal(r.commit("main").status, 1);
  });
  it("pick the newest version, by version order", () => {
    const r = repo();
    install(r.home, "factory-marketplace", "0.4.0", { fake: true });
    install(r.home, "factory-marketplace", "0.10.0");
    assert.equal(r.commit("main").status, 1);
  });
  it("skip an old install that lacks the guard, instead of failing every commit", () => {
    const r = repo();
    install(r.home, "factory-marketplace", "0.3.0", { files: ["branch-guard.mjs", "scope.mjs"] });
    assert.equal(r.commit("feat/x").status, 0);
    assert.equal(r.commit("fix/y", "fix: y\n\nCo-Authored-By: Claude <noreply@anthropic.com>").status, 1);
  });
  it("fall back to the repo copy without the plugin", () => {
    const r = repo();
    assert.equal(r.commit("main").status, 1);
    assert.equal(r.commit("feat/ok").status, 0);
  });
});
