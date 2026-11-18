// `check.mjs` is what the read-only /skuizops:check command and the SessionStart notice run.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, format, notice } from "./check.mjs";
import { installHooks } from "./install-hooks.mjs";
import { trust } from "./trust.mjs";

const script = fileURLToPath(new URL("./check.mjs", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));

// A project under <home>/DEV with everything configured, plus the user's plugin data.
function sandbox() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "check-")));
  const project = join(home, "DEV", "app");
  const env = { HOME: home };
  mkdirSync(join(project, ".claude", "verification"), { recursive: true });
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  spawnSync("git", ["init", "-q", project]);
  installHooks(project, env);
  trust(project, env);
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ agent: "skuizops:lemon" }));
  writeFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "skuizops@juicebar": [{ scope: "user", version }] } }));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "skuizops@juicebar": true } }));
  const rows = () => check({ project, home, env });
  const row = (name) => rows().find((r) => r.name === name);
  const setAgent = (agent) => writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify({ agent }));
  return { home, project, env, rows, row, setAgent };
}

// Every file under dir with its content, to prove nothing changed.
function snapshot(dir) {
  const out = {};
  for (const entry of readdirSync(dir, { recursive: true })) {
    const file = join(dir, entry);
    out[entry] = statSync(file).isFile() ? readFileSync(file, "utf8") : null;
  }
  return out;
}

describe("check", () => {
  it("passes a well-configured project", () => {
    const s = sandbox();
    assert.deepEqual(s.rows().filter((r) => r.status === "fail"), []);
    assert.match(format(s.row("plugin")), /^ok   plugin \(v\d/);
    assert.equal(format(s.row("effective language")).startsWith("info effective language: "), true);
    const run = spawnSync("node", [script], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: s.project }, encoding: "utf8" });
    assert.equal(run.status, 0, run.stdout);
  });

  it("fails the old default agent with the fix and lists it as a leftover", () => {
    const s = sandbox();
    s.setAgent("dev-factory:lemon");
    assert.match(format(s.row("default agent")), /^FAIL default agent {2}->  .*set "agent": "skuizops:lemon" in \.claude\/settings\.json/);
    assert.match(s.row("old-name leftovers").text, /dev-factory:lemon/);
    const run = spawnSync("node", [script], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: s.project }, encoding: "utf8" });
    assert.equal(run.status, 1);
  });

  it("fails a missing agent, an unknown skuizops agent and invalid JSON", () => {
    const s = sandbox();
    writeFileSync(join(s.project, ".claude", "settings.json"), "{}");
    assert.equal(s.row("default agent").status, "fail");
    s.setAgent("skuizops:nope");
    assert.equal(s.row("default agent").status, "fail");
    writeFileSync(join(s.project, ".claude", "settings.json"), "{ nope");
    assert.equal(s.row("default agent").status, "fail");
  });

  it("only informs about the user's own agent", () => {
    const s = sandbox();
    s.setAgent("mine");
    assert.equal(s.row("default agent").status, "info");
    assert.equal(s.row("old-name leftovers").status, "ok");
  });

  it("fails git hooks when a hook was edited", () => {
    const s = sandbox();
    appendFileSync(join(s.project, ".githooks", "pre-commit"), "# edited\n");
    assert.match(s.row("git hooks").text, /\/skuizops:install-hooks .*pre-commit was edited/);
  });

  it("fails git hooks as outdated when the hook differs from the plugin's but matches the manifest", () => {
    const s = sandbox();
    const manifest = join(s.project, ".githooks", ".skuizops.json");
    const content = "#!/bin/sh\n# older\n";
    writeFileSync(join(s.project, ".githooks", "pre-commit"), content);
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    m.files[".githooks/pre-commit"] = createHash("sha256").update(content).digest("hex");
    writeFileSync(manifest, JSON.stringify(m));
    const r = s.row("git hooks");
    assert.equal(r.status, "fail");
    assert.match(r.text, /\/skuizops:install-hooks .*pre-commit is outdated/);
  });

  it("accepts identical hooks installed by another plugin version, and shows one plugin version", () => {
    const s = sandbox();
    const manifest = join(s.project, ".githooks", ".skuizops.json");
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, "utf8")), version: "0.0.1" }));
    writeFileSync(join(s.home, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "skuizops@juicebar": [{ scope: "user", version: "0.0.1" }] } }));
    const hooks = s.row("git hooks");
    assert.equal(hooks.status, "ok");
    assert.equal(format(hooks), `ok   git hooks (installed by v0.0.1, identical to v${version})`);
    assert.equal(format(s.row("plugin")), `ok   plugin (v${version})`);
    assert.equal(s.row("project guards").status, "ok");
    assert.equal(notice(s.rows()), "");
  });

  it("fails project guards when a copy was edited", () => {
    const s = sandbox();
    appendFileSync(join(s.project, "scripts", "guard", "branch-guard.mjs"), "// edited\n");
    assert.equal(s.row("project guards").status, "fail");
    assert.equal(s.row("git hooks").status, "ok");
  });

  it("lists .githooks/.dev-factory.json as a leftover", () => {
    const s = sandbox();
    writeFileSync(join(s.project, ".githooks", ".dev-factory.json"), "{}");
    assert.match(s.row("old-name leftovers").text, /\.githooks\/\.dev-factory\.json/);
  });

  it("lists the old env keys and user files as leftovers", () => {
    const s = sandbox();
    writeFileSync(join(s.project, ".claude", "settings.json"), JSON.stringify({ agent: "skuizops:lemon", env: { DEV_FACTORY_LANG: "en" } }));
    mkdirSync(join(s.home, ".config", "dev-factory"), { recursive: true });
    const text = s.row("old-name leftovers").text;
    assert.match(text, /env\.DEV_FACTORY_LANG/);
    assert.match(text, /\.config\/dev-factory/);
  });

  it("fails an untrusted project and a plugin that is not installed", () => {
    const s = sandbox();
    writeFileSync(join(s.home, ".config", "skuizops", "trusted-projects"), "");
    writeFileSync(join(s.home, ".claude", "plugins", "installed_plugins.json"), "{}");
    assert.equal(s.row("trusted project").text, "/skuizops:trust");
    assert.match(s.row("plugin").text, /npx github:enderdev01\/skuizops/);
  });

  it("reports FAIL for hooks outside a git repository and without a control script", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "check-bare-")));
    const rows = check({ project: dir, home: dir, env: { HOME: dir } });
    assert.equal(rows.find((r) => r.name === "git hooks").status, "fail");
    assert.equal(rows.find((r) => r.name === "verification map").status, "info");
  });

  it("shows the language and the verification map", () => {
    const s = sandbox();
    assert.equal(check({ project: s.project, home: s.home, env: { HOME: s.home, SKUIZOPS_LANG: "en" } }).find((r) => r.name === "effective language").text, "en");
    assert.equal(s.row("effective language").text, "es (default)");
  });

  it("modifies no file", () => {
    const s = sandbox();
    s.setAgent("dev-factory:lemon");
    const before = snapshot(s.home);
    s.rows();
    spawnSync("node", [script], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: s.project } });
    spawnSync("node", [script, "notice"], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: s.project }, input: "{}" });
    assert.deepEqual(snapshot(s.home), before);
  });
});

