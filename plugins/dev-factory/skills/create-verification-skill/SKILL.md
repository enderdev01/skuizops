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

4. **Have the human install the git hooks and the branch guard.** You cannot do it: `.githooks/` and `scripts/guard/` are protected from agents. Give the human these commands to run from the project root, with `${CLAUDE_PLUGIN_ROOT}` replaced by its real path, and wait until they say it is done:
   - Copy the git hooks: `mkdir -p .githooks && cp "${CLAUDE_PLUGIN_ROOT}"/templates/githooks/* .githooks/`.
   - Copy the guard: `mkdir -p scripts/guard && cp "${CLAUDE_PLUGIN_ROOT}/scripts/branch-guard.mjs" "${CLAUDE_PLUGIN_ROOT}/scripts/scope.mjs" "${CLAUDE_PLUGIN_ROOT}/scripts/attribution-guard.mjs" scripts/guard/` (both guards import `scope.mjs`; copy all three).
   - `chmod +x .githooks/*`
   - Run exactly: `git config core.hooksPath .githooks`

5. **Have the human make lemon the orchestrator of this project.** `.claude/settings.json` is protected from agents too. Ask the human to set `"agent": "dev-factory:lemon"` in it, keeping every existing key and creating the file only if it is missing. New sessions in this project then run as lemon, which delegates to kiwi, fig, mango and cherry on its own.

   **Make sure git tracks it.** The feature map is the project's memory, so it must be committed. Run `git check-ignore -v .claude/settings.json .claude/verification/features/README.md`. If either is ignored (often `.claude/` is ignored as a whole), add these lines to `.gitignore`, after the ignoring rule:
   ```
   !.claude/settings.json
   !.claude/verification/
   ```
   Keep `.claude/settings.local.json` ignored. If the ignoring rule is `.claude/` with a trailing slash, git cannot re-include files under it: change it to `.claude/*` first. Re-run `git check-ignore` until neither path is ignored.

6. **Make it green, without touching the app.**
   - Ask the human to trust the project, so the Stop gate and the linter run here. You cannot do it: the list is blocked for agents. Ask them to type `/dev-factory:trust` in this session (only the human can run it), and wait until they say it is done.
   - Run `node scripts/control.mjs doctor`, then `node scripts/control.mjs verify`.
   - Fix failures caused by this setup: the files you created, `package.json` scripts you added, hooks and config.
   - Fix environment problems `doctor` reports (for example a Node version that does not match the project's pin) by changing the environment, not the code: run `nvm use`, or tell the human.
   - Do **not** change application source, tests or their config to make a failure that existed before the setup go away. To check whether a failure is pre-existing, run the same command in a clean checkout of `HEAD`: `d=$(mktemp -d) && git worktree add --detach "$d" HEAD`, install dependencies there, run it, then `git worktree remove --force "$d"`. If it fails there too, it is pre-existing. List each one in the report (command, test or rule, first error line) and leave it for the human.
   - Repeat until `doctor` passes and `verify` fails only on the listed pre-existing failures.

7. **Document it.** Add the `doctor` and `verify` commands and the branch policy to the project's AGENTS.md, and point to the feature map.

Report: files created or changed (including `.gitignore`), the observed output of `doctor` and `verify`, the number of features catalogued, and the pre-existing failures you left untouched.
