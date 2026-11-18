import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNewer, message, remoteVersion, run } from "./update-check.mjs";

const HOUR = 3600 * 1000;
const NOW = Date.now();
const MANIFEST = join("plugins", "skuizops", ".claude-plugin", "plugin.json");
const tmp = (name) => mkdtempSync(join(tmpdir(), `${name}-`));

// A fake home whose known_marketplaces.json holds `entry` (none when undefined).
function home(entry) {
  const h = tmp("update-home");
  if (entry) {
    mkdirSync(join(h, ".claude", "plugins"), { recursive: true });
    writeFileSync(join(h, ".claude", "plugins", "known_marketplaces.json"), JSON.stringify({ "juicebar": entry }));
  }
  mkdirSync(join(h, ".claude"), { recursive: true });
  return h;
}
const cacheFile = (h) => join(h, ".claude", "skuizops-update-check.json");
const remote = () => home({ source: { source: "github", repo: "o/n" }, installLocation: "/clone" });
const counter = (version) => {
  const lookup = () => (lookup.calls++, version());
  lookup.calls = 0;
  return lookup;
};

describe("isNewer", () => {
  it("compares dotted versions part by part", () => {
    assert.equal(isNewer("0.14.0", "0.13.0"), true);
    assert.equal(isNewer("0.13.0", "0.14.0"), false);
    assert.equal(isNewer("0.13.0", "0.9.0"), true);
    assert.equal(isNewer("0.9.0", "0.13.0"), false);
    assert.equal(isNewer("1.0", "0.13.0"), true);
  });

  it("equal or garbage is not newer", () => {
    assert.equal(isNewer("0.13.0", "0.13.0"), false);
    assert.equal(isNewer("1.0", "1.0.0"), false);
    for (const bad of [undefined, null, "", "abc", "1.x", "v2"]) {
      assert.equal(isNewer(bad, "0.1.0"), false);
      assert.equal(isNewer("9.9.9", bad), false);
    }
  });
});

describe("update check, codex host", () => {
  it("prints nothing even when claude would print a notice", () => {
    const script = new URL("./update-check.mjs", import.meta.url).pathname;
    const dir = tmp("update-repo");
    mkdirSync(join(dir, "plugins", "skuizops", ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ version: "999.0.0" }));
    const h = home({ source: { source: "directory", path: dir }, installLocation: dir });
    const out = (...args) => spawnSync("node", [script, ...args], { env: { ...process.env, HOME: h }, encoding: "utf8" }).stdout;
    assert.match(out(), /999\.0\.0/);
    assert.equal(out("codex"), "");
  });
});

describe("update check, directory source", () => {
  const repo = (version) => {
    const dir = tmp("update-repo");
    mkdirSync(join(dir, "plugins", "skuizops", ".claude-plugin"), { recursive: true });
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ version }));
    return dir;
  };
  const entry = (dir) => ({ source: { source: "directory", path: dir }, installLocation: dir });

  it("a newer repo version gives the notice with both versions and both commands", () => {
    const out = run("0.13.0", { home: home(entry(repo("0.14.0"))), now: NOW });
    assert.match(out, /0\.14\.0/);
    assert.match(out, /0\.13\.0/);
    assert.match(out, /claude plugin marketplace update juicebar/);
    assert.match(out, /claude plugin update skuizops@juicebar/);
  });

  it("the same version prints nothing", () => assert.equal(run("0.13.0", { home: home(entry(repo("0.13.0"))), now: NOW }), ""));

  it("message names both versions", () => assert.match(message("2.0.0", "1.0.0"), /2\.0\.0.*1\.0\.0/));
});

describe("update check, remote source", () => {
  it("looks up once, caches, and reuses the cache for 24 hours", () => {
    const h = remote();
    const lookup = counter(() => "0.14.0");
    assert.match(run("0.13.0", { home: h, now: NOW, lookup }), /0\.14\.0/);
    assert.equal(lookup.calls, 1);
    assert.deepEqual(JSON.parse(readFileSync(cacheFile(h), "utf8")), { checkedAt: NOW, latest: "0.14.0" });
    assert.match(run("0.13.0", { home: h, now: NOW + 23 * HOUR, lookup }), /0\.14\.0/);
    assert.equal(lookup.calls, 1);
    run("0.13.0", { home: h, now: NOW + 25 * HOUR, lookup });
    assert.equal(lookup.calls, 2);
  });

  it("a failing lookup prints nothing and the attempt is cached", () => {
    const h = remote();
    const lookup = counter(() => {
      throw new Error("offline");
    });
    assert.equal(run("0.13.0", { home: h, now: NOW, lookup }), "");
    assert.deepEqual(JSON.parse(readFileSync(cacheFile(h), "utf8")), { checkedAt: NOW, latest: null });
    assert.equal(run("0.13.0", { home: h, now: NOW + HOUR, lookup }), "");
    assert.equal(lookup.calls, 1);
  });

  it("a corrupt cache counts as no cache", () => {
    const h = remote();
    writeFileSync(cacheFile(h), "not json");
    const lookup = counter(() => "0.14.0");
    assert.match(run("0.13.0", { home: h, now: NOW, lookup }), /0\.14\.0/);
    assert.equal(lookup.calls, 1);
  });

  it("the real lookup reads the version from the clone's origin", () => {
    const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    const origin = tmp("update-origin");
    git(origin, "init", "-q");
    mkdirSync(join(origin, "plugins", "skuizops", ".claude-plugin"), { recursive: true });
    writeFileSync(join(origin, MANIFEST), JSON.stringify({ version: "99.0.0" }));
    git(origin, "add", ".");
    assert.equal(git(origin, "commit", "-q", "-m", "init").status, 0);
    const clone = join(tmp("update-clone"), "c");
    assert.equal(git(origin, "clone", "-q", origin, clone).status, 0);
    assert.equal(remoteVersion(clone), "99.0.0");
  });
});

describe("update check, failures", () => {
  it("a missing known_marketplaces.json prints nothing and writes nothing", () => {
    const h = home();
    assert.equal(run("0.13.0", { home: h, now: NOW }), "");
    assert.equal(existsSync(cacheFile(h)), false);
  });

  it("a marketplace without our entry prints nothing", () => {
    const h = home();
    mkdirSync(join(h, ".claude", "plugins"), { recursive: true });
    writeFileSync(join(h, ".claude", "plugins", "known_marketplaces.json"), "{}");
    assert.equal(run("0.13.0", { home: h, now: NOW }), "");
  });
});

describe("update check hook", () => {
  it("no marketplaces file: nothing printed, exit 0", () => {
    const r = spawnSync("node", [join(import.meta.dirname, "update-check.mjs")], { encoding: "utf8", input: "{}", env: { ...process.env, HOME: tmp("update-empty") } });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});
