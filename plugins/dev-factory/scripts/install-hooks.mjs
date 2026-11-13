// Install the git hooks and the guard scripts in a project. Run by the human only, through the
// /dev-factory:install-hooks command (which the model cannot invoke); the Bash guard blocks agents from running this script.
//   node install-hooks.mjs [dir]   install in the git root of `dir`, or of the current directory when omitted
import { chmodSync, copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./scope.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templates = join(here, "..", "templates", "githooks");
const GUARDS = ["branch-guard.mjs", "scope.mjs", "attribution-guard.mjs"];

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// Returns { root, actions }: one line per action. Overwrites plugin-owned copies, leaves other files alone.
export function installHooks(dir, env = process.env) {
  let root;
  try {
    root = git(resolve(dir.replace(/^~(?=\/|$)/, env.HOME ?? "~")), "rev-parse", "--show-toplevel");
  } catch {
    throw new Error(`${dir} is not inside a git repository.`);
  }
  const actions = [];
  const hooks = join(root, ".githooks");
  mkdirSync(hooks, { recursive: true });
  for (const name of readdirSync(templates)) {
    copyFileSync(join(templates, name), join(hooks, name));
    chmodSync(join(hooks, name), 0o755);
    actions.push(`Installed .githooks/${name}`);
  }
  const guard = join(root, "scripts", "guard");
  mkdirSync(guard, { recursive: true });
  for (const name of GUARDS) {
    copyFileSync(join(here, name), join(guard, name));
    actions.push(`Installed scripts/guard/${name}`);
  }
  let previous = "";
  try {
    previous = git(root, "config", "--local", "core.hooksPath");
  } catch {}
  git(root, "config", "core.hooksPath", ".githooks");
  if (previous && previous !== ".githooks") actions.push(`Replaced the previous hooks path "${previous}"`);
  actions.push("Pointed git at .githooks");
  return { root, actions };
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
