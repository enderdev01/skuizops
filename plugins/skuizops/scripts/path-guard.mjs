// PreToolUse hook: agents cannot change the files that enforce the policy.
//   node path-guard.mjs        (Edit|Write|NotebookEdit) checks the target file
//   node path-guard.mjs bash   (Bash) checks the shell command, best effort
// Protected anywhere: the skuizops config dir (trust list), the installed plugins, the user's
// Claude settings, git and gh config and shell profiles; a directory-marketplace source repo, unless the session is opened in it.
// Protected under the scope roots (~/DEV): any .githooks/, scripts/guard/ or .git/ path and any
// .claude/settings*.json, in any project.
// The human edits these by hand.
import { globSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fold, inScope, isMain, projectDir, real, scopeRoots, trustFile, under } from "./scope.mjs";

const PROFILES = [".zshrc", ".zshenv", ".zprofile", ".bashrc", ".bash_profile", ".profile"];

export function editViolation(file, project, env = process.env) {
  if (!file) return null;
  const target = fold(resolve(project ?? "", file));
  if (under(target, fold(dirname(trustFile(env))))) return "the skuizops config (trusted-projects list) is edited by the human only.";
  if (under(target, fold(join(env.HOME ?? "", ".claude", "plugins")))) return "installed plugins are changed by the human only.";
  const marketplaces = (() => {
    try { return Object.values(JSON.parse(readFileSync(join(env.HOME ?? "", ".claude", "plugins", "known_marketplaces.json"), "utf8"))); } catch { return []; }
  })();
  for (const m of marketplaces) {
    const path = m?.source?.source === "directory" ? (m.source.path ?? m.installLocation) : null;
    if (typeof path !== "string" || !path || !under(target, fold(path))) continue;
    if (!project || !under(fold(project), fold(path))) {
      return `${file} is the source of an installed plugin marketplace (${path}). Edit it only from a session opened in that repo.`;
    }
  }
  const homeFiles = [[".claude", "settings.json"], [".claude", "settings.local.json"], [".gitconfig"], ...PROFILES.map((p) => [p])];
  const home = (...parts) => fold(join(env.HOME ?? "", ...parts));
  // gh runs aliases, extensions and its pager, editor and browser from its config dir.
  const ghDirs = [home(".config", "gh"), env.GH_CONFIG_DIR && fold(env.GH_CONFIG_DIR), env.XDG_CONFIG_HOME && fold(join(env.XDG_CONFIG_HOME, "gh"))];
  if (homeFiles.some((parts) => target === home(...parts)) || [home(".config", "git"), ...ghDirs].some((dir) => dir && under(target, dir))) {
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

const WRITES_ALL_ARGS = ["rm", "rmdir", "mv", "tee", "touch", "chmod", "chown", "chflags", "truncate", "unlink", "mkdir"];
const GIT_WRITES = ["checkout", "restore", "rm", "mv", "clean", "apply", "stash", "reset", "switch"];
// Subcommands that rewrite a whole tree: the directory git runs in is what gets written.
const GIT_TREE_WIDE = ["stash", "clean", "reset", "checkout", "restore", "switch"];
// Subcommands that change the tree or refs: cherry may not run them on the live project.
const GIT_MUTATES = ["stash", "checkout", "switch", "restore", "reset", "clean", "apply", "commit", "add", "rm", "mv", "merge", "rebase", "cherry-pick", "revert", "am", "pull", "update-index", "update-ref"];
// `git tag` / `git branch` list unless an option or a bare name creates, deletes or moves a ref.
const REF_WRITE_OPTS = { tag: /^-[a-zA-Z]*[dfasumF]|^--(delete|force|annotate|sign|local-user|message|file)/, branch: /^-[a-zA-Z]*[dDfmMcCu]|^--(delete|force|move|copy|set-upstream-to|unset-upstream)/ };
const REF_LIST_OPTS = /^(-l|--list|--contains|--points-at|--merged|--no-merged|--show-current|--verify)$/;
const CHERRY_MSG = 'cherry is read-only on the project: reproduce or mutate in a copy (git worktree add "$(mktemp -d)" or cp -R into a mktemp dir), never the live tree.';
const editsMsg = (who) => `${who} edits files with Edit or Write (apply_patch in Codex), not through Bash (redirects, heredocs, tee, sed -i, perl -i, inline python/node writes): a scripted replace that misses its text fails silently. Bash may write only under the temp dir.`;
const INLINE_CODE = /\b(python3?|node|perl|ruby|bun|deno)\b[^\n;&|]*(\s-\w*[ce]\b|\s--eval\b|\s-(\s|$)|<<)/;
const FILE_WRITE_API = /(?<!stdout|stderr)\.write\(|write_(text|bytes)\(|(write|append)FileSync|createWriteStream|open\([^)]*,\s*['"][wax]/;
const READ_ONLY = ["cat", "ls", "head", "tail", "wc", "stat", "file", "grep", "rg", "diff"];
// The list itself, its directory, or the script the human-only /skuizops:trust command runs.
const MENTIONS_TRUST_LIST = /trusted-proj|\.config\b.*skuizops|\btrust\.mjs\b/i;
// The script the human-only /skuizops:install-hooks command runs.
const MENTIONS_INSTALL_HOOKS = /\binstall-hooks\.mjs\b/i;
const MENTIONS_PUBLISH = /\bpublish\.mjs\b/i;
// The one-command setup is human-only: only a segment that EXECUTES it is blocked (mentioning it is fine).
const SETUP_TARGET = /enderdev01\/skuizops|skuizops-setup/i;
const SETUP_SCRIPT = /(^|\/)bin\/setup\.mjs$/;
function runsSetup(words, depth = 0) {
  const [cmd = "", ...args] = commandWords(words);
  const name = basename(cmd);
  // A nested shell (`bash -c "..."`, `eval ...`): run the same check on its script. shortcut: quotes are already dropped, so the script is the re-joined args, deeper than 3 levels is not followed.
  const c = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
  const script = name === "eval" ? args : ["bash", "sh", "zsh", "dash", "ksh"].includes(name) && c >= 0 ? args.slice(c + 1) : null;
  if (script && depth < 3) return script.join(" ").split(/\n|;|&|\||\(|\)|`/).some((s) => runsSetup(s.trim().split(/\s+/), depth + 1));
  if (["npx", "bunx", "pnpx"].includes(name)) return args.some((a) => SETUP_TARGET.test(a));
  if (["npm", "pnpm", "yarn"].includes(name) && args.some((a) => ["exec", "dlx", "x"].includes(a))) return args.some((a) => SETUP_TARGET.test(a));
  if (["node", "bun", "deno", "bash", "sh", "zsh"].includes(name)) return args.some((a) => SETUP_SCRIPT.test(a));
  return SETUP_SCRIPT.test(cmd) || name === "skuizops-setup";
}

const unquote = (w) => w.replace(/["'\\]/g, "");
// shortcut: a leading $VAR other than HOME/PWD is assumed to point outside the project (mktemp dirs), upgrade if cherry abuses it.
const unknownVar = (w) => /^\$/.test(unquote(w)) && !/^\$\{?(HOME|PWD|SUBST|GH_CONFIG_DIR|XDG_CONFIG_HOME)\b/.test(unquote(w));
const subst = (w) => /^\$SUBST/.test(unquote(w));

// Heredoc bodies are data, not shell: drop them, but an unquoted one still runs `$(...)` and backticks, so keep those as lines.
// `<<` inside quotes is text; an unterminated heredoc is not one we understand, so nothing is dropped (fail closed).
function stripHeredocs(command) {
  const out = [];
  let pending = [], q = null;
  for (const line of command.split("\n")) {
    if (pending.length) {
      const { word, dash, quoted } = pending[0];
      if ((dash ? line.replace(/^\t+/, "") : line) === word) pending.shift();
      else if (!quoted) out.push(...(line.match(/\$\(.*\)|`[^`]*`/g) ?? []));
      continue;
    }
    out.push(line);
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === "\\" && q !== "'") { i++; continue; }
      if (q) { if (c === q) q = null; continue; }
      if (c === "'" || c === '"') { q = c; continue; }
      const m = line[i - 1] !== "<" && /^<<(-?)\s*(["']?)([\w.-]+)\2/.exec(line.slice(i));
      if (m) { pending.push({ dash: !!m[1], quoted: !!m[2], word: m[3] }); i += m[0].length - 1; }
    }
  }
  return pending.length ? command : out.join("\n");
}

// `>` inside quotes is text, not a redirect: hide it (\u0001) until the words are read. `$(...)` inside "..." stays code.
function hideQuotedRedirects(s) {
  let out = "", q = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && q !== "'") { out += c + (s[i + 1] ?? ""); i++; continue; }
    if (!q) { if (c === "'" || c === '"') q = c; out += c; continue; }
    if (q === "'") { if (c === "'") q = null; out += c === ">" ? "\u0001" : c; continue; }
    if (depth) { if (c === "(") depth++; else if (c === ")") depth--; out += c; continue; }
    if (c === "$" && s[i + 1] === "(") { depth = 1; out += "$("; i++; continue; }
    if (c === '"') q = null;
    out += c === ">" ? "\u0001" : c;
  }
  return out;
}

