import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectDir, firstErrorLine, hasPlaywright, hasSession, hasWebUi, pickMarketplaceAction, pickPluginAction, playwrightInstallCommand, setAutoUpdate, setLemonAgent, welcomePrompt } from "./setup.mjs";

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
  it("lists what the setup configured and says lemon applies to new sessions", () => {
    assert.ok(!welcomePrompt({ oldVersion: null, newVersion: "1" }).includes("NEW sessions"));
    const p = welcomePrompt({ oldVersion: null, newVersion: "1", configured: ["trusted the project", "installed Playwright and Chromium"] });
    assert.match(p, /also did this: trusted the project; installed Playwright and Chromium\./);
    assert.match(p, /NEW sessions/);
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

describe("setAutoUpdate", () => {
  const source = { source: "github", repo: "enderdev01/la-fruteria" };
  // A fake home: `settings` is the text of settings.json (null: no file), `known` registers the marketplace.
  const home = (settings, known = true) => {
    const dir = mkdtempSync(join(tmpdir(), "setup-auto-"));
    mkdirSync(join(dir, ".claude", "plugins"), { recursive: true });
    if (settings !== null) writeFileSync(join(dir, ".claude", "settings.json"), settings);
    if (known) writeFileSync(join(dir, ".claude", "plugins", "known_marketplaces.json"), JSON.stringify({ "factory-marketplace": { source } }));
    return dir;
  };
  const file = (dir) => join(dir, ".claude", "settings.json");
  const read = (dir) => JSON.parse(readFileSync(file(dir), "utf8"));

  it("turns it on with the registered source and keeps every other setting", () => {
    const dir = home(JSON.stringify({ outputStyle: "x", extraKnownMarketplaces: { other: { autoUpdate: false } } }));
    assert.deepEqual(setAutoUpdate(dir), { status: "ok", message: "on" });
    assert.deepEqual(read(dir), { outputStyle: "x", extraKnownMarketplaces: { other: { autoUpdate: false }, "factory-marketplace": { source, autoUpdate: true } } });
    assert.deepEqual(readdirSync(join(dir, ".claude")).sort(), ["plugins", "settings.json"]);
  });
  it("creates the settings file when missing", () => {
    const dir = home(null);
    assert.equal(setAutoUpdate(dir).status, "ok");
    assert.equal(read(dir).extraKnownMarketplaces["factory-marketplace"].autoUpdate, true);
  });
  it("keeps the entry's own source", () => {
    const own = { source: "directory", path: "/x" };
    const dir = home(JSON.stringify({ extraKnownMarketplaces: { "factory-marketplace": { source: own } } }));
    setAutoUpdate(dir);
    assert.deepEqual(read(dir).extraKnownMarketplaces["factory-marketplace"], { source: own, autoUpdate: true });
  });
  for (const [value, message] of [[true, "already on"], [false, "kept your setting (off)"]]) {
    it(`leaves the file untouched when autoUpdate is ${value}`, () => {
      const text = JSON.stringify({ extraKnownMarketplaces: { "factory-marketplace": { source, autoUpdate: value } } });
      const dir = home(text);
      assert.deepEqual(setAutoUpdate(dir), { status: "skip", message });
      assert.equal(readFileSync(file(dir), "utf8"), text);
    });
  }
  it("fails on invalid JSON without touching the file", () => {
    const dir = home("{ nope");
    assert.equal(setAutoUpdate(dir).status, "fail");
    assert.equal(readFileSync(file(dir), "utf8"), "{ nope");
  });
  it("writes nothing when the marketplace is not registered", () => {
    const dir = home(null, false);
    assert.equal(setAutoUpdate(dir).status, "skip");
    assert.equal(existsSync(file(dir)), false);
  });
});

describe("setLemonAgent", () => {
  const project = () => mkdtempSync(join(tmpdir(), "setup-lemon-"));
  const withSettings = (text) => {
    const root = project();
    mkdirSync(join(root, ".claude"));
    writeFileSync(join(root, ".claude", "settings.json"), text);
    return root;
  };
  const read = (root) => readFileSync(join(root, ".claude", "settings.json"), "utf8");

  it("creates the file when missing", () => {
    const root = project();
    assert.equal(setLemonAgent(root).status, "ok");
    assert.equal(read(root), '{\n  "agent": "dev-factory:lemon"\n}\n');
  });
  it("skips when already set", () => {
    const root = withSettings('{"agent":"dev-factory:lemon"}');
    assert.equal(setLemonAgent(root).status, "skip");
    assert.equal(read(root), '{"agent":"dev-factory:lemon"}');
  });
  it("adds the key and keeps the others", () => {
    const root = withSettings('{"model":"opus","env":{"A":"1"}}');
    assert.equal(setLemonAgent(root).status, "ok");
    assert.deepEqual(JSON.parse(read(root)), { model: "opus", env: { A: "1" }, agent: "dev-factory:lemon" });
    assert.ok(read(root).endsWith("}\n"));
  });
  it("keeps a different agent", () => {
    const root = withSettings('{"agent":"mine"}');
    const r = setLemonAgent(root);
    assert.deepEqual(r, { status: "skip", message: "kept your agent mine" });
    assert.equal(read(root), '{"agent":"mine"}');
  });
  it("never overwrites invalid JSON or a non-object", () => {
    for (const text of ["{nope", "[1]", "null", '"x"']) {
      const root = withSettings(text);
      assert.deepEqual(setLemonAgent(root), { status: "fail", message: "fix .claude/settings.json (invalid JSON) and re-run" }, text);
      assert.equal(read(root), text);
    }
  });
});

describe("Playwright detection", () => {
  it("detects a web UI in dependencies or devDependencies", () => {
    assert.equal(hasWebUi(null), false);
    assert.equal(hasWebUi({}), false);
    assert.equal(hasWebUi({ dependencies: { express: "4" } }), false);
    assert.equal(hasWebUi({ dependencies: { react: "19" } }), true);
    assert.equal(hasWebUi({ devDependencies: { "@sveltejs/kit": "2" } }), true);
    assert.equal(hasWebUi({ devDependencies: { "@angular/core": "19" } }), true);
  });
  it("detects playwright", () => {
    assert.equal(hasPlaywright({ devDependencies: { playwright: "1" } }), true);
    assert.equal(hasPlaywright({ devDependencies: { "@playwright/test": "1" } }), true);
    assert.equal(hasPlaywright({ dependencies: { react: "1" } }), false);
  });
  it("picks the package manager by lockfile", () => {
    assert.deepEqual(playwrightInstallCommand(["pnpm-lock.yaml"]), ["pnpm", "add", "-D", "playwright"]);
    assert.deepEqual(playwrightInstallCommand(["yarn.lock"]), ["yarn", "add", "-D", "playwright"]);
    assert.deepEqual(playwrightInstallCommand(["bun.lock"]), ["bun", "add", "-d", "playwright"]);
    assert.deepEqual(playwrightInstallCommand(["bun.lockb"]), ["bun", "add", "-d", "playwright"]);
    assert.deepEqual(playwrightInstallCommand(["package-lock.json"]), ["npm", "install", "-D", "playwright"]);
    assert.deepEqual(playwrightInstallCommand([]), ["npm", "install", "-D", "playwright"]);
  });
  it("shows the first useful error line", () => {
    assert.equal(firstErrorLine("\nnpm warn x\nnpm error code E404\nmore"), "npm error code E404");
    assert.equal(firstErrorLine("boom\nbang"), "boom");
  });
});
