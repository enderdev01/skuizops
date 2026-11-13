# Subagent status row

Script: `plugins/dev-factory/scripts/subagent-row.mjs`, wired as `subagentStatusLine` in `plugins/dev-factory/settings.json`. It reads `{columns, tasks}` on stdin and prints one `{"id","content"}` JSON line per task. It never blocks.

Exercise: `node scripts/control.mjs verify` runs `subagent-row.test.mjs`; all 15 cases pass.

| Input task | Expected row |
|---|---|
| `kiwi`, completed, 1200 tokens | `🥝 kiwi · search · haiku · 1k tok ✓` |
| `fig` / `mango` / `lemon` / `cherry` | 🫐 / 🥭 / 🍋 / 🍒 |
| Agent type without the `dev-factory:` prefix | Same fruit as with the prefix |
| Agent outside the factory | Neutral marker |

## Edge cases

- No `tasks`: prints nothing, no crash.
- Narrow `columns`: the row never exceeds them and is never empty (empty hides the row).
- Small token counts are not rounded to `0k`.
