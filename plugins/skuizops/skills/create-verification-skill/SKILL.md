---
name: create-verification-skill
description: Set up verification for a project: a control CLI, a feature map, git hooks and the branch guard. Use on first install of skuizops in a project, or when a project has no scripts/control.mjs.
---

# Create the verification skill for this project

Goal: give agents a lever (`scripts/control.mjs`) and a memory (`.claude/verification/features/`) so they can check their own work.
Plugin files live under `${CLAUDE_PLUGIN_ROOT}`. Work on a `feat/`, `fix/` or `hotfix/` branch.

## Steps

1. **Explore the app with kiwi.** Ask kiwi to list every user-facing feature (commands, endpoints, screens, exported APIs), the entry point of each, and an example input. Also ask whether the app renders a canvas/WebGL scene (imports of `three`, `@react-three/fiber`, `@babylonjs/core`, `pixi.js`, `phaser`, or a `<canvas>` with `getContext`), how a user reaches it (route, room, login) and moves the camera, and whether a route or debug query param loads it with no interaction. Do not guess: read the code.

2. **Create the control CLI.**
   - Copy the template, quoting the path because it may contain spaces: `cp "${CLAUDE_PLUGIN_ROOT}/templates/control.mjs" scripts/control.mjs`.
   - For projects with screens: find the dev server script and its URL by reading package.json and the framework config (do not guess), and fill `APP` at the top of `scripts/control.mjs`. Set `APP.expect` to text only this app's HTML contains, usually its exact `<title>...</title>`: `screenshot` refuses to capture a port whose page lacks it. Do not use generic dev-server text like `/@vite/client`: another Vite project on the same port has it too. For web projects, check that `playwright` is in package.json; if not, see the setup note below.
   - Add one subcommand per user-facing feature, following the template's placeholder. CLI design rules:
     - `--json` on every command;
     - `--dry-run` on every destructive command;
     - subcommands, not flags, to pick the action;
     - errors say what to do instead, not only what went wrong;
     - rich `--help` that lists every subcommand with an example;
     - exit 0 on success, 1 on failure.

3. **Write the feature map** in `.claude/verification/features/`.
   - `README.md`: a table with columns `Feature | What it does | How to exercise it | Triggers | Details`, one row per feature, the "How to exercise it" cell being a runnable `node scripts/control.mjs ...` command. The Triggers cell is comma-separated path globs whose change makes the feature worth checking (for example `src/auth/*, src/routes/login.*`); lemon matches them against `git diff --name-only` to pick finish checks. Read which files the feature lives in; do not guess. Screens get rows whose cell is `node scripts/control.mjs screenshot [route]` (the route defaults to `/`).
   - Each table row stays on one line. Append this line to the project's `.gitattributes` (create the file if missing, never duplicate the line): `.claude/verification/features/README.md merge=union`. Parallel branches each add a row, and union merges by line, so both rows survive instead of conflicting.
   - One file per feature (linked from the Details column) with a table of expected input and output, plus the edge cases (empty, very large, invalid input).
   - The screens file includes a row for `screenshot` with no arguments, with its observed output and exit code.
   - **Canvas/3D scenes** (found in step 1): one row per main scene, with its own details file (for example `world.md`). If a route or debug query param reaches the scene with no interaction, the cell is `node scripts/control.mjs screenshot <route> --wait <ms>` (the wait lets the first frames render), and the details file lists any camera presets that param supports. Otherwise, or if the headless capture comes out blank (no WebGL), the cell is `manual verification` and the details file gives the exact steps: how to reach the scene, the controls that move the camera, and which parts of the scene to look at. Do not add a debug route to the app unasked: propose it in the report.
   - Fill the tables by running each command and recording what you observe. Never invent expected output.

4. **Git hooks and the branch guard.** You cannot install them: `.githooks/` and `scripts/guard/` are protected from agents. Check that `git config core.hooksPath` prints `.githooks` and `.githooks/pre-commit` exists. If not, see the setup note below.
   - Fallback outside a session, from the project root, with `${CLAUDE_PLUGIN_ROOT}` replaced by its real path: `mkdir -p .githooks scripts/guard && cp "${CLAUDE_PLUGIN_ROOT}"/templates/githooks/* .githooks/ && cp "${CLAUDE_PLUGIN_ROOT}/scripts/branch-guard.mjs" "${CLAUDE_PLUGIN_ROOT}/scripts/scope.mjs" "${CLAUDE_PLUGIN_ROOT}/scripts/attribution-guard.mjs" scripts/guard/ && chmod +x .githooks/*`, then run exactly `git config core.hooksPath .githooks`.

5. **Lemon as orchestrator.** `.claude/settings.json` is protected from agents. Check that it has `"agent": "skuizops:lemon"`; if not, see the setup note below. New sessions in this project then run as lemon, which delegates to kiwi, fig, mango and cherry on its own.

   **Make sure git tracks it.** The feature map is the project's memory, so it must be committed. Run `git check-ignore -v .claude/settings.json .claude/verification/features/README.md`. If either is ignored (often `.claude/` is ignored as a whole), add these lines to `.gitignore`, after the ignoring rule:
   ```
   !.claude/settings.json
   !.claude/verification/
   ```
   Keep `.claude/settings.local.json` ignored. If the ignoring rule is `.claude/` with a trailing slash, git cannot re-include files under it: change it to `.claude/*` first. Re-run `git check-ignore` until neither path is ignored.

6. **Make it green, without touching the app.**
   - Trust lets the Stop gate and the linter run here; agents cannot edit the list. Treat `node scripts/control.mjs doctor` or a Stop-gate/lint "not trusted" message as the signal; if the project is not trusted, see the setup note below.
   - Run `node scripts/control.mjs doctor`, then `node scripts/control.mjs verify`.
   - Fix failures caused by this setup: the files you created, `package.json` scripts you added, hooks and config.
   - Fix environment problems `doctor` reports (for example a Node version that does not match the project's pin) by changing the environment, not the code: run `nvm use`, or tell the human.
   - Do **not** change application source, tests or their config to make a failure that existed before the setup go away. To check whether a failure is pre-existing, run the same command in a clean checkout of `HEAD`: `d=$(mktemp -d) && git worktree add --detach "$d" HEAD`, install dependencies there, run it, then `git worktree remove --force "$d"`. If it fails there too, it is pre-existing. List each one in the report (command, test or rule, first error line) and leave it for the human.
   - Repeat until `doctor` passes and `verify` fails only on the listed pre-existing failures.

**Setup note (steps 2, 4, 5, 6).** Playwright, the hooks, the lemon setting and trust are all done by one command. If any check above found something missing, ask the human ONCE to exit Claude and run `npx github:enderdev01/skuizops` in the project root (it does all of it and reopens this session), then wait. One-line fallback: `/skuizops:install-hooks` and `/skuizops:trust`.

7. **Document it.** Add the `doctor` and `verify` commands and the branch policy to the project's AGENTS.md, and point to the feature map.

Report: files created or changed (including `.gitignore`), the observed output of `doctor` and `verify`, the number of features catalogued, whether the `screenshot` command works, each canvas/3D scene and how it is covered (command or manual steps), and the pre-existing failures you left untouched.
