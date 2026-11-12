// subagentStatusLine: one row per running subagent in the agent panel, with the fruit emoji.
// Display only: nothing printed here is sent to the model, so it costs no tokens.
// Reads {columns, tasks: [...]} on stdin and prints one {"id","content"} JSON line per task.
import { readFileSync } from "node:fs";
import { isMain } from "./scope.mjs";

const EMOJI = { kiwi: "🥝", fig: "🫐", mango: "🥭", lemon: "🍋" };
const DONE = { completed: "✓", failed: "✗", error: "✗", killed: "✗", cancelled: "✗" };

const shortModel = (model) => model?.match(/haiku|sonnet|opus|fable/i)?.[0].toLowerCase() ?? model;

export function formatRow(task, columns = 80) {
  const agent = String(task.agentType ?? task.name ?? task.type ?? "agent").split(":").pop();
  const parts = [
    `${EMOJI[agent] ?? "•"} ${agent}`,
    task.description ?? task.label,
    shortModel(task.model),
    Number.isFinite(task.tokenCount) ? (task.tokenCount < 1000 ? `${task.tokenCount} tok` : `${Math.round(task.tokenCount / 1000)}k tok`) : undefined,
  ].filter(Boolean);
  const mark = DONE[task.status];
  const row = parts.join(" · ") + (mark ? ` ${mark}` : "");

  // Count by code points so emoji do not split; leave room for the ellipsis.
  const chars = [...row];
  return chars.length <= columns ? row : `${chars.slice(0, Math.max(1, columns - 1)).join("")}…`;
}

export function renderRows(input) {
  return (input.tasks ?? []).map((task) => `${JSON.stringify({ id: task.id, content: formatRow(task, input.columns) })}\n`).join("");
}

if (isMain(import.meta.url)) {
  try {
    process.stdout.write(renderRows(JSON.parse(readFileSync(0, "utf8") || "{}")));
  } catch {
    // Malformed input: print nothing so Claude Code falls back to its default rows.
  }
}
