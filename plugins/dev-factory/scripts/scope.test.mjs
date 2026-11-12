import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inScope, isTrusted, scopeRoots, trustHint } from "./scope.mjs";

const env = { HOME: "/Users/ada" };

describe("scopeRoots", () => {
  it("defaults to ~/DEV", () => assert.deepEqual(scopeRoots(env), ["/Users/ada/DEV"]));
  it("reads DEV_FACTORY_ROOTS as a path list", () =>
    assert.deepEqual(scopeRoots({ ...env, DEV_FACTORY_ROOTS: "/work:/Users/ada/DEV" }), ["/work", "/Users/ada/DEV"]));
});

describe("inScope", () => {
  it("includes a project inside ~/DEV", () => assert.equal(inScope("/Users/ada/DEV/onistream", env), true));
  it("includes a nested folder inside ~/DEV", () => assert.equal(inScope("/Users/ada/DEV/onistream/frontend", env), true));
  it("includes ~/DEV itself", () => assert.equal(inScope("/Users/ada/DEV", env), true));
  it("excludes projects outside ~/DEV", () => assert.equal(inScope("/Users/ada/rimacDev", env), false));
  it("excludes sibling folders that share the prefix", () => assert.equal(inScope("/Users/ada/DEVELOPMENT/app", env), false));
  it("ignores a trailing slash", () => assert.equal(inScope("/Users/ada/DEV/app/", env), true));
  it("excludes an unknown directory", () => assert.equal(inScope(undefined, env), false));
});

describe("isTrusted", () => {
  const home = mkdtempSync(join(tmpdir(), "trust-"));
  const env = { HOME: home };
  it("trusts nothing when the list is missing", () => assert.equal(isTrusted("/work/app", env), false));
  it("trusts a listed project and its subfolders, not its siblings", () => {
    mkdirSync(join(home, ".config", "dev-factory"), { recursive: true });
    writeFileSync(join(home, ".config", "dev-factory", "trusted-projects"), "# mine\n/work/app\n\nrelative/ignored\n");
    assert.equal(isTrusted("/work/app", env), true);
    assert.equal(isTrusted("/work/app/packages/web", env), true);
    assert.equal(isTrusted("/work/apple", env), false);
    assert.equal(isTrusted("relative/ignored", env), false);
  });
});

describe("trustHint", () => {
  it("quotes a hostile directory name so pasting it runs nothing", () => {
    const hint = trustHint('/w/a"$(touch /tmp/pwn)"\'b', { HOME: "/h" });
    assert.equal(hint, `mkdir -p '/h/.config/dev-factory' && echo '/w/a"$(touch /tmp/pwn)"'\\''b' >> '/h/.config/dev-factory/trusted-projects'`);
  });
});
