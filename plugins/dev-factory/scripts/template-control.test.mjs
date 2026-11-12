// Tests for templates/control.mjs: copy it into a throwaway project and run `doctor --json`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const template = fileURLToPath(new URL("../templates/control.mjs", import.meta.url));
const major = Number(process.versions.node.split(".")[0]);

function doctor(files) {
  const dir = mkdtempSync(join(tmpdir(), "control-"));
  mkdirSync(join(dir, "scripts"));
  copyFileSync(template, join(dir, "scripts", "control.mjs"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const r = spawnSync("node", ["scripts/control.mjs", "doctor", "--json"], { cwd: dir, encoding: "utf8" });
  return JSON.parse(r.stdout).checks.find((c) => c.name.startsWith("node matches"));
}

describe("doctor: node pin", () => {
  it("passes when .nvmrc pins the running major", () => assert.equal(doctor({ ".nvmrc": `v${major}.0.0\n` }).ok, true));
  it("fails when .nvmrc pins another major, and says how to switch", () => {
    const check = doctor({ ".nvmrc": `${major - 2}\n` });
    assert.equal(check.ok, false);
    assert.match(check.fix, new RegExp(`pins Node ${major - 2} .*nvm use`));
  });
  it("reads .node-version", () => assert.equal(doctor({ ".node-version": `${major + 1}` }).ok, false));
  it("reads an exact engines.node range", () =>
    assert.equal(doctor({ "package.json": JSON.stringify({ engines: { node: `^${major - 2}.1.0` } }) }).ok, false));
  it("accepts a newer Node for a >= range", () =>
    assert.equal(doctor({ "package.json": JSON.stringify({ engines: { node: `>=${major - 2}` } }) }).ok, true));
  it("skips the check when nothing pins Node", () => assert.equal(doctor({}), undefined));
  it("skips an alias it cannot compare, like lts/*", () => assert.equal(doctor({ ".nvmrc": "lts/*" }), undefined));
});