// Each `$(...)` becomes one word in its segment (`$MKTEMP` for mktemp, else `$SUBST`); its inner command is returned as its own segment.
function takeSubstitutions(s, inner = []) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "$" || s[i + 1] !== "(") { out += s[i]; continue; }
    let depth = 1, j = i + 2;
    while (j < s.length && depth) { if (s[j] === "(") depth++; else if (s[j] === ")") depth--; j++; }
    const body = s.slice(i + 2, depth ? j : j - 1);
    inner.push(takeSubstitutions(body, inner));
    out += /^\s*mktemp\b/.test(body) ? "$MKTEMP" : "$SUBST";
    i = j - 1;
  }
  return out;
}

// The words of a segment without quotes, `VAR=value` prefixes and words that run the next word as the command.
function commandWords(words) {
  // The shell drops quotes and backslashes: `\rm` and 'rm' are rm. Words that were only quotes are empty: drop them.
  words = words.map(unquote).filter(Boolean);
  while (/^\w+=/.test(words[0] ?? "") || ["sudo", "command", "env", "exec", "nohup", "time", "xargs", "{", "!", "then", "do", "else"].includes(basename(words[0] ?? ""))) words = words.slice(1); // basename: `/usr/bin/env node` is env
  return words;
}

// The git subcommand, what follows it and the `-C` directories, or null when the segment is not git.
function gitCall(words) {
  const [cmd, ...args] = commandWords(words);
  if (basename(cmd ?? "") !== "git") return null;
  const dirs = [];
  let i = 0;
  while (i < args.length && args[i].startsWith("-")) {
    // --work-tree / --git-dir (the parent of a /.git) move git's tree like -C does.
    const [, name, glued] = /^(-C|--work-tree|--git-dir)(?:=(.*))?$/.exec(args[i]) ?? [];
    const value = glued ?? (name ? args[i + 1] : undefined);
    if (value) {
      if (name !== "--git-dir") dirs.push(value);
      else if (/(^|\/)\.git$/.test(value)) dirs.push(value.slice(0, -4) || ".");
    }
    i += ["-c", "-C", "--work-tree", "--git-dir"].includes(args[i]) ? 2 : 1;
  }
  return { sub: args[i], rest: args.slice(i + 1), dirs };
}

