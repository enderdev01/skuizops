---
description: Make this GitHub repo public so that only collaborators can push or open pull requests. Without the owner/repo it only shows the plan. Only you can run this.
argument-hint: [owner/repo to confirm]
allowed-tools: Bash(node:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/publish.mjs" "$ARGUMENTS"`

Tell the user, in one line, what the output above says. Do not run any command and do not call gh or edit the repository settings yourself.
