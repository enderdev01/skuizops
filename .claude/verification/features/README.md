# Feature map

The user-facing features of the `dev-factory` plugin and how to exercise each one. Every expected output below was observed by running the command, not written from memory.

| Feature | What it does | How to exercise it | Details |
|---|---|---|---|
| Branch guard | Blocks commits and pushes on protected branches, `--no-verify` and `core.hooksPath` changes (Claude Bash hook and git hooks) | `node scripts/control.mjs bench` | [branch-guard.md](branch-guard.md) |
| Path guard | Blocks agent edits and shell writes to `.githooks/`, `.git/`, `scripts/guard/`, `.claude/settings*.json`, the trust list and user config | `node scripts/control.mjs bench` | [path-guard.md](path-guard.md) |
| Attribution guard | `commit-msg` hook that rejects AI attribution trailers | `node scripts/control.mjs bench` | [attribution-guard.md](attribution-guard.md) |
| Background guard | Blocks `run_in_background` Bash calls from subagents | `node scripts/control.mjs bench` | [background-guard.md](background-guard.md) |
| Verify gate | Stop hook: runs the project's `verify` in trusted projects and blocks the stop on failure | `node scripts/control.mjs verify` | [verify-gate.md](verify-gate.md) |
| Lint on edit | PostToolUse hook: runs the project's local ESLint on the edited JS/TS file | `node scripts/control.mjs verify` | [check-file.md](check-file.md) |
| Subagent status row | Status line: one row per subagent with fruit emoji, task, model and tokens | `node scripts/control.mjs verify` | [subagent-row.md](subagent-row.md) |
| Trust command | `/dev-factory:trust [dir]`: the human adds a project to the trust list | `node scripts/control.mjs verify` | [trust.md](trust.md) |

`node scripts/control.mjs doctor` checks the environment (Node 22.18+, git hooks, work branch) and runs before everything else.
