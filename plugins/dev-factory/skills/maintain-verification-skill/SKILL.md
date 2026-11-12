---
name: maintain-verification-skill
description: Daily refresh of the project's feature map and control CLI: re-run every documented command, find missing and removed features, fix stale commands. Use daily or when the feature map may be out of date.
---

# Maintain the verification skill

Run this once a day (or on a schedule). It keeps `.claude/verification/features/` true.
Never invent an expected output: observe it by running the command.

## Steps

1. Run `node scripts/control.mjs doctor`. If it fails, report it and stop.
2. For every row in `.claude/verification/features/README.md`: run its command and compare the output with the expected table in the feature's file.
   - Output differs because the feature changed: update the expected table with the observed output.
   - Command no longer runs: fix the command in the README (and `scripts/control.mjs` if the subcommand is stale), or remove the row if the feature is gone.
3. Ask kiwi to find user-facing features in the code that are missing from the map. For each: add a subcommand to `scripts/control.mjs` if needed, a row in the README, and a feature file filled with observed input and output.
4. Remove features, rows and files for features that no longer exist in the code.
5. Run `node scripts/control.mjs verify` and make sure it is green.
6. Report what changed: added, updated, removed, and anything you could not verify.
