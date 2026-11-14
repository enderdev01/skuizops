---
name: push-up-the-ladder
description: Turn a review correction into the highest-leverage guarantee. Use whenever a human or reviewer corrects the agent's code, or the same mistake shows up twice.
---

# Push up the ladder

A correction fixed only in one line will come back. Move it as high as it can go:

1. **Codebase** — can the bad pattern become impossible? (a type that cannot hold the wrong value, a module boundary, a narrower API)
2. **Static analysis** — can a lint rule, type check or test fail on it? (`no-restricted-imports`, `no-restricted-syntax`, a regression test)
3. **Verification** — can the verify skill observe it at runtime? (add the check to `scripts/control.mjs` or the feature map in `.claude/verification/features/`)
4. **Prose** — only if 1–3 are impossible: one line in `AGENTS.md` or a skill.
5. **Human review** — stays responsible only for taste and finding the next gap.

## Steps

1. State the correction in one sentence.
2. Pick the highest layer that can enforce it and implement it there.
3. Prove it: reintroduce the mistake and show the new check fails, then revert.
4. Fix the original code.
5. Report: the layer chosen, why higher layers were not possible, and the proof.

## Example (TypeScript project)

Correction: "domain code must not import the database client."
→ Layer 2: `no-restricted-imports` in `eslint.config.js` for `src/domain/**`.
Proof: adding `import { db } from "../infra/db"` to a domain file makes `npm run lint` fail.
