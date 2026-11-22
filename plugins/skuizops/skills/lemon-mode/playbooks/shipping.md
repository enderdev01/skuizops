### Shipping

You stop at the open PR. The merge is a later gate, and this playbook does not run it.

1. Commit on a `feat/`, `fix/`, or `hotfix/` branch, push, and open the PR. The PR is the human's review.
2. A PASS covers the patch, not the commit. Before trusting a PASS after HEAD moved, compare `git diff $(git merge-base HEAD origin/<default>) | git patch-id --stable` with the patch-id on the PASS row. The same id, and the same untracked files on finish-check paths, keeps the PASS.
3. The merge gate, for an autopilot that does not exist yet, is both of these on the PR head: CI green, and a cherry PASS whose patch-id is still that head. The autopilot would then run `gh pr merge <n> --squash` and read back `gh pr view <n> --json state,mergeCommit`. Green CI alone is not a merge. An old PASS on a different patch is not a merge.
4. Do not arm auto-merge. Do not run `gh pr merge`. Do not change repository rules or required checks. Tell the human which workflow check to require, and stop.
