# Path guard

Script: `plugins/dev-factory/scripts/path-guard.mjs` (PreToolUse Edit|Write|NotebookEdit, reads `tool_input.file_path` or `notebook_path`) and `path-guard.mjs bash` (PreToolUse Bash, reads `tool_input.command`). It blocks with exit 2.

Exercise: `node scripts/control.mjs bench`.

| Input | Expected |
|---|---|
| Bash `rm -rf .githooks` | BLOCK: `dev-factory: <repo>/.githooks enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.` |
| Bash `echo done > notes.txt` | allow |
| Edit `.githooks/pre-commit` | BLOCK: `dev-factory: .githooks/pre-commit enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.` |
| Edit `src/app.js` | allow |

## Edge cases

- Always protected: the trust list, installed plugins, `~/.claude/settings*.json`, `.gitconfig`, shell profiles.
- Protected only inside the scope roots: `.githooks/`, `.git/`, `scripts/guard/`, `.claude/settings*.json`.
- No `file_path` in the input: allowed.
