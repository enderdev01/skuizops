import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_SESSIONS, message, run } from "./sessions.mjs";

const HOUR = 3600 * 1000;
const NOW = Date.now();
const here = { tree: "/r", branch: "main" };
const registry = () => mkdtempSync(join(tmpdir(), "sessions-"));

describe("sessions", () => {
  it("alone gets no message", () => assert.equal(run("start", registry(), "a", here, NOW), ""));

  it("a second session in the same tree is told to use a worktree", () => {
    const r = registry();
    run("start", r, "a", { tree: "/r", branch: "feat/x" }, NOW);
    const out = run("start", r, "b", here, NOW + 1000);
    assert.match(out, /feat\/x/);
    assert.match(out, /worktree/);
  });

  it("the earliest session gets no message even when a later one is live", () => {
    const r = registry();
    run("start", r, "a", here, NOW);
    run("start", r, "b", here, NOW + 1000);
    assert.equal(run("start", r, "a", here, NOW + 2000), "");
  });

  it("a session in another tree gets no worktree message", () => {
    const r = registry();
    run("start", r, "a", here, NOW);
    assert.equal(run("start", r, "b", { tree: "/other", branch: "main" }, NOW + 1000), "");
  });

  it("start removes and ignores entries older than 12 hours", () => {
    const r = registry();
    run("start", r, "old", here, NOW - 13 * HOUR);
    utimesSync(join(r, "old.json"), new Date(NOW - 13 * HOUR), new Date(NOW - 13 * HOUR));
    assert.equal(run("start", r, "b", here, NOW), "");
    assert.equal(existsSync(join(r, "old.json")), false);
  });

  it("warns above MAX_SESSIONS live sessions, not at the limit", () => {
    const r = registry();
    const trees = (i) => ({ tree: `/t${i}`, branch: "main" });
    for (let i = 0; i < MAX_SESSIONS - 1; i++) run("start", r, `s${i}`, trees(i), NOW + i);
    assert.doesNotMatch(run("start", r, "last", trees(9), NOW + 10), /more than/);
    assert.match(run("start", r, "extra", trees(10), NOW + 11), /more than 4/);
  });

  it("a garbage file in the registry does not hide the live sessions", () => {
    const r = registry();
    writeFileSync(join(r, "junk.json"), "not json");
    run("start", r, "a", here, NOW);
    assert.match(run("start", r, "b", here, NOW + 1000), /worktree/);
  });

  it("message ignores an unknown session",() => assert.equal(message([], "a"), ""));

  it("end removes the entry and touch recreates a missing one", () => {
    const r = registry();
    run("start", r, "a", here, NOW);
    run("end", r, "a", here);
    assert.deepEqual(readdirSync(r), []);
    run("touch", r, "a", here, NOW);
    assert.deepEqual(readdirSync(r), ["a.json"]);
  });

  it("an unsafe session_id writes nothing", () => {
    const r = join(registry(), "reg");
    assert.equal(run("start", r, "../x", here), "");
    assert.equal(existsSync(r), false);
  });
});

describe("sessions hook", () => {
  const repo = mkdtempSync(join(tmpdir(), "sessions-repo-"));
  spawnSync("git", ["init", "-q"], { cwd: repo });
  const hook = (mode, input, cwd = repo) =>
    spawnSync("node", [join(import.meta.dirname, "sessions.mjs"), mode], { cwd, encoding: "utf8", input, env: { ...process.env, SKUIZOPS_ROOTS: tmpdir(), CLAUDE_PROJECT_DIR: cwd } });

  it("prints the message for a second session, exit 0", () => {
    assert.equal(hook("start", JSON.stringify({ session_id: "a", cwd: repo })).stdout, "");
    const r = hook("start", JSON.stringify({ session_id: "b", cwd: repo }));
    assert.equal(r.status, 0);
    assert.match(r.stdout, /worktree/);
  });

  it("empty stdin or a non-git cwd prints nothing, exit 0", () => {
    const plain = mkdtempSync(join(tmpdir(), "sessions-plain-"));
    for (const r of [hook("start", ""), hook("start", JSON.stringify({ session_id: "a", cwd: plain }), plain)]) {
      assert.equal(r.status, 0);
      assert.equal(r.stdout, "");
    }
  });
});
