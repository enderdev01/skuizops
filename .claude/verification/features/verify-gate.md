# Verify gate

Script: `plugins/dev-factory/scripts/verify-gate.mjs` (Stop hook). It runs `node scripts/control.mjs verify` (or `npm run verify`) with a 240 s limit and blocks the stop with exit 2 on failure.

Exercise: `node scripts/control.mjs verify` runs `verify-gate.test.mjs`; all 10 cases pass.

| Situation | Expected |
|---|---|
| Untrusted project | Does not run project code; `systemMessage` tells the human to run `/dev-factory:trust`; exit 0 |
| Trusted project, verify fails | Blocks (exit 2) with the tail of the output |
| Verify times out | Blocks and reports the timeout |
| `stop_hook_active` set and verify fails | Still verifies, warns with a `systemMessage`, exit 0 (no loop) |
| Clean pass on a clean tree | Records HEAD; the next stop on the same HEAD skips verify |
| Dirty tree | Verifies once and records a hash of HEAD, the diff and the untracked files; the next stop skips until a tracked or untracked file changes |

## Edge cases

- Not a git repo: still runs verify and blocks on failure.
- New commit after a recorded pass: verifies again.
