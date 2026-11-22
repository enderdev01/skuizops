// Branch policy for every agent and every human:
//   - commits only on work branches: `feat/*`, `fix/*`, `hotfix/*`
//   - never commit or push to a protected branch (or anything under it, e.g. release/1.2)
//
// One policy, three entry points:
//   node branch-guard.mjs claude       Claude Code PreToolUse hook (Bash), reads hook JSON on stdin
//   node branch-guard.mjs pre-commit   git pre-commit / pre-merge-commit hook
//   node branch-guard.mjs pre-push     git pre-push hook, reads "<local ref> <sha> <remote ref> <sha>" lines
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, normalize } from "node:path";
import { inScope, isMain, projectDir } from "./scope.mjs";

export const PROTECTED = ["develop", "desarrollo", "desa", "main", "master", "production", "prod", "test", "release"];
export const WORK_PREFIXES = ["feat/", "fix/", "hotfix/"];

const shortName = (ref) => ref.replace(/^refs\/heads\//, "");

export function isProtected(ref) {
  const first = shortName(ref).toLowerCase().split("/")[0];
  return PROTECTED.includes(first);
}

export function isWorkBranch(ref) {
  return WORK_PREFIXES.some((prefix) => shortName(ref).startsWith(prefix));
}

export function commitViolation(branch) {
  if (!branch) return "HEAD is detached or unknown. Create a branch first: git switch -c feat/<name> (or fix/, hotfix/)";
  if (isProtected(branch)) return `"${branch}" is a protected branch. Work on a feat/, fix/ or hotfix/ branch: git switch -c feat/<name>`;
  if (!isWorkBranch(branch)) return `"${branch}" is not a feat/, fix/ or hotfix/ branch. Rename it: git branch -m feat/<name>`;
  return null;
}

export function pushViolation(remoteRef) {
  if (isProtected(remoteRef)) return `Pushing to protected branch "${shortName(remoteRef)}" is forbidden. Open a PR from a feat/, fix/ or hotfix/ branch instead.`;
  if (!isWorkBranch(remoteRef)) return `Only feat/, fix/ and hotfix/ branches may be pushed, got "${shortName(remoteRef)}".`;
  return null;
}

// git global options that take a separate value: `git -c k=v commit`, `git -C dir commit`.
const GIT_OPTIONS_WITH_VALUE = ["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"];

// Split `git [global options] <subcommand> [args]` into the subcommand and its arguments.
function parseGit(words) {
  let i = 0;
  while (i < words.length && words[i].startsWith("-")) i += GIT_OPTIONS_WITH_VALUE.includes(words[i]) ? 2 : 1;
  return { sub: words[i], rest: words.slice(i + 1) };
}

// A `gh` call whose only quoted text is inert data (no `$`, backtick, `;`, `|`...) cannot run git, so its
// text (e.g. an issue body that mentions `git commit`) is not inspected. `gh alias`/`extension` can run shell.
const GH_DATA = /"\$\(cat <<'(\w+)'\n([\s\S]*?)\n\1\n\)"|"(?:\\.|[^"\\$`])*"|'[^']*'/g;
export function isPlainGhCall(command) {
  if (!/^gh\s/.test(command) || /^gh\s+(alias|extension)\b/.test(command)) return false;
  // A body line equal to the delimiter would end the heredoc early and run the rest: keep the `$` so it is rejected.
  const rest = command.replace(GH_DATA, (m, tag, body) => (tag && body.split("\n").includes(tag) ? m : ""));
  return !/[;&|<>(){}$`\\#"'\n]/.test(rest);
}