const stashReads = (git) => git.sub === "stash" && ["list", "show"].includes(git.rest[0]);

function gitMutates(git) {
  const { sub, rest } = git;
  if (sub === "stash") return !stashReads(git);
  if (sub === "worktree") return rest[0] === "remove";
  if (Object.hasOwn(REF_WRITE_OPTS, sub)) {
    const listing = rest.some((a) => REF_LIST_OPTS.test(a));
    return rest.some((a) => REF_WRITE_OPTS[sub].test(a)) || (!listing && rest.some((a) => !a.startsWith("-")));
  }
  return GIT_MUTATES.includes(sub);
}

// The file operands of sed/perl: the script (first operand, or the argument of -e/-f) is not written.
// The script may be glued to its option (-es/a/b/, --expression=X, perl -pe'..'): then every operand is a file.
function scriptFiles(args, name) {
  const files = [];
  let script = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^--(expression|file)=/.test(a)) script = true;
    else if (/^--(expression|file)$/.test(a)) { script = true; i++; }
    else if (a.startsWith("--")) continue;
    else if (a.startsWith("-") && a.length > 1) {
      // sed: a script option ends a cluster of flags; perl: the first e/E in the cluster takes the rest (i takes a suffix, M/I/... a module or path).
      const m = name === "sed" ? /^-[nsuzEr]*[ef](.*)$/.exec(a) : /^-[^eEiMmIFxCdDV]*[eE](.*)$/.exec(a);
      if (m) { script = true; if (!m[1]) i++; }
    } else files.push(a);
  }
  return script ? files : files.slice(1);
}

