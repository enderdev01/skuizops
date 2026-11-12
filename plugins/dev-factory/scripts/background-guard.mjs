// PreToolUse hook (Bash): subagents run every command in the foreground.
// A subagent that starts a background shell reports, then stays open waiting for that shell,
// so the orchestrator never sees it finish. The main session (no agent_id) is not affected.
import { readFileSync } from "node:fs";
import { inScope, isMain, projectDir } from "./scope.mjs";

export function backgroundViolation(input) {
  if (!input.agent_id || input.tool_input?.run_in_background !== true) return null;
  return "subagents run commands in the foreground. Run it again without run_in_background (raise timeout up to 600000 ms if it is long); start and stop any server it needs inside the same command.";
}

if (isMain(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const problem = inScope(projectDir(input)) && backgroundViolation(input);
  if (problem) {
    process.stderr.write(`Background policy: ${problem}\n`);
    process.exit(2);
  }
}
