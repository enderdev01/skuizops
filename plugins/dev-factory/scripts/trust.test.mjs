// `trust.mjs` is what the human-only /dev-factory:trust command runs to add a project to the trust list.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isTrusted, trustFile } from "./scope.mjs";
import { commandViolation } from "./path-guard.mjs";
import { trust } from "./trust.mjs";

const script = fileURLToPath(new URL("./trust.mjs", import.meta.url));

function sandbox() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "trust-cmd-")));
  const app = join(home, "DEV", "app");
  mkdirSync(app, { recursive: true });
  const env = { HOME: home };
  const lines = () => readFileSync(trustFile(env), "utf8").split("\n").filter(Boolean);
  return { home, app, env, lines };
}

describe("trust", () => {
  it("creates the list and trusts the project", () => {
    const s = sandbox();
    assert.deepEqual(trust(s.app, s.env), { added: true, dir: s.app });
    assert.deepEqual(s.lines(), [s.app]);
    assert.equal(isTrusted(s.app, s.env), true);
  });

  it("adds a project only once", () => {
    const s = sandbox();
    trust(s.app, s.env);
    assert.deepEqual(trust(s.app, s.env), { added: false, dir: s.app });
    assert.deepEqual(s.lines(), [s.app]);
  });

  it("stores the real path of a symlinked project", () => {
    const s = sandbox();
    const link = join(s.home, "link");
    symlinkSync(s.app, link);
    assert.equal(trust(link, s.env).dir, s.app);
    assert.deepEqual(s.lines(), [s.app]);
  });

  it("keeps existing entries, even when the file has no final newline", () => {
    const s = sandbox();
    mkdirSync(join(s.home, ".config", "dev-factory"), { recursive: true });
    writeFileSync(trustFile(s.env), "/work/other");
    trust(s.app, s.env);
    assert.deepEqual(s.lines(), ["/work/other", s.app]);
  });

  it("rejects a path that is not an existing directory", () => {
    const s = sandbox();
    writeFileSync(join(s.home, "file.txt"), "");
    assert.throws(() => trust(join(s.home, "missing"), s.env), /not a directory/);
    assert.throws(() => trust(join(s.home, "file.txt"), s.env), /not a directory/);
  });

  it("rejects a directory name containing a newline", () => {
    const s = sandbox();
    const odd = join(s.home, "a\nb");
    mkdirSync(odd);
    assert.throws(() => trust(odd, s.env), /newline/);
  });
});

describe("trust.mjs entry point", () => {
  const run = (s, args, extra = {}) =>
    spawnSync("node", [script, ...args], { cwd: s.app, encoding: "utf8", env: { PATH: process.env.PATH, HOME: s.home, ...extra } });

  it("trusts the directory given as argument and prints the list", () => {
    const s = sandbox();
    const r = run(s, [s.app]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Trusted/);
    assert.ok(r.stdout.includes(s.app));
    assert.deepEqual(s.lines(), [s.app]);
  });

  it("defaults to the project directory of the session", () => {
    const s = sandbox();
    assert.equal(run(s, [], { CLAUDE_PROJECT_DIR: s.app }).status, 0);
    assert.deepEqual(s.lines(), [s.app]);
  });

  it("treats an empty argument as no argument, and accepts spaces and a leading ~", () => {
    const s = sandbox();
    assert.equal(run(s, [""], { CLAUDE_PROJECT_DIR: s.app }).status, 0);
    const spaced = join(s.home, "DEV", "my app");
    mkdirSync(spaced);
    assert.equal(run(s, ["~/DEV/my app"]).status, 0);
    assert.deepEqual(s.lines(), [s.app, spaced]);
  });

  it("fails without changing the list for a missing directory", () => {
    const s = sandbox();
    const r = run(s, [join(s.home, "missing")]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not a directory/);
    assert.throws(() => s.lines());
  });
});

describe("agents cannot run trust.mjs", () => {
  const check = (command) => commandViolation(command, { project: "/tmp", cwd: "/tmp", env: { HOME: "/Users/ada" } });
  it("blocks running it from a shell command", () => {
    assert.ok(check("node /plugins/dev-factory/scripts/trust.mjs"));
    assert.ok(check('node "$CLAUDE_PLUGIN_ROOT/scripts/trust.mjs" /work/app'));
  });
  it("blocks a name spliced with quotes or backslashes, which the shell reads as the same name", () => {
    assert.ok(check("node /plugins/dev-factory/scripts/tru\\st.mjs"));
    assert.ok(check('node /plugins/dev-factory/scripts/tru"st".mjs'));
    assert.ok(check("node /plugins/dev-factory/scripts/tru''st.m\\js"));
  });
  it("allows reading it", () => assert.equal(check("cat /plugins/dev-factory/scripts/trust.mjs"), null));
});
