// PreToolUse hook for the Agent tool: prefixes the fruit emoji to the task description.
// Display only and cosmetic: it never blocks; on any doubt it prints nothing.
import { readFileSync } from "node:fs";
import { isMain } from "./scope.mjs";

const EMOJI = { kiwi: "🥝", fig: "🫐", mango: "🥭", lemon: "🍋", cherry: "🍒" };

export function withEmoji(toolInput) {
  const agent = String(toolInput?.subagent_type ?? "").split(":").pop();
  const emoji = EMOJI[agent];
  const { description } = toolInput ?? {};
  if (!emoji || typeof description !== "string" || description.startsWith(emoji)) return null;
  return { ...toolInput, description: `${emoji} ${description}` };
}

if (isMain(import.meta.url)) {
  try {
    const updatedInput = withEmoji(JSON.parse(readFileSync(0, "utf8") || "{}").tool_input);
    if (updatedInput) process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput } })}\n`);
  } catch {
    // Malformed input: print nothing and let the call go through untouched.
  }
}
