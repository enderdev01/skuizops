# Path guard

Script: `plugins/skuizops/scripts/path-guard.mjs` (PreToolUse Edit|Write|NotebookEdit, reads `tool_input.file_path` or `notebook_path`) and `path-guard.mjs bash` (PreToolUse Bash, reads `tool_input.command`). It blocks with exit 2.

Exercise: `node scripts/control.mjs bench`.

| Input | Expected |
|---|---|
| Bash `rm -rf .githooks` | BLOCK: `skuizops: <repo>/.githooks enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.` |
| Bash `echo done > notes.txt` | allow |
| Edit `.githooks/pre-commit` | BLOCK: `skuizops: .githooks/pre-commit enforces the branch and commit policy. Agents cannot change it: ask the human to edit it.` |
| Edit `src/app.js` | allow |

## mango edits with Edit or Write

Under the scope roots, for `agent_type` `skuizops:mango`, Bash may write files only under the temp dir (or `/dev`): redirects, `tee`, `sed -i`, `perl -i`, and inline `python`/`node`/`perl`/`ruby`/`bun`/`deno` code that calls a file-write API are blocked. `rm`, `mv`, `cp`, `mkdir`, `touch`, git and test/build commands stay allowed. Other agents are unaffected.

Exercise (from a repo under `~/DEV`, `CLAUDE_PROJECT_DIR` unset):
`echo '{"agent_type":"skuizops:mango","cwd":"'$PWD'","tool_input":{"command":"echo x > README.md"}}' | node plugins/skuizops/scripts/path-guard.mjs bash; echo "exit=$?"`

| Input | Expected |
|---|---|
| mango, Bash `echo x > README.md` | BLOCK, exit 2: `skuizops: mango edits files with Edit or Write, not through Bash (redirects, heredocs, tee, sed -i, perl -i, inline python/node writes): a scripted replace that misses its text fails silently. Bash may write only under the temp dir.` |
| lemon, same command | allow, exit 0 |

`node scripts/control.mjs bench` does not cover it: its throwaway repo lives under the temp dir, where mango may write.

## Edge cases

- Always protected: the trust list, installed plugins, `~/.claude/settings*.json`, `.gitconfig`, shell profiles.
- Protected only inside the scope roots: `.githooks/`, `.git/`, `scripts/guard/`, `.claude/settings*.json`.
- No `file_path` in the input: allowed.
