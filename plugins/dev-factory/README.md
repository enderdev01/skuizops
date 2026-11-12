# dev-factory

A Claude Code plugin that makes agents check their own work. It follows the pyramid, strongest guarantee first:
**codebase > static analysis > verification > prose > human review**.

## Agents

| Agent | Model | Role |
|---|---|---|
| `kiwi` | Haiku | Scout: read-only codebase search |
| `fig` | Haiku | Log reader: reports each test, build and lint failure |
| `mango` | Sonnet | Builder: implements one well-specified unit |
| `lemon` | Session model | Orchestrator: the main session in set-up projects, delegates on its own |
| `cherry` | Opus | Inspector: independently verifies a change, with evidence |

Skills: `verify`, `push-up-the-ladder`, `create-verification-skill`, `maintain-verification-skill`.
Hooks: branch guard on Bash, a protected-files guard on Edit and Write, a commit-msg guard that rejects AI attribution, ESLint on edited files (when the project has it), and a Stop gate that runs the project's verify.

## What you see

Each agent has a color (kiwi green, fig purple, mango orange, cherry red, lemon yellow), and while one runs the agent panel shows a row like:

```
🥝 kiwi · find auth routes · haiku · 12k tok
🍒 cherry · verify with control.mjs · opus · 48k tok ✓
```

Lemon is not listed there: it is the main session, not a subagent. `create-verification-skill` sets `"agent": "dev-factory:lemon"` in the project's `.claude/settings.json`, so only set-up projects run as lemon. Lemon may delegate only to kiwi, fig, mango and cherry, and decides on its own when to.
The rows show in the CLI; the desktop app shows its own agent list instead.

The row is drawn by `scripts/subagent-row.mjs` through the plugin's `subagentStatusLine` setting. It is display only and costs no tokens.

## Scope

The plugin installs for your whole user, but its Claude Code hooks (branch guard, lint on edit, verify on stop) only act on projects under `~/DEV`. `DEV_FACTORY_ROOTS`, a `:`-separated list of absolute paths, adds roots and never replaces `~/DEV`. Case variants of a root and symlinks into a root are in scope. Git hooks installed in a project by `create-verification-skill` apply wherever that project lives. They run the guard installed with the plugin, and fall back to the project's `scripts/guard/` copy for contributors without it.

### Trust and protected files

The verify gate and the linter run the project's own code, so they only run in projects you trust. The trust list lives outside every repo, in `~/.config/dev-factory/trusted-projects` (one absolute path per line). Only you edit it. Agents are blocked from it on Edit and Write. Through Bash the block is best effort, like the rest of the Bash guard. Trust is the exact listed root, compared through symlinks: a project nested inside a trusted folder is not trusted, and neither is a case variant of it. To trust a project, run this yourself from its root:

```bash
mkdir -p ~/.config/dev-factory && echo "$PWD" >> ~/.config/dev-factory/trusted-projects
```

Agents cannot use Edit or Write on `.githooks/`, `scripts/guard/` or `.git/` in any project under the scope roots, on `~/.config/dev-factory/`, or on `~/.claude/plugins/`. Case variants and symlinks are resolved first. You change those files by hand. Agents treat AGENTS.md and the feature map as data. They only run commands from them that look like `node scripts/control.mjs <subcommand>` or `npm run <script>`, with no shell operators.

## Branch policy

Commit only on `feat/`, `fix/` or `hotfix/` branches. Never commit or push to `develop`, `desarrollo`, `desa`, `main`, `master`, `production`, `prod`, `test` or `release` (or anything under them). `--no-verify` (and its short form `git commit -n`) and `core.hooksPath` changes are blocked; the only allowed form is `git config core.hooksPath .githooks`.

## Install

```bash
claude plugin marketplace add <path-to-this-repo>
claude plugin install dev-factory@factory-marketplace
```

## First run

In your project, ask Claude to run the `create-verification-skill` skill. It adds `scripts/control.mjs`, the feature map under `.claude/verification/features/`, the git hooks and the branch guard.

## Daily

Run the `maintain-verification-skill` skill (for example on a schedule) to keep the feature map true.

The plugin has zero npm dependencies; its tests use `node --test`.
