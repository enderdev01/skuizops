import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { withEmoji } from "./agent-emoji.mjs";

const script = new URL("./agent-emoji.mjs", import.meta.url).pathname;
const input = (agent, description = "x") => ({ subagent_type: `dev-factory:${agent}`, description, prompt: "p" });

describe("withEmoji", () => {
  for (const [agent, emoji] of [["kiwi", "🥝"], ["fig", "🫐"], ["mango", "🥭"], ["lemon", "🍋"], ["cherry", "🍒"]]) {
    it(`prefixes ${emoji} for ${agent}`, () => assert.equal(withEmoji(input(agent)).description, `${emoji} x`));
  }

  it("works without the plugin prefix", () => assert.equal(withEmoji({ subagent_type: "kiwi", description: "x" }).description, "🥝 x"));
  it("does not double the prefix", () => assert.equal(withEmoji(input("cherry", "🍒 x")), null));
  it("ignores unknown agents", () => assert.equal(withEmoji({ subagent_type: "Explore", description: "x" }), null));
  it("ignores a missing description", () => assert.equal(withEmoji({ subagent_type: "kiwi" }), null));
  it("preserves the other fields", () =>
    assert.deepEqual(withEmoji({ ...input("kiwi"), run_in_background: false }), { subagent_type: "dev-factory:kiwi", description: "🥝 x", prompt: "p", run_in_background: false }));
});

describe("CLI", () => {
  const run = (stdin) => spawnSync("node", [script], { input: stdin, encoding: "utf8" });

  it("prints the allow JSON for cherry", () => {
    const r = run(JSON.stringify({ tool_name: "Agent", tool_input: input("cherry") }));
    assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { ...input("cherry"), description: "🍒 x" } } });
  });

  it("prints nothing for malformed input", () => {
    const r = run("not json");
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});
