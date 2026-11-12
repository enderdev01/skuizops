import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { backgroundViolation } from "./background-guard.mjs";

const bash = (extra, toolInput) => ({ tool_name: "Bash", tool_input: { command: "npm test", ...toolInput }, ...extra });

describe("backgroundViolation", () => {
  it("blocks a background command from a subagent", () =>
    assert.match(backgroundViolation(bash({ agent_id: "a1", agent_type: "dev-factory:fig" }, { run_in_background: true })), /foreground/));
  it("allows a foreground command from a subagent", () => assert.equal(backgroundViolation(bash({ agent_id: "a1" })), null));
  it("allows a background command from the main session", () =>
    assert.equal(backgroundViolation(bash({ agent_type: "dev-factory:lemon" }, { run_in_background: true })), null));
});
