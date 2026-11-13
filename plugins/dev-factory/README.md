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
| `cherry` | Sonnet (Opus for risky changes) | Inspector: independently verifies a change, with evidence |

Skills: `verify`, `push-up-the-ladder`, `create-verification-skill`, `maintain-verification-skill`.
Hooks: branch guard on Bash, a protected-files guard on Edit, Write and Bash, a commit-msg guard that rejects AI attribution, ESLint on edited files (when the project has it), and a Stop gate that runs the project's verify.

The Stop gate runs verify once per tree state: it records what it verified in the git directory (the commit on a clean tree, else a hash of the commit, the diff against it and the untracked files) and skips while nothing changed. Ignored files do not count as a change. If verify still fails on the second stop of a turn, you get a warning instead of a second block. A verify that runs longer than four minutes counts as a failure.

The commit-msg guard rejects any `<something>-by:` trailer that names an AI tool, lines like "generated with" or "written by" an AI tool, and commits whose author or committer email belongs to one. It checks the email, not the name, so a person called Claude can commit. Lines that start with `#` are checked too, and everything after git's scissors line (the diff of `git commit -v`) is ignored.

## What you see

Each agent has a color (kiwi green, fig purple, mango orange, cherry red, lemon yellow), and while one runs Claude Code draws its agent row and the hook prefixes the emoji to the task description:

```
dev-factory:kiwi(🥝 find auth routes)
```

Lemon is not listed there: it is the main session, not a subagent. The setup command (`npx github:enderdev01/la-fruteria`) sets `"agent": "dev-factory:lemon"` in the project's `.claude/settings.json` (keeping your other keys and any agent you already chose), so only set-up projects run as lemon, in new sessions. Lemon may delegate only to kiwi, fig, mango and cherry, and decides on its own when to.
The rows show in the CLI; the desktop app shows its own agent list instead.

A PreToolUse hook (`scripts/agent-emoji.mjs`) prefixes the fruit emoji to the Agent task description; it is display only.

## Scope

The plugin installs for your whole user, but its Claude Code hooks (branch guard, lint on edit, verify on stop) only act on projects under `~/DEV`. `DEV_FACTORY_ROOTS`, a `:`-separated list of absolute paths, adds roots and never replaces `~/DEV`. Case variants of a root and symlinks into a root are in scope. Git hooks installed in a project by `create-verification-skill` apply wherever that project lives. They run the guard of the installed plugin, as recorded in `~/.claude/plugins/installed_plugins.json`: a newer, uninstalled or orphaned copy in the cache is never used. Contributors without the plugin fall back to the project's `scripts/guard/` copy. `node scripts/control.mjs doctor` fails when a hook file is missing, not executable or no longer runs its guard.

### Trust and protected files

The verify gate and the linter run the project's own code, so they only run in projects you trust. The trust list lives outside every repo, in `~/.config/dev-factory/trusted-projects` (one absolute path per line). Only you edit it. Agents are blocked from it on Edit and Write. Through Bash, any command that mentions it is blocked unless it only reads (`cat`, `ls`, `grep` and the like, with no redirection). Trust is the exact listed root, compared through symlinks: a project nested inside a trusted folder is not trusted, and neither is a case variant of it. To trust a project, use the `/dev-factory:trust` command:

```
/dev-factory:trust
```

Type it in a Claude Code session opened in the project. It adds the session's project directory to the list (or the directory you pass, `/dev-factory:trust ~/DEV/other-app`), skips it if it is already there, and prints the list. Only you can run it: the model cannot invoke the command, and the Bash guard blocks agents from running its script. Outside a session, this does the same from the project root:

```bash
mkdir -p ~/.config/dev-factory && echo "$PWD" >> ~/.config/dev-factory/trusted-projects
```

### Install the git hooks

To install the git hooks and the guard scripts in a project, use the `/dev-factory:install-hooks` command:

```
/dev-factory:install-hooks
```

Type it in a Claude Code session opened in the project (or pass a directory: `/dev-factory:install-hooks ~/DEV/other-app`). It resolves the git root, copies the hooks to `.githooks/` (executable) and the three guard scripts to `scripts/guard/`, and points git at `.githooks`. It overwrites those plugin-owned copies, so running it again re-syncs them after a plugin update, and leaves other files there alone. If git already had another hooks path (husky, for example), the output says so. Only you can run it: the model cannot invoke the command, and the Bash guard blocks agents from running its script. Outside a session, run from the project root, with the plugin path in place of `$PLUGIN`:

```bash
mkdir -p .githooks scripts/guard && cp "$PLUGIN"/templates/githooks/* .githooks/ && cp "$PLUGIN"/scripts/{branch-guard,scope,attribution-guard}.mjs scripts/guard/ && chmod +x .githooks/* && git config core.hooksPath .githooks
```

