# Parallel sessions

Script: `plugins/dev-factory/scripts/sessions.mjs start|end|touch`, hooks `SessionStart`, `SessionEnd` and `PreToolUse` (every tool), JSON on stdin (`session_id`, `cwd`). It never blocks: any error ends with exit 0 and no output.

Registry: one `<session_id>.json` per session in `<git common dir>/dev-factory-sessions`, shared by every worktree. An entry not touched for 12 hours is dead.

Exercise: in a throwaway repo under the scope roots (`DEV_FACTORY_ROOTS=<repo>`):

```
echo '{"session_id":"a","cwd":"<repo>"}' | node sessions.mjs start
echo '{"session_id":"b","cwd":"<repo>"}' | node sessions.mjs start
```

| Input | Expected (observed) |
|---|---|
| session `a` starts alone | nothing, exit 0 |
| session `b` starts while `a` is live in the same checkout | `dev-factory: 1 other live session(s) already use this checkout (branch: master). Do not edit files, switch branches or commit in this checkout. Do every change in your own git worktree created from the repository's default branch, following the "Worktrees" section of your instructions. Reading files here is fine.` exit 0 |
| empty stdin, or a cwd that is not a git repo | nothing, exit 0 |
| more than 4 live sessions on the repo | extra line: `dev-factory: warning, more than 4 sessions are live on this repository.` |

## Edge cases

- The earliest session in a checkout (smaller `started`) gets no message. Resume and compact keep the original `started`.
- `touch` recreates a missing entry; `end` deletes it. An unsafe `session_id` (not `[\w-]+`) does nothing.
- Liveness is the mtime: an idle session older than 12 hours looks dead, a crashed one looks alive until then.
- Not in `bench`: its cases expect a block, and this hook never blocks. Covered by `sessions.test.mjs`.
