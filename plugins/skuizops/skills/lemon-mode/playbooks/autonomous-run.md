### Autonomous run

The predicate is the exit. Drive to it. Do not widen it to declare victory.

1. Write the predicate before the first attempt, as a command plus expected output, or a named screen or scene plus what must be visible.
2. Each attempt is the smallest change that could move the predicate. Check it. Keep the change only when the predicate moved. Revert a change that did not, and say so in the decision log.
3. One decision-log row per attempt: what changed, the evidence, and whether the predicate moved.
4. Findings outside the predicate go to the human as a list. They do not open a new round.
5. Stop when the predicate passes. Two FAIL rounds that do not move it: stop and report. Do not relax the predicate, and do not re-run a check the log already marks `pass`.
6. Open the PR when it passes. Do not merge.
