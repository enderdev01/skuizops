// Install the git hooks and the guard scripts in a project. Run by the human only, through the
// /dev-factory:install-hooks command (which the model cannot invoke); the Bash guard blocks agents from running this script.
//   node install-hooks.mjs [dir]   install in the git root of `dir`, or of the current directory when omitted
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./scope.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templates = join(here, "..", "templates", "githooks");
const GUARDS = ["branch-guard.mjs", "scope.mjs", "attribution-guard.mjs"];

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const stamp = () => new Date().toISOString().replace(/\D/g, "").replace(/^(\d{8})(\d{6}).*/, "$1-$2");

// Returns { root, actions, backups }: one line per action. Plugin-owned copies are updated; a copy the user edited
// is saved as <file>.local-<timestamp> first. Other files are left alone. .githooks/.dev-factory.json records what we wrote.
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
  const manifestFile = join(hooks, ".dev-factory.json");
  let old = {};
  try {
    old = JSON.parse(readFileSync(manifestFile, "utf8")).files ?? {};
  } catch {}
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
  for (const name of readdirSync(templates)) put(join(templates, name), join(hooks, name), 0o755);
  for (const name of GUARDS) put(join(here, name), join(guard, name));
  let previous = "";
  try {
    previous = git(root, "config", "--local", "core.hooksPath");
  } catch {}
  git(root, "config", "core.hooksPath", ".githooks");
  if (previous && previous !== ".githooks") actions.push(`Replaced the previous hooks path "${previous}"`);
  actions.push("Pointed git at .githooks");
  const { version } = JSON.parse(readFileSync(join(here, "..", ".claude-plugin", "plugin.json"), "utf8"));
  writeFileSync(manifestFile, `${JSON.stringify({ version, files }, null, 2)}\n`);
  return { root, actions, backups };
}

if (isMain(import.meta.url)) {
  try {
    const { root, actions } = installHooks(process.argv[2] || process.cwd());
    process.stdout.write(`${actions.join("\n")}\nHooks installed in: ${root}\n`);
  } catch (error) {
    process.stderr.write(`dev-factory: ${error.message}\n`);
    process.exit(1);
  }
}
