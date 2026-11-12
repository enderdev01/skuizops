---
name: verify
description: How to run this app and check that a change actually works. Use before claiming any change is done, and whenever cherry (the verifier) runs.
---

# Verify

Verification is critical infrastructure: an agent that can check its own work does not need a human to tell it it is broken.
Collect evidence, not opinions.

If the project has no `scripts/control.mjs`, use the verify command named in its AGENTS.md and tell the user the `create-verification-skill` skill can generate the CLI and the feature map.

## 1. Environment

```bash
node scripts/control.mjs doctor
```

Every check must be `ok`. A `FAIL` line says exactly what to run to fix it.

## 2. Static gate

```bash
node scripts/control.mjs verify        # add --json for machine-readable output
```

Green is required, not sufficient.

## 3. Exercise the behavior

1. Find the feature in the project's feature map, `.claude/verification/features/README.md`.
2. Use the `scripts/control.mjs` command listed there, with the request's example input.
3. Try the edge cases listed in the feature's file next to the README, plus any the request names.

If the feature is not in the map, add it (see "Keeping this skill current").

## 4. Evidence format

For each requirement: the exact command, the observed output, PASS or FAIL.
"It should work" is not evidence.

## Keeping this skill current

- When you add or change a user-facing feature, add or update its file under `.claude/verification/features/` and its row in the README.
- When a feature needs a way to be exercised, add a subcommand to `scripts/control.mjs` instead of writing a throwaway script.
- Run the `maintain-verification-skill` skill at least once a day: it removes features that no longer exist and fixes commands that no longer run.
