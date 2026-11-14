# Attribution guard

Script: `plugins/skuizops/scripts/attribution-guard.mjs <message-file>`, run by the `commit-msg` git hook. It blocks with exit 1.

Exercise: `node scripts/control.mjs bench`.

| Commit message | Expected |
|---|---|
| `feat: add login` + `Co-Authored-By: Claude <noreply@anthropic.com>` | BLOCK: `Commit policy: AI attribution is forbidden in commits, remove this line: "Co-Authored-By: Claude <noreply@anthropic.com>"` |
| `feat: add login` | allow, exit 0 |

## Edge cases

- AI bot identities and "Generated with" footers are rejected too (see `attribution-guard.test.mjs`).
- Empty message: git aborts the commit before the hook matters.
