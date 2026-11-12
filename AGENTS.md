# AGENTS.md

Keep this file short. A rule belongs here only if no type, lint, test or architecture change can enforce it.

## Commands

- `node scripts/control.mjs doctor` — run first; every check must be `ok`.
- `node scripts/control.mjs verify` — plugin tests, marketplace and plugin validation, syntax check. Must be green before you finish.

## Branch policy (enforced by hooks, applies to every agent)

- Never commit or push directly to `develop`, `desarrollo`, `desa`, `main`, `master`, `production`, `prod`, `test` or `release` (or anything under them).
- Commit only on `feat/<name>`, `fix/<name>` or `hotfix/<name>`. Changes reach protected branches only through a pull request.
- Never use `--no-verify`; the only allowed `core.hooksPath` change is `git config core.hooksPath .githooks`.

## Agents

| Agent | Model | Use it to |
|---|---|---|
| `kiwi` | Haiku | Search the codebase before editing |
| `fig` | Haiku | Read long test, build and lint output |
| `mango` | Sonnet | Implement a well-specified unit |
| `lemon` | Session model | Orchestrate: main session, delegates to the others on its own |
| `cherry` | Opus | Verify a finished change with evidence |

## Rules

- The plugin `plugins/dev-factory` has zero dependencies: Node built-ins only (tests use `node:test`).
- When a reviewer corrects you, follow the `push-up-the-ladder` skill instead of only fixing the line.
