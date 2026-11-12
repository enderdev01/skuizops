// Where the plugin's Claude Code hooks are active. The plugin is installed for the whole user,
// but its hooks only act on projects under these roots (default ~/DEV).
// Override with DEV_FACTORY_ROOTS, a ":"-separated list of absolute paths.
import { realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function scopeRoots(env = process.env) {
  const configured = env.DEV_FACTORY_ROOTS?.split(delimiter).filter(Boolean);
  return (configured?.length ? configured : [join(env.HOME ?? "", "DEV")]).map((root) => resolve(root));
}

export function inScope(dir, env = process.env) {
  if (!dir) return false;
  const target = resolve(dir);
  return scopeRoots(env).some((root) => target === root || target.startsWith(`${root}/`));
}

// The project directory a hook is running for.
export function projectDir(input = {}) {
  return process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
}

// True when the module at `metaUrl` is the script node was started with.
// Both paths are resolved through symlinks: comparing raw paths made scripts silently skip
// their entry point (and the branch guard fail open) when launched via a symlinked path.
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}
