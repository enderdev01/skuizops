---
description: Trust this project (or the directory you pass) so the verify gate and the linter run in it. Only you can run this.
argument-hint: [directory]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/trust.mjs" "$ARGUMENTS"`

Tell the user, in one line, what the output above says. Do not run any command and do not edit the trust list yourself.
