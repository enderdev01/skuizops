import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leftovers, message } from "./leftovers.mjs";

const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

// A clone whose origin/main exists, on branch feat/current.
function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "leftovers-")));
  const origin = join(dir, "origin");
  const root = join(dir, "work");
  mkdirSync(origin);
  git(origin, "init", "-q", "-b", "main");
  git(origin, "commit", "-q", "--allow-empty", "-m", "init");
  git(dir, "clone", "-q", origin, "work");
  git(root, "switch", "-q", "-c", "feat/current");
  return { dir, root };
}

describe("leftovers", () => {
  it("a clean repo has none and an empty message", () => {
    const { root } = repo();
    const found = leftovers(root);
    assert.deepEqual(found, { backups: [], branches: [], worktrees: [] });
    assert.equal(message(found), "");
  });

  it("lists installer backups", () => {
    const { root } = repo();
    mkdirSync(join(root, "scripts", "guard"), { recursive: true });
    mkdirSync(join(root, ".githooks"));
    writeFileSync(join(root, "scripts", "guard", "x.mjs.local-20260101-120000"), "");
    writeFileSync(join(root, ".githooks", "pre-commit.local-20260101-120000"), "");
    writeFileSync(join(root, ".githooks", "pre-commit"), "");
    assert.deepEqual(leftovers(root).backups.sort(), [".githooks/pre-commit.local-20260101-120000", "scripts/guard/x.mjs.local-20260101-120000"]);
  });

  it("lists merged branches, not the current, protected or unmerged ones", () => {
    const { root } = repo();
    git(root, "branch", "feat/done");
    git(root, "branch", "develop");
    git(root, "switch", "-q", "-c", "feat/wip");
    git(root, "commit", "-q", "--allow-empty", "-m", "wip");
    git(root, "switch", "-q", "feat/current");
    assert.deepEqual(leftovers(root).branches, ["feat/done"]);
  });

  it("lists a merged clean worktree, not a dirty or unmerged one, and not its branch", () => {
    const { dir, root } = repo();
    git(root, "worktree", "add", "-q", "-b", "feat/clean", join(dir, "clean"));
    git(root, "worktree", "add", "-q", "-b", "feat/dirty", join(dir, "dirty"));
    writeFileSync(join(dir, "dirty", "f.txt"), "x");
    git(root, "worktree", "add", "-q", "-b", "feat/unmerged", join(dir, "unmerged"));
    git(join(dir, "unmerged"), "commit", "-q", "--allow-empty", "-m", "wip");
    const found = leftovers(root);
    assert.deepEqual(found.worktrees, [join(dir, "clean")]);
    assert.deepEqual(found.branches, []);
  });

  it("no remote default branch reports no branches or worktrees", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "leftovers-")));
    git(dir, "init", "-q", "-b", "feat/a");
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
    git(dir, "branch", "feat/b");
    assert.deepEqual(leftovers(dir), { backups: [], branches: [], worktrees: [] });
  });

  it("message names everything and forbids forcing and unasked deletes", () => {
    const text = message({ backups: [".githooks/a.local-20260101-120000"], branches: ["feat/done"], worktrees: ["/w/clean"] });
    assert.match(text, /a\.local-20260101-120000/);
    assert.match(text, /feat\/done/);
    assert.match(text, /\/w\/clean/);
    assert.match(text, /ask whether to clean/);
    assert.match(text, /never `--force`/);
    assert.match(text, /never `-D`/);
    assert.match(text, /Never delete anything without a yes/);
  });
});