// A small shell parser (issue #61). It understands only plain shapes and returns null for anything else:
// unbalanced quotes, `$(...)`, backticks, subshells, process substitution, line continuations, unterminated heredocs.
// The one `$(...)` it accepts is a quoted-heredoc message, `"$(cat <<'EOF' ... EOF)"`, which only prints text.
const SAFE_CAT = /"\$\(cat <<'(\w+)'\n([\s\S]*?)\n\1\n\)"/g;
const REDIR = /^(\d*[<>]|&>)/;
const REDIR_OP = /^(\d*(>>?|<|<<<|>&|<&)|&>>?)$/; // a bare operator: its target is the next word
// The delimiter must end the word: in `<<EO\F` or `<<'EO'F` the shell's delimiter is `EOF`, not `EO`.
const HEREDOC = /^<<(-?)\s*(["']?)([\w.-]+)\2(?=[\s;&|<>]|$)/;
const lineEnd = (s, i) => (s.indexOf("\n", i) === -1 ? s.length : s.indexOf("\n", i));

function parseShell(command) {
  const src = command.replace(SAFE_CAT, (m, tag, body) => (body.split("\n").includes(tag) ? m : "'\u0001'"));
  const cmds = [], cuts = [], pending = [];
  let cur = null, w = null, sep = null;
  const open = () => {
    if (!cur) cmds.push((cur = { words: [], sep })), (sep = null);
    return cur;
  };
  const flush = (end) => {
    if (w) (w.end = end), open().words.push(w);
    w = null;
  };
  const split = (s, at) => {
    flush(at);
    cur = null;
    sep = s;
  };
  const word = (at) => (w ??= { raw: "", quoted: false, start: at });
  for (let i = 0; i < src.length; i++) {
    const c = src[i], next = src[i + 1];
    if (c === " " || c === "\t") flush(i);
    else if (c === "\n") {
      flush(i);
      // Heredoc bodies start on the next line. An unquoted body still expands `$(...)` and backticks: not understood.
      for (const h of pending.splice(0)) {
        const start = i + 1;
        let j = start, end = -1;
        while (j <= src.length) {
          const e = lineEnd(src, j);
          const line = src.slice(j, e);
          if (!h.quoted && line.endsWith("\\")) return null; // the shell joins it with the next line, which can form the delimiter
          if ((h.dash ? line.replace(/^\t+/, "") : line) === h.word) { end = e; break; }
          if (e === src.length) break;
          j = e + 1;
        }
        if (end === -1 || (!h.quoted && /\$\(|`/.test(src.slice(start, end)))) return null;
        cuts.push({ start, end, owner: h.owner });
        i = end;
      }
      split("\n", i);
    } else if (c === "\\") {
      if (next === "\n" || next === undefined) return null;
      word(i).raw += c + next;
      w.quoted = true;
      i++;
    } else if (c === "'" || (c === "$" && next === "'")) {
      let j = c === "$" ? i + 2 : i + 1;
      while (j < src.length && src[j] !== "'") j += c === "$" && src[j] === "\\" ? 2 : 1;
      if (j >= src.length) return null;
      word(i).raw += src.slice(i, j + 1);
      w.quoted = true;
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "`" || (src[j] === "$" && src[j + 1] === "(")) return null;
        j += src[j] === "\\" ? 2 : 1;
      }
      if (j >= src.length) return null;
      word(i).raw += src.slice(i, j + 1);
      w.quoted = true;
      i = j;
    } else if (c === "`" || c === "(" || c === ")" || (c === "$" && next === "(") || ((c === "<" || c === ">") && next === "(")) return null;
    else if (c === "#" && !w) {
      const e = lineEnd(src, i);
      cuts.push({ start: i, end: e, owner: null });
      i = e - 1;
    } else if (c === ";") split(";", i);
    else if (c === "&") {
      if (next === "&") split("&&", i), i++;
      else if (w && /[<>]$/.test(w.raw)) w.raw += c; // 2>&1, >&2
      else if (next === ">") word(i).raw += c; // &> file
      else split("&", i);
    } else if (c === "|") {
      if (next === "|") split("||", i), i++;
      else split("|", i), (i += next === "&" ? 1 : 0);
    } else if (c === "<" && next === "<" && src[i + 2] === "<") {
      word(i).raw += "<<<"; // a here-string, not a heredoc: its next `<<` must not be read as one
      i += 2;
    } else if (c === "<" && next === "<") {
      const m = HEREDOC.exec(src.slice(i));
      if (!m) return null;
      flush(i);
      pending.push({ dash: !!m[1], quoted: !!m[2], word: m[3], owner: open() });
      cur.words.push({ raw: m[0], quoted: true, start: i, end: i + m[0].length });
      i += m[0].length - 1;
    } else word(i).raw += c;
  }
  flush(src.length);
  return pending.length ? null : { src, cmds, cuts };
}

// The words a command runs, without leading assignments and redirections.
function argv(words) {
  const out = [];
  for (let k = 0; k < words.length; k++) {
    if (REDIR.test(words[k].raw)) {
      if (REDIR_OP.test(words[k].raw)) k++;
      continue;
    }
    if (!out.length && /^[A-Za-z_]\w*=/.test(words[k].raw)) continue;
    out.push(words[k]);
  }
  return out;
}

const isGit = (w) => !!w && !w.quoted && (w.raw === "git" || w.raw.endsWith("/git"));
// Commands that only print, read or create files: their arguments and heredocs are data, never shell.
const INERT = new Set(["echo", "printf", "cat", "tee", "grep", "head", "tail", "wc", "ls", "mkdir", "touch", "true", "false", "pwd", "cd", "gh"]);
function kind(cmd) {
  const a = argv(cmd.words);
  if (!a.length) return "assign";
  if (isGit(a[0])) return "git";
  if (a[0].quoted || /[$\\]/.test(a[0].raw) || !INERT.has(a[0].raw)) return "other";
  // A prefix assignment (GH_BROWSER=, PAGER=...) can name a program to run.
  if (cmd.words.slice(0, cmd.words.indexOf(a[0])).some((w) => /^[A-Za-z_]\w*=/.test(w.raw))) return "other";
  // The first argument picks gh's subcommand and printf's `-v`: it must be read as the shell passes it, so it has to be plain.
  const first = a[1] && (a[1].quoted || /[$\\]/.test(a[1].raw) ? null : a[1].raw);
  if ((a[0].raw === "gh" || a[0].raw === "printf") && a[1] && first === null) return "other";
  // gh runs its configured browser, editor and pager, and aliases and extensions; `config` sets them.
  if (a[0].raw === "gh" && /^(alias|extension|ext|config)$/.test(first ?? "")) return "other";
  // bash `printf -v` sets a variable that an arithmetic `$[x]` would evaluate, running its `$(...)`. Options come first.
  if (a[0].raw === "printf" && /^-v/.test(first ?? "")) return "other";
  return "inert";
}
// A pipe feeds the left side's output to the right side: only an inert reader may receive it (never git or a shell).
const pipesOk = (p) => p.cmds.every((c) => c.sep !== "|" || (kind(c) === "inert" && argv(c.words)[0].raw !== "cd"));

// The command with data removed: every argument of an inert command, heredoc bodies fed to one, and comments.
// Only when every command is inert, git, or an assignment, so no removed text can reach a shell. Else null.
function dataOnly(p) {
  if (!p.cmds.every((c) => kind(c) !== "other") || !pipesOk(p) || p.cuts.some((c) => c.owner && kind(c.owner) !== "inert")) return null;
  const spans = p.cuts.map((c) => [c.start, c.end, ""]);
  for (const c of p.cmds) {
    const head = argv(c.words)[0];
    if (kind(c) !== "inert" || head.raw === "cd") continue;
    for (const w of c.words) if (w !== head) spans.push([w.start, w.end, "\u0001"]);
  }
  let out = "", at = 0;
  for (const [s, e, r] of spans.sort((x, y) => x[0] - y[0])) (out += p.src.slice(at, s) + r), (at = e);
  return out + p.src.slice(at);
}

const PATH_RE = /^(\/|\.\/|\.\.\/|~\/|\.\.$|\.$)[\w./@+-]*$/;
const home = (d) => (d.startsWith("~/") ? homedir() + d.slice(1) : d);
// Only config that cannot move the work tree, alias a command or run code is honored among the leading options (#63).
const SAFE_CONFIG = /^(user\.(name|email)|commit\.gpgsign)=[\w.@+-]*$/;
// Builtins and keywords that can change the shell's directory (or hide a `cd` after them).
const MOVES_CWD = new Set(["pushd", "popd", "builtin", "command", "source", ".", "eval", "exec", "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "for", "select", "case", "esac", "!", "{", "}", "[[", "time", "function", "coproc", "alias", "set", "shopt", "trap"]);

// Directories each git of the command may run in (null = the session cwd), in order, or null when not understood.
// A git entry is null when its own dir cannot be read (it is then judged by the session branch).
function gitDirs(p) {
  if (!pipesOk(p)) return null;
  const vars = new Map();
  // `NAME=/path` alone on its statement, and NAME nowhere else but in `$NAME`/`${NAME}` (no `W+=`, `read W`, zsh `W[1]=`).
  const assign = (c, n) => {
    const m = /^([A-Za-z_]\w*)=(.*)$/s.exec(c.words[0].raw);
    if (!m || c.words.length !== 1) return;
    const value = m[2].replace(/^(["'])(.*)\1$/s, "$2");
    const once = (p.src.match(new RegExp(`(?<![\\w$])(?<!\\$\\{)${m[1]}\\b`, "g")) ?? []).length === 1;
    const certain = [null, ";", "\n"].includes(c.sep) && [";", "\n", "&&"].includes(p.cmds[n + 1]?.sep);
    vars.set(m[1], once && certain && PATH_RE.test(value) ? value : null);
  };
  const pathOf = (w) => {
    const v = /^(?:\$(\w+)|\$\{(\w+)\}|"\$(\w+)"|"\$\{(\w+)\}")$/.exec(w.raw);
    const name = v && (v[1] ?? v[2] ?? v[3] ?? v[4]);
    const raw = v ? (name !== "_" && vars.get(name)) || null : w.quoted ? null : w.raw;
    return raw && PATH_RE.test(raw) ? home(raw) : null;
  };
  const under = (cwd, d) => (isAbsolute(d) ? [d] : cwd.map((c) => (c === null ? d : `${c}/${d}`)));
  const dirOf = (a, cwd) => {
    let k = 1, dir = null;
    while (a[k]?.raw.startsWith("-")) {
      if (a[k].quoted) return null;
      if (a[k].raw === "-C" && dir === null && a[k + 1]) {
        if ((dir = pathOf(a[k + 1])) === null) return null;
        k += 2;
      } else if (a[k].raw === "-c" && a[k + 1] && !a[k + 1].quoted && SAFE_CONFIG.test(a[k + 1].raw)) k += 2;
      else return null; // `--bare`, `--git-dir`, a second `-C`...: git may act elsewhere, judge by the session (#63)
    }
    if (a[k]?.quoted) return null; // a quoted subcommand
    return dir === null ? cwd : under(cwd, dir); // raw: `git -C` follows symlinks physically, so `..` is not folded
  };
  // cwd: the dirs the shell may be in. A `cd` holds for its `&&` chain; after `;`, `||`, `|` or `&` either side may apply.
  let cwd = [null], base = cwd;
  const out = [];
  p.cmds.forEach((c, n) => {
    if (c.sep && c.sep !== "&&") base = cwd = [...new Set([...base, ...cwd])];
    const a = argv(c.words);
    if (!a.length) return assign(c, n);
    if (isGit(a[0])) return out.push(dirOf(a, cwd));
    if (a[0].quoted || /[$\\]/.test(a[0].raw) || MOVES_CWD.has(a[0].raw)) cwd = [null];
    else if (a[0].raw === "cd") {
      const d = a.length === 2 ? pathOf(a[1]) : null;
      cwd = d === null ? [null] : under(cwd, d).map((x) => normalize(x));
    }
  });
  return out;
}

const HINT = " (the target dir could not be read from this command: pass the literal path, as in git -C <path> … or cd <path> && git …)";

// Best-effort check of a shell command before Claude runs it. The git hooks are the authoritative layer.
export function checkCommand(command, currentBranch, branchAt = () => null) {
  if (!/\bgit\b/.test(command)) return null;
  const parsed = parseShell(command);
  // Text given to echo, cat, a heredoc... is data (#61). When anything else could run text, all of it is inspected.
  const text = (parsed && dataOnly(parsed)) ?? command;
  if (!/\bgit\b/.test(text)) return null;
  // git accepts any unambiguous prefix of a long option, so `--no-verif` is `--no-verify`.
  if (/(^|[\s"'])--no-v/.test(text)) return "--no-verify is forbidden: the git hooks enforce the branch policy.";
  // An included config file can set core.hooksPath without naming it here.
  if (/\binclude\.path\b|\bincludeif\./i.test(text)) return "Changing git config includes is forbidden: an included file could disable the git hooks.";
  // The one allowed form is the setup step: `git config [--local] core.hooksPath .githooks`.
  const withoutSetup = text.replace(/\bgit\s+config\s+(--local\s+)?core\.hooksPath\s+\.githooks(?![^\s;&|])/gi, "");
  if (/core\.hooksPath/i.test(withoutSetup)) return "Changing core.hooksPath is forbidden: it would disable the branch policy.";

  if (isPlainGhCall(command)) return null;

  // Dropping quotes splits `-C "$W"p commit` into `-C $W p commit` (subcommand `p`), hiding the commit: refuse the shape.
  if (/\s-C\s+(?:"[^"]*"|'[^']*')[^\s;&|)]/.test(text)) return "git blocked: -C <quoted path> followed by more text in the same word is not understood: write the path as one word, git -C <path> …";

  // Quotes are dropped so `bash -c 'git commit'` is inspected like `git commit`. Only the first git of
  // each segment is inspected. Redirections are removed first: `2>&1` and `> file` are not refspecs.
  const segments = text.replace(/["']/g, " ").replace(/\d*>>?(&\d+|\s*[^\s;&|()`]+)/g, " ").split(/[;&|\n()`]+/);
  const wordsOf = (s) => s.trim().split(/\s+/);
  const gitIn = (ws) => ws.findIndex((w) => w === "git" || w.endsWith("/git"));
  // Dirs are trusted only when the parser saw exactly the gits found here, else a git it missed could hide.
  let dirs = parsed && gitDirs(parsed);
  if (dirs && dirs.length !== segments.filter((s) => gitIn(wordsOf(s)) !== -1).length) dirs = null;
  const hintable = /(^|[\s;&|])(cd|-C)\s/.test(text);
  let nth = -1;
  for (const segment of segments) {
    const words = wordsOf(segment);
    const gitAt = gitIn(words);
    if (gitAt === -1) continue;
    nth++;
    const own = dirs?.[nth] ?? null;
    const hint = own === null && hintable ? HINT : "";
    // Every dir this git may run in is judged; a violation on any of them blocks.
    const branches = () => (own ?? [null]).map((d) => (d === null ? currentBranch : branchAt(d)));
    // These decide which hooks, config and git binary run. GIT_EDITOR, GIT_PAGER and the like are fine.
    if (words.slice(0, gitAt).some((w) => /^(HOME|PATH|GIT_DIR|GIT_EXEC_PATH|GIT_CONFIG\w*)=/.test(w))) {
      return "Setting HOME, PATH, GIT_DIR, GIT_EXEC_PATH or GIT_CONFIG* for a git command is forbidden: it changes which hooks and config git uses.";
    }
    const { sub, rest } = parseGit(words.slice(gitAt + 1));
    const args = [sub, ...rest.filter((w) => !w.startsWith("-"))];

    if (sub === "commit" && rest.some((w) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(w))) {
      return "git commit -n is --no-verify, which is forbidden: the git hooks enforce the branch policy.";
    }
    if (["commit", "merge", "cherry-pick", "revert", "rebase", "am", "reset"].includes(sub)) {
      for (const branch of branches()) {
        const problem = commitViolation(branch);
        if (problem) return `git ${sub} blocked: ${problem}${hint}`;
      }
    }
    // Plumbing and forced branch moves change a ref without running any hook.
    if (sub === "update-ref" || sub === "commit-tree") return `git ${sub} is forbidden: it moves refs without running the git hooks.`;
    const deletes = sub === "branch" && rest.some((w) => /^(-[a-zA-Z]*[dD][a-zA-Z]*|--delete)$/.test(w));
    const forces =
      (sub === "branch" && rest.some((w) => /^(-[a-zA-Z]*[fM][a-zA-Z]*|--force)$/.test(w))) ||
      (sub === "checkout" && rest.includes("-B")) ||
      (sub === "switch" && rest.some((w) => w === "-C" || w === "--force-create"));
    // A delete names every branch it removes; a forced move names the branch first, then its start point.
    const operands = args.slice(1);
    const moved = deletes ? operands.find(isProtected) : forces && isProtected(operands[0] ?? "") ? operands[0] : null;
    if (moved) return `git ${sub} blocked: "${moved}" is a protected branch and cannot be moved, reset or deleted here.`;
    if (sub === "push") {
      if (/\s--(all|mirror)\b/.test(segment)) return "git push --all/--mirror is forbidden.";
      const heads = branches().map((b) => b ?? "");
      const refspecs = args.slice(2).map((r) => r.replace(/^\+/, "").split(":").pop()); // after "push <remote>"
      const targets = refspecs.length ? refspecs.flatMap((t) => (t === "HEAD" ? heads : [t])) : heads;
      for (const target of targets) {
        const problem = pushViolation(target);
        if (problem) return `git push blocked: ${problem}${hint}`;
      }
    }
  }
  return null;
}

function currentBranch(cwd) {
  const r = spawnSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function fail(message) {
  process.stderr.write(`Branch policy: ${message}\n`);
  process.exit(2);
}

function main(mode) {
  const stdin = readFileSync(0, "utf8");

  if (mode === "claude") {
    const input = JSON.parse(stdin || "{}");
    // Outside the scope roots (~/DEV plus SKUIZOPS_ROOTS) the Claude hook does nothing; installed git hooks still apply.
    if (!inScope(projectDir(input))) return;
    const command = input.tool_input?.command ?? "";
    const cwd = input.cwd ?? process.cwd();
    const problem = checkCommand(command, currentBranch(cwd), (d) => currentBranch(isAbsolute(d) ? d : cwd + "/" + d));
    if (problem) fail(problem);
    return;
  }
  if (mode === "pre-commit") {
    const problem = commitViolation(currentBranch(process.cwd()));
    if (problem) fail(problem);
    return;
  }
  if (mode === "pre-push") {
    for (const line of stdin.split("\n").filter(Boolean)) {
      const remoteRef = line.split(" ")[2];
      const problem = remoteRef && pushViolation(remoteRef);
      if (problem) fail(problem);
    }
    return;
  }
  fail(`unknown mode "${mode}". Use: claude | pre-commit | pre-push`);
}

if (isMain(import.meta.url)) main(process.argv[2]);
