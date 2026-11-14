# Install-hooks command

Command: `/skuizops:install-hooks [dir]` runs `plugins/skuizops/scripts/install-hooks.mjs "$ARGUMENTS"`, which copies `templates/githooks/*` to `.githooks/` (mode 755), copies `branch-guard.mjs`, `scope.mjs` and `attribution-guard.mjs` to `scripts/guard/`, and points git at `.githooks`. Only the human can run it: the model cannot invoke it and the path guard blocks running `install-hooks.mjs` from a shell.

Exercise: `node scripts/control.mjs verify` runs `install-hooks.test.mjs` and `path-guard.test.mjs` in throwaway git repos. Do not run the script against this repo by hand.

| Input | Expected |
|---|---|
| A git repo | One line per file, then `Hooks installed in: <root>`; hooks executable, guards identical to the plugin's |
| A second run | Succeeds; unchanged files are "up to date", files the plugin wrote are updated, a file you edited is copied to `<file>.local-<timestamp>` first (manifest `.githooks/.skuizops.json`); other files are left alone |
| A repo whose hooks path was `.husky` | Output says the previous path was replaced |
| A subdirectory of a repo | Installs in the git root |
| A directory outside git | Exit 1, `not inside a git repository` |
| An agent runs `install-hooks.mjs` through Bash | Blocked: ask the human to type `/skuizops:install-hooks` |

## Edge cases

- Empty argument: the session's current directory.
- A leading `~` in the argument is expanded.
- Reading the script (`cat`) is allowed; only non-read-only commands naming it are blocked.
