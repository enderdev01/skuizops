import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installHooks } from "../plugins/skuizops/scripts/install-hooks.mjs";
import { trustFile } from "../plugins/skuizops/scripts/scope.mjs";
import { removeLemonAgent, removeMarketplace, removeMarketplaceEntry, removeOutputStyle, uninstall, uninstallHooks, uninstallPlugin, untrust } from "./uninstall.mjs";
import { setOutputStyle } from "./setup.mjs";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "skuizops-un-")));
const repo = () => {
  const dir = tmp();
  execFileSync("git", ["init", "-q", dir]);
  return dir;
};
const hooksPath = (root) => {
  try {
    return execFileSync("git", ["-C", root, "config", "--local", "core.hooksPath"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const settingsOf = (root, text) => {
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude", "settings.json"), text);
};
const read = (root) => JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));

describe("uninstallHooks", () => {
  it("removes unedited files, keeps an edited one, and keeps hooksPath while .githooks remains", () => {
    const root = repo();
    installHooks(root);
    writeFileSync(join(root, ".githooks", "pre-commit"), "my edit\n");
    const r = uninstallHooks(root);
    assert.equal(r.status, "ok");
    assert.ok(r.details.some((d) => d.includes("kept .githooks/pre-commit")));
    assert.equal(readFileSync(join(root, ".githooks", "pre-commit"), "utf8"), "my edit\n");
    assert.ok(!existsSync(join(root, ".githooks", ".skuizops.json")));
    assert.ok(!existsSync(join(root, "scripts", "guard")));
    assert.equal(hooksPath(root), ".githooks");
  });
  it("removes everything and unsets hooksPath when nothing was edited", () => {
    const root = repo();
    installHooks(root);
    uninstallHooks(root);
    assert.ok(!existsSync(join(root, ".githooks")));
    assert.equal(hooksPath(root), "");
  });
  it("leaves other hooksPath values alone", () => {
    const root = repo();
    installHooks(root);
    uninstallHooks(root);
    execFileSync("git", ["-C", root, "config", "core.hooksPath", ".husky"]);
    uninstallHooks(root);
    assert.equal(hooksPath(root), ".husky");
  });
  it("touches nothing without a manifest", () => {
    const root = repo();
    installHooks(root);
    writeFileSync(join(root, ".githooks", ".skuizops.json"), "{");
    assert.match(uninstallHooks(root).text, /unreadable/);
    rmManifest(root);
    const r = uninstallHooks(root);
    assert.equal(r.text, "no manifest, hooks left alone");
    assert.ok(existsSync(join(root, ".githooks", "pre-commit")));
    assert.equal(hooksPath(root), ".githooks");
  });
});
const rmManifest = (root) => execFileSync("rm", [join(root, ".githooks", ".skuizops.json")]);

describe("untrust", () => {
  it("removes this project and keeps every other line byte-identical", () => {
    const home = tmp();
    const project = tmp();
    const file = join(home, ".config", "skuizops", "trusted-projects");
    mkdirSync(join(home, ".config", "skuizops"), { recursive: true });
    writeFileSync(file, `# mine\n/other/a\n${project}\n\n/other/b\n`);
    const r = untrust(project, { HOME: home });
    assert.equal(r.status, "ok");
    assert.deepEqual(r.others, ["/other/a", "/other/b"]);
    assert.equal(readFileSync(file, "utf8"), "# mine\n/other/a\n\n/other/b\n");
  });
  it("skips when the project is not listed or there is no file", () => {
    const home = tmp();
    assert.equal(untrust("/x", { HOME: home }).status, "skip");
    mkdirSync(join(home, ".config", "skuizops"), { recursive: true });
    writeFileSync(join(home, ".config", "skuizops", "trusted-projects"), "/other\n");
    assert.equal(untrust("/x", { HOME: home }).status, "skip");
  });
});

describe("removeLemonAgent", () => {
  it("removes lemon and keeps other keys", () => {
    const root = tmp();
    settingsOf(root, JSON.stringify({ agent: "skuizops:lemon", model: "x" }));
    assert.equal(removeLemonAgent(root).status, "ok");
    assert.deepEqual(read(root), { model: "x" });
  });
  it("keeps another agent", () => {
    const root = tmp();
    settingsOf(root, JSON.stringify({ agent: "mine" }));
    assert.equal(removeLemonAgent(root).status, "skip");
    assert.deepEqual(read(root), { agent: "mine" });
  });
  it("leaves {} when it was the only key", () => {
    const root = tmp();
    settingsOf(root, JSON.stringify({ agent: "skuizops:lemon" }));
    removeLemonAgent(root);
    assert.equal(readFileSync(join(root, ".claude", "settings.json"), "utf8"), "{}\n");
  });
  it("fails on invalid JSON without writing", () => {
    const root = tmp();
    settingsOf(root, "{nope");
    assert.equal(removeLemonAgent(root).status, "fail");
    assert.equal(readFileSync(join(root, ".claude", "settings.json"), "utf8"), "{nope");
  });
});

describe("removeOutputStyle", () => {
  it("removes brief, its unedited file and the empty folder", () => {
    const root = tmp();
    const home = tmp();
    setOutputStyle(root, home);
    const r = removeOutputStyle(root);
    assert.equal(r.status, "ok");
    assert.ok(!("outputStyle" in read(root)));
    assert.ok(!existsSync(join(root, ".claude", "output-styles")));
  });
  it("keeps a different style, and keeps an edited brief.md", () => {
    const root = tmp();
    setOutputStyle(root, tmp());
    writeFileSync(join(root, ".claude", "output-styles", "brief.md"), "mine\n");
    settingsOf(root, JSON.stringify({ outputStyle: "other" }));
    const r = removeOutputStyle(root);
    assert.equal(r.status, "skip");
    assert.equal(read(root).outputStyle, "other");
    assert.equal(readFileSync(join(root, ".claude", "output-styles", "brief.md"), "utf8"), "mine\n");
  });
  it("fails on invalid JSON without writing", () => {
    const root = tmp();
    settingsOf(root, "[");
    assert.equal(removeOutputStyle(root).status, "fail");
    assert.equal(readFileSync(join(root, ".claude", "settings.json"), "utf8"), "[");
  });
});

describe("removeMarketplaceEntry", () => {
  it("removes juicebar and keeps other keys and marketplaces", () => {
    const home = tmp();
    settingsOf(home, JSON.stringify({ theme: "dark", extraKnownMarketplaces: { juicebar: { autoUpdate: true }, other: { x: 1 } } }));
    assert.equal(removeMarketplaceEntry(home).status, "ok");
    assert.deepEqual(read(home), { theme: "dark", extraKnownMarketplaces: { other: { x: 1 } } });
  });
  it("drops extraKnownMarketplaces when it ends empty", () => {
    const home = tmp();
    settingsOf(home, JSON.stringify({ theme: "dark", extraKnownMarketplaces: { juicebar: {} } }));
    removeMarketplaceEntry(home);
    assert.deepEqual(read(home), { theme: "dark" });
  });
  it("fails on invalid JSON without writing", () => {
    const home = tmp();
    settingsOf(home, "{x");
    assert.equal(removeMarketplaceEntry(home).status, "fail");
    assert.equal(readFileSync(join(home, ".claude", "settings.json"), "utf8"), "{x");
  });
  it("skips when absent", () => {
    assert.equal(removeMarketplaceEntry(tmp()).status, "skip");
  });
});

describe("claude commands", () => {
  const fake = (plugins, marketplaces) => {
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push(args.join(" "));
      if (args.join(" ") === "plugin list --json") return { stdout: JSON.stringify(plugins) };
      if (args.join(" ") === "plugin marketplace list --json") return { stdout: JSON.stringify(marketplaces) };
      return { stdout: "" };
    };
    return { exec, calls };
  };
  it("skips both when not installed", async () => {
    const { exec, calls } = fake([], []);
    assert.equal((await uninstallPlugin(exec)).status, "skip");
    assert.equal((await removeMarketplace(exec)).status, "skip");
    assert.ok(!calls.some((c) => /uninstall|remove/.test(c)));
  });
  it("runs both when installed", async () => {
    const { exec, calls } = fake([{ id: "skuizops@juicebar" }], [{ name: "juicebar" }]);
    assert.equal((await uninstallPlugin(exec)).status, "ok");
    assert.equal((await removeMarketplace(exec)).status, "ok");
    assert.ok(calls.includes("plugin uninstall skuizops@juicebar"));
    assert.ok(calls.includes("plugin marketplace remove juicebar"));
  });
});

describe("scripts folder", () => {
  it("is removed with scripts/guard when empty, kept when it holds anything", () => {
    const a = repo();
    installHooks(a);
    uninstallHooks(a);
    assert.ok(!existsSync(join(a, "scripts")));
    const b = repo();
    installHooks(b);
    writeFileSync(join(b, "scripts", "mine.sh"), "x\n");
    uninstallHooks(b);
    assert.ok(!existsSync(join(b, "scripts", "guard")));
    assert.ok(existsSync(join(b, "scripts", "mine.sh")));
  });
});

describe("claude not installed", () => {
  it("skips plugin and marketplace on ENOENT, rethrows other errors", async () => {
    const exec = async () => {
      throw Object.assign(new Error("spawn claude ENOENT"), { code: "ENOENT" });
    };
    for (const r of [await uninstallPlugin(exec), await removeMarketplace(exec)]) assert.deepEqual(r, { status: "skip", message: "Claude Code not found" });
    await assert.rejects(uninstallPlugin(async () => { throw new Error("boom"); }), /boom/);
  });
});

describe("uninstall end to end", () => {
  const snapshot = (...dirs) => {
    const out = {};
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (p.endsWith(join(".git", "objects"))) continue;
        if (e.isDirectory()) {
          out[p] = "dir";
          walk(p);
        } else out[p] = createHash("sha256").update(readFileSync(p)).digest("hex");
      }
    };
    dirs.forEach(walk);
    return out;
  };
  const setup = () => {
    const root = repo();
    const home = tmp();
    installHooks(root);
    writeFileSync(join(root, ".githooks", "pre-commit"), "my edit\n");
    writeFileSync(join(root, ".githooks", "my-hook"), "#!/bin/sh\n");
    settingsOf(root, JSON.stringify({ agent: "skuizops:lemon", outputStyle: "brief", model: "x" }));
    settingsOf(home, JSON.stringify({ theme: "dark", extraKnownMarketplaces: { juicebar: { a: 1 }, other: { x: 1 } } }));
    const trust = trustFile({ HOME: home });
    mkdirSync(dirname(trust), { recursive: true });
    writeFileSync(trust, `/other/a\n${root}\n# mine\n/other/b\n`);
    const calls = [];
    const exec = async (cmd, args) => {
      if (cmd === "git") return { stdout: execFileSync("git", args, { encoding: "utf8" }) };
      calls.push(args.join(" "));
      if (args.join(" ") === "plugin list --json") return { stdout: JSON.stringify([{ id: "skuizops@juicebar" }]) };
      if (args.join(" ") === "plugin marketplace list --json") return { stdout: JSON.stringify([{ name: "juicebar" }]) };
      return { stdout: "" };
    };
    const lines = [];
    const step = async (label, fn) => {
      try {
        return await fn();
      } catch (e) {
        return { status: "fail", text: e.message };
      }
    };
    const ui = { step, out: (s) => lines.push(s), MARK: { ok: "ok", fail: "fail" }, dim: (s) => s };
    const go = (opts) => uninstall(ui, { cwd: root, home, env: { HOME: home }, exec, ...opts });
    return { root, home, trust, calls, lines, go };
  };
  const mutating = (calls) => calls.filter((c) => /uninstall|remove/.test(c));

  it("no TTY: changes nothing", async () => {
    const { root, home, calls, lines, go } = setup();
    const before = snapshot(root, home);
    assert.equal(await go({ isTTY: false }), 0);
    assert.ok(lines.includes("Nothing was changed."));
    assert.deepEqual(snapshot(root, home), before);
    assert.deepEqual(mutating(calls), []);
  });
  it("answer n: changes nothing", async () => {
    const { root, home, calls, lines, go } = setup();
    const before = snapshot(root, home);
    assert.equal(await go({ isTTY: true, ask: async () => "n" }), 0);
    assert.ok(lines.includes("Nothing was changed."));
    assert.deepEqual(snapshot(root, home), before);
    assert.deepEqual(mutating(calls), []);
  });
  it("answer y: removes ours, keeps the user's files, hooksPath and other entries", async () => {
    const { root, home, trust, calls, go } = setup();
    assert.equal(await go({ isTTY: true, ask: async () => "y" }), 0);
    assert.equal(readFileSync(join(root, ".githooks", "pre-commit"), "utf8"), "my edit\n");
    assert.equal(readFileSync(join(root, ".githooks", "my-hook"), "utf8"), "#!/bin/sh\n");
    assert.equal(hooksPath(root), ".githooks");
    assert.deepEqual(read(root), { model: "x" });
    assert.deepEqual(read(home), { theme: "dark", extraKnownMarketplaces: { other: { x: 1 } } });
    assert.equal(readFileSync(trust, "utf8"), "/other/a\n# mine\n/other/b\n");
    assert.ok(calls.includes("plugin uninstall skuizops@juicebar"));
    assert.ok(calls.includes("plugin marketplace remove juicebar"));
  });
});

describe("uninstall flow", () => {
  it("changes nothing without a TTY", async () => {
    const lines = [];
    const exec = async () => {
      throw new Error("no exec expected");
    };
    const ui = { step: async () => assert.fail("no step"), out: (s) => lines.push(s), MARK: {}, dim: (s) => s };
    assert.equal(await uninstall(ui, { cwd: tmp(), home: tmp(), env: {}, exec, isTTY: false }), 0);
    assert.ok(lines.includes("Nothing was changed."));
  });
});
