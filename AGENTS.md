# AGENTS.md

Keep this file short. A rule belongs here only if no type, lint, test or architecture change can enforce it.

## Commands

- `node scripts/control.mjs doctor` — run first; every check must be `ok`.
- `node scripts/control.mjs verify` — plugin tests, marketplace and plugin validation, syntax check. Must be green before you finish.
- `node scripts/control.mjs bench` — runs each guard and the Stop gate as their hooks do, in a throwaway repo on `main`.
- Feature map: `.claude/verification/features/README.md` — how to exercise each feature and its observed output.

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
| `cherry` | Sonnet | Verify a finished change with evidence |

## Rules

- The plugin `plugins/skuizops` has zero dependencies: Node built-ins only (tests use `node:test`).
- Commits and PRs are authored by the human only: no `Co-Authored-By` AI trailers or "Generated with" footers. The `commit-msg` hook rejects them.
- When a reviewer corrects you, follow the `push-up-the-ladder` skill instead of only fixing the line.
- Before non-trivial work, lemon restates the goal and writes `.skuizops/plan.md` with a falsifiable done-predicate and ordered units. A trivial change may skip the file, never the predicate. See `plugins/skuizops/agents/lemon.md`.
