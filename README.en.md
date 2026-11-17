<h1 align="center">🍋 skuizops</h1>

<h3 align="center">Five fruits work your code. Nothing rotten reaches <code>main</code>.</h3>

<p align="center">
  A team of agents for Claude Code:<br>
  🍋 <b>lemon</b> organizes · 🥝 <b>kiwi</b> searches · 🫐 <b>fig</b> reads the logs · 🥭 <b>mango</b> builds · 🍒 <b>cherry</b> verifies<br>
  Each task goes to the cheapest model that can do it, and no shortcut gets through: no commits on <code>main</code>, no red tests.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-d97757" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="0 dependencies">
  <img src="https://img.shields.io/badge/per%20check-~50%20ms-blue" alt="About 50 ms per check">
</p>

<p align="center">
  <a href="README.md">Español</a> · <b>English</b>
</p>

---

## The team

Each fruit does one job. The expensive model is used only where it is needed.

| Agent | Model | What it does | When it is used |
|---|---|---|---|
| 🍋 `lemon` | The session's model | Organizes and delegates | Always: it is the main session |
| 🥝 `kiwi` | Haiku (cheap) | Searches the code, never edits | Before touching unfamiliar code |
| 🫐 `fig` | Haiku (cheap) | Reads long test and build output | When something fails |
| 🥭 `mango` | Sonnet (mid) | Implements a well-defined task | When what to build is already clear |
| 🍒 `cherry` | Sonnet (Opus when risky) | Checks that the change works, with evidence | After an important change |

## Nothing rotten reaches `main`

| Without the plugin | With `skuizops` |
|---|---|
| The agent commits straight to `main` | Blocked. It must create a `feat/`, `fix/` or `hotfix/` branch |
| The agent disables the git hooks to get around a rule | Blocked. It cannot touch those files |
| The agent signs the commit as a co-author | Blocked. Commits belong to the person only |
| The agent says "done" while the tests are red | It cannot finish until they pass |

It has no dependencies (Node only) and each check takes about 50 ms: you do not notice it.

## Install

One command, inside your project:

```bash
npx github:enderdev01/skuizops
```

That is all. The command:

- installs or updates the marketplace and the plugin;
- turns on auto-update: new versions install on their own when Claude Code starts (an explicit `false` is kept);
- installs the git hooks (if you edited one, it keeps a `.local-<date>` copy before replacing it);
- marks the project as trusted and sets `lemon` as the default agent (without overwriting your settings);
- relaunches Claude Code with a welcome.

To update, run the same command again.

## Uninstall

Inside your project:

```bash
npx github:enderdev01/skuizops uninstall
```

It prints what it will remove and asks one `Uninstall skuizops? [y/N]`. Without an interactive terminal or without a yes, it changes nothing. It removes:

- the git hooks and guards it installed (a file you edited is kept) and `core.hooksPath` when it points to `.githooks` and nothing is left there;
- the project from the trust list (other trusted projects are listed: run the uninstall in each one);
- `agent` (if it is `skuizops:lemon`) and `outputStyle` (if it is `brief`) from `.claude/settings.json`, and an unedited `.claude/output-styles/brief.md`;
- the marketplace entry in `~/.claude/settings.json`, the plugin and the marketplace.

It leaves alone the third-party skills (ponytail, engram, unslop, stageshow), Playwright, and your `.claude/verification` and `scripts/control.mjs`. Restart open Claude sessions afterwards.

<details>
<summary>Manual install</summary>

```bash
claude plugin marketplace add enderdev01/skuizops
claude plugin install skuizops@juicebar
```

Then, in each project under `~/DEV`:

| Step | What to do | Why |
|---|---|---|
| 1 | Ask Claude to run the `create-verification-skill` skill | It creates the verification script, the git hooks and the feature map |
| 2 | Type `/skuizops:trust` in the session | It lets the plugin run that project's tests |
| 3 | Open a new session and work as usual | The protections act on their own |

</details>

## Try it

With the plugin installed, ask Claude:

> Run the `create-verification-skill` skill.

It is the only step left after installing: it creates the project's verification script and feature map. From then on, the agent cannot finish while the tests are red.

> Make a quick commit of this on `main`.

It is blocked, gets the reason and creates a `feat/` branch on its own.

> Add this change and verify that it works.

🍋 `lemon` delegates: 🥝 `kiwi` searches, 🥭 `mango` implements and 🍒 `cherry` checks with evidence.

## The five protections

| Protection | What it checks | Example of what it stops |
|---|---|---|
| `branch-guard` | Which branch a commit or push goes to | `git commit` while on `main` |
| `path-guard` | Which files are changed | Deleting the `.githooks` folder |
| `attribution-guard` | The commit message and author | A `Co-Authored-By` line from an AI |
| `check-file` | The file just edited, with ESLint | A lint error the agent left behind |
| `verify-gate` | The project's tests, on finish | Calling a task done with broken tests |

Full detail on rules, scope and the trust model: [plugins/skuizops/README.md](plugins/skuizops/README.md).

## More detail

<details>
<summary><b>How it works</b></summary>

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

</details>

<details>
<summary><b>Demo</b>: what it blocks and what it lets through</summary>

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

The full raw output of the command is in the [Spanish README](README.md), under "Demostración". The command exits with an error if any protection gives the wrong verdict.

</details>

<details>
<summary><b>Performance</b>: how much it slows the agent down</summary>

About 50 thousandths of a second per action. A blink takes twice as long.

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

</details>

## Contributing

Read [AGENTS.md](AGENTS.md) and run:

```bash
node scripts/control.mjs doctor
```

```bash
node scripts/control.mjs verify
```

Commits go only on `feat/`, `fix/` or `hotfix/` branches. Changes reach protected branches through a pull request.
