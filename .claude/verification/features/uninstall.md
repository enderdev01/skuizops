# Uninstall command

Command: `npx github:enderdev01/skuizops uninstall` (`bin/setup.mjs` dispatches to `bin/uninstall.mjs`) reverses the setup. It prints the plan, asks one `Uninstall skuizops? [y/N]` and acts only after an explicit yes on an interactive terminal; there is no `--yes` flag.

Exercise: `node --test bin/uninstall.test.mjs` (throwaway git repos and temp homes, fake `claude`). By hand, in a throwaway repo with `HOME` pointed at a temp dir: `node bin/setup.mjs uninstall </dev/null` prints the plan, `Nothing was changed.` and changes no file.

| Input | Expected |
|---|---|
| Hooks with a manifest, none edited | Files listed in `.githooks/.skuizops.json` deleted, manifest deleted, empty `.githooks` and `scripts/guard` removed, `core.hooksPath` unset |
| A hook file you edited | Kept and reported; `.githooks` stays, so `core.hooksPath` stays |
| No manifest | `no manifest, hooks left alone`; no hook file touched |
| Project in the trust list | Its line removed, other lines byte-identical; other trusted projects listed |
| `agent` is `skuizops:lemon` / `outputStyle` is `brief` | Removed; any other value kept. Settings left as `{}` stay as a file |
| `.claude/output-styles/brief.md` | Deleted only when identical to the plugin's copy |
| `~/.claude/settings.json` | `extraKnownMarketplaces.juicebar` removed (key dropped when empty) |
| Plugin or marketplace not listed by `claude` | Step skipped, no command run |
| Invalid JSON in either settings file | Step fails with `fix ... (invalid JSON) and re-run`, file untouched, exit 1 |
| No TTY or any answer but yes | `Nothing was changed.`, exit 0 |

## Edge cases

- Left alone on purpose: ponytail, engram, unslop, stageshow, Playwright, `.claude/verification`, `scripts/control.mjs`.
- Only paths the installer writes are deleted, even if the manifest lists others.
- Ends with `Restart open Claude sessions.`
