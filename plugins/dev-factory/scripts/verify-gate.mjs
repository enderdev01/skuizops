// Stop hook: the agent cannot finish while the project verify is red.
// Exit 2 blocks the stop and feeds the failure back to the agent.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { inScope, projectDir } from "./scope.mjs";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
// Already blocked once this turn: let it stop, so a broken environment cannot loop forever.
if (input.stop_hook_active) process.exit(0);

const cwd = projectDir(input);
// Hooks only act on projects under the configured roots (default ~/DEV).
if (!inScope(cwd)) process.exit(0);

// Skip when nothing changed (pure Q&A turns). Outside a git repo, always verify.
const git = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
if (git.status === 0 && git.stdout.trim() === "") process.exit(0);

// Prefer the project's control CLI; else an npm "verify" script; else nothing to run.
let command;
if (existsSync(join(cwd, "scripts", "control.mjs"))) command = ["node", ["scripts/control.mjs", "verify"]];
else {
  let scripts = {};
  try {
    scripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {};
  } catch {}
  if (scripts.verify) command = ["npm", ["run", "verify", "--silent"]];
}
if (!command) process.exit(0);

const result = spawnSync(command[0], command[1], { cwd, encoding: "utf8" });
if (result.status === 0) process.exit(0);

const output = `${result.stdout}${result.stderr}`.trim().split("\n").slice(-40).join("\n");
process.stderr.write(
  `Project verify is failing. Fix it before you finish (delegate long logs to fig):\n${output}`,
);
process.exit(2);
