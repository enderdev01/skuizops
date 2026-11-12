---
name: create-verification-skill
description: Set up verification for a project: a control CLI, a feature map, git hooks and the branch guard. Use on first install of dev-factory in a project, or when a project has no scripts/control.mjs.
---

# Create the verification skill for this project

Goal: give agents a lever (`scripts/control.mjs`) and a memory (`.claude/verification/features/`) so they can check their own work.
Plugin files live under `${CLAUDE_PLUGIN_ROOT}`. Work on a `feat/`, `fix/` or `hotfix/` branch.

## Steps

1. **Explore the app with kiwi.** Ask kiwi to list every user-facing feature (commands, endpoints, screens, exported APIs), the entry point of each, and an example input. Do not guess: read the code.

2. **Create the control CLI.**
   - Copy the template, quoting the path because it may contain spaces: `cp "${CLAUDE_PLUGIN_ROOT}/templates/control.mjs" scripts/control.mjs`.
   - Add one subcommand per user-facing feature, following the template's placeholder. CLI design rules:
     - `--json` on every command;
     - `--dry-run` on every destructive command;
     - subcommands, not flags, to pick the action;
     - errors say what to do instead, not only what went wrong;
     - rich `--help` that lists every subcommand with an example;
     - exit 0 on success, 1 on failure.

3. **Write the feature map** in `.claude/verification/features/`.
   - `README.md`: a table with columns `Feature | What it does | How to exercise it | Details`, one row per feature, the "How to exercise it" cell being a runnable `node scripts/control.mjs ...` command.
   - One file per feature (linked from the Details column) with a table of expected input and output, plus the edge cases (empty, very large, invalid input).
   - Fill the tables by running each command and recording what you observe. Never invent expected output.

4. **Install the git hooks and the branch guard.**
   - Copy the git hooks: `mkdir -p .githooks && cp "${CLAUDE_PLUGIN_ROOT}"/templates/githooks/* .githooks/`.
   - Copy the guard: `mkdir -p scripts/guard && cp "${CLAUDE_PLUGIN_ROOT}/scripts/branch-guard.mjs" "${CLAUDE_PLUGIN_ROOT}/scripts/scope.mjs" "${CLAUDE_PLUGIN_ROOT}/scripts/attribution-guard.mjs" scripts/guard/` (both guards import `scope.mjs`; copy all three).
   - `chmod +x .githooks/*`
   - Run exactly: `git config core.hooksPath .githooks`

5. **Make lemon the orchestrator of this project.** In `.claude/settings.json`, set `"agent": "dev-factory:lemon"`. Read the file first and merge: keep every existing key, create the file only if it is missing. New sessions in this project then run as lemon, which delegates to kiwi, fig, mango and cherry on its own.

6. **Make it green.** Run `node scripts/control.mjs doctor`, then `node scripts/control.mjs verify`. Fix every failure and repeat until both exit 0.

7. **Document it.** Add the `doctor` and `verify` commands and the branch policy to the project's AGENTS.md, and point to the feature map.

Report: files created, the observed output of `doctor` and `verify`, and the number of features catalogued.