// Paths a single command segment writes to, as raw words (quotes and `~` not yet resolved).
function writtenWords(words) {
  const [cmd, ...args] = commandWords(words);
  const name = basename(cmd ?? "");
  const operands = (list) => list.filter((w) => !w.startsWith("-"));
  if (WRITES_ALL_ARGS.includes(name)) return operands(args);
  if ((name === "sed" || name === "perl") && args.some((a) => /^-[a-zA-Z]*i|^--in-place/.test(a))) return scriptFiles(args, name);
  if (name === "dd") return args.filter((a) => a.startsWith("of=")).map((a) => a.slice(3));
  if (["cp", "rsync", "install"].includes(name)) return operands(args).slice(-1);
  if (name === "ln") {
    // Only the link location is written: -t DIR, else the last operand, else (one operand) its basename in the cwd.
    const t = args.findIndex((a) => /^(-t|--target-directory)(=|$)|^-t./.test(a));
    if (t >= 0) return [/^--target-directory=|^-t./.test(args[t]) ? args[t].replace(/^--target-directory=|^-t/, "") : args[t + 1]].filter(Boolean);
    const ops = operands(args);
    return ops.length > 1 ? ops.slice(-1) : ops.map((w) => basename(unquote(w)));
  }
  const git = gitCall(words);
  if (git && GIT_WRITES.includes(git.sub) && !stashReads(git)) return [...operands(git.rest), ...(GIT_TREE_WIDE.includes(git.sub) ? ["."] : [])];
  return [];
}

