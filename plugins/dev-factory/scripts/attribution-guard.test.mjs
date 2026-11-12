import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attributionViolation } from "./attribution-guard.mjs";

describe("attributionViolation", () => {
  it("rejects a Claude co-author trailer", () =>
    assert.match(attributionViolation("feat: x\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n"), /forbidden/));
  it("rejects any anthropic noreply co-author, case-insensitive", () =>
    assert.ok(attributionViolation("fix: y\n\nco-authored-by: Bot <noreply@anthropic.com>")));
  it("rejects the Generated with Claude Code footer", () =>
    assert.ok(attributionViolation("feat: x\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)")));
  it("allows a human co-author", () =>
    assert.equal(attributionViolation("feat: x\n\nCo-Authored-By: Ada <ada@example.com>"), null));
  it("allows a plain message that mentions Claude in the subject", () =>
    assert.equal(attributionViolation("docs: explain how to run claude with the plugin"), null));
  it("ignores git comment lines", () =>
    assert.equal(attributionViolation("feat: x\n# Co-Authored-By: Claude <noreply@anthropic.com>"), null));
});

describe("commit-msg entry point", () => {
  const script = fileURLToPath(new URL("./attribution-guard.mjs", import.meta.url));
  const run = (msg) => {
    const file = join(mkdtempSync(join(tmpdir(), "msg-")), "COMMIT_EDITMSG");
    writeFileSync(file, msg);
    return spawnSync("node", [script, file], { encoding: "utf8" });
  };
  it("exits 1 with the offending line", () => {
    const r = run("feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Co-Authored-By: Claude/);
  });
  it("exits 0 on a clean message", () => assert.equal(run("feat: x\n").status, 0));
});
