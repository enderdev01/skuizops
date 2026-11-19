import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const md = readFileSync(new URL("../agents/lemon.md", import.meta.url), "utf8");
const front = md.split("---")[1];
const field = (name) => new RegExp(`^${name}:\\s*(.*)$`, "m").exec(front)?.[1];

describe("lemon agent frontmatter", () => {
  it("inherits every tool, so the user's MCP servers stay available", () => {
    assert.equal(field("tools"), undefined, "a tools: allowlist hides MCP servers lemon was never told about");
  });

  it("denies the heavy built-in tools it does not use, to keep its context small", () => {
    const denied = (field("disallowedTools") ?? "").split(",").map((t) => t.trim());
    for (const tool of ["Artifact", "Workflow", "SendFeedback", "ScheduleWakeup", "ReportFindings"]) assert.ok(denied.includes(tool), `${tool} is not in disallowedTools`);
    assert.ok(!denied.some((t) => t.startsWith("mcp__")), "denying mcp__ tools would hide the user's MCP servers");
  });
});
