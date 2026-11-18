import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inScope, isTrusted, mainWorktree, scopeRoots, trustHint } from "./scope.mjs";

const env = { HOME: "/Users/ada" };

describe("scopeRoots", () => {
  it("defaults to ~/DEV", () => assert.deepEqual(scopeRoots(env), ["/Users/ada/DEV"]));
  it("adds SKUIZOPS_ROOTS to ~/DEV without duplicates", () =>
    assert.deepEqual(scopeRoots({ ...env, SKUIZOPS_ROOTS: "/work:/Users/ada/DEV" }), ["/Users/ada/DEV", "/work"]));
});

describe("inScope", () => {
  it("includes a project inside ~/DEV", () => assert.equal(inScope("/Users/ada/DEV/onistream", env), true));
  it("includes a nested folder inside ~/DEV", () => assert.equal(inScope("/Users/ada/DEV/onistream/frontend", env), true));
  it("includes ~/DEV itself", () => assert.equal(inScope("/Users/ada/DEV", env), true));
  it("excludes projects outside ~/DEV", () => assert.equal(inScope("/Users/ada/rimacDev", env), false));
  it("excludes sibling folders that share the prefix", () => assert.equal(inScope("/Users/ada/DEVELOPMENT/app", env), false));
  it("ignores a trailing slash", () => assert.equal(inScope("/Users/ada/DEV/app/", env), true));
  it("excludes an unknown directory", () => assert.equal(inScope(undefined, env), false));
  it("includes a case variant of a root", () => assert.equal(inScope("/users/ADA/dev/app", env), true));
  it("includes a symlink into a root", () => {
    const base = mkdtempSync(join(tmpdir(), "scope-"));
    mkdirSync(join(base, "real", "app"), { recursive: true });
    symlinkSync(join(base, "real"), join(base, "link"));
    assert.equal(inScope(join(base, "link", "app"), { HOME: "/nowhere", SKUIZOPS_ROOTS: join(base, "real") }), true);
  });
  it("keeps ~/DEV in scope when SKUIZOPS_ROOTS names other roots", () =>
    assert.equal(inScope("/Users/ada/DEV/app", { ...env, SKUIZOPS_ROOTS: "/nowhere" }), true));
});

describe("isTrusted", () => {
  const home = mkdtempSync(join(tmpdir(), "trust-"));
  const env = { HOME: home };
  it("trusts nothing when the list is missing", () => assert.equal(isTrusted("/work/app", env), false));
  it("trusts a listed project exactly, not its subfolders or siblings", () => {
    mkdirSync(join(home, ".config", "skuizops"), { recursive: true });
    writeFileSync(join(home, ".config", "skuizops", "trusted-projects"), "# mine\n/work/app\n\nrelative/ignored\n");
    assert.equal(isTrusted("/work/app", env), true);
    assert.equal(isTrusted("/work/app/packages/web", env), false);
    assert.equal(isTrusted("/work/apple", env), false);
    assert.equal(isTrusted("relative/ignored", env), false);
  });
  it("trusts a symlink to a listed project, not a case variant of it", () => {
    const project = join(home, "app");
    mkdirSync(project);
    mkdirSync(join(home, ".config", "skuizops"), { recursive: true });
    writeFileSync(join(home, ".config", "skuizops", "trusted-projects"), `${project}\n`);
    symlinkSync(project, join(home, "link"));
    assert.equal(isTrusted(join(home, "link"), env), true);
    assert.equal(isTrusted(project.toUpperCase(), env), false);
  });
  it("never trusts a directory name containing a newline", () => {
    assert.equal(isTrusted("/work/app\n/work/b", env), false);
  });
});

describe("linked worktrees", () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wt-")));
  const env = { HOME: base };
  const main = join(base, "main");
  const wt = join(base, "wt");
  const git = (...args) => spawnSync("git", ["-C", main, "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
  mkdirSync(main);
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "init");
  git("worktree", "add", "-q", wt, "-b", "feat/x");
  const trustList = (text) => {
    mkdirSync(join(base, ".config", "skuizops"), { recursive: true });
    writeFileSync(join(base, ".config", "skuizops", "trusted-projects"), text);
  };

  it("mainWorktree gives the main root for a worktree, itself for the main, null outside git", () => {
    assert.equal(mainWorktree(wt), main);
    assert.equal(mainWorktree(main), main);
    assert.equal(mainWorktree(tmpdir()), null);
  });
  it("does not trust a worktree through its trusted main worktree, only when listed itself", () => {
    trustList(`${main}\n`);
    assert.equal(isTrusted(wt, env), false);
    trustList(`${main}\n${wt}\n`);
    assert.equal(isTrusted(wt, env), true);
  });
  it("does not inherit trust through a symlinked .git pointing at a real worktree", () => {
    trustList(`${main}\n`);
    const z = join(base, "linked-git");
    mkdirSync(z);
    symlinkSync(join(wt, ".git"), join(z, ".git"));
    assert.equal(isTrusted(z, env), false);
  });
  it("does not inherit trust through a forged .git file", () => {
    trustList(`${main}\n`);
    const fake = join(base, "fake");
    mkdirSync(fake);
    writeFileSync(join(fake, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
    assert.equal(isTrusted(fake, env), false);
  });
  it("does not inherit trust through a fully self-contained forged worktree admin dir", () => {
    trustList(`${main}\n`);
    const x = join(base, "forged");
    const admin = join(x, "fake");
    mkdirSync(join(admin, "objects"), { recursive: true });
    mkdirSync(join(admin, "refs"));
    writeFileSync(join(admin, "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(admin, "commondir"), `${join(main, ".git")}\n`);
    writeFileSync(join(admin, "gitdir"), `${join(x, ".git")}\n`);
    writeFileSync(join(x, ".git"), `gitdir: ${admin}\n`);
    assert.notEqual(mainWorktree(x), main);
    assert.equal(isTrusted(x, env), false);
  });
});

describe("trustHint", () => {
  it("emits one line, not a command, for a directory name containing a newline", () => {
    const hint = trustHint("/w/a\nb", { HOME: "/h" });
    assert.equal(hint.split("\n").length, 1);
    assert.match(hint, /newline/);
    assert.doesNotMatch(hint, /mkdir/);
  });
  it("quotes a hostile directory name so pasting it runs nothing", () => {
    const hint = trustHint('/w/a"$(touch /tmp/pwn)"\'b', { HOME: "/h" });
    assert.equal(hint, `mkdir -p '/h/.config/skuizops' && echo '/w/a"$(touch /tmp/pwn)"'\\''b' >> '/h/.config/skuizops/trusted-projects'`);
  });
});
