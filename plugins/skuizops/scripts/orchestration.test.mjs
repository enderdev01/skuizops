import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const lemon = read("../agents/lemon.md");
const cherry = read("../agents/cherry.md");
const mango = read("../agents/mango.md");

describe("lemon plans before it delegates", () => {
  it("requires a falsifiable predicate and a plan file, and a trivial change may skip only the file", () => {
    assert.match(lemon, /\.skuizops\/plan\.md/);
    assert.match(lemon, /falsifiable predicate/);
    assert.match(lemon, /may skip the file/);
    assert.match(lemon, /may not skip the predicate/);
    assert.match(lemon, /lemon-mode/);
    assert.match(lemon, /show-your-work/);
    assert.match(lemon, /decisions\.tsv/);
  });

  it("caps cherry at 2 to 4 checks and does not grow the list between FAILs", () => {
    assert.match(lemon, /2 to 4 finish checks/);
    assert.match(lemon, /The cap is 4/);
    assert.match(lemon, /once after the last FAIL/);
    assert.match(lemon, /does not start another cherry round/);
    assert.match(cherry, /Do not widen the list after a FAIL/);
    assert.match(cherry, /Stop as soon as the done-predicate passes/);
  });

  it("keeps a PASS when the patch-id is unchanged", () => {
    assert.match(lemon, /patch-id --stable/);
    assert.match(lemon, /same patch-id and the same hashes keep the PASS/);
    assert.match(cherry, /patch-id --stable/);
  });

  it("skips a full verify the gate already recorded and offers a path-filtered mode", () => {
    for (const text of [lemon, cherry, mango]) {
      assert.match(text, /verify --changed/);
      assert.match(text, /tree already verified/);
    }
  });

  it("aggregates parallel cherries and stops at the PR", () => {
    assert.match(lemon, /One cherry is the default/);
    assert.match(lemon, /ISSUES when any FAIL/);
    assert.match(lemon, /BLOCKED when a check is BLOCKED/);
    assert.match(lemon, /Do not merge on your own and do not arm auto-merge; merge only when the human asks/);
    assert.match(lemon, /gh pr merge <n> --squash/);
  });

  it("merges only on request and then cleans without asking, never forcing unmerged work", () => {
    const section = (name) => lemon.split(`## ${name}\n`)[1]?.split("\n## ")[0] ?? "";
    const merge = section("Merge on request");
    assert.match(merge, /that request is the approval for the merge and for the cleanup/);
    assert.match(merge, /A failing check: report it and stop/);
    assert.match(merge, /Do not pass `--delete-branch` and do not use `--admin` or `--auto`/);
    const after = section("After a merge");
    assert.match(after, /clean what the merge orphaned without being asked/);
    assert.match(after, /never a protected branch, never one with an open PR/);
    assert.match(after, /`git worktree remove <path>`, never `--force`/);
    assert.match(after, /a `MERGED` PR whose `headRefOid` equals the tip you are about to delete/);
    assert.match(after, /Being an ancestor of the default branch is not enough/);
    assert.match(after, /`git push --force-with-lease=<branch>:<headRefOid> origin --delete <branch>`/);
    assert.doesNotMatch(after, /`git push origin --delete/);
    assert.match(after, /A tip that moved after the merge, or a refused lease, holds unmerged work: report it and keep it/);
    assert.match(after, /When another session is live in this checkout, skip the switch/);
    assert.doesNotMatch(after, /ask the human whether to clean/);
  });
});

describe("lemon-mode playbooks", () => {
  const skill = read("../skills/lemon-mode/SKILL.md");
  for (const name of ["feature", "bug-fix", "autonomous-run", "shipping", "visual"]) {
    it(`routes to ${name} and the file is present`, () => {
      assert.match(skill, new RegExp(`playbooks/${name}\\.md`));
      assert.equal(existsSync(new URL(`../skills/lemon-mode/playbooks/${name}.md`, import.meta.url)), true);
    });
  }

  it("shipping does not merge", () => {
    const shipping = read("../skills/lemon-mode/playbooks/shipping.md");
    assert.match(shipping, /Do not arm auto-merge/);
    assert.match(shipping, /Do not run `gh pr merge` on your own: only when the human asks/);
    assert.match(shipping, /CI green/);
    assert.match(shipping, /patch-id/);
  });

  it("visual and the verify skill refuse a scene PASS without the artifact", () => {
    const visual = read("../skills/lemon-mode/playbooks/visual.md");
    const verify = read("../skills/verify/SKILL.md");
    const setup = read("../skills/create-verification-skill/SKILL.md");
    for (const text of [visual, verify, cherry, setup]) assert.match(text, /Unity/);
    assert.match(verify, /blank canvas/);
    assert.match(verify, /EditMode test/);
    assert.match(setup, /blank capture is not a passing observation/);
    assert.match(setup, /ProjectSettings\/ProjectVersion\.txt/);
  });
});
