// `install-hooks.mjs` is what the human-only /skuizops:install-hooks command runs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

  const manifest = (dir) => JSON.parse(readFileSync(join(dir, ".githooks", ".skuizops.json"), "utf8"));
  const backupsOf = (dir) => readdirSync(join(dir, ".githooks")).filter((f) => f.includes(".local-"));

  it("writes a manifest on a fresh install", () => {
    const dir = repo();
    installHooks(dir);
    const m = manifest(dir);
    assert.equal(m.version, JSON.parse(readFileSync(join(scripts, "..", ".claude-plugin", "plugin.json"), "utf8")).version);
    assert.equal(m.files[".githooks/pre-commit"], createHash("sha256").update(readFileSync(join(templates, "pre-commit"))).digest("hex"));
    assert.ok(m.files["scripts/guard/scope.mjs"]);
  });

  it("re-running reports up to date and makes no backup", () => {
    const dir = repo();
    installHooks(dir);
    const { actions, backups } = installHooks(dir);
    assert.deepEqual(backups, []);
    assert.ok(actions.includes(".githooks/pre-commit is up to date"));
    assert.deepEqual(backupsOf(dir), []);
  });

  it("backs up an edited file, then replaces it, and keeps other files", () => {
    const dir = repo();
    installHooks(dir);
    writeFileSync(join(dir, ".githooks", "pre-commit"), "my edit");
    writeFileSync(join(dir, ".githooks", "mine"), "keep");
    const { backups, actions } = installHooks(dir);
    assert.equal(backups.length, 1);
    assert.match(backups[0], /pre-commit\.local-\d{8}-\d{6}$/);
    assert.equal(readFileSync(backups[0], "utf8"), "my edit");
    assert.ok(actions.some((a) => a.startsWith("Backed up your edits of .githooks/pre-commit")));
    assert.equal(readFileSync(join(dir, ".githooks", "pre-commit"), "utf8"), readFileSync(join(templates, "pre-commit"), "utf8"));
    assert.equal(readFileSync(join(dir, ".githooks", "mine"), "utf8"), "keep");
  });

  it("overwrites without a backup a file still matching the manifest", () => {
    const dir = repo();
    installHooks(dir);
    // Pretend an older plugin wrote "stale" and recorded it.
    writeFileSync(join(dir, ".githooks", "pre-commit"), "stale");
    const m = manifest(dir);
    m.files[".githooks/pre-commit"] = createHash("sha256").update("stale").digest("hex");
    writeFileSync(join(dir, ".githooks", ".skuizops.json"), JSON.stringify(m));
    const { backups, actions } = installHooks(dir);
    assert.deepEqual(backups, []);
    assert.ok(actions.includes("Updated .githooks/pre-commit"));
    assert.equal(readFileSync(join(dir, ".githooks", "pre-commit"), "utf8"), readFileSync(join(templates, "pre-commit"), "utf8"));
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
