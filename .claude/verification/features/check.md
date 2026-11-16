# Check command

Command: `/skuizops:check` runs `plugins/skuizops/scripts/check.mjs`, which validates the skuizops configuration of the project and prints one row per check (`ok`, `FAIL <name>  ->  <fix>`, `info`). It only reads and exits 1 when any check is FAIL. Agents may invoke it. A SessionStart hook runs `check.mjs notice`: one line only when a check fails, nothing otherwise, never fails the session.

Exercise: `node plugins/skuizops/scripts/check.mjs` from the project root, or `node --test plugins/skuizops/scripts/check.test.mjs` (also run by `node scripts/control.mjs verify`).

Observed in a worktree of this repo that is not in the trust list (exit 1):

```
ok   plugin (v0.17.0)
ok   default agent (skuizops:lemon)
ok   git hooks
ok   project guards
FAIL trusted project  ->  /skuizops:trust
ok   old-name leftovers
info effective language: es (default)
info verification map: .claude/verification exists
```

| Input | Expected |
|---|---|
| Well-configured project | every row `ok` or `info`, exit 0 |
| `"agent": "dev-factory:lemon"` | default agent FAIL with the fix, and the leftovers row lists it |
| Edited hook or guard copy, or a manifest of another version | git hooks (or project guards) FAIL, fix `/skuizops:install-hooks` |
| `.githooks/.dev-factory.json` | leftovers row lists it |
| `"agent": "mine"` | `info`, not FAIL |
| Any run | no file is written |

## Edge cases

- No `scripts/control.mjs` or no git repository: runs, hooks are FAIL.
- Invalid `.claude/settings.json`: default agent is FAIL.
- `notice` mode outside the scope roots (`~/DEV`, `SKUIZOPS_ROOTS`): prints nothing.
