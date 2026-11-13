// `install-hooks.mjs` is what the human-only /dev-factory:install-hooks command runs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandViolation } from "./path-guard.mjs";
import { installHooks } from "./install-hooks.mjs";

const scripts = fileURLToPath(new URL(".", import.meta.url));
const script = join(scripts, "install-hooks.mjs");
const templates = join(scripts, "..", "templates", "githooks");
const repo = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "install-hooks-")));
  execFileSync("git", ["init", "-q", dir]);
  return dir;
};
const hooksPath = (dir) => execFileSync("git", ["-C", dir, "config", "core.hooksPath"], { encoding: "utf8" }).trim();

describe("installHooks", () => {
  it("installs executable hooks, identical guards and the hooks path", () => {
    const dir = repo();
    const { root } = installHooks(dir);
    assert.equal(root, dir);
    for (const name of readdirSync(templates)) {
      accessSync(join(dir, ".githooks", name), constants.X_OK);
      assert.equal(readFileSync(join(dir, ".githooks", name), "utf8"), readFileSync(join(templates, name), "utf8"));
    }
    for (const name of ["branch-guard.mjs", "scope.mjs", "attribution-guard.mjs"]) {
      assert.equal(readFileSync(join(dir, "scripts", "guard", name), "utf8"), readFileSync(join(scripts, name), "utf8"));
    }
    assert.equal(hooksPath(dir), ".githooks");
  });

  it("is idempotent, overwrites stale copies and keeps other files", () => {
    const dir = repo();
    installHooks(dir);
    writeFileSync(join(dir, ".githooks", "pre-commit"), "stale");
    writeFileSync(join(dir, ".githooks", "mine"), "keep");
    installHooks(dir);
    assert.equal(readFileSync(join(dir, ".githooks", "pre-commit"), "utf8"), readFileSync(join(templates, "pre-commit"), "utf8"));
    assert.equal(readFileSync(join(dir, ".githooks", "mine"), "utf8"), "keep");
  });

  it("reports a previous, different hooks path", () => {
    const dir = repo();
    execFileSync("git", ["-C", dir, "config", "core.hooksPath", ".husky"]);
    assert.ok(installHooks(dir).actions.some((a) => a.includes(".husky")));
    assert.equal(hooksPath(dir), ".githooks");
  });

  it("resolves the git top-level from a subdirectory", () => {
    const dir = repo();
    mkdirSync(join(dir, "sub"));
    assert.equal(installHooks(join(dir, "sub")).root, dir);
  });

  it("rejects a directory outside a git repository", () => {
    assert.throws(() => installHooks(realpathSync(mkdtempSync(join(tmpdir(), "no-git-")))), /not inside a git repository/);
  });
});

describe("install-hooks.mjs entry point", () => {
  it("installs in the directory argument and prints the root", () => {
    const dir = repo();
    const r = spawnSync("node", [script, dir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`Hooks installed in: ${dir}`));
  });

  it("exits non-zero with a message outside a git repository", () => {
    const r = spawnSync("node", [script, realpathSync(mkdtempSync(join(tmpdir(), "no-git-")))], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not inside a git repository/);
  });
});
