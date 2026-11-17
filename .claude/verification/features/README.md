# Feature map

The user-facing features of the `skuizops` plugin and how to exercise each one. Every expected output below was observed by running the command, not written from memory.

| Feature | What it does | How to exercise it | Details |
|---|---|---|---|
| Branch guard | Blocks commits and pushes on protected branches, `--no-verify` and `core.hooksPath` changes (Claude Bash hook and git hooks) | `node scripts/control.mjs bench` | [branch-guard.md](branch-guard.md) |
| Path guard | Blocks agent edits and shell writes to `.githooks/`, `.git/`, `scripts/guard/`, `.claude/settings*.json`, the trust list and user config | `node scripts/control.mjs bench` | [path-guard.md](path-guard.md) |
| Attribution guard | `commit-msg` hook that rejects AI attribution trailers | `node scripts/control.mjs bench` | [attribution-guard.md](attribution-guard.md) |
| Background guard | Blocks `run_in_background` Bash calls from subagents | `node scripts/control.mjs bench` | [background-guard.md](background-guard.md) |
| Parallel sessions | SessionStart hook: a session that starts while another live one holds the same checkout is told to work in its own worktree; warns above 4 live sessions; never blocks | `node --test plugins/skuizops/scripts/sessions.test.mjs` | [parallel-sessions.md](parallel-sessions.md) |
| Update notice | SessionStart hook: when the installed skuizops is older than the marketplace's, tells lemon to ask the human whether to update; silent when up to date, offline or on any error | `node --test plugins/skuizops/scripts/update-check.test.mjs` | [update-notice.md](update-notice.md) |
| Leftovers notice | SessionStart hook: lists installer backups, merged local branches and merged clean worktrees left by earlier sessions and tells lemon to ask the human before cleaning; never deletes | `node --test plugins/skuizops/scripts/leftovers.test.mjs` | [leftovers.md](leftovers.md) |
| Verify gate | Stop hook: runs the project's `verify` in trusted projects and blocks the stop on failure | `node scripts/control.mjs verify` | [verify-gate.md](verify-gate.md) |
| Lint on edit | PostToolUse hook: runs the project's local ESLint on the edited JS/TS file | `node scripts/control.mjs verify` | [check-file.md](check-file.md) |
| Subagent status row | Status line: one row per subagent with fruit emoji, task, model and tokens | `node scripts/control.mjs verify` | [subagent-row.md](subagent-row.md) |
| Trust command | `/skuizops:trust [dir]`: the human adds a project to the trust list | `node scripts/control.mjs verify` | [trust.md](trust.md) |
| Check command | `/skuizops:check`: read-only check of plugin, default agent, git hooks, guards, trust and old-name leftovers, with the fix for each FAIL; a SessionStart hook nudges when one fails | `node --test plugins/skuizops/scripts/check.test.mjs` | [check.md](check.md) |
| Install-hooks command | `/skuizops:install-hooks [dir]`: the human installs the git hooks and guard scripts in a project | `node scripts/control.mjs verify` | [install-hooks.md](install-hooks.md) |
| Publish command | `/skuizops:publish [owner/repo]`: the human makes the GitHub repo public with only collaborators able to push or open pull requests (dry run unless the repo name is confirmed) | `node --test plugins/skuizops/scripts/publish.test.mjs` | [publish.md](publish.md) |
| Setup command | `npx github:enderdev01/skuizops`: the human installs or updates marketplace, plugin, git hooks (keeping backups of edits), trusts the project, sets lemon in `.claude/settings.json` (never overwrites a different agent or invalid JSON) and installs Playwright when a web UI is detected, then relaunches Claude | `node --test bin/setup.test.mjs` | [install-hooks.md](install-hooks.md) |
| Uninstall command | `npx github:enderdev01/skuizops uninstall`: prints the plan, asks one y/N, then removes the git hooks (keeping edited files), trust line, lemon agent and brief style, marketplace setting, plugin and marketplace | `node --test bin/uninstall.test.mjs` | [uninstall.md](uninstall.md) |

`node scripts/control.mjs doctor` checks the environment (Node 22.18+, git hooks, work branch) and runs before everything else.
