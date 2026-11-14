import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeProjectDir, firstErrorLine, hasPlaywright, hasSession, hasWebUi, installRecommended, offerRecommended, pickMarketplaceAction, pickPluginAction, playwrightInstallCommand, recommendedSkills, setAutoUpdate, setLemonAgent, setOutputStyle, welcomePrompt } from "./setup.mjs";

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
    assert.equal(pickMarketplaceAction([{ name: "other" }, { name: "juicebar" }]), "update");
  });
  it("plugin", () => {
    assert.equal(pickPluginAction([]), "install");
    assert.equal(pickPluginAction([{ id: "skuizops@other" }]), "install");
    assert.equal(pickPluginAction([{ id: "skuizops@juicebar", version: "1" }]), "update");
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
  const source = { source: "github", repo: "enderdev01/skuizops" };
  // A fake home: `settings` is the text of settings.json (null: no file), `known` registers the marketplace.
  const home = (settings, known = true) => {
    const dir = mkdtempSync(join(tmpdir(), "setup-auto-"));
    mkdirSync(join(dir, ".claude", "plugins"), { recursive: true });
    if (settings !== null) writeFileSync(join(dir, ".claude", "settings.json"), settings);
    if (known) writeFileSync(join(dir, ".claude", "plugins", "known_marketplaces.json"), JSON.stringify({ "juicebar": { source } }));
    return dir;
  };
  const file = (dir) => join(dir, ".claude", "settings.json");
  const read = (dir) => JSON.parse(readFileSync(file(dir), "utf8"));

  it("turns it on with the registered source and keeps every other setting", () => {
    const dir = home(JSON.stringify({ outputStyle: "x", extraKnownMarketplaces: { other: { autoUpdate: false } } }));
    assert.deepEqual(setAutoUpdate(dir), { status: "ok", message: "on" });
    assert.deepEqual(read(dir), { outputStyle: "x", extraKnownMarketplaces: { other: { autoUpdate: false }, "juicebar": { source, autoUpdate: true } } });
    assert.deepEqual(readdirSync(join(dir, ".claude")).sort(), ["plugins", "settings.json"]);
  });
  it("creates the settings file when missing", () => {
    const dir = home(null);
    assert.equal(setAutoUpdate(dir).status, "ok");
    assert.equal(read(dir).extraKnownMarketplaces["juicebar"].autoUpdate, true);
  });
  it("keeps the entry's own source", () => {
    const own = { source: "directory", path: "/x" };
    const dir = home(JSON.stringify({ extraKnownMarketplaces: { "juicebar": { source: own } } }));
    setAutoUpdate(dir);
    assert.deepEqual(read(dir).extraKnownMarketplaces["juicebar"], { source: own, autoUpdate: true });
  });
  for (const [value, message] of [[true, "already on"], [false, "kept your setting (off)"]]) {
    it(`leaves the file untouched when autoUpdate is ${value}`, () => {
      const text = JSON.stringify({ extraKnownMarketplaces: { "juicebar": { source, autoUpdate: value } } });
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
    assert.equal(read(root), '{\n  "agent": "skuizops:lemon"\n}\n');
  });
  it("skips when already set", () => {
    const root = withSettings('{"agent":"skuizops:lemon"}');
    assert.equal(setLemonAgent(root).status, "skip");
    assert.equal(read(root), '{"agent":"skuizops:lemon"}');
  });
  it("adds the key and keeps the others", () => {
    const root = withSettings('{"model":"opus","env":{"A":"1"}}');
    assert.equal(setLemonAgent(root).status, "ok");
    assert.deepEqual(JSON.parse(read(root)), { model: "opus", env: { A: "1" }, agent: "skuizops:lemon" });
    assert.ok(read(root).endsWith("}\n"));
  });
  it("keeps a different agent", () => {
    const root = withSettings('{"agent":"mine"}');
    const r = setLemonAgent(root);
    assert.deepEqual(r, { status: "skip", message: "kept your agent mine" });
    assert.equal(read(root), '{"agent":"mine"}');
  });
  it("migrates the agent of the old plugin name and keeps the other keys", () => {
    const root = withSettings('{"model":"opus","agent":"dev-factory:lemon"}');
    assert.deepEqual(setLemonAgent(root), { status: "ok", message: "migrated from dev-factory:lemon" });
    assert.deepEqual(JSON.parse(read(root)), { model: "opus", agent: "skuizops:lemon" });
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

describe("welcomePrompt usage warning", () => {
  it("warns about plan usage and requires an explicit yes before create-verification-skill", () => {
    const p = welcomePrompt({ oldVersion: null, newVersion: "1" });
    assert.match(p, /create-verification-skill skill, and say that running it uses the user's plan usage/);
    assert.match(p, /depends on the project size and the plan/);
    assert.match(p, /only after an explicit yes/);
  });
});

describe("recommended skills", () => {
  const names = (webUi) => recommendedSkills(webUi).map((s) => s.name);
  const fake = (plugins = [], { failOn, tamper } = {}) => {
    const calls = [];
    const exec = async (cmd, args) => {
      if (args[0] === "plugin" && args[1] === "list") return { stdout: JSON.stringify(plugins) };
      calls.push([cmd, ...args].join(" "));
      if (failOn && [cmd, ...args].join(" ").includes(failOn)) throw Object.assign(new Error("x"), { stderr: "npm error boom\nmore" });
      if (cmd === "git") {
        const repo = args.at(-1);
        mkdirSync(join(repo, "skills", "unslop"), { recursive: true });
        writeFileSync(join(repo, "skills", "unslop", "SKILL.md"), "s");
        writeFileSync(join(repo, "LICENSE"), "CC BY 4.0");
        tamper?.(repo);
      }
      return { stdout: "" };
    };
    return { exec, calls };
  };
  const dirs = () => ({ home: mkdtempSync(join(tmpdir(), "rec-home-")), project: mkdtempSync(join(tmpdir(), "rec-proj-")) });
  const all = [{ id: "ponytail@ponytail" }, { id: "engram@engram" }];

  it("offers ponytail and engram, plus unslop and stageshow with a web UI", () => {
    assert.deepEqual(names(false), ["ponytail", "engram"]);
    assert.deepEqual(names(true), ["ponytail", "engram", "unslop", "stageshow"]);
  });
  it("installs nothing without TTY or without an explicit yes", async () => {
    for (const [isTTY, answer] of [[false, "y"], [true, ""], [true, "no"], [true, "maybe"]]) {
      const { exec, calls } = fake();
      const r = await offerRecommended({ webUi: true, isTTY, ask: async () => answer, say() {}, exec, ...dirs(), hasBrew: true });
      assert.equal(r.status, "skip");
      assert.deepEqual(calls, []);
    }
  });
  it("installs all four after a yes, with the user-scope commands", async () => {
    const { exec, calls } = fake();
    const d = dirs();
    const said = [];
    const r = await offerRecommended({ webUi: true, isTTY: true, ask: async () => "y", say: (s) => said.push(s), exec, ...d, hasBrew: true });
    assert.deepEqual(r.installed, ["ponytail", "engram", "unslop", "stageshow"]);
    assert.ok(calls.includes("claude plugin install ponytail@ponytail"));
    assert.ok(calls.includes("brew install gentleman-programming/tap/engram") && calls.includes("engram setup claude-code"));
    assert.ok(calls.includes("npx skills add benjitaylor/skills --skill stageshow -g -a claude-code -y"));
    assert.equal(readFileSync(join(d.home, ".claude", "skills", "unslop", "SKILL.md"), "utf8"), "s");
    assert.equal(readFileSync(join(d.home, ".claude", "skills", "unslop", "LICENSE"), "utf8"), "CC BY 4.0");
    assert.ok(said.some((l) => l.includes("plan usage")));
  });
  it("copies nothing from an unslop repo that holds a symlink or lacks its LICENSE", async () => {
    const outside = mkdtempSync(join(tmpdir(), "rec-outside-"));
    const tampers = {
      "skill dir is a symlink": (repo) => (rmSync(join(repo, "skills", "unslop"), { recursive: true }), symlinkSync(outside, join(repo, "skills", "unslop"))),
      "symlink inside the skill": (repo) => symlinkSync(outside, join(repo, "skills", "unslop", "link")),
      "LICENSE is a symlink": (repo) => (rmSync(join(repo, "LICENSE")), symlinkSync(join(outside, "x"), join(repo, "LICENSE"))),
      "no LICENSE": (repo) => rmSync(join(repo, "LICENSE")),
      "skills is a symlink": (repo) => {
        const real = mkdtempSync(join(tmpdir(), "rec-real-"));
        mkdirSync(join(real, "unslop"));
        rmSync(join(repo, "skills"), { recursive: true });
        symlinkSync(real, join(repo, "skills"));
      },
    };
    for (const [name, tamper] of Object.entries(tampers)) {
      const d = dirs();
      const r = await installRecommended({ webUi: true, exec: fake(all, { tamper }).exec, ...d, hasBrew: true });
      assert.equal(r.find((x) => x.name === "unslop").status, "fail", name);
      assert.equal(existsSync(join(d.home, ".claude", "skills", "unslop")), false, name);
      assert.deepEqual(readdirSync(outside), [], name);
    }
  });
  it("fails unslop, without crashing, when its destination is a broken link", async () => {
    const d = dirs();
    mkdirSync(join(d.home, ".claude", "skills"), { recursive: true });
    symlinkSync(join(d.home, "gone"), join(d.home, ".claude", "skills", "unslop"));
    const r = await installRecommended({ webUi: true, exec: fake(all).exec, ...d, hasBrew: true });
    assert.deepEqual(r.map((x) => [x.name, x.status]).slice(2), [["unslop", "fail"], ["stageshow", "ok"]]);
    assert.equal(existsSync(join(d.home, "gone")), false);
  });
  it("detects each one as installed from its marker and runs no install on a second pass", async () => {
    const d = dirs();
    for (const base of [d.home, d.project]) mkdirSync(join(base, ".claude", "skills", base === d.home ? "unslop" : "stageshow"), { recursive: true });
    const { exec, calls } = fake(all);
    const r = await installRecommended({ webUi: true, exec, ...d, hasBrew: true });
    assert.deepEqual(r.map((x) => x.text), Array(4).fill("already installed"));
    assert.deepEqual(calls, []);
  });
  it("reports a failing install by name and keeps going", async () => {
    const { exec, calls } = fake([], { failOn: "ponytail@ponytail" });
    const r = await installRecommended({ webUi: false, exec, ...dirs(), hasBrew: true });
    assert.deepEqual(r.map((x) => [x.name, x.status]), [["ponytail", "fail"], ["engram", "ok"]]);
    assert.equal(r[0].text, "npm error boom");
    assert.ok(calls.includes("engram setup claude-code"));
  });
  it("does not install engram without brew and shows the command", async () => {
    const { exec, calls } = fake();
    const r = await installRecommended({ webUi: false, exec, ...dirs(), hasBrew: false });
    assert.equal(r[1].status, "skip");
    assert.match(r[1].text, /brew install gentleman-programming\/tap\/engram.*docs\/INSTALLATION\.md/);
    assert.ok(!calls.some((c) => c.includes("engram") && !c.includes("ponytail")));
  });
});

describe("setOutputStyle", () => {
  const source = join(mkdtempSync(join(tmpdir(), "style-src-")), "brief.md");
  writeFileSync(source, "---\nname: brief\n---\n");
  const setup = ({ project, home, local } = {}) => {
    const root = mkdtempSync(join(tmpdir(), "style-proj-"));
    const h = mkdtempSync(join(tmpdir(), "style-home-"));
    const put = (dir, name, text) => text !== undefined && (mkdirSync(join(dir, ".claude"), { recursive: true }), writeFileSync(join(dir, ".claude", name), text));
    put(root, "settings.json", project);
    put(root, "settings.local.json", local);
    put(h, "settings.json", home);
    return { root, h, file: join(root, ".claude", "settings.json") };
  };

  it("copies the style, sets the key and keeps the others", () => {
    const { root, h, file } = setup({ project: '{"model":"opus"}' });
    assert.deepEqual(setOutputStyle(root, h, source), { status: "ok", message: "set" });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { model: "opus", outputStyle: "brief" });
    assert.equal(readFileSync(join(root, ".claude", "output-styles", "brief.md"), "utf8"), "---\nname: brief\n---\n");
  });
  it("works on a clean project", () => {
    const { root, h, file } = setup();
    assert.equal(setOutputStyle(root, h, source).status, "ok");
    assert.equal(readFileSync(file, "utf8"), '{\n  "outputStyle": "brief"\n}\n');
  });
  for (const where of ["home", "project", "local"]) {
    it(`keeps a style already set in the ${where} settings`, () => {
      const { root, h, file } = setup({ [where]: '{"outputStyle":"mine"}' });
      assert.deepEqual(setOutputStyle(root, h, source), { status: "skip", message: "kept your output style mine" });
      assert.equal(existsSync(join(root, ".claude", "output-styles")), false);
      if (where === "project") assert.equal(readFileSync(file, "utf8"), '{"outputStyle":"mine"}');
      else assert.equal(existsSync(file), false);
    });
  }
  it("fails on invalid JSON without writing", () => {
    const { root, h, file } = setup({ project: "{nope" });
    assert.equal(setOutputStyle(root, h, source).status, "fail");
    assert.equal(readFileSync(file, "utf8"), "{nope");
    assert.equal(existsSync(join(root, ".claude", "output-styles")), false);
  });
});
