// Update notice: tells the orchestrator when a newer dev-factory is published than the installed one. Never blocks;
// up to date, offline or any error prints nothing.
//   node update-check.mjs    Claude Code SessionStart hook
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isMain } from "./scope.mjs";

const MARKETPLACE = "factory-marketplace";
const PLUGIN = "dev-factory";
const MANIFEST = `plugins/${PLUGIN}/.claude-plugin/plugin.json`;
const DAY_MS = 24 * 60 * 60 * 1000;

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

// True when `latest` is a higher dotted numeric version than `installed`; anything non-numeric is "not newer".
export function isNewer(latest, installed) {
  const parts = (v) => (/^\d+(\.\d+)*$/.test(v ?? "") ? v.split(".").map(Number) : null);
  const [a, b] = [parts(latest), parts(installed)];
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const [x, y] = [a[i] ?? 0, b[i] ?? 0];
    if (x !== y) return x > y;
  }
  return false;
}

export function message(latest, installed) {
  return `dev-factory: version ${latest} is available and this session runs ${installed}. Tell the human both versions and ask whether to update. On a yes, run \`claude plugin marketplace update ${MARKETPLACE}\` and then \`claude plugin update ${PLUGIN}@${MARKETPLACE}\`. Sessions already open keep the old version until they are restarted.`;
}

// shortcut: reads the remote's default branch, upgrade to the pinned ref when a marketplace is pinned to one.
export function remoteVersion(installLocation) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  execFileSync("git", ["-C", installLocation, "fetch", "--quiet", "origin", "HEAD"], { env, timeout: 5000, stdio: "ignore" });
  const show = execFileSync("git", ["-C", installLocation, "show", `FETCH_HEAD:${MANIFEST}`], { env, encoding: "utf8" });
  return JSON.parse(show).version;
}

// Returns the notice, or "" when there is nothing to say. `lookup(installLocation)` returns the latest version or throws.
export function run(installed, { home = homedir(), now = Date.now(), lookup = remoteVersion } = {}) {
  let entry;
  try {
    entry = readJson(join(home, ".claude", "plugins", "known_marketplaces.json"))[MARKETPLACE];
  } catch {}
  if (!entry) return "";
  let latest;
  if (entry.source?.source === "directory") latest = readJson(join(entry.source.path, MANIFEST)).version;
  else {
    const cache = join(home, ".claude", "dev-factory-update-check.json");
    let cached;
    try {
      cached = readJson(cache);
    } catch {}
    if (cached && now - cached.checkedAt < DAY_MS) latest = cached.latest;
    else {
      try {
        latest = lookup(entry.installLocation);
      } catch {
        latest = null;
      }
      writeFileSync(cache, JSON.stringify({ checkedAt: now, latest: latest ?? null }));
    }
  }
  return isNewer(latest, installed) ? message(latest, installed) : "";
}

function main() {
  try {
    const installed = readJson(new URL("../.claude-plugin/plugin.json", import.meta.url)).version;
    const text = run(installed);
    if (text) process.stdout.write(`${text}\n`);
  } catch {}
}

if (isMain(import.meta.url)) main();