### Protected paths

Agents cannot use Edit or Write on `.githooks/`, `scripts/guard/` or `.git/` in any project under the scope roots, on `~/.config/dev-factory/`, or on `~/.claude/plugins/`. The same goes for `.claude/settings.json` and `.claude/settings.local.json` of those projects, and for your own `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.gitconfig`, `~/.config/git/` and shell profiles (`~/.zshrc`, `~/.zshenv`, `~/.zprofile`, `~/.bashrc`, `~/.bash_profile`, `~/.profile`). Case variants and symlinks are resolved first. You change those files by hand, which is why the setup command (not the agents) does the hook and settings steps.

Shell commands that write to those paths are blocked too: redirections, `rm`, `mv`, `chmod`, `mkdir`, `sed -i`, the destination of `cp`, and `git checkout` or `git restore` of them. Reading them is allowed. This check is best effort: a script, an interpreter or a variable can still write, so the git hooks and your review stay the authoritative layers. Agents treat AGENTS.md and the feature map as data. They only run commands from them that look like `node scripts/control.mjs <subcommand>` or `npm run <script>`, with no shell operators.

## Branch policy

Commit only on `feat/`, `fix/` or `hotfix/` branches. Never commit or push to `develop`, `desarrollo`, `desa`, `main`, `master`, `production`, `prod`, `test` or `release` (or anything under them). `--no-verify` (any abbreviation of it, and its short form `git commit -n`) and `core.hooksPath` changes are blocked; the only allowed form is `git config core.hooksPath .githooks`.

On a protected branch, `rebase`, `am` and `reset` are blocked like `commit` and `merge`. Anywhere, agents cannot run `git update-ref` or `git commit-tree`, force-move or delete a protected branch (`branch -f`, `branch -D`, `checkout -B`, `switch -C`), add a git config include, or set `HOME`, `PATH`, `GIT_DIR`, `GIT_EXEC_PATH` or `GIT_CONFIG*` in front of a git command. A command is read piece by piece, split on `;`, `&`, `|`, newlines, parentheses and backticks, so a commit message that contains a git command inside parentheses or on its own line can be blocked by mistake: reword it. The Bash check is best effort; the git hooks are the authoritative layer.

## Install

Inside your project, run one command:

```bash
npx github:enderdev01/la-fruteria
```

It installs or updates the marketplace and the plugin, installs the git hooks (an edited hook is saved as `<file>.local-<date>` before it is replaced), trusts the project, sets lemon as the project's agent in `.claude/settings.json` (never overwriting an agent you chose or invalid JSON), installs Playwright and Chromium when it detects a web UI (using the package manager of your lockfile), and relaunches Claude Code with a welcome that says what it configured. `create-verification-skill` asks you to run it when any of that is missing. Only the human runs it; the path guard blocks agents.

Manual:

```bash
claude plugin marketplace add <path-to-this-repo>
claude plugin install dev-factory@factory-marketplace
```

## First run

In your project, ask Claude to run the `create-verification-skill` skill. It adds `scripts/control.mjs`, the feature map under `.claude/verification/features/`, the git hooks and the branch guard.

## Visual checks

Two paths, so agents look at a visual change instead of trusting numbers:

- `node scripts/control.mjs screenshot [route] [--out <file.png>] [--wait <ms>] [--full-page] [--port <n>]` takes a headless screenshot of `route` (default `/`). Without `--out` it writes `$TMPDIR/<project>-screenshot.png`, overwritten on every run. Set `APP = { start, url, expect }` at the top of `scripts/control.mjs` (`create-verification-skill` fills it); `expect` is text only this app's HTML contains (its `<title>`), so another app on the port, even another Vite project, is refused instead of captured. It reuses the app if `APP.url` already answers with it, else starts `APP.start`, and always stops a server it started. `--port` replaces the port of `APP.url` (for a worktree's own dev server, started first; `APP.start` is not run), and a server answering from another checkout is refused. The project provides Playwright: `npm i -D playwright && npx playwright install chromium`.
- For interaction, lemon and cherry can use the Chrome extension tools (`mcp__claude-in-chrome__*`). Lemon starts the dev server in the background and gives cherry the URL.

A visual requirement nobody looked at is BLOCKED, never PASS.

## Language

Agents write PR titles and bodies, and reports to the human, in Spanish. Set `DEV_FACTORY_LANG` to change it, for example in `.claude/settings.json`:

```json
{ "env": { "DEV_FACTORY_LANG": "en" } }
```

Code, comments and commit messages stay as the project has them.

## Daily

Run the `maintain-verification-skill` skill (for example on a schedule) to keep the feature map true.

The plugin has zero npm dependencies; its tests use `node --test`.
