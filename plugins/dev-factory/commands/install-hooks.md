---
description: Install the dev-factory git hooks and branch guard in this project (or the directory you pass). Only you can run this.
argument-hint: [directory]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/install-hooks.mjs" "$ARGUMENTS"`

Tell the user, in one line, what the output above says. Do not run any command and do not edit .githooks, scripts/guard or git config yourself.
