// Add a project to the trust list. Run by the human only, through the /dev-factory:trust command
// (which the model cannot invoke); the Bash guard blocks agents from running this script.
//   node trust.mjs [dir]   trust `dir`, or the session's project directory when omitted
import { appendFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isMain, isTrusted, projectDir, real, trustFile } from "./scope.mjs";

// Returns { added, dir }: `dir` is the real path that is now trusted, `added` is false when it already was.
export function trust(dir, env = process.env) {
  if (dir.includes("\n")) throw new Error("the directory name contains a newline and cannot be trusted: rename it.");
  // The command passes its argument quoted, so the shell does not expand a leading `~`.
  const target = real(resolve(dir.replace(/^~(?=\/|$)/, env.HOME ?? "~")));
  if (!statSync(target, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`${target} is not a directory.`);
  if (isTrusted(target, env)) return { added: false, dir: target };
  const file = trustFile(env);
  mkdirSync(dirname(file), { recursive: true });
  let current = "";
  try {
    current = readFileSync(file, "utf8");
  } catch {}
  appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}${target}\n`);
  return { added: true, dir: target };
}

if (isMain(import.meta.url)) {
  try {
    const { added, dir } = trust(process.argv[2] || projectDir());
    const list = readFileSync(trustFile(), "utf8").split("\n").filter((l) => l.trim().startsWith("/"));
    process.stdout.write(`${added ? "Trusted" : "Already trusted"}: ${dir}\nTrusted projects:\n${list.map((l) => `  ${l}`).join("\n")}\n`);
  } catch (error) {
    process.stderr.write(`dev-factory: ${error.message}\n`);
    process.exit(1);
  }
}
