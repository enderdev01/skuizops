// PreToolUse hook: agents cannot change the files that enforce the policy.
//   node path-guard.mjs        (Edit|Write|NotebookEdit) checks the target file
//   node path-guard.mjs bash   (Bash) checks the shell command, best effort
// Protected anywhere: the dev-factory config dir (trust list), the installed plugins, the user's
// Claude settings, git config and shell profiles.
// Protected under the scope roots (~/DEV): any .githooks/, scripts/guard/ or .git/ path and any
// .claude/settings*.json, in any project.
// The human edits these by hand.
import { globSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fold, inScope, isMain, projectDir, scopeRoots, trustFile, under } from "./scope.mjs";

const PROFILES = [".zshrc", ".zshenv", ".zprofile", ".bashrc", ".bash_profile", ".profile"];

export function editViolation(file, project, env = process.env) {
  if (!file) return null;
  const target = fold(resolve(project ?? "", file));
  if (under(target, fold(dirname(trustFile(env))))) return "the dev-factory config (trusted-projects list) is edited by the human only.";
  if (under(target, fold(join(env.HOME ?? "", ".claude", "plugins")))) return "installed plugins are changed by the human only.";
  const homeFiles = [[".claude", "settings.json"], [".claude", "settings.local.json"], [".gitconfig"], ...PROFILES.map((p) => [p])];
  const home = (...parts) => fold(join(env.HOME ?? "", ...parts));
  if (homeFiles.some((parts) => target === home(...parts)) || under(target, home(".config", "git"))) {
    return `${file} is a protected user file. Agents cannot change it: ask the human to edit it.`;
  }
  const roots = scopeRoots(env).map(fold);
  if (!roots.some((root) => under(target, root)) && !inScope(project, env)) return null;
  const parts = target.split(sep);
  const guarded = parts.some(
    (p, i) =>
      p === ".githooks" ||
      p === ".git" ||
      (p === "scripts" && parts[i + 1] === "guard") ||
      (p === ".claude" && i + 2 === parts.length && ["settings.json", "settings.local.json"].includes(parts[i + 1])),
  );
  return guarded ? `${file} enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.` : null;
}

const WRITES_ALL_ARGS = ["rm", "rmdir", "mv", "tee", "touch", "chmod", "chown", "chflags", "truncate", "unlink", "mkdir", "ln"];
const GIT_WRITES = ["checkout", "restore", "rm", "mv", "clean", "apply", "stash"];
const READ_ONLY = ["cat", "ls", "head", "tail", "wc", "stat", "file", "grep", "rg", "diff"];
const MENTIONS_TRUST_LIST = /trusted-proj|\.config\b.*dev-factory/i;

// Paths a single command segment writes to, as raw words (quotes and `~` not yet resolved).
function writtenWords(words) {
  // The shell drops quotes and backslashes: `\rm` and 'rm' are rm.
  words = words.map((w) => w.replace(/["'\\]/g, ""));
  // Skip `VAR=value` prefixes and words that run the next word as the command.
  while (/^\w+=/.test(words[0] ?? "") || ["sudo", "command", "env", "exec", "nohup", "time", "xargs", "{", "!", "then", "do", "else"].includes(words[0])) words = words.slice(1);
  const [cmd, ...args] = words;
  const name = basename(cmd ?? "");
  const operands = (list) => list.filter((w) => !w.startsWith("-"));
  if (WRITES_ALL_ARGS.includes(name)) return operands(args);
  if ((name === "sed" || name === "perl") && args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) return operands(args);
  if (name === "dd") return args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
  if (["cp", "rsync", "install"].includes(name)) return operands(args).slice(-1);
  if (name === "git") {
    let i = 0;
    while (i < args.length && args[i].startsWith("-")) i += ["-c", "-C"].includes(args[i]) ? 2 : 1;
    if (GIT_WRITES.includes(args[i])) return operands(args.slice(i + 1));
  }
  return [];
}

// Best effort: a shell command that writes to a path editViolation protects, or mentions the trust list
// without being read-only. Interpreters, variables and indirection can still write.
export function commandViolation(command, { project, cwd, env = process.env } = {}) {
  // `>|` and `>&` are redirections too: make them `>` so the split below does not cut them from their target.
  const segments = command.replace(/>[|&]/g, ">").split(/\n|;|&|\||\(|\)|`|\$\(/);
  if (MENTIONS_TRUST_LIST.test(command)) {
    const readOnly = !command.includes(">") && segments.every((s) => !s.trim() || READ_ONLY.includes(s.trim().split(/\s+/)[0]));
    if (!readOnly) return "Only the human edits the trusted-projects list. Ask them to run the command.";
  }
  let here = cwd ?? process.cwd();
  const clean = (word) => {
    const w = word.replace(/["'\\]/g, "").replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, env.HOME ?? "");
    return /[*?[]/.test(w) ? globSync(w, { cwd: here }).map((m) => resolve(here, m)).concat(resolve(here, w)) : [resolve(here, w)];
  };
  for (const segment of segments) {
    const redirects = [...segment.matchAll(/\d*>>?\|?\s*([^\s<>]+)/g)].map((m) => m[1]);
    const words = segment.replace(/\d*>>?\|?\s*[^\s<>]*/g, " ").trim().split(/\s+/).filter(Boolean);
    if (["cd", "pushd"].includes(words[0])) here = clean(words[1] ?? "~")[0];
    for (const word of [...redirects, ...writtenWords(words)]) {
      for (const path of clean(word)) {
        const problem = editViolation(path, project, env);
        if (problem) return problem;
      }
    }
  }
  return null;
}

if (isMain(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const bash = process.argv[2] === "bash";
  const problem = bash
    ? commandViolation(input.tool_input?.command ?? "", { project: projectDir(input), cwd: input.cwd ?? process.cwd() })
    : editViolation(input.tool_input?.file_path ?? input.tool_input?.notebook_path, projectDir(input));
  if (problem) {
    process.stderr.write(`dev-factory: ${problem}\n`);
    process.exit(2);
  }
}
