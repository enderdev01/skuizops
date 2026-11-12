// The Stop gate runs the project's own code only when the human trusted the project.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const gate = fileURLToPath(new URL("./verify-gate.mjs", import.meta.url));

function setup(trusted) {
  const home = mkdtempSync(join(tmpdir(), "gate-"));
  const project = join(home, "DEV", "app");
  mkdirSync(join(project, "scripts"), { recursive: true });
  writeFileSync(join(project, "scripts", "control.mjs"), 'console.log("ran"); process.exit(1);\n');
  if (trusted) {
    mkdirSync(join(home, ".config", "dev-factory"), { recursive: true });
    writeFileSync(join(home, ".config", "dev-factory", "trusted-projects"), `${project}\n`);
  }
  // Not a git repo, so the gate always verifies.
  return spawnSync("node", [gate], {
    input: "{}",
    env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: project, DEV_FACTORY_ROOTS: "" },
    encoding: "utf8",
  });
}

describe("verify gate trust", () => {
  it("does not run an untrusted project's code and tells the human how to trust it", () => {
    const r = setup(false);
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout + r.stderr, /\bran\b/);
    assert.match(JSON.parse(r.stdout).systemMessage, /not trusted.*trusted-projects/);
  });
  it("runs a trusted project's verify and blocks on failure", () => {
    const r = setup(true);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Project verify is failing[\s\S]*ran/);
  });
});
