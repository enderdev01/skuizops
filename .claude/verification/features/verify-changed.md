# Verify changed

`node scripts/control.mjs verify --changed [path...]` runs only the checks those paths can affect: syntax of changed `.mjs` files, the sibling test or the test file itself, the agent and hook tests when an agent, skill, hook or manifest changes, and `claude plugin validate` when a marketplace or plugin manifest changes. No matching path means nothing runs.

A full `node scripts/control.mjs verify` that passes records the tree the Stop gate records. The next full verify on that same tree skips. `verify --changed` does not record the tree.

The project template (`plugins/skuizops/templates/control.mjs`) has the same two modes for `typecheck`, `lint` and `test`: JS/TS files are forwarded to those scripts, a `.cs` file is forwarded only to `test`, and a filtered pass does not record the tree. `node --test plugins/skuizops/scripts/template-control.test.mjs` covers it.

Observed from this checkout:

```
$ node scripts/control.mjs verify --changed -- README.md
ok  verify --changed (no checks for these paths)
```

Exit 0. The verify marker was unchanged.

```
$ node scripts/control.mjs verify --changed -- --nope
FAIL unknown verify flag "--nope"  ->  see: node scripts/control.mjs --help
```

Exit 1.

```
$ node scripts/control.mjs verify
ok  verify (tree already verified, skipped)
```

Exit 0, when the marker already held this tree. The marker was put back afterwards.

| Input | Expected |
|---|---|
| `verify --changed -- README.md` | exit 0, `ok  verify --changed (no checks for these paths)`, marker unchanged |
| `verify --changed -- --nope` | exit 1, `unknown verify flag` |
| full `verify` when the marker matches the tree | exit 0, `ok  verify (tree already verified, skipped)` |
| full `verify` passes and the tree is the same afterwards | marker equals the Stop gate's tree state |
| `verify --changed` passes | marker unchanged |
