# Lint on edit

Script: `plugins/dev-factory/scripts/check-file.mjs` (PostToolUse Edit|Write). It reads `tool_input.file_path` and runs `npx --no-install eslint --no-warn-ignored <file>`. On failure it exits 2 with `ESLint failed on <file>. Fix it before continuing:` plus the ESLint output.

Exercise: `node scripts/control.mjs verify` only syntax-checks it: there is no `check-file.test.mjs`. Observed by piping input in this repo:

| Input `file_path` | Expected |
|---|---|
| `README.md` | exit 0 (not `.ts/.tsx/.js/.jsx/.mjs`) |
| `scripts/control.mjs` in this repo (no local ESLint) | exit 0 |

## Edge cases

- No `file_path`: exit 0.
- Project outside the scope roots or untrusted: exit 0, ESLint never loads the project config.
- No `node_modules/.bin/eslint`: exit 0.
