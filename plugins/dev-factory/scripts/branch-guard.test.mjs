import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkCommand, commitViolation, isProtected, pushViolation } from "./branch-guard.mjs";

describe("isProtected", () => {
  for (const ref of ["develop", "desarrollo", "desa", "main", "master", "production", "prod", "test", "release", "release/1.2", "refs/heads/main", "MAIN"]) {
    it(`protects ${ref}`, () => assert.equal(isProtected(ref), true));
  }
  for (const ref of ["feat/login", "feat/main-menu", "testing", "maintenance"]) {
    it(`does not protect ${ref}`, () => assert.equal(isProtected(ref), false));
  }
});

describe("commitViolation", () => {
  it("allows feat/ branches", () => assert.equal(commitViolation("feat/login"), null));
  it("blocks protected branches", () => assert.match(commitViolation("main"), /protected/));
  for (const branch of ["fix/null-total", "hotfix/prod-crash"]) {
    it(`allows ${branch}`, () => assert.equal(commitViolation(branch), null));
  }
  it("blocks other prefixes", () => assert.match(commitViolation("chore/deps"), /not a feat\//));
  it("blocks detached HEAD", () => assert.match(commitViolation(null), /detached/));
});

describe("pushViolation", () => {
  it("allows feat/ targets", () => assert.equal(pushViolation("refs/heads/feat/login"), null));
  it("allows fix/ and hotfix/ targets", () => {
    assert.equal(pushViolation("refs/heads/fix/bug"), null);
    assert.equal(pushViolation("refs/heads/hotfix/urgent"), null);
  });
  it("blocks protected targets", () => assert.match(pushViolation("refs/heads/develop"), /protected/));
});

describe("checkCommand", () => {
  const onFeat = "feat/login";
  it("ignores non-git commands", () => assert.equal(checkCommand("npm test", "main"), null));
  it("allows commit on feat/", () => assert.equal(checkCommand('git commit -m "x"', onFeat), null));
  it("blocks commit on main", () => assert.match(checkCommand('git add . && git commit -m "x"', "main"), /blocked/));
  it("blocks --no-verify", () => assert.match(checkCommand('git commit --no-verify -m "x"', onFeat), /no-verify/));
  it("blocks core.hooksPath changes", () => assert.match(checkCommand("git config core.hooksPath /dev/null", onFeat), /hooksPath/));
  it("allows git config core.hooksPath .githooks", () => {
    assert.equal(checkCommand("git config core.hooksPath .githooks", onFeat), null);
    assert.equal(checkCommand("git config --local core.hooksPath .githooks", onFeat), null);
  });
  it("blocks git -c core.hooksPath=x commit", () => assert.match(checkCommand("git -c core.hooksPath=x commit -m y", onFeat), /hooksPath/));
  it("allows push of feat/", () => assert.equal(checkCommand("git push -u origin feat/login", onFeat), null));
  it("blocks push to protected refspec", () => assert.match(checkCommand("git push origin feat/login:main", onFeat), /protected/));
  it("blocks bare push from main", () => assert.match(checkCommand("git push", "main"), /protected/));
  it("blocks push --all", () => assert.match(checkCommand("git push --all origin", onFeat), /--all/));
  it("blocks merge while on develop", () => assert.match(checkCommand("git merge feat/login", "develop"), /blocked/));
  it("allows merging main into a feat/ branch", () => assert.equal(checkCommand("git merge main", onFeat), null));
});

// Regression cases found by the verifier in a real Claude Code session.
describe("checkCommand bypass regressions", () => {
  const onFeat = "feat/login";
  it("blocks commit on main with git -c options", () =>
    assert.match(checkCommand("git -c user.name=t -c user.email=t@t commit -m test", "main"), /blocked/));
  it("blocks commit on main with git -C dir", () => assert.match(checkCommand("git -C . commit -m x", "main"), /blocked/));
  it("blocks commit -n (short --no-verify)", () => assert.match(checkCommand("git commit -n -m x", onFeat), /no-verify/));
  it("blocks combined short flags containing n", () => assert.match(checkCommand('git commit -anm "x"', onFeat), /no-verify/));
  it("blocks git wrapped in bash -c quotes", () => assert.match(checkCommand("bash -c 'git commit -m t'", "main"), /blocked/));
  it("blocks git called by absolute path", () => assert.match(checkCommand("/usr/bin/git commit -m t", "main"), /blocked/));
  it("still allows commit on feat/ with -c options", () =>
    assert.equal(checkCommand("git -c user.name=t commit -m x", onFeat), null));
  it("does not treat merge -n (no-stat) as no-verify", () => assert.equal(checkCommand("git merge -n main", onFeat), null));
});

// Regression: the entry point compared paths without resolving symlinks, so the guard
// silently did nothing (failed open) when invoked through a symlinked path.
describe("entry point through a symlinked path", () => {
  it("still blocks a commit on main", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const base = mkdtempSync(join(tmpdir(), "guard-link-"));
    symlinkSync(dirname(fileURLToPath(import.meta.url)), join(base, "link"));
    const repo = mkdtempSync(join(tmpdir(), "guard-repo-"));
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    const r = spawnSync("node", [join(base, "link", "branch-guard.mjs"), "pre-commit"], { cwd: repo, input: "", encoding: "utf8" });
    assert.equal(r.status, 2, r.stderr);
  });
});

describe("checkCommand: after the trust list check moved to path-guard bash", () => {
  it("still enforces the branch policy and allows the setup step", () => {
    assert.match(checkCommand('git commit -m "x"', "main"), /protected/);
    assert.equal(checkCommand("git config core.hooksPath .githooks", "feat/x"), null);
  });
});
