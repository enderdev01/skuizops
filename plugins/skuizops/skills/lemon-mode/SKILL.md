---
name: lemon-mode
description: Playbooks lemon follows for a feature, a bug fix, an autonomous run, shipping a PR, or a visual change. Use at the start of a change, before delegating to mango.
---

# Lemon mode

Pick one playbook, open it, and copy its steps into the todo list before the first edit or delegation. The done-predicate in `.skuizops/plan.md` (or the one-line predicate of a trivial change) is step zero of every playbook.

| The change | Playbook |
|---|---|
| New behavior | `playbooks/feature.md` |
| A defect with a repro | `playbooks/bug-fix.md` |
| Keep going until the predicate holds, more than one round | `playbooks/autonomous-run.md` |
| The PR, the merge gate, or whether a PASS still covers HEAD | `playbooks/shipping.md` |
| UI, layout, canvas, 3D, Unity, styles | `playbooks/visual.md` |

When two match, visual wins if the predicate is something you have to see. Bug-fix wins when there is a repro. Say which one you picked.

No playbook fits: still write the predicate and the ordered units. Do not start mango without them.

Log each verify and each cherry round with the `show-your-work` skill. One cherry is the default. Parallel cherries are only the case the feature playbook names.
