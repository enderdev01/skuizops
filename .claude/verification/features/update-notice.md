# Update notice

Script: `plugins/skuizops/scripts/update-check.mjs`, hook `SessionStart`, JSON on stdin (ignored). It never blocks: any error ends with exit 0 and no output.

Installed version: `version` in the plugin's own `.claude-plugin/plugin.json`. Latest version: for a `directory` marketplace, the `plugin.json` in that directory; for any other source, `git fetch origin HEAD` in the marketplace clone (the user's own git credentials, no prompt, 5 s timeout) and `git show FETCH_HEAD:plugins/skuizops/.claude-plugin/plugin.json`. The remote answer, or its failure, is cached in `~/.claude/skuizops-update-check.json` for 24 hours.

Exercise:

```
node --test plugins/skuizops/scripts/update-check.test.mjs
```

| Input | Expected (observed) |
|---|---|
| installed version behind the marketplace's | one paragraph naming both versions, asking the orchestrator to ask the human, with `claude plugin marketplace update juicebar` and `claude plugin update skuizops@juicebar`, exit 0 |
| same version, offline, no marketplaces file, or any error | nothing, exit 0 |

Observed output:

```
▶ isNewer
  ✔ compares dotted versions part by part
  ✔ equal or garbage is not newer
✔ isNewer
▶ update check, directory source
  ✔ a newer repo version gives the notice with both versions and both commands
  ✔ the same version prints nothing
  ✔ message names both versions
✔ update check, directory source
▶ update check, remote source
  ✔ looks up once, caches, and reuses the cache for 24 hours
  ✔ a failing lookup prints nothing and the attempt is cached
  ✔ a corrupt cache counts as no cache
  ✔ the real lookup reads the version from the clone's origin
✔ update check, remote source
▶ update check, failures
  ✔ a missing known_marketplaces.json prints nothing and writes nothing
  ✔ a marketplace without our entry prints nothing
✔ update check, failures
▶ update check hook
  ✔ no marketplaces file: nothing printed, exit 0
✔ update check hook
ℹ tests 12
ℹ suites 5
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms (varies)
```

## Edge cases

- Versions compare as dotted numbers (`0.9.0` is older than `0.13.0`); a non-numeric version is never newer.
- The notice repeats on every session start while the installed version is behind.
- Reads the remote's default branch; a marketplace pinned to a ref is not followed.
- Not in `bench`: this hook never blocks. Covered by `update-check.test.mjs`.