// Best effort: a shell command that writes to a path editViolation protects, or mentions the trust list
// without being read-only. Interpreters, variables and indirection can still write.
// readOnly (cherry): nothing under the project changes and git does not touch the tree or refs.
// toolEditsOnly (mango, lemon; the agent name, or true for mango): file contents change through Edit/Write; Bash writes only under the temp dir.
export function commandViolation(command, { project, cwd, env = process.env, readOnly = false, toolEditsOnly = false } = {}) {
  readOnly = readOnly && inScope(project, env);
  toolEditsOnly = toolEditsOnly && inScope(project, env) && toolEditsOnly;
  const MANGO_MSG = editsMsg(typeof toolEditsOnly === "string" ? toolEditsOnly : "mango");
  // Codex can run `apply_patch` from the shell (heredoc bodies are dropped below): check the patch headers it names.
  const patched = patchPaths(command, cwd ?? process.cwd()).map((p) => editViolation(p, project, env)).find(Boolean);
  if (patched) return patched;
  // shortcut: code inside an interpreter cannot be resolved to a path, so any inline write API is blocked whatever its target; upgrade if mango needs scripted temp files.
  const inlineWrite = toolEditsOnly && INLINE_CODE.test(command) && FILE_WRITE_API.test(command);
  const flat = hideQuotedRedirects(stripHeredocs(command))
    .replace(/\d*>&(\d+|-)(?![^\s;&|)<>])/g, " ") // `2>&1`, `>&-`: fd duplication, not a file
    .replace(/&>>?[|!]?|>[|&]/g, ">"); // `&>`, `&>|`, `>|`, `>&word` are file redirections: keep them from being cut by the split below
  const inner = [];
  const text = takeSubstitutions(flat, inner);
  const segments = [text, ...inner].join("\n").split(/\n|;|&|\||\(|\)|`/);
  // The shell drops quotes and backslashes, so `tru"st".mjs` is trust.mjs: match with them removed.
  const onlyReads = !command.includes(">") && segments.every((s) => !s.trim() || READ_ONLY.includes(s.trim().split(/\s+/)[0]));
  if (MENTIONS_TRUST_LIST.test(unquote(command)) && !onlyReads) return "Only the human edits the trusted-projects list. Ask them to run the command.";
  if (MENTIONS_INSTALL_HOOKS.test(unquote(command)) && !onlyReads) return "Only the human installs the hooks. Ask them to type /skuizops:install-hooks.";
  if (MENTIONS_PUBLISH.test(unquote(command)) && !onlyReads) return "Only the human publishes the repo. Ask them to run /skuizops:publish.";
  let here = cwd ?? process.cwd();
  const clean = (word, from = here) => {
    // readOnly: a word starting with a command substitution is assumed inside the project (fail closed); mktemp is $MKTEMP, outside.
    const w = unquote(word).replace(/^\$SUBST/, (m) => (readOnly ? project : m)).replace(/^(~|\$HOME|\$\{HOME\})(?=\/|$)/, env.HOME ?? "").replace(/^(\$PWD|\$\{PWD\})(?=\/|$)/, here).replace(/^\$(?:(GH_CONFIG_DIR|XDG_CONFIG_HOME)|\{(GH_CONFIG_DIR|XDG_CONFIG_HOME)\})(?=\/|$)/, (m, a, b) => env[a ?? b] ?? m);
    return /[*?[]/.test(w) ? globSync(w, { cwd: from }).map((m) => resolve(from, m)).concat(resolve(from, w)) : [resolve(from, w)];
  };
  const dirOf = (word, from) => (unknownVar(word) ? resolve("/", unquote(word)) : clean(word, from)[0]);
  const unhide = (s) => s.replaceAll("\u0001", ">");
  for (const segment of segments) {
    // `>|` and zsh `>!` write past noclobber.
    const redirects = [...segment.matchAll(/\d*>>?[|!]?\s*([^\s<>]+)/g)].map((m) => unhide(m[1]));
    const words = unhide(segment.replace(/\d*>>?[|!]?\s*[^\s<>]*/g, " ")).trim().split(/\s+/).filter(unquote);
    if (runsSetup(words)) return "Only the human runs the setup. Ask them to run: npx github:enderdev01/skuizops";
    if (["cd", "pushd"].includes(words[0])) here = dirOf(words[1] ?? "~", here);
    const git = gitCall(words);
    const base = git ? git.dirs.reduce((dir, d) => dirOf(d, dir), here) : here;
    // cherry may drop its own mktemp copies: a worktree under the temp dir (or behind a $VAR, see unknownVar) holds no one's work.
    const inTemp = (path) => [env.TMPDIR ?? tmpdir(), "/tmp"].some((t) => under(fold(real(path)), fold(real(t))));
    const tempCopy = (w) => !!w && (unknownVar(w) || inTemp(dirOf(w, base)));
    if (readOnly && git?.sub === "worktree" && git.rest[0] === "remove" && tempCopy(git.rest.slice(1).find((a) => !a.startsWith("-")))) continue;
    if (readOnly && git && under(fold(base), fold(project)) && gitMutates(git)) return CHERRY_MSG;
    for (const [word, from] of [...redirects.map((w) => [w, here]), ...writtenWords(words).map((w) => [w, base])]) {
      if (!unquote(word) || (readOnly ? unknownVar(word) : subst(word))) continue;
      for (const path of clean(word, from)) {
        if (readOnly && under(fold(path), fold(project))) return CHERRY_MSG;
        const problem = editViolation(path, project, env);
        if (problem) return problem;
      }
    }
    if (toolEditsOnly) {
      const name = basename(commandWords(words)[0] ?? "");
      for (const word of [...redirects, ...(["tee", "sed", "perl"].includes(name) ? writtenWords(words) : [])]) {
        // shortcut: a leading unknown $VAR is assumed to be a temp dir, upgrade if mango abuses it.
        if (!unquote(word) || unknownVar(word)) continue;
        if (clean(word, here).some((path) => !inTemp(path) && !under(fold(path), "/dev"))) return MANGO_MSG;
      }
    }
  }
  return inlineWrite ? MANGO_MSG : null;
}

// Codex edits files with apply_patch: every path named in a patch header, resolved against cwd.
export const patchPaths = (patch, cwd) =>
  [...String(patch ?? "").matchAll(/^\s*\*\*\* (?:Add File|Update File|Delete File|Move to): (.+?)\s*$/gm)].map((m) => resolve(cwd, m[1]));

if (isMain(import.meta.url)) {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");
  const bash = process.argv[2] === "bash";
  const project = projectDir(input);
  const agent = input.agent_type?.split(":").pop();
  const problem = bash
    ? commandViolation(input.tool_input?.command ?? "", { project, cwd: input.cwd ?? process.cwd(), readOnly: agent === "cherry", toolEditsOnly: ["mango", "lemon"].includes(agent) && agent })
    : input.tool_name === "apply_patch"
      ? patchPaths(input.tool_input?.command ?? input.tool_input?.input, input.cwd ?? process.cwd()).map((p) => editViolation(p, project)).find(Boolean)
      : editViolation(input.tool_input?.file_path ?? input.tool_input?.notebook_path, project);
  if (problem) {
    process.stderr.write(`skuizops: ${problem}\n`);
    process.exit(2);
  }
}
