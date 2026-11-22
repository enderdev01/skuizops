### Feature

You own the plan. Mango writes the code. Cherry checks the predicate.

1. Restate the goal in your own words. Write `.skuizops/plan.md`: the goal, one falsifiable done-predicate, and small units in order. Each unit ends in a check that runs before the next unit starts.
2. Ask kiwi where the first unit lives, when you cannot name the files yourself.
3. Delegate that unit to mango: the files, the pattern to copy, and the unit's check. One unit at a time.
4. Run the unit's check. Keep the change only when the predicate moved. Discard a change that left the predicate where it was.
5. When the predicate is met, run full `verify` once (skip it when it says the tree is already verified) and send one cherry. The brief has 2 to 4 finish checks taken from the predicate and the feature-map rows that match the diff and this request.
6. Independent features that do not share files may take one cherry each, in parallel, each in its own worktree at the SHA named in the brief. Aggregate PASS, ISSUES, or BLOCKED. A single feature stays one cherry.
7. Open the PR. Shipping says where you stop.