describe("check notice", () => {
  const run = (s) => spawnSync("node", [script, "notice"], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: s.project }, input: "{}", encoding: "utf8" });

  it("prints one line when a check fails", () => {
    const s = sandbox();
    s.setAgent("dev-factory:lemon");
    const r = run(s);
    assert.equal(r.status, 0);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    assert.match(r.stdout, /\/skuizops:check/);
  });

  it("prints nothing when all pass, and when the project is out of scope", () => {
    const s = sandbox();
    assert.deepEqual([run(s).status, run(s).stdout], [0, ""]);
    s.setAgent("dev-factory:lemon");
    const out = realpathSync(mkdtempSync(join(tmpdir(), "check-out-")));
    const r = spawnSync("node", [script, "notice"], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: out }, input: "{}", encoding: "utf8" });
    assert.deepEqual([r.status, r.stdout], [0, ""]);
  });

  it("codex host skips the Claude-only checks but keeps trust", () => {
    const s = sandbox();
    rmSync(join(s.home, ".claude"), { recursive: true });
    rmSync(join(s.project, ".claude", "settings.json"));
    const rows = check({ project: s.project, home: s.home, env: s.env, host: "codex" });
    assert.deepEqual(rows.filter((r) => r.status === "fail"), []);
    assert.deepEqual(rows.filter((r) => ["plugin", "default agent"].includes(r.name)), []);
    assert.equal(check({ project: s.project, home: s.home, env: s.env }).find((r) => r.name === "plugin").status, "fail");
    const codex = (project) => spawnSync("node", [script, "notice", "codex"], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: project }, input: "{}", encoding: "utf8" });
    assert.equal(codex(s.project).stdout, "");
    rmSync(join(s.home, ".config"), { recursive: true, force: true });
    assert.match(codex(s.project).stdout, /trusted project/);
  });

  it("informs and says to carry on, never to stop", () => {
    const s = sandbox();
    s.setAgent("dev-factory:lemon");
    const text = run(s).stdout;
    assert.match(text, /setup is incomplete \(default agent, old-name leftovers\)/);
    assert.match(text, /carry on/);
    assert.doesNotMatch(text, /Do not change anything/);
  });

  it("is empty for rows without a failure", () => assert.equal(notice([{ status: "ok", name: "x" }, { status: "info", name: "y", text: "z" }]), ""));
});

describe("linked git worktree", () => {
  // The manifest stays untracked (as in real projects); guards and hooks are committed, so the worktree has them.
  function withWorktree({ trusted }) {
    const s = sandbox();
    const g = (...args) => spawnSync("git", ["-C", s.project, "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
    appendFileSync(join(s.project, ".git", "info", "exclude"), ".githooks/.skuizops.json\n.claude/verification\n");
    g("add", "-A");
    g("commit", "-q", "-m", "init");
    const worktree = join(s.home, "DEV", "app-wt");
    assert.equal(g("worktree", "add", "-q", worktree, "-b", "feat/x").status, 0);
    if (!trusted) writeFileSync(join(s.home, ".config", "skuizops", "trusted-projects"), "");
    const run = (dir) => spawnSync("node", [script, "notice"], { env: { ...process.env, HOME: s.home, CLAUDE_PROJECT_DIR: dir }, input: "{}", encoding: "utf8" });
    return { s, worktree, run };
  }

  it("reads the main worktree's manifest but does not inherit its trust", () => {
    const { s, worktree, run } = withWorktree({ trusted: true });
    assert.equal(run(s.project).stdout, "");
    const rows = check({ project: worktree, home: s.home, env: s.env });
    assert.equal(rows.find((r) => r.name === "git hooks").status, "ok");
    assert.equal(rows.find((r) => r.name === "project guards").status, "ok");
    assert.equal(rows.find((r) => r.name === "trusted project").status, "fail");
    assert.doesNotMatch(run(worktree).stdout, /manifest/);
  });

  it("still reports a worktree of an untrusted repo", () => {
    const { worktree, run } = withWorktree({ trusted: false });
    assert.match(run(worktree).stdout, /trusted project/);
  });
});
