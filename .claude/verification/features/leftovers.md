# Leftovers notice

Script: `plugins/skuizops/scripts/leftovers.mjs`, hook `SessionStart`, JSON on stdin (cwd of the session). It never blocks and never deletes: any error ends with exit 0 and no output. No network call.

Leftovers, in the git root of the session: installer backups (`*.local-<YYYYMMDD-HHMMSS>` directly in `.githooks` and `scripts/guard`); local branches merged into the remote default branch (`origin/HEAD`, else `origin/develop`, `origin/main`, `origin/master`; none found means no branches or worktrees) minus the current, protected and worktree-checked-out ones; linked worktrees whose branch is merged and whose `git status --porcelain` is empty.

Path guard finding: `commandViolation("rm scripts/guard/x.mjs.local-...")` and the same for `.githooks/` are blocked, so the notice tells lemon to show the human the `rm` command for backups. Branches and worktrees are removed with `git branch -d` and `git worktree remove`, never forced.

Exercise:

```
node --test plugins/skuizops/scripts/leftovers.test.mjs
echo '{}' | node plugins/skuizops/scripts/leftovers.mjs
```

| Input | Expected (observed) |
|---|---|
| merged branches, backups or merged clean worktrees exist | one line naming each with counts, asking the orchestrator to ask the human, exit 0 |
| nothing left over, not a git repo, or any error | nothing, exit 0 |

Observed output (second command, from this repo's root):

```
skuizops: earlier sessions left leftovers in this checkout: 16 merged local branch(es) (feat/install-hooks-command, feat/lighter-cherry, ..., fix/use-hook-templates). List them to the human and ask whether to clean them. Only on a yes, run `git worktree remove <path>` (never `--force`) and `git branch -d <name>` (never `-D`); the guard blocks deleting backup files, so show the human the `rm` command for the backups instead. Never delete anything without a yes.
```

Observed output (first command):

```
✔ a clean repo has none and an empty message
✔ lists installer backups
✔ lists merged branches, not the current, protected or unmerged ones
✔ lists a merged clean worktree, not a dirty or unmerged one, and not its branch
✔ no remote default branch reports no branches or worktrees
✔ message names everything and forbids forcing and unasked deletes
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

## Edge cases

- Repeats on every session start while leftovers remain.
- Squash-merged branches are not "merged" for git, so they are never listed.
- Not in `bench`: this hook never blocks. Covered by `leftovers.test.mjs`.
