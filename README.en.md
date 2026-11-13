# la-fruteria

[Español](README.md) · **English**

A Claude Code marketplace with a single plugin: `dev-factory`.

**What it does, in one sentence:** it stops an AI agent from breaking the team's rules, even when it tries.

| Without the plugin | With `dev-factory` |
|---|---|
| The agent commits straight to `main` | Blocked. It must create a `feat/`, `fix/` or `hotfix/` branch |
| The agent disables the git hooks to get around a rule | Blocked. It cannot touch those files |
| The agent signs the commit as a co-author | Blocked. Commits belong to the person only |
| The agent says "done" while the tests are red | It cannot finish until they pass |

It has no dependencies (Node only) and each check takes about 50 ms: you do not notice it.

## Install

```bash
claude plugin marketplace add enderdev01/la-fruteria
```

```bash
claude plugin install dev-factory@factory-marketplace
```

Then, in each project under `~/DEV`:

| Step | What to do | Why |
|---|---|---|
| 1 | Ask Claude to run the `create-verification-skill` skill | It creates the verification script, the git hooks and the feature map |
| 2 | Type `/dev-factory:trust` in the session | It lets the plugin run that project's tests |
| 3 | Open a new session and work as usual | The protections act on their own |

## How it works

Every time the agent wants to do something, the plugin checks it **before** it happens.

```text
       The agent wants to run a command or edit a file
                               |
                               v
                     Does it break a rule?
                        |             |
                       YES            NO
                        |             |
                        v             v
                     BLOCKED        IT RUNS
               gets the reason,       |
              fixes and retries       v
                           Does the agent want to finish?
                              |                   |
                          tests red          tests green
                              |                   |
                              v                   v
                        CANNOT FINISH        SESSION ENDS
                        gets the error
                         and fixes it
```

There are two barriers, one behind the other:

| Barrier | When it acts | Who it applies to |
|---|---|---|
| **Claude Code hooks** | Before each command or edit by the agent | Agents only |
| **Git hooks** | On every `commit` and `push` | Everyone: agents and people, even without the plugin installed |

The first one is fast, but a clever agent can get around it (with a script, for example). The second one has the final word: whatever slips past the first, git stops.

### The five protections

| Protection | What it checks | Example of what it stops |
|---|---|---|
| `branch-guard` | Which branch a commit or push goes to | `git commit` while on `main` |
| `path-guard` | Which files are changed | Deleting the `.githooks` folder |
| `attribution-guard` | The commit message and author | A `Co-Authored-By` line from an AI |
| `check-file` | The file just edited, with ESLint | A lint error the agent left behind |
| `verify-gate` | The project's tests, on finish | Calling a task done with broken tests |

### The agent team

The plugin also splits the work, so the expensive model is used only where it is needed.

| Agent | Model | What it does | When it is used |
|---|---|---|---|
| 🍋 `lemon` | The session's model | Organizes and delegates | Always: it is the main session |
| 🥝 `kiwi` | Haiku (cheap) | Searches the code, never edits | Before touching unfamiliar code |
| 🫐 `fig` | Haiku (cheap) | Reads long test and build output | When something fails |
| 🥭 `mango` | Sonnet (mid) | Implements a well-defined task | When what to build is already clear |
| 🍒 `cherry` | Sonnet (Opus when risky) | Checks that the change works, with evidence | After an important change |

Full detail on rules, scope and the trust model: [plugins/dev-factory/README.md](plugins/dev-factory/README.md).

## Demo

These results are real. You get them with:

```bash
node scripts/control.mjs bench
```

The command creates a temporary repository on the `main` branch and runs each protection the same way Claude Code does.

| The agent tries | Result | What the agent receives |
|---|---|---|
| `git commit -m "quick fix"` on `main` | 🛑 Blocked | `"main" is a protected branch. Work on a feat/, fix/ or hotfix/ branch` |
| `git push origin main` | 🛑 Blocked | `Pushing to protected branch "main" is forbidden. Open a PR` |
| `git commit --no-verify` | 🛑 Blocked | `--no-verify is forbidden: the git hooks enforce the branch policy` |
| `git config core.hooksPath /dev/null` | 🛑 Blocked | `Changing core.hooksPath is forbidden` |
| `rm -rf .githooks` | 🛑 Blocked | `.githooks enforces the branch and commit policy. Agents cannot change it` |
| Edit `.githooks/pre-commit` | 🛑 Blocked | `Agents cannot change it: ask the human to edit it` |
| Commit with `Co-Authored-By: Claude` | 🛑 Blocked | `AI attribution is forbidden in commits, remove this line` |
| `git status` | ✅ Allowed | (nothing) |
| `npm test` | ✅ Allowed | (nothing) |
| `echo done > notes.txt` | ✅ Allowed | (nothing) |
| Edit `src/app.js` | ✅ Allowed | (nothing) |
| Commit with message `feat: add login` | ✅ Allowed | (nothing) |

When it gets the reason, the agent corrects itself: it creates a `feat/` branch instead of trying again.

The full raw output of the command is in the [Spanish README](README.md#demostración). The command exits with an error if any protection gives the wrong verdict.

## Performance

**How much does it slow the agent down?** About 50 thousandths of a second per action. A blink takes twice as long.

Each `█` block is 5 ms:

| What is measured | Time | |
|---|---|---|
| Starting Node and doing nothing (baseline) | 34 ms | `███████` |
| `path-guard` on each command or edit | 38–43 ms | `████████` |
| `branch-guard` on each command | 52–56 ms | `███████████` |
| `attribution-guard` on each commit | 66 ms | `█████████████` |

How to read it:

- **Almost all of the time is Node starting up** (34 ms). The check itself adds 5 to 30 ms.
- **A command pays for two checks** (`branch-guard` and `path-guard`). An edit pays for one.
- **The tests on finish cost whatever your tests cost.** With a clean tree they run once per commit and are skipped after that.

Other numbers:

| Item | Value |
|---|---|
| Tokens spent by a check that allows the action | 0 |
| Plugin tests | 260, all green, in 6 seconds |
| Dependencies | 0 |

Measured on an Apple M1 Pro with Node 26.13.0, median of 20 runs. To repeat it: `node scripts/control.mjs bench` (add `--json` for the raw data).

> **What is not measured:** whether the agents write better code, or how many tokens delegating to Haiku and Sonnet saves. That depends on the model and the task, and this repository has no way to measure it yet.

## Contributing

Read [AGENTS.md](AGENTS.md) and run:

```bash
node scripts/control.mjs doctor
```

```bash
node scripts/control.mjs verify
```

Commits go only on `feat/`, `fix/` or `hotfix/` branches. Changes reach protected branches through a pull request.
