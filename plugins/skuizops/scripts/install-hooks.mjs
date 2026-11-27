// Install the git hooks and the guard scripts in a project. Run by the human only, through the
// /skuizops:install-hooks command (which the model cannot invoke); the Bash guard blocks agents from running this script.
//   node install-hooks.mjs [dir]   install in the git root of `dir`, or of the current directory when omitted
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./scope.mjs";
import { isNewer } from "./update-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templates = join(here, "..", "templates", "githooks");
const GUARDS = ["branch-guard.mjs", "scope.mjs", "attribution-guard.mjs"];

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const stamp = () => new Date().toISOString().replace(/\D/g, "").replace(/^(\d{8})(\d{6}).*/, "$1-$2");

// What the installer installs: { from, rel (relative to the project root), mode }.
export const sources = () => [
  ...readdirSync(templates).map((name) => ({ from: join(templates, name), rel: `.githooks/${name}`, mode: 0o755 })),
  ...GUARDS.map((name) => ({ from: join(here, name), rel: `scripts/guard/${name}` })),
];

// Returns { root, actions, backups }: one line per action. Plugin-owned copies are updated; a copy the user edited
// is saved as <file>.local-<timestamp> first. Other files are left alone. .githooks/.skuizops.json records what we wrote.
export function installHooks(dir, env = process.env) {
  let root;
  try {
    root = git(resolve(dir.replace(/^~(?=\/|$)/, env.HOME ?? "~")), "rev-parse", "--show-toplevel");
  } catch {
    throw new Error(`${dir} is not inside a git repository.`);
  }
  const actions = [];
  const backups = [];
  const hooks = join(root, ".githooks");
  const guard = join(root, "scripts", "guard");
  mkdirSync(hooks, { recursive: true });
  mkdirSync(guard, { recursive: true });
  const manifestFile = join(hooks, ".skuizops.json");
  let old = {};
  let installedBy;
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    old = manifest.files ?? {};
    installedBy = manifest.version;
  } catch {}
  const { version } = JSON.parse(readFileSync(join(here, "..", ".claude-plugin", "plugin.json"), "utf8"));
  // Never overwrite newer guards with this older plugin's copies.
  if (isNewer(installedBy, version)) {
    throw new Error(`hooks in ${root} were installed by skuizops v${installedBy}, newer than this plugin (v${version}). Update the plugin instead: claude plugin marketplace update juicebar, then claude plugin update skuizops@juicebar, and restart the session.`);
  }
  const files = {};
  const when = stamp();
  const put = (from, to, mode) => {
    const rel = relative(root, to);
    const next = readFileSync(from);
    files[rel] = sha(next);
    let current = null;
    try {
      current = readFileSync(to);
    } catch {}
    if (current && current.equals(next)) {
      actions.push(`${rel} is up to date`);
    } else if (!current) {
      writeFileSync(to, next);
      actions.push(`Installed ${rel}`);
    } else if (sha(current) === old[rel]) {
      writeFileSync(to, next);
      actions.push(`Updated ${rel}`);
    } else {
      // shortcut: without a manifest (installs before 0.11) an old, unedited copy is backed up once too; it cannot be told from an edit.
      const backup = `${to}.local-${when}`;
      copyFileSync(to, backup);
      writeFileSync(to, next);
      backups.push(backup);
      actions.push(`Backed up your edits of ${rel} to ${relative(root, backup)}`);
    }
    if (mode) chmodSync(to, mode);
  };
  for (const { from, rel, mode } of sources()) put(from, join(root, rel), mode);
  let previous = "";
  try {
    previous = git(root, "config", "--local", "core.hooksPath");
  } catch {}
  git(root, "config", "core.hooksPath", ".githooks");
  if (previous && previous !== ".githooks") actions.push(`Replaced the previous hooks path "${previous}"`);
  actions.push("Pointed git at .githooks");
  writeFileSync(manifestFile, `${JSON.stringify({ version, files }, null, 2)}\n`);
  return { root, actions, backups };
}

// One-line hint to commit the setup files that git shows as untracked or modified; "" when none, or not a git repo.
export function commitHint(root, paths) {
  try {
    const shown = git(root, "status", "--porcelain", "--", ...paths)
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3).replace(/^"|"$/g, ""));
    if (!shown.length) return "";
    const branch = git(root, "branch", "--show-current");
    const start = /^(feat|fix|hotfix)\//.test(branch) ? "" : "git switch -c feat/skuizops-setup && ";
    return `Commit the setup on a work branch: ${start}git add ${shown.join(" ")} && git commit -m "chore: add skuizops setup"`;
  } catch {
    return "";
  }
}

export const HOOK_PATHS = [".githooks", "scripts/guard"];

if (isMain(import.meta.url)) {
  try {
    const { root, actions } = installHooks(process.argv[2] || process.cwd());
    const hint = commitHint(root, HOOK_PATHS);
    process.stdout.write(`${actions.join("\n")}\nHooks installed in: ${root}\n${hint ? `${hint}\n` : ""}`);
  } catch (error) {
    process.stderr.write(`skuizops: ${error.message}\n`);
    process.exit(1);
  }
}
