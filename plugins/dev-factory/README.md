# dev-factory

A Claude Code plugin that makes agents check their own work. It follows the pyramid, strongest guarantee first:
**codebase > static analysis > verification > prose > human review**.

## Agents

| Agent | Model | Role |
|---|---|---|
| `kiwi` | Haiku | Scout: read-only codebase search |
| `fig` | Haiku | Log reader: reports each test, build and lint failure |
| `mango` | Sonnet | Builder: implements one well-specified unit |
| `lemon` | Opus | Inspector: independently verifies a change, with evidence |

Skills: `verify`, `push-up-the-ladder`, `create-verification-skill`, `maintain-verification-skill`.
Hooks: branch guard on Bash, ESLint on edited files (when the project has it), and a Stop gate that runs the project's verify.

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
