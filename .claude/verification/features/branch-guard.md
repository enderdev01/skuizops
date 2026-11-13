# Branch guard

Script: `plugins/dev-factory/scripts/branch-guard.mjs <mode>`, with mode `claude` (PreToolUse Bash hook, JSON on stdin), `pre-commit`, `pre-merge-commit` or `pre-push` (git hooks). It blocks with exit 2 and the reason on stderr.

Exercise: `node scripts/control.mjs bench`, which runs it in a throwaway repo on `main`.

| Input (agent command on `main`) | Expected |
|---|---|
| `git commit -m "quick fix"` | BLOCK: `Branch policy: git commit blocked: "main" is a protected branch. Work on a feat/, fix/ or hotfix/ branch: git switch -c feat/<name>` |
| `git push origin main` | BLOCK: `Branch policy: git push blocked: Pushing to protected branch "main" is forbidden. Open a PR from a feat/, fix/ or hotfix/ branch instead.` |
| `git commit --no-verify -m "skip hooks"` | BLOCK: `Branch policy: --no-verify is forbidden: the git hooks enforce the branch policy.` |
| `git config core.hooksPath /dev/null` | BLOCK: `Branch policy: Changing core.hooksPath is forbidden: it would disable the branch policy.` |
| `git status` | allow, exit 0 |
| `npm test` | allow, exit 0 |

## Edge cases

- Empty stdin: parsed as `{}`, allowed.
- Project outside the scope roots (`~/DEV` plus `DEV_FACTORY_ROOTS`): allowed, the guard does not act.
- Reading the setting is caught too: `git config core.hooksPath` with no value was blocked in this session, so use `grep hooksPath .git/config` to read it.
- Matches command text: interpreters and variables can bypass it (best effort, documented in the code).
- Target dir (session on `develop`, worktree `../wt` on `fix/x`): `git -C ../wt commit -m x` and `cd ../wt && git commit -m x` are judged by `fix/x` and allowed. Any other shape (`pushd`, subshells, `$VAR`, `cd wt` without `./`) is judged by the session branch.
- A single plain `gh` call (not `alias`/`extension`) is not parsed for git: `gh issue create --body "... git commit ..."` and `gh pr create --body "$(cat <<'EOF' ... EOF)"` are allowed.
- Known gaps (verified, left as is): extra `git switch`/`git fetch . x:develop` chained after the `cd`, user gh aliases (`gh r "..."`), and a session cwd under a symlink.
