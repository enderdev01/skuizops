import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatRow, renderRows } from "./subagent-row.mjs";

const task = (over = {}) => ({
  id: "t1",
  agentType: "dev-factory:kiwi",
  name: "kiwi",
  description: "find auth routes",
  status: "running",
  model: "claude-haiku-5-5",
  tokenCount: 12400,
  ...over,
});

describe("formatRow", () => {
  it("shows the fruit emoji, name, task, short model and tokens", () =>
    assert.equal(formatRow(task(), 200), "🥝 kiwi · find auth routes · haiku · 12k tok"));

  for (const [agent, emoji] of [["fig", "🫐"], ["mango", "🥭"], ["lemon", "🍋"], ["cherry", "🍒"]]) {
    it(`uses ${emoji} for ${agent}`, () =>
      assert.ok(formatRow(task({ agentType: `dev-factory:${agent}`, name: agent }), 200).startsWith(`${emoji} ${agent}`)));
  }

  it("accepts an agent type without the plugin prefix", () =>
    assert.ok(formatRow(task({ agentType: "lemon", name: "lemon" }), 200).startsWith("🍋 lemon")));

  it("uses a neutral marker for agents outside the factory", () =>
    assert.ok(formatRow(task({ agentType: "Explore", name: "Explore" }), 200).startsWith("• Explore")));

  it("marks finished and failed tasks", () => {
    assert.ok(formatRow(task({ status: "completed" }), 200).endsWith(" ✓"));
    assert.ok(formatRow(task({ status: "failed" }), 200).endsWith(" ✗"));
  });

  it("falls back to label when there is no description, and omits missing parts", () =>
    assert.equal(formatRow(task({ description: undefined, label: "scan", model: undefined, tokenCount: undefined }), 200), "🥝 kiwi · scan"));

  it("never exceeds the available columns", () => {
    const row = formatRow(task({ description: "x".repeat(300) }), 40);
    assert.ok([...row].length <= 40, `got ${[...row].length} chars`);
    assert.ok(row.endsWith("…"));
  });

  it("never returns empty content (empty would hide the row)", () =>
    assert.ok(formatRow({ id: "x" }, 80).length > 0));
});

describe("renderRows", () => {
  it("emits one JSON line per task with its id", () => {
    const out = renderRows({ columns: 120, tasks: [task(), task({ id: "t2", agentType: "dev-factory:lemon", name: "lemon" })] });
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.id), ["t1", "t2"]);
    assert.ok(lines[1].content.startsWith("🍋 lemon"));
  });

  it("handles missing tasks", () => assert.equal(renderRows({}), ""));
});

describe("entry point through a symlinked path", () => {
  it("still prints rows", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const base = mkdtempSync(join(tmpdir(), "row-link-"));
    symlinkSync(dirname(fileURLToPath(import.meta.url)), join(base, "link"));
    const r = spawnSync("node", [join(base, "link", "subagent-row.mjs")], { input: '{"tasks":[{"id":"x","agentType":"kiwi"}]}', encoding: "utf8" });
    assert.match(r.stdout, /🥝 kiwi/);
  });
});

describe("token formatting", () => {
  it("shows small counts without rounding to 0k", () =>
    assert.ok(formatRow({ id: "x", agentType: "kiwi", tokenCount: 0 }, 80).endsWith("0 tok")));
});
