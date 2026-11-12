# guard-hardening

Objective: close the gaps a read-only security audit found in the dev-factory guards (plugin 0.4.0).
Branch: `fix/guard-hardening`. Delivery: ask-on-risk. Test runner: `node --test plugins/dev-factory/scripts/` (gate: `node scripts/control.mjs verify`).

## Specs

- S1 (U1, fail closed). Both PreToolUse hook commands in `plugins/dev-factory/hooks/hooks.json` block (exit 2) when the guard script throws or cannot be parsed, without relying on `onFailure`.
- S2 (U2, scope). `inScope` treats a case variant of a root and a symlink into a root as in scope. `DEV_FACTORY_ROOTS` adds roots to `~/DEV` and never replaces it (confirmed by the user: "DEV_FACTORY_ROOTS aditivo").
- S3 (U2, trust). `isTrusted` is true only when the project directory is exactly a listed root, compared through symlinks; nested directories are not trusted (confirmed by the user: "trust exacto"). A case variant is not trusted (assumption: under-trusting is the safe failure on case-sensitive volumes).
- S4 (U2, hint). A directory containing a newline is never trusted and `trustHint` does not emit a second line for it.
- S5 (U2, docs). README scope and trust sections and the command rule in agents and the `verify` skill describe S2 and S3.
- S6 (U3, more protected files). `editViolation` also blocks, anywhere: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.gitconfig`, anything under `~/.config/git`, and the shell profiles `~/.zshrc`, `~/.zshenv`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile`, `~/.profile`. Under the scope roots it also blocks `.claude/settings.json` and `.claude/settings.local.json` of any project.
- S7 (U3, shell writes). New `commandViolation(command, { project, cwd, env })` in `path-guard.mjs` returns a violation when a shell command writes to a path `editViolation` protects. A write is: (a) a redirection target (any `>` form); (b) any argument of `rm`, `rmdir`, `mv`, `tee`, `touch`, `chmod`, `chown`, `chflags`, `truncate`, `unlink`, `mkdir`, `ln`, of `sed` or `perl` with an `-i` flag, the `of=` value of `dd`, or of `git checkout|restore|rm|mv|clean|apply|stash`; (c) the last argument of `cp`, `rsync`, `install`. Before the check each word has quotes and backslashes deleted, a leading `~`, `$HOME` or `${HOME}` expanded, globs expanded with `fs.globSync`, and is resolved against the current directory, which follows `cd <dir>` across segments. Segments split on newline, `;`, `&`, `|`, `(`, `)`, backtick and `$(`. Reading a protected file (`cat`, `ls`, `cp` from it, `node <plugin script>`) is not a violation. This is best effort: interpreters and variables can still write.
- S8 (U3, trust list mention). A command that mentions the trust list (the current `branch-guard.mjs:53` pattern) is blocked unless it is read-only: every segment starts with `cat`, `ls`, `head`, `tail`, `wc`, `stat`, `file`, `grep`, `rg` or `diff`, and the command has no `>`.
- S9 (U3, wiring). `path-guard.mjs bash` is a new entry point registered in `hooks.json` as a second PreToolUse hook on `Bash` (with `|| exit 2`). It applies S7 and S8 with no scope gate of its own. The pattern at `branch-guard.mjs:53` is removed, so `branch-guard.mjs` keeps importing only `scope.mjs` and the copies in `scripts/guard/` keep working.
- S10 (U3, setup skill). In `create-verification-skill`, the steps that write `.githooks/`, `scripts/guard/` and `.claude/settings.json` are given to the human as exact commands instead of run by the agent.
- S11 (U3, docs). README "Trust and protected files" lists the S6 files and describes S7 and S8 and their best-effort limit.
- S12 (U4 to U8). Pending, see the plan in the session; specified when each unit starts.

## Tasks

- [x] T1 S1. Route: lemon inline. Commit: pending (human commits).
- [x] T2 S2, S3, S4, S5. Route: mango (user asked for the fruit team). Verifier: cherry (Risk items 2 and 3), PASS on S1 to S5. Commit: pending (human commits).
- [x] T3 S6 to S11. Route: mango started it, parent finished it inline (see L8). Verifier: cherry (Risk items 2 and 3), FAIL then corrected (see L9). Commit: pending (human decides).
- [ ] T4 S12. U4 to U8, not started.

## Log

- L1 (2026-11-12) User: "Genera un plan de correccion con lemon y sus frutas".
- L2 (2026-11-12) User confirmed the two U2 contract changes: "Sí, confirmo".
- L3 (2026-11-12) User authorized implementation starting with U1 and U2: "Si"; then committed the WIP as ed43d81 and created the branch: "Ya lo hice".
- L4 Baseline: `node scripts/control.mjs verify` green on ed43d81 before any change. Engram mirror pending.
- L5 T1 and T2 done, uncommitted. RED/GREEN: hooks-json 4 failing then 7/7; scope 6 failing then 17/17. cherry PASS S1 to S5. Parent follow-up inline: test for symlink trusted and case variant not trusted (scope 18/18), stale scope comments in three scripts, command rule copy in maintain-verification-skill. `control.mjs verify` green. Not checked: how Claude Code treats exit 2 with `onFailure`; case-sensitive volumes.
- L6 T1 and T2 committed as c5bec1e at the user's request: "Confirma los cambios del árbol de trabajo con un mensaje razonable."
- L7 (2026-11-12) User: "Sí, U3". Design change against the session plan: the shell check flags writes only (redirections and mutating commands) instead of every word that resolves to a protected path, because the plugin cache holds scripts that skills of every plugin run and copy from; and it lives in `path-guard.mjs bash` so `branch-guard.mjs` keeps a single import.
- L8 T3: mango split one change to `path-guard.mjs` into three edits; after the second the file did not parse and the live fail-closed Edit hook blocked the third. Lemon stopped. Parent removed the duplicated line with a shell edit and finished S8 removal, S9 wiring, S10 and S11 inline, one edit per file state. Added beyond the spec: wrapper words (`sudo`, `env`, `xargs`, ...) are skipped before the command name.
- L9 cherry on T3: S6, S8, S9, S10 PASS; differential PASS (editViolation 14/14, checkCommand 22/26 with the 4 moved trust-list cases blocked by commandViolation); 21 false-positive probes allowed. Blockers: `>|` and `>&` redirections, and a quoted or backslashed command word (`\rm`). S11 missed `settings.local.json`. One correction batch: six regression tests RED (6 failing) then GREEN (path-guard 61/61), README lists every file; also `pushd` and `{`, `!`, `then`, `do`, `else` prefixes. `control.mjs verify` green. The correction was rechecked by the tests, not by a second cherry run.
- L10 Open advisories (not covered): brace expansion, `find -delete`, `tar -C`, `patch`, `cp -t`, `env -i`, interpreters and variables; heredoc bodies are parsed as commands (possible false blocks); a glob over a huge tree can hit the 10 s hook timeout (fails closed); the trust-mention pattern also matches unrelated commands that mention `.config` and later `dev-factory`.
- L11 Next: U4 (git command parsing).
