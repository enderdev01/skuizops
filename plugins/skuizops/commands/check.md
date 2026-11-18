---
description: Check the skuizops configuration of this project (plugin, default agent, git hooks, guards, trust, old-name leftovers) and how to fix each failure. Changes nothing.
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs" report`

Summarize the output above in a few lines: what is fine and, for each FAIL, the fix it suggests. If `project root` fails, lead with it: opening the session from the repo root usually fixes the other rows. This command only reads: do not change any file, setting or hook, and do not run any fix yourself; the human runs the fixes.
