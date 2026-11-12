import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandViolation, editViolation } from "./path-guard.mjs";

const env = { HOME: "/Users/ada" };
const project = "/Users/ada/DEV/app";

describe("editViolation", () => {
  it("blocks the git hooks", () => assert.match(editViolation(`${project}/.githooks/pre-commit`, project, env), /ask the human/));
  it("blocks the copied guard", () => assert.ok(editViolation(`${project}/scripts/guard/branch-guard.mjs`, project, env)));
  it("blocks .git, also nested", () => assert.ok(editViolation(`${project}/sub/.git/config`, project, env)));
  it("blocks a relative path", () => assert.ok(editViolation(".githooks/pre-push", project, env)));
  it("blocks the trust list even outside ~/DEV", () =>
    assert.match(editViolation("/Users/ada/.config/dev-factory/trusted-projects", "/tmp/x", env), /trusted-projects/));
  it("allows normal source files", () => assert.equal(editViolation(`${project}/scripts/control.mjs`, project, env), null));
  it("allows look-alike names", () => assert.equal(editViolation(`${project}/src/.githooks-docs.md`, project, env), null));
  it("blocks case variants (case-insensitive volumes)", () => {
    assert.ok(editViolation(`${project}/.GITHOOKS/pre-commit`, project, env));
    assert.ok(editViolation(`${project}/Scripts/Guard/x.mjs`, project, env));
    assert.ok(editViolation("/Users/ada/.config/Dev-Factory/trusted-projects", project, env));
  });
  it("blocks another project's hooks under ~/DEV", () => assert.ok(editViolation("/Users/ada/DEV/other/.githooks/x", project, env)));
  it("blocks the installed plugins", () => assert.ok(editViolation("/Users/ada/.claude/plugins/cache/zz/dev-factory/9.9.9/scripts/branch-guard.mjs", project, env)));
  it("blocks a symlink that points at a protected folder", () => {
    const home = mkdtempSync(join(tmpdir(), "pg-"));
    const app = join(home, "DEV", "app");
    mkdirSync(join(app, ".githooks"), { recursive: true });
    mkdirSync(join(home, ".config", "dev-factory"), { recursive: true });
    symlinkSync(join(app, ".githooks"), join(app, "hk"));
    symlinkSync(join(home, ".config", "dev-factory"), join(app, "cfg"));
    assert.ok(editViolation(join(app, "hk", "pre-commit"), app, { HOME: home }));
    assert.ok(editViolation(join(app, "cfg", "trusted-projects"), app, { HOME: home }));
  });
  it("ignores projects outside ~/DEV", () => assert.equal(editViolation("/Users/ada/other/.githooks/x", "/Users/ada/other", env), null));
});

describe("hook entry point", () => {
  const script = fileURLToPath(new URL("./path-guard.mjs", import.meta.url));
  const run = (file) =>
    spawnSync("node", [script], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      env: { ...process.env, HOME: "/Users/ada", CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
    });
  it("exits 2 with the reason", () => {
    const r = run(`${project}/.githooks/pre-commit`);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.githooks/);
  });
  it("exits 0 on an allowed file", () => assert.equal(run(`${project}/src/a.ts`).status, 0));
});

describe("editViolation: more protected files", () => {
  for (const file of [".claude/settings.json", ".claude/settings.local.json", ".gitconfig", ".config/git/ignore", ".zshrc", ".zshenv", ".zprofile", ".bashrc", ".bash_profile", ".profile"]) {
    it(`blocks ~/${file} even outside ~/DEV`, () => assert.ok(editViolation(`/Users/ada/${file}`, "/tmp/x", env)));
  }
  it("blocks a project .claude/settings*.json under a scope root only", () => {
    assert.ok(editViolation(`${project}/.claude/settings.json`, project, env));
    assert.ok(editViolation(`${project}/.claude/settings.local.json`, project, env));
    assert.equal(editViolation("/Users/ada/other/.claude/settings.json", "/Users/ada/other", env), null);
  });
  it("allows the feature map", () => assert.equal(editViolation(`${project}/.claude/verification/features/README.md`, project, env), null));
});

describe("commandViolation", () => {
  const home = mkdtempSync(join(tmpdir(), "pg-cmd-"));
  const app = join(home, "DEV", "app");
  const cache = join(home, ".claude", "plugins", "cache", "dev-factory");
  const trust = join(home, ".config", "dev-factory", "trusted-projects");
  mkdirSync(join(app, ".githooks"), { recursive: true });
  mkdirSync(join(app, ".git"), { recursive: true });
  mkdirSync(cache, { recursive: true });
  mkdirSync(join(home, ".config", "dev-factory"), { recursive: true });
  writeFileSync(trust, "");
  const check = (command) => commandViolation(command, { project: app, cwd: app, env: { HOME: home } });

  for (const command of [
    "echo x > .githooks/pre-commit",
    "echo x >> .githooks/pre-commit",
    "echo x >> .git/config",
    "sed -i s/a/b/ .githooks/pre-commit",
    "chmod -x .githooks/pre-commit",
    "cp x .githooks/pre-commit",
    `mkdir -p ${cache}/x`,
    'rm .g""it/config',
    "cd .githooks; rm pre-commit",
    "ls\nrm .githooks/pre-commit",
    "echo $(rm .githooks/pre-commit)",
    "ls & rm .githooks/pre-commit",
    "git checkout HEAD~1 -- .githooks",
    "FOO=1 sudo rm .githooks/pre-commit",
    "echo x >| .githooks/pre-commit",
    "echo x >& .githooks/pre-commit",
    "\\rm .githooks/pre-commit",
    "'rm' .githooks/pre-commit",
    "{ rm .githooks/pre-commit; }",
    "pushd .githooks && rm pre-commit",
    `rm ${home}/.config/dev-factory/trusted-proj*`,
    "rm ~/.config/dev-factory/trusted-proj*",
  ]) it(`blocks: ${JSON.stringify(command)}`, () => assert.ok(check(command)));

  for (const command of [
    `cat ${app}/.githooks/pre-commit`,
    `ls ${app}/.git`,
    `cp ${cache}/templates/control.mjs scripts/control.mjs`,
    `node ${cache}/scripts/x.mjs`,
    'git commit -m "fix .githooks/pre-commit"',
    "git status",
    "grep -r foo --exclude-dir=.git .",
    "echo x > src/a.ts",
  ]) it(`allows: ${command}`, () => assert.equal(check(command), null));

  it("allows a plain cat of the trust list", () => assert.equal(check(`cat ${trust}`), null));
  it("blocks cat of the trust list with a redirection", () => assert.ok(check(`cat ${trust} > x`)));
  it("blocks an interpreter one-liner mentioning the trust list", () =>
    assert.ok(check(`node -e "require('fs').appendFileSync('${trust}','y')"`)));

  describe("entry point `bash`", () => {
    const script = fileURLToPath(new URL("./path-guard.mjs", import.meta.url));
    const outside = mkdtempSync(join(tmpdir(), "pg-out-"));
    const run = (args, payload) =>
      spawnSync("node", [script, ...args], { input: JSON.stringify(payload), env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: outside }, encoding: "utf8" });
    it("exits 2 on a write to the trust list from outside every scope root", () => {
      const r = run(["bash"], { cwd: outside, tool_input: { command: `echo ${outside} >> ${trust}` } });
      assert.equal(r.status, 2, r.stderr);
    });
    it("still handles Edit payloads without the argument", () =>
      assert.equal(run([], { cwd: outside, tool_input: { file_path: trust } }).status, 2));
  });
});
