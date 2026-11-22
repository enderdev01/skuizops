### Bug fix

The repro is the predicate. A line that does not change the repro does not ship.

1. Restate the bug. The predicate is the repro: the exact command, or the screen or scene, and the output you will see when it is fixed. It fails before the fix.
2. Reproduce it on the real surface. A visual or scene bug is reproduced by looking at the artifact. A compile, an EditMode test, or a log line does not count.
3. Mango writes the failing check first when a local test can express the repro, then the smallest fix. The brief names the files and the repro command.
4. Re-run only the repro. After 3 attempts that do not move it, stop and report what you tried. Discard an attempt that left the repro unchanged.
5. Cherry re-checks the failed repro and the files the fix touched. Do not add checks between attempts.
6. Run `push-up-the-ladder` once after the last FAIL (the one a later PASS fixed, or the second FAIL that stops you). The check it adds does not start another cherry round.
7. Open the PR.
