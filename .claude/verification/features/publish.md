# Publish command

Command: `/skuizops:publish [owner/repo]` runs `plugins/skuizops/scripts/publish.mjs "$ARGUMENTS"`, which makes the current GitHub repo public while only collaborators can push or open pull requests. Only the human can run it: the model cannot invoke it and the path guard blocks running `publish.mjs` from a shell.

Exercise: `node scripts/control.mjs verify` runs `publish.test.mjs` (fake `gh`) and `path-guard.test.mjs`. Never run the script against a real repo by hand to test it.

| Input | Expected |
|---|---|
| No argument, or an argument that is not the repo's `owner/repo` | Dry run: the plan and `To apply, run: /skuizops:publish <owner/repo>`; nothing changes |
| The exact `owner/repo` | In order: `pull_request_creation_policy=collaborators_only`, visibility public, ruleset `skuizops-protected` created or updated; one `ok:` line each, plus a line saying anyone can still fork |
| Tracked `.env`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `credentials*` | Exit 1, lists the files, nothing changed (`*.example` and `*.sample` are fine) |
| Repo already public | The visibility step is skipped |
| Ruleset already exists | Updated with PUT, not duplicated |
| A step fails | Exit 1, names the failed step and the ones already applied |
| gh missing or not a GitHub repo | Exit 1 with a clear message |
| An agent runs `publish.mjs` through Bash | Blocked: ask the human to run `/skuizops:publish` |

## Edge cases

- The ruleset covers `~DEFAULT_BRANCH` and every protected branch name (and `<name>/**`) from `branch-guard.mjs`: no deletion, no force push, pull request required with 0 approvals so a solo maintainer can merge his own PR.
- Reading the script (`cat`) and running its tests are allowed.
