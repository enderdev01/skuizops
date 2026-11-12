// Commits belong to their human author only: reject AI attribution in commit messages.
//   node attribution-guard.mjs <commit message file>   git commit-msg hook
import { readFileSync } from "node:fs";
import { isMain } from "./scope.mjs";

const AI = /\b(claude|anthropic|openai|chatgpt|copilot|gemini|cursor)\b|noreply@anthropic\.com/i;

export function attributionViolation(message) {
  const lines = message.split("\n").filter((line) => !line.startsWith("#"));
  const hit = lines.find(
    (line) => (/^\s*co-authored-by:/i.test(line) && AI.test(line)) || /generated (with|by) .*(claude|ai\b)/i.test(line),
  );
  return hit ? `AI attribution is forbidden in commits, remove this line: "${hit.trim()}"` : null;
}

if (isMain(import.meta.url)) {
  const problem = attributionViolation(readFileSync(process.argv[2], "utf8"));
  if (problem) {
    process.stderr.write(`Commit policy: ${problem}\n`);
    process.exit(1);
  }
}
