import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentToml, codexModel, ensureCodexProjectTrust, ensurePluginEnabled, parseAgent, removeAgents, removeCodexProjectTrust, removeLemonCodex, setLemonCodex, setupCodex, tomlMultiline, uninstallCodex, writeAgents } from "./codex.mjs";

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "skuizops-cx-")));
const MARK = { ok: "ok", skip: "skip", fail: "fail" };
const lines = [];
const ui = {
  MARK,
  dim: (s) => s,
  out: (s) => lines.push(s),
  step: async (label, fn) => {
    try {
      const r = await fn({ pause() {} });
      lines.push(`${r.status} ${label} ${r.text ?? ""}`);
      return r;
    } catch (e) {
      lines.push(`fail ${label} ${e.message}`);
      return { status: "fail" };
    }
  },
};

// Tiny TOML reader for what we write: `key = "json string"` and `key = '''...'''` / `"""..."""` multi-line.
const readToml = (text) => {
  const out = {};
  const re = /^(\w+) = (?:'''\n([\s\S]*?)\n'''|"""\n([\s\S]*?)\n"""|(".*"))$/gm;
  for (const [, k, lit, basic, one] of text.matchAll(re)) out[k] = one !== undefined ? JSON.parse(one) : lit ?? basic.replace(/\\(["\\])/g, "$1");
  return out;
};

// Fake codex CLI with state: marketplaces and installed plugin ids.
const fakeExec = (state = { marketplaces: [], installed: [] }, calls = []) => {
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(" "));
    if (cmd !== "codex") throw new Error("unexpected");
    const a = args.join(" ");
    if (a === "--version") return { stdout: "codex-cli 0.166\n" };
    if (a === "plugin marketplace list --json") return { stdout: JSON.stringify({ marketplaces: state.marketplaces.map((name) => ({ name })) }) };
    if (a === "plugin list --json") return { stdout: JSON.stringify({ installed: state.installed.map((pluginId) => ({ pluginId })) }) };
    if (a.startsWith("plugin marketplace add")) state.marketplaces.push("juicebar");
    if (a.startsWith("plugin add")) state.installed.push("skuizops@juicebar");
    if (a.startsWith("plugin remove")) state.installed = state.installed.filter((p) => p !== "skuizops@juicebar");
    if (a.startsWith("plugin marketplace remove")) state.marketplaces = state.marketplaces.filter((m) => m !== "juicebar");
    return { stdout: "" };
  };
  exec.calls = calls;
  exec.state = state;
  return exec;
};

describe("agent TOML", () => {
  it("maps models", () => {
    assert.equal(codexModel("haiku"), "gpt-6.1-terra");
    assert.equal(codexModel("sonnet"), "gpt-6.2-sol");
    assert.equal(codexModel("opus"), undefined);
    assert.equal(codexModel("inherit"), undefined);
  });

  it("round-trips the body, with literal and escaped strings", () => {
    for (const body of ["plain `x` \\ \"q\"", "has ''' inside \\ and \"q\""]) {
      const t = readToml(`x = ${tomlMultiline(body)}\n`);
      assert.equal(t.x, body);
    }
  });

  it("writes the four agents with right name and model, idempotently, leaving other files", () => {
    const home = tmp();
    mkdirSync(join(home, ".codex", "agents"), { recursive: true });
    writeFileSync(join(home, ".codex", "agents", "other.toml"), "name = \"other\"\n");
    assert.equal(writeAgents(home).status, "ok");
    const dir = join(home, ".codex", "agents");
    const expected = { kiwi: "gpt-6.1-terra", fig: "gpt-6.1-terra", mango: "gpt-6.2-sol", cherry: "gpt-6.2-sol" };
    for (const [name, model] of Object.entries(expected)) {
      const text = readFileSync(join(dir, `skuizops-${name}.toml`), "utf8");
      const t = readToml(text);
      assert.equal(t.name, name);
      assert.equal(t.model, model);
      const src = parseAgent(readFileSync(new URL(`../plugins/skuizops/agents/${name}.md`, import.meta.url), "utf8"));
      assert.ok(t.developer_instructions.startsWith("You run inside OpenAI Codex CLI."));
      assert.ok(t.developer_instructions.endsWith(src.body));
    }
    assert.equal(writeAgents(home).status, "skip");
    assert.equal(removeAgents(home).status, "ok");
    assert.deepEqual(readdirSync(dir), ["other.toml"]);
  });

  it("omits model for inherit", () => {
    assert.ok(!agentToml({ name: "a", description: "d", model: "inherit", body: "b" }).includes("model ="));
  });
});

describe("lemon block", () => {
  it("is added, replaced in place, removed, and keeps unrelated lines", () => {
    const root = tmp();
    const file = join(root, ".codex", "config.toml");
    mkdirSync(join(root, ".codex"));
    const mine = 'model = "x"\n\n[projects."/p"]\ntrust_level = "trusted"\n';
    writeFileSync(file, mine);
    assert.equal(setLemonCodex(root).status, "ok");
    const first = readFileSync(file, "utf8");
    assert.ok(first.startsWith("# skuizops:lemon begin\n"));
    assert.ok(first.endsWith(mine));
    assert.equal(readToml(first).developer_instructions.includes("kiwi, fig, mango and cherry"), true);
    assert.equal(setLemonCodex(root).status, "skip");
    assert.equal(readFileSync(file, "utf8"), first);
    writeFileSync(file, first.replace("# skuizops:lemon begin\n", "# skuizops:lemon begin\nstale = 1\n#"));
    // block content outdated: replaced, not duplicated
    setLemonCodex(root);
    assert.equal(readFileSync(file, "utf8").split("skuizops:lemon begin").length, 2);
    assert.equal(removeLemonCodex(root).status, "ok");
    assert.equal(readFileSync(file, "utf8"), mine);
  });

  it("deletes the file and folder when only our block was there", () => {
    const root = tmp();
    setLemonCodex(root);
    assert.equal(removeLemonCodex(root).status, "ok");
    assert.equal(existsSync(join(root, ".codex")), false);
  });

  it("keeps the user's own developer_instructions", () => {
    const root = tmp();
    mkdirSync(join(root, ".codex"));
    const mine = 'developer_instructions = "mine"\n';
    writeFileSync(join(root, ".codex", "config.toml"), mine);
    assert.equal(setLemonCodex(root).message, "kept your developer_instructions");
    assert.equal(readFileSync(join(root, ".codex", "config.toml"), "utf8"), mine);
    assert.equal(removeLemonCodex(root).status, "skip");
  });
});

describe("ensurePluginEnabled", () => {
  it("appends only when the table is missing", () => {
    const home = tmp();
    mkdirSync(join(home, ".codex"));
    writeFileSync(join(home, ".codex", "config.toml"), "a = 1");
    assert.equal(ensurePluginEnabled(home), true);
    assert.equal(ensurePluginEnabled(home), false);
    assert.equal(readFileSync(join(home, ".codex", "config.toml"), "utf8"), 'a = 1\n\n[plugins."skuizops@juicebar"]\nenabled = true\n');
  });
});

describe("Codex project trust", () => {
  const cfg = (home) => join(home, ".codex", "config.toml");
  const ours = (root) => `\n# skuizops: trusted so Codex loads this project's .codex/config.toml\n[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"\n`;
  it("appends once and is idempotent", () => {
    const home = tmp();
    mkdirSync(join(home, ".codex"));
    writeFileSync(cfg(home), "a = 1\n");
    assert.equal(ensureCodexProjectTrust(home, "/p/app").status, "ok");
    const once = readFileSync(cfg(home), "utf8");
    assert.equal(once, `a = 1\n${ours("/p/app")}`);
    assert.equal(ensureCodexProjectTrust(home, "/p/app").message, "already trusted");
    assert.equal(readFileSync(cfg(home), "utf8"), once);
  });
  it("creates the file when missing", () => {
    const home = tmp();
    ensureCodexProjectTrust(home, "/p/app");
    assert.ok(readFileSync(cfg(home), "utf8").includes('trust_level = "trusted"'));
  });
  it("keeps a user-written table untouched, even with another trust_level", () => {
    const home = tmp();
    mkdirSync(join(home, ".codex"));
    const mine = '[projects."/p/app"]\ntrust_level = "untrusted"\n';
    writeFileSync(cfg(home), mine);
    assert.equal(ensureCodexProjectTrust(home, "/p/app").status, "skip");
    assert.equal(removeCodexProjectTrust(home, "/p/app").status, "skip");
    assert.equal(readFileSync(cfg(home), "utf8"), mine);
  });
  it("uninstall removes only ours and restores the original bytes", () => {
    const home = tmp();
    mkdirSync(join(home, ".codex"));
    const before = 'a = 1\n\n[projects."/other"]\ntrust_level = "trusted"\n';
    writeFileSync(cfg(home), before);
    ensureCodexProjectTrust(home, "/p/app");
    assert.equal(removeCodexProjectTrust(home, "/p/app").status, "ok");
    assert.equal(readFileSync(cfg(home), "utf8"), before);
  });
  it("escapes spaces and quotes in the path", () => {
    const home = tmp();
    const root = '/p/my "app" \\ x';
    ensureCodexProjectTrust(home, root);
    assert.ok(readFileSync(cfg(home), "utf8").includes('[projects."/p/my \\"app\\" \\\\ x"]'));
    assert.equal(ensureCodexProjectTrust(home, root).status, "skip");
    assert.equal(removeCodexProjectTrust(home, root).status, "ok");
  });
  describe("detects existing trust in any TOML form", () => {
    const R = "/p/app";
    const forms = {
      "basic header": '[projects."/p/app"]\ntrust_level = "trusted"\n',
      "literal header": "[projects.'/p/app']\ntrust_level = \"trusted\"\n",
      "spaced header": '[ projects . "/p/app" ]\ntrust_level = "trusted"\n',
      "header with trailing comment": '[projects."/p/app"] # mine\ntrust_level = "trusted"\n',
      "header with trailing comment containing ]": '[projects."/p/app"] # see [docs]\ntrust_level = "trusted"\n',
      "inline entry, basic key": '[projects]\n"/p/app" = { trust_level = "trusted" }\n',
      "inline entry, literal key": "[projects]\n'/p/app' = { trust_level = \"trusted\" }\n",
      "top-level dotted key": 'a = 1\nprojects."/p/app".trust_level = "trusted"\n',
      "dotted key under [projects]": '[projects]\n"/p/app".trust_level = "trusted"\n',
    };
    for (const [name, toml] of Object.entries(forms)) {
      it(name, () => {
        const home = tmp();
        mkdirSync(join(home, ".codex"));
        writeFileSync(cfg(home), toml);
        assert.equal(ensureCodexProjectTrust(home, R).message, "already trusted");
        assert.equal(readFileSync(cfg(home), "utf8"), toml);
      });
    }
    it("a header inside a comment does not count", () => {
      const home = tmp();
      mkdirSync(join(home, ".codex"));
      writeFileSync(cfg(home), '# [projects."/p/app"]\n  #projects."/p/app".trust_level = "trusted"\n');
      assert.equal(ensureCodexProjectTrust(home, R).status, "ok");
    });
    it("another project's entry does not count", () => {
      const home = tmp();
      mkdirSync(join(home, ".codex"));
      writeFileSync(cfg(home), '[projects."/p/app2"]\ntrust_level = "trusted"\n');
      assert.equal(ensureCodexProjectTrust(home, R).status, "ok");
    });
  });
  it("round trip restores the exact bytes, with and without a trailing newline", () => {
    for (const before of ["a = 1", "a = 1\n", "a = 1\n\n", "", "\n"]) {
      const home = tmp();
      mkdirSync(join(home, ".codex"));
      writeFileSync(cfg(home), before);
      assert.equal(ensureCodexProjectTrust(home, "/p/app").status, "ok");
      assert.equal(removeCodexProjectTrust(home, "/p/app").status, "ok");
      assert.equal(readFileSync(cfg(home), "utf8"), before);
    }
  });
  it("setup trusts the root and uninstall removes it", async () => {
    const home = tmp();
    const root = tmp();
    const exec = fakeExec();
    await setupCodex(ui, { home, root, exec });
    assert.ok(readFileSync(cfg(home), "utf8").includes(`[projects.${JSON.stringify(root)}]`));
    await uninstallCodex(ui, { home, root, exec });
    assert.ok(!readFileSync(cfg(home), "utf8").includes("[projects."));
  });
});

describe("setupCodex / uninstallCodex", () => {
  it("sets up, is idempotent, and uninstall removes exactly what setup added", async () => {
    const home = tmp();
    const root = tmp();
    mkdirSync(join(home, ".codex", "agents"), { recursive: true });
    writeFileSync(join(home, ".codex", "agents", "other.toml"), "name = \"other\"\n");
    writeFileSync(join(home, ".codex", "config.toml"), "[plugins.\"caveman@c\"]\nenabled = true\n");
    mkdirSync(join(root, ".codex"));
    writeFileSync(join(root, ".codex", "config.toml"), 'model = "m"\n');
    const exec = fakeExec();
    assert.equal(await setupCodex(ui, { home, root, exec }), false);
    assert.ok(exec.calls.includes("codex plugin marketplace add enderdev01/skuizops"));
    assert.ok(exec.calls.includes("codex plugin add skuizops@juicebar"));
    const snap = () => [join(root, ".codex", "config.toml"), ...readdirSync(join(home, ".codex", "agents")).map((f) => join(home, ".codex", "agents", f)), join(home, ".codex", "config.toml")].map((f) => readFileSync(f, "utf8"));
    assert.equal(readdirSync(join(home, ".codex", "agents")).length, 5);
    assert.ok(lines.some((l) => l.includes("/hooks")));
    const before = snap();
    assert.equal(await setupCodex(ui, { home, root, exec }), false);
    assert.ok(exec.calls.includes("codex plugin marketplace upgrade juicebar"));
    assert.deepEqual(snap(), before);

    assert.equal(await uninstallCodex(ui, { home, root, exec }), false);
    assert.ok(exec.calls.includes("codex plugin remove skuizops@juicebar"));
    assert.ok(exec.calls.includes("codex plugin marketplace remove juicebar"));
    assert.deepEqual(readdirSync(join(home, ".codex", "agents")), ["other.toml"]);
    assert.equal(readFileSync(join(root, ".codex", "config.toml"), "utf8"), 'model = "m"\n');
  });

  it("prints a skip line and does not fail when codex is missing", async () => {
    const exec = () => Promise.reject(Object.assign(new Error("nope"), { code: "ENOENT" }));
    lines.length = 0;
    assert.equal(await setupCodex(ui, { home: tmp(), root: tmp(), exec }), false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /not found/);
    const home = tmp();
    assert.equal(await uninstallCodex(ui, { home, root: null, exec }), false);
  });

  it("skips the lemon step outside a git root", async () => {
    lines.length = 0;
    await setupCodex(ui, { home: tmp(), root: null, exec: fakeExec() });
    assert.ok(lines.some((l) => l.includes("not a git repository")));
  });
});
