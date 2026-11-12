# guard-hardening

Objective: close the gaps a read-only security audit found in the dev-factory guards (plugin 0.4.0).
Branch: `fix/guard-hardening`. Delivery: ask-on-risk. Test runner: `node --test plugins/dev-factory/scripts/` (gate: `node scripts/control.mjs verify`).

## Specs

- S1 (U1, fail closed). Both PreToolUse hook commands in `plugins/dev-factory/hooks/hooks.json` block (exit 2) when the guard script throws or cannot be parsed, without relying on `onFailure`.
- S2 (U2, scope). `inScope` treats a case variant of a root and a symlink into a root as in scope. `DEV_FACTORY_ROOTS` adds roots to `~/DEV` and never replaces it (confirmed by the user: "DEV_FACTORY_ROOTS aditivo").
- S3 (U2, trust). `isTrusted` is true only when the project directory is exactly a listed root, compared through symlinks; nested directories are not trusted (confirmed by the user: "trust exacto"). A case variant is not trusted (assumption: under-trusting is the safe failure on case-sensitive volumes).
- S4 (U2, hint). A directory containing a newline is never trusted and `trustHint` does not emit a second line for it.
- S5 (U2, docs). README scope and trust sections and the command rule in agents and the `verify` skill describe S2 and S3.
- S6 (U3 to U8). Pending, see the plan in the session; specified when each unit starts.

## Tasks

- [x] T1 S1. Route: lemon inline. Commit: pending (human commits).
- [x] T2 S2, S3, S4, S5. Route: mango (user asked for the fruit team). Verifier: cherry (Risk items 2 and 3), PASS on S1 to S5. Commit: pending (human commits).
- [ ] T3 S6. U3 to U8, not started.

## Log

- L1 (2026-11-12) User: "Genera un plan de correccion con lemon y sus frutas".
- L2 (2026-11-12) User confirmed the two U2 contract changes: "Sí, confirmo".
- L3 (2026-11-12) User authorized implementation starting with U1 and U2: "Si"; then committed the WIP as ed43d81 and created the branch: "Ya lo hice".
- L4 Baseline: `node scripts/control.mjs verify` green on ed43d81 before any change. Engram mirror pending.
- L5 T1 and T2 done, uncommitted. RED/GREEN: hooks-json 4 failing then 7/7; scope 6 failing then 17/17. cherry PASS S1 to S5. Parent follow-up inline: test for symlink trusted and case variant not trusted (scope 18/18), stale scope comments in three scripts, command rule copy in maintain-verification-skill. `control.mjs verify` green. Not checked: how Claude Code treats exit 2 with `onFailure`; case-sensitive volumes.
- L6 Next: U3 (protected paths on Edit and Bash).
