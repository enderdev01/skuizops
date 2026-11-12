// PostToolUse hook: lint the file the agent just edited.
// Exit 2 sends stderr back to the agent so it fixes the error in the same turn.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = input.tool_input?.file_path ?? input.tool_response?.filePath;

if (!file || !/\.(ts|tsx|js|jsx|mjs)$/.test(file)) process.exit(0);

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
// Projects without a local ESLint are not ours to lint.
if (!existsSync(join(cwd, "node_modules", ".bin", "eslint"))) process.exit(0);
const result = spawnSync("npx", ["--no-install", "eslint", "--no-warn-ignored", file], {
  cwd,
  encoding: "utf8",
});

if (result.status === 0) process.exit(0);

process.stderr.write(
  `ESLint failed on ${file}. Fix it before continuing:\n${result.stdout}${result.stderr}`,
);
process.exit(2);
