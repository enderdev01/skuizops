import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { hooks } = JSON.parse(readFileSync(new URL("../hooks/hooks.json", import.meta.url), "utf8"));
const all = hooks.PreToolUse.flatMap((entry) => entry.hooks.map((hook) => hook.command));
const commands = all.filter((command) => command.includes("|| exit 2"));

// A plugin root whose guard scripts are replaced by `source`.
function run(command, source) {
  const root = mkdtempSync(join(tmpdir(), "hooks-json-"));
  mkdirSync(join(root, "scripts"));
  for (const name of ["branch-guard.mjs", "path-guard.mjs", "background-guard.mjs"]) writeFileSync(join(root, "scripts", name), source);
  return spawnSync("sh", ["-c", command], { input: "{}", env: { ...process.env, CLAUDE_PLUGIN_ROOT: root } }).status;
}

describe("PreToolUse hook commands", () => {
  it("covers the branch guard, the background guard and the path guard (Edit and Bash)", () => assert.equal(commands.length, 4));
  it("tags agents with a cosmetic hook that is not fail-closed", () => {
    const agent = hooks.PreToolUse.find((entry) => entry.matcher === "Agent");
    assert.ok(agent, "Agent entry missing");
    assert.ok(agent.hooks.every((hook) => !hook.command.includes("|| exit 2") && hook.onFailure !== "block"));
  });
  for (const command of commands) {
    it(`blocks when the guard throws: ${command}`, () => assert.equal(run(command, 'throw new Error("boom");\n'), 2));
    it(`blocks when the guard cannot be parsed: ${command}`, () => assert.equal(run(command, "const = ;\n"), 2));
    it(`allows when the guard exits 0: ${command}`, () => assert.equal(run(command, "process.exit(0);\n"), 0));
  }
});
