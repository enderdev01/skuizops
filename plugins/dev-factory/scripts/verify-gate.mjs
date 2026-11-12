// Stop hook: the agent cannot finish while the project verify is red.
// Exit 2 blocks the stop and feeds the failure back to the agent.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inScope, isMain, isTrusted, projectDir, trustHint } from "./scope.mjs";
import { join, resolve } from "node:path";

// null when verify passed, else the failure text. A timeout counts as a failure.
export function verdict(result) {
  if (result.status === 0) return null;
  if (result.error?.code === "ETIMEDOUT") return "Project verify timed out.";
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n");
}

function main() {
  const input = JSON.parse(readFileSync(0, "utf8") || "{}");

  const cwd = projectDir(input);
  // Hooks only act on projects under the scope roots (~/DEV plus DEV_FACTORY_ROOTS).
  if (!inScope(cwd)) process.exit(0);

  // Outside a git repo, always verify. A clean tree skips only when HEAD was already verified.
  const git = (...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
  const clean = git("status", "--porcelain");
  const isClean = clean.status === 0 && clean.stdout.trim() === "";
  const head = isClean ? git("rev-parse", "HEAD").stdout.trim() : "";
  const marker = isClean && head ? resolve(cwd, git("rev-parse", "--git-path", "dev-factory-verified").stdout.trim()) : "";
  if (marker) {
    try {
      if (readFileSync(marker, "utf8").trim() === head) process.exit(0);
    } catch {}
  }

  // Prefer the project's control CLI; else an npm "verify" script; else nothing to run.
  let command;
  if (existsSync(join(cwd, "scripts", "control.mjs"))) command = ["node", ["scripts/control.mjs", "verify"]];
  else {
    let scripts = {};
    try {
      scripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {};
    } catch {}
    if (scripts.verify) command = ["npm", ["run", "verify", "--silent"]];
  }
  if (!command) process.exit(0);
  // The command is the project's own code: run it only for projects the human trusted.
  if (!isTrusted(cwd)) {
    process.stdout.write(
      `${JSON.stringify({ systemMessage: `dev-factory: verify skipped, this project is not trusted. To trust it, run yourself: ${trustHint(cwd)}` })}\n`,
    );
    process.exit(0);
  }

  // The hook timeout is 300 s: stay below it so a hang is a failure we report, not a kill.
  const failure = verdict(spawnSync(command[0], command[1], { cwd, encoding: "utf8", timeout: 240000 }));
  if (failure === null) {
    if (marker) {
      try {
        writeFileSync(marker, `${head}\n`);
      } catch {}
    }
    process.exit(0);
  }

  // Already blocked once this turn: warn but let it stop, so we never block twice.
  if (input.stop_hook_active) {
    process.stdout.write(`${JSON.stringify({ systemMessage: "dev-factory: project verify is still failing." })}\n`);
    process.exit(0);
  }
  process.stderr.write(
    `Project verify is failing. Fix it before you finish (delegate long logs to fig):\n${failure}`,
  );
  process.exit(2);
}

if (isMain(import.meta.url)) main();
