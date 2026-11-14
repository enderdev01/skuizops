# Background guard

Script: `plugins/skuizops/scripts/background-guard.mjs` (PreToolUse Bash, JSON on stdin). It blocks with exit 2 when `agent_id` is set and `tool_input.run_in_background` is `true`.

Exercise: `node scripts/control.mjs bench`.

| Input | Expected |
|---|---|
| `{agent_id: "kiwi", tool_input: {command: "npm run dev", run_in_background: true}}` | BLOCK: `Background policy: subagents run commands in the foreground. Run it again without run_in_background (raise timeout up to 600000 ms if it is long); start and stop any server it needs inside the same command.` |
| Same command, no `agent_id` (main session) | allow |

## Edge cases

- Subagent with `run_in_background` false or missing: allow (`background-guard.test.mjs`).
- Project outside the scope roots: allow.
