import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedPaths, changedVerifyPlan, parseVerifyArgs } from "../../../scripts/control.mjs";
import { markerPath, recordState, treeState } from "./verify-gate.mjs";

const repo = new URL("../../../", import.meta.url);

describe("verify --changed plan", () => {
  it("parses paths and rejects an unknown flag", () => {
    assert.deepEqual(parseVerifyArgs(["--changed", "--", "src/a.ts"]), { changed: true, paths: ["src/a.ts"] });
    assert.deepEqual(parseVerifyArgs([]), { changed: false, paths: [] });
    assert.match(parseVerifyArgs(["--changed", "--nope"]).error, /unknown verify flag/);
  });

  it("syntax-checks a script and runs its sibling test", () => {
    const plan = changedVerifyPlan(["plugins/skuizops/scripts/branch-guard.mjs"], (p) => p.endsWith("branch-guard.test.mjs"));
    assert.deepEqual(plan.map((s) => s.kind), ["syntax", "test"]);
    assert.deepEqual(plan[1].files, ["plugins/skuizops/scripts/branch-guard.test.mjs"]);
  });

  it("runs the agent tests when an agent or skill changes, and ignores a readme", () => {
    const exists = (p) => p.endsWith("lemon-agent.test.mjs") || p.endsWith("orchestration.test.mjs");
    const plan = changedVerifyPlan(["plugins/skuizops/agents/lemon.md", "README.md"], exists);
    assert.deepEqual(plan.map((s) => s.kind), ["test"]);
    assert.ok(plan[0].files.includes("plugins/skuizops/scripts/lemon-agent.test.mjs"));
    assert.ok(plan[0].files.includes("plugins/skuizops/scripts/orchestration.test.mjs"));
  });

  it("validates the marketplace json and the plugin manifest, and nothing for a readme alone", () => {
    assert.deepEqual(changedVerifyPlan([".claude-plugin/marketplace.json"], () => false).map((s) => s.kind), ["validate-marketplace"]);
    const plugin = changedVerifyPlan(["plugins/skuizops/.claude-plugin/plugin.json"], (p) => p.endsWith("hooks-json.test.mjs"));
    assert.deepEqual(plugin.map((s) => s.kind), ["test", "validate-plugin"]);
    assert.deepEqual(changedVerifyPlan(["README.md"], () => false), []);
  });

  it("lists untracked paths and returns null when git cannot", () => {
    const dir = mkdtempSync(join(tmpdir(), "changed-paths-"));
    assert.equal(changedPaths(dir), null);
    const git = (...args) => spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir });
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "init");
    writeFileSync(join(dir, "README.md"), "x");
    assert.deepEqual(changedPaths(dir), ["README.md"]);
  });
});

describe("verify --changed on this repo", { concurrency: false }, () => {
  const root = repo.pathname;
  const run = (...args) => spawnSync(process.execPath, ["scripts/control.mjs", ...args], { cwd: root, encoding: "utf8" });

  it("a readme has no checks and does not record the tree", () => {
    const marker = markerPath(root);
    const before = marker && existsSync(marker) ? readFileSync(marker, "utf8") : null;
    const r = run("verify", "--changed", "README.md");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no checks for these paths/);
    const after = marker && existsSync(marker) ? readFileSync(marker, "utf8") : null;
    assert.equal(after, before);
  });

  it("an unknown flag fails", () => {
    const r = run("verify", "--changed", "--nope");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /unknown verify flag/);
  });

  it("a full verify skips when the marker already matches the tree", () => {
    const state = treeState(root);
    assert.ok(state, "this checkout has a HEAD");
    const marker = markerPath(root);
    const previous = existsSync(marker) ? readFileSync(marker, "utf8") : null;
    recordState(root, state);
    try {
      const r = run("verify");
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /tree already verified, skipped/);
    } finally {
      if (previous === null) rmSync(marker, { force: true });
      else writeFileSync(marker, previous);
    }
  });
});
