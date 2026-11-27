import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision, cell, ensureGitignore } from "../skills/show-your-work/decisions.mjs";

const script = new URL("../skills/show-your-work/decisions.mjs", import.meta.url);

describe("decision log cells", () => {
  it("strips tabs and newlines and quotes a leading formula character", () => {
    assert.equal(cell("a\tb\nc"), "a b c");
    assert.equal(cell("=cmd"), "'=cmd");
    assert.equal(cell("+1"), "'+1");
    assert.equal(cell("-1"), "'-1");
    assert.equal(cell("@sum"), "'@sum");
    assert.equal(cell("  keep  "), "keep");
  });
});

describe("decision log append", () => {
  it("writes the header once, appends rows, and gitignores .skuizops", () => {
    const dir = mkdtempSync(join(tmpdir(), "decisions-"));
    assert.equal(ensureGitignore(dir), true);
    assert.equal(ensureGitignore(dir), false);
    assert.match(readFileSync(join(dir, ".gitignore"), "utf8"), /^\.skuizops\/\n$/);
    const first = appendDecision(dir, { phase: "predicate", decision: "npm test exits 0", evidence: ".skuizops/plan.md", result: "open" });
    const second = appendDecision(dir, { phase: "cherry", decision: "re-checked the repro", evidence: "sha abc patch-id def", result: "pass" });
    assert.equal(first.ok, true);
    assert.equal(second.file, first.file);
    const lines = readFileSync(first.file, "utf8").trim().split("\n");
    assert.equal(lines[0], "ts\tphase\tdecision\tevidence\tresult");
    assert.equal(lines.length, 3);
    assert.match(lines[1], /^20\d\d-\d\d-\d\dT.*\tpredicate\tnpm test exits 0\t\.skuizops\/plan\.md\topen$/);
    assert.match(lines[2], /\tcherry\tre-checked the repro\tsha abc patch-id def\tpass$/);
  });

  it("leaves .gitignore untouched when .skuizops is already ignored in another form", () => {
    for (const form of ["/.skuizops/", ".skuizops", "/.skuizops", ".skuizops/"]) {
      const dir = mkdtempSync(join(tmpdir(), "decisions-"));
      const text = `node_modules\n  ${form}  \n`;
      writeFileSync(join(dir, ".gitignore"), text);
      assert.equal(ensureGitignore(dir), false, form);
      assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), text, form);
    }
  });

  it("refuses a row with an empty cell", () => {
    const dir = mkdtempSync(join(tmpdir(), "decisions-"));
    const result = appendDecision(dir, { phase: "verify", decision: " ", evidence: "cmd", result: "pass" });
    assert.equal(result.ok, false);
    assert.match(result.error, /decision/);
  });

  it("the CLI appends one row and fails when a flag is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "decisions-"));
    const ok = spawnSync(process.execPath, [script.pathname, "append", "--phase", "predicate", "--decision", "done when ping prints pong", "--evidence", "plan", "--result", "open"], { cwd: dir, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(readFileSync(join(dir, ".skuizops", "decisions.tsv"), "utf8"), /predicate\tdone when ping prints pong\tplan\topen/);
    const bad = spawnSync(process.execPath, [script.pathname, "append", "--phase", "verify"], { cwd: dir, encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /missing/);
  });
});
