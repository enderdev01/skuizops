---
name: show-your-work
description: Append-only decision log for a change. Use when lemon states a done-predicate, when verify or cherry finishes a round, or when the next cherry brief must not repeat a check that already passed.
---

# Show your work

One log per checkout, append-only, so the next round can see what already passed.

The file is `.skuizops/decisions.tsv`. It is a working note, not a commit: the script adds `.skuizops/` to `.gitignore` when that line is missing. An unignored log changes the verify-gate tree hash, and the verify skip never hits.

## Columns

Header, then one row per decision. Cells stay on one line. Evidence is a pointer (a path, a SHA, a patch-id, a command), not a paragraph.

```
ts	phase	decision	evidence	result
```

- **ts.** ISO 8601, written by the script.
- **phase.** `predicate`, `verify`, `cherry`, or the unit name.
- **decision.** What was decided or checked, one line.
- **evidence.** Where to look to confirm it.
- **result.** `open`, `pass`, `fail`, `blocked`, `skipped`, or `reverted`.

The first row of a change is the done-predicate (`phase` `predicate`, `result` `open`). Each verify run and each cherry round adds exactly one row. A wrong row stays; a later row supersedes it. Do not edit or delete rows.

## Write a row

Use the script next to this file. Do not append with a shell redirect.

```bash
node "<directory of this SKILL.md>/decisions.mjs" append --phase <phase> --decision "<one line>" --evidence "<pointer>" --result <result>
```

A verify row's evidence is the command (`node scripts/control.mjs verify` or `verify --changed` plus the paths). A cherry row's evidence includes `sha <sha> patch-id <id>` from `git diff $(git merge-base HEAD origin/<default>) | git patch-id --stable`.

## Read it before the next round

Lemon pastes the rows into the next cherry brief. Cherry does not re-run a finish check whose latest row is `pass`, unless the fix touched a file that check covers. A `skipped` verify row (`tree already verified`) counts as a pass of the full suite for that tree.
