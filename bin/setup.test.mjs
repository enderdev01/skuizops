import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectDir, hasSession, pickMarketplaceAction, pickPluginAction, welcomePrompt } from "./setup.mjs";

describe("encodeProjectDir", () => {
  it("replaces every non-alphanumeric character with a dash", () => {
    assert.equal(encodeProjectDir("/Users/a/DEV/factory-marketplace"), "-Users-a-DEV-factory-marketplace");
    assert.equal(encodeProjectDir("/a b/c.d_e"), "-a-b-c-d-e");
  });
});

describe("welcomePrompt", () => {
  it("says installed", () => assert.match(welcomePrompt({ oldVersion: null, newVersion: "0.11.0" }), /was just installed v0\.11\.0 in this project/));
  it("says updated", () => assert.match(welcomePrompt({ oldVersion: "0.10.2", newVersion: "0.11.0" }), /updated from v0\.10\.2 to v0\.11\.0/));
  it("says up to date", () => assert.match(welcomePrompt({ oldVersion: "0.11.0", newVersion: "0.11.0" }), /confirmed up to date at v0\.11\.0/));
  it("lists backups only when there are some", () => {
    assert.ok(!welcomePrompt({ oldVersion: null, newVersion: "1" }).includes("backed up"));
    assert.match(welcomePrompt({ oldVersion: "1", newVersion: "2", backups: ["/p/.githooks/pre-commit.local-1", "/p/x.local-2"] }), /backed up before being replaced: \/p\/\.githooks\/pre-commit\.local-1, \/p\/x\.local-2\./);
  });
  it("always forbids running commands", () => assert.match(welcomePrompt({ oldVersion: null, newVersion: "1" }), /Do not run any command\.$/));
});

describe("add vs update", () => {
  it("marketplace", () => {
    assert.equal(pickMarketplaceAction([]), "add");
    assert.equal(pickMarketplaceAction([{ name: "other" }]), "add");
    assert.equal(pickMarketplaceAction([{ name: "other" }, { name: "factory-marketplace" }]), "update");
  });
  it("plugin", () => {
    assert.equal(pickPluginAction([]), "install");
    assert.equal(pickPluginAction([{ id: "dev-factory@other" }]), "install");
    assert.equal(pickPluginAction([{ id: "dev-factory@factory-marketplace", version: "1" }]), "update");
  });
});

describe("hasSession", () => {
  it("is true only when the project folder holds a .jsonl", () => {
    const home = mkdtempSync(join(tmpdir(), "setup-home-"));
    const project = realpathSync(mkdtempSync(join(tmpdir(), "setup-proj-")));
    assert.equal(hasSession(project, home), false);
    const dir = join(home, ".claude", "projects", encodeProjectDir(project));
    mkdirSync(dir, { recursive: true });
    assert.equal(hasSession(project, home), false);
    writeFileSync(join(dir, "abc.jsonl"), "{}");
    assert.equal(hasSession(project, home), true);
  });
});
