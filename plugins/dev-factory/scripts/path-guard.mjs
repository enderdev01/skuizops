// PreToolUse hook (Edit|Write|NotebookEdit): agents cannot change the files that enforce the policy.
// Protected anywhere: the dev-factory config dir (trust list) and the installed plugins.
// Protected under the scope roots (~/DEV): any .githooks/, scripts/guard/ or .git/ path, in any project.
// The human edits these by hand.
import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fold, inScope, isMain, projectDir, scopeRoots, trustFile, under } from "./scope.mjs";

export function editViolation(file, project, env = process.env) {
  if (!file) return null;
  const target = fold(resolve(project ?? "", file));
  if (under(target, fold(dirname(trustFile(env))))) return "the dev-factory config (trusted-projects list) is edited by the human only.";
  if (under(target, fold(join(env.HOME ?? "", ".claude", "plugins")))) return "installed plugins are changed by the human only.";
  const roots = scopeRoots(env).map(fold);
  if (!roots.some((root) => under(target, root)) && !inScope(project, env)) return null;
  const parts = target.split(sep);
  const guarded = parts.some((p, i) => p === ".githooks" || p === ".git" || (p === "scripts" && parts[i + 1] === "guard"));
  return guarded ? `${file} enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.` : null;
}

if (isMain(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const problem = editViolation(file, projectDir(input));
  if (problem) {
    process.stderr.write(`dev-factory: ${problem}\n`);
    process.exit(2);
  }
}
