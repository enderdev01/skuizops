import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { attributionViolation, identViolation } from "./attribution-guard.mjs";

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
  it("rejects an AI trailer inside a comment line (adapted: comments are no longer skipped)", () =>
    assert.ok(attributionViolation("feat: x\n# Co-authored-by: Claude <noreply@anthropic.com>")));
  for (const line of [
    "Co-Authored-By: Claude <noreply@anthropic.com>",
    "Assisted-by: Claude",
    "Co-authored-by: Fable <x@example.com>",
    "Written by ChatGPT",
    "Created using Claude Code",
    "Generated with claude-code",
    "Co-Authored-By : Claude",
    "Co-Authored-By: Claude_Code",
    "Co-authored-by: claude-bot <bot@example.com>",
    "Generated with AI",
  ])
    it(`rejects: ${line}`, () => assert.ok(attributionViolation(`feat: x\n\n${line}`)));
  for (const msg of [
    "feat: x\n\nSigned-off-by: Ada <ada@example.com>",
    "feat: x\n\nCo-authored-by: Grace Hopper <grace@example.com>",
    "fix(plugin): validate .claude-plugin/marketplace.json",
    "feat: x\n#\tmodified:   .claude-plugin/plugin.json\n# Please enter the commit message for your changes.",
    "feat: x\n# ------------------------ >8 ------------------------\nCo-Authored-By: Claude <noreply@anthropic.com>",
  ])
    it(`allows: ${JSON.stringify(msg).slice(0, 50)}`, () => assert.equal(attributionViolation(msg), null));
});

describe("identViolation", () => {
  it("rejects an anthropic address", () => assert.ok(identViolation("Claude <noreply@anthropic.com> 1700000000 +0000")));
  it("rejects a bot address", () =>
    assert.ok(identViolation("dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com> 1700000000 +0000")));
  it("rejects an openai or copilot address", () => {
    assert.ok(identViolation("X <x@openai.com> 1 +0000"));
    assert.ok(identViolation("X <copilot@example.com> 1 +0000"));
  });
  it("allows a human named Claude", () => assert.equal(identViolation("Claude Dupont <claude@example.com> 1700000000 +0000"), null));
  it("allows a normal ident", () => assert.equal(identViolation("Ada <ada@example.com> 1700000000 +0000"), null));
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
