import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inScope, scopeRoots } from "./scope.mjs";

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
