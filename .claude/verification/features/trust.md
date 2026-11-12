# Trust command

Command: `/dev-factory:trust [dir]` runs `plugins/dev-factory/scripts/trust.mjs "$ARGUMENTS"`, which appends the real path to `~/.config/dev-factory/trusted-projects` and prints the list. Only the human can run it: the model cannot invoke it and the path guard blocks running `trust.mjs` from a shell.

Exercise: `node scripts/control.mjs verify` runs `trust.test.mjs`; all 13 cases pass. Do not run it against the real trust list.

| Input | Expected |
|---|---|
| `/dev-factory:trust` in this repo | `Trusted: /Users/.../factory-marketplace` plus the full list (observed in this session) |
| A project already in the list | Added only once |
| A symlinked directory | Stores the real path |
| A missing directory | Fails, exit 1, list unchanged |

## Edge cases

- Empty argument: treated as no argument (session project dir).
- Spaces and a leading `~` are accepted.
- A directory name with a newline is rejected.
- A list file without a final newline keeps its entries.
