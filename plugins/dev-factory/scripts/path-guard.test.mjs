import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { editViolation } from "./path-guard.mjs";

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
