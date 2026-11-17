// Reverses the setup: npx github:enderdev01/skuizops uninstall
// Pure parts are exported and take home/env/exec so tests need no real machine. setup.mjs passes its display helpers in:
// importing setup.mjs from here would wait on itself, because setup.mjs is still running when it loads this file.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { sources } from "../plugins/skuizops/scripts/install-hooks.mjs";
import { real, trustFile } from "../plugins/skuizops/scripts/scope.mjs";

const run = promisify(execFile);
const MARKETPLACE = "juicebar";
const PLUGIN = `skuizops@${MARKETPLACE}`;
const LEMON = "skuizops:lemon";
const BRIEF = new URL("../plugins/skuizops/output-styles/brief.md", import.meta.url);
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const readBytes = (file) => {
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
};
const readSettings = (file) => {
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};
const rmdirIfEmpty = (dir) => {
  try {
    if (!readdirSync(dir).length) rmdirSync(dir);
  } catch {}
};
// Write then rename: a crash mid-write must not truncate the user's settings.
const writeSettings = (file, settings) => {
  writeFileSync(`${file}.skuizops-tmp`, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(`${file}.skuizops-tmp`, file);
};
const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// --- pure steps (tested) ---

// Deletes the hook and guard files the manifest lists, unless the user edited them. Returns { status, text, details }.
export function uninstallHooks(root) {
  const manifestFile = join(root, ".githooks", ".skuizops.json");
  if (!existsSync(manifestFile)) return { status: "skip", text: "no manifest, hooks left alone" };
  let files;
  try {
    files = JSON.parse(readFileSync(manifestFile, "utf8")).files;
    if (!files || typeof files !== "object") throw new Error("no files");
  } catch {
    return { status: "skip", text: "manifest unreadable, hooks left alone" };
  }
  const details = [];
  let removed = 0;
  // Only paths the installer writes are touched, whatever the manifest says.
  for (const { from, rel } of sources()) {
    if (!(rel in files)) continue;
    const current = readBytes(join(root, rel));
    if (!current) continue;
    if ([files[rel], sha(readBytes(from) ?? "")].includes(sha(current))) {
      rmSync(join(root, rel));
      removed++;
    } else details.push(`kept ${rel} (you edited it)`);
  }
  rmSync(manifestFile);
  rmdirIfEmpty(join(root, ".githooks"));
  rmdirIfEmpty(join(root, "scripts", "guard"));
  rmdirIfEmpty(join(root, "scripts"));
  if (!existsSync(join(root, ".githooks"))) {
    try {
      if (git(root, "config", "--local", "core.hooksPath") === ".githooks") {
        git(root, "config", "--local", "--unset", "core.hooksPath");
        details.push("unset core.hooksPath");
      }
    } catch {}
  } else details.push("kept core.hooksPath: .githooks still holds files");
  return { status: "ok", text: `removed ${removed} files`, details };
}

// Removes this project's line from the trust list, every other line untouched. `others` are the projects still trusted.
export function untrust(project, env = process.env) {
  const file = trustFile(env);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return { status: "skip", text: "not trusted", others: [] };
  }
  const target = real(resolve(project));
  const lines = text.split("\n");
  const kept = lines.filter((l) => !(l.trim().startsWith("/") && real(resolve(l.trim())) === target));
  const others = kept.map((l) => l.trim()).filter((l) => l.startsWith("/"));
  if (kept.length === lines.length) return { status: "skip", text: "not trusted", others };
  writeFileSync(`${file}.skuizops-tmp`, kept.join("\n"));
  renameSync(`${file}.skuizops-tmp`, file);
  return { status: "ok", text: "removed from the trust list", others };
}

// Removes "agent" from <root>/.claude/settings.json only when it is skuizops:lemon.
export function removeLemonAgent(root) {
  const file = join(root, ".claude", "settings.json");
  if (!existsSync(file)) return { status: "skip", message: "no .claude/settings.json" };
  const settings = readSettings(file);
  if (!settings) return { status: "fail", message: "fix .claude/settings.json (invalid JSON) and re-run" };
  if (settings.agent !== LEMON) return { status: "skip", message: settings.agent === undefined ? "no agent set" : `kept your agent ${settings.agent}` };
  delete settings.agent;
  writeSettings(file, settings);
  return { status: "ok", message: "removed" };
}

// Removes "outputStyle" only when it is brief, and brief.md only when it is still the plugin's copy.
export function removeOutputStyle(root, source = BRIEF) {
  const file = join(root, ".claude", "settings.json");
  const style = join(root, ".claude", "output-styles", "brief.md");
  let settings = {};
  if (existsSync(file)) {
    settings = readSettings(file);
    if (!settings) return { status: "fail", message: "fix .claude/settings.json (invalid JSON) and re-run" };
  }
  const notes = [];
  if (settings.outputStyle === "brief") {
    delete settings.outputStyle;
    writeSettings(file, settings);
    notes.push("outputStyle removed");
  } else if (settings.outputStyle !== undefined) notes.push(`kept your output style ${settings.outputStyle}`);
  const current = readBytes(style);
  if (current) {
    if (current.equals(readFileSync(source))) {
      rmSync(style);
      rmdirIfEmpty(join(root, ".claude", "output-styles"));
      notes.push("brief.md removed");
    } else notes.push("kept brief.md (you edited it)");
  }
  return { status: notes.some((n) => /removed$/.test(n)) ? "ok" : "skip", message: notes.join(", ") || "nothing to remove" };
}

// Removes extraKnownMarketplaces.juicebar from the user's settings.
export function removeMarketplaceEntry(home) {
  const file = join(home, ".claude", "settings.json");
  if (!existsSync(file)) return { status: "skip", message: "no ~/.claude/settings.json" };
  const settings = readSettings(file);
  if (!settings) return { status: "fail", message: "fix ~/.claude/settings.json (invalid JSON) and re-run" };
  if (!settings.extraKnownMarketplaces?.[MARKETPLACE]) return { status: "skip", message: "no marketplace entry" };
  delete settings.extraKnownMarketplaces[MARKETPLACE];
  if (!Object.keys(settings.extraKnownMarketplaces).length) delete settings.extraKnownMarketplaces;
  writeSettings(file, settings);
  return { status: "ok", message: "removed" };
}

const claudeJson = async (exec, ...args) => JSON.parse((await exec("claude", args)).stdout);

// A missing claude binary is a skip, not a failure: there is nothing of ours to remove through it.
const noClaude = (e) => {
  if (e?.code === "ENOENT") return { status: "skip", message: "Claude Code not found" };
  throw e;
};

// exec(cmd, args) -> Promise, throws on failure.
export async function uninstallPlugin(exec) {
  try {
    if (!(await claudeJson(exec, "plugin", "list", "--json")).some((p) => p.id === PLUGIN)) return { status: "skip", message: "not installed" };
    await exec("claude", ["plugin", "uninstall", PLUGIN]);
    return { status: "ok", message: "removed" };
  } catch (e) {
    return noClaude(e);
  }
}

export async function removeMarketplace(exec) {
  try {
    if (!(await claudeJson(exec, "plugin", "marketplace", "list", "--json")).some((m) => m.name === MARKETPLACE)) return { status: "skip", message: "not added" };
    await exec("claude", ["plugin", "marketplace", "remove", MARKETPLACE]);
    return { status: "ok", message: "removed" };
  } catch (e) {
    return noClaude(e);
  }
}

export const isYes = (answer) => /^(y|yes|s|si|sí)$/i.test(answer.trim());

export const planLines = (project) => [
  `Git hooks: delete the unedited hook and guard files listed in ${project}/.githooks/.skuizops.json, then the manifest, empty folders and core.hooksPath`,
  `Trust: remove ${project} from the trust list`,
  `Project: remove "agent" (if skuizops:lemon) and "outputStyle" (if brief) from ${project}/.claude/settings.json, and the unedited .claude/output-styles/brief.md`,
  `User: remove extraKnownMarketplaces.${MARKETPLACE} from ~/.claude/settings.json`,
  `Claude: claude plugin uninstall ${PLUGIN}, then claude plugin marketplace remove ${MARKETPLACE} (each only if present)`,
  "Left alone: ponytail, engram, unslop, stageshow, Playwright, and your .claude/verification and scripts/control.mjs",
];

const defaultAsk = async (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
};

// ui: { step, out, MARK, dim } from setup.mjs. Returns the exit code.
export async function uninstall({ step, out, MARK, dim }, { cwd = process.cwd(), home = homedir(), env = process.env, exec = (cmd, args) => run(cmd, args, { maxBuffer: 1 << 24 }), isTTY = process.stdin.isTTY, ask = defaultAsk } = {}) {
  let root = null;
  try {
    root = (await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"])).stdout.trim();
  } catch {}
  const project = root ?? cwd;
  out("\nskuizops uninstall\n");
  for (const line of planLines(project)) out(`  ${line}`);
  out("");
  const answer = isTTY ? await ask("Uninstall skuizops? [y/N] ") : "";
  if (!isYes(answer)) {
    out("Nothing was changed.");
    return 0;
  }
  let failed = false;
  const track = (r) => (failed ||= r.status === "fail");
  // Adapts a { status, message } result to what step() shows; a fail throws so step prints the message.
  const asStep = (r) => {
    if (r.status === "fail") throw new Error(r.message);
    return { status: r.status, text: r.message ?? r.text, details: r.details };
  };
  track(await step("Git hooks", async () => (root ? asStep(uninstallHooks(root)) : { status: "skip", text: "not a git repository" })));
  let others = [];
  track(await step("Trust", async () => {
    const r = untrust(project, env);
    others = r.others;
    return asStep(r);
  }));
  track(await step("Lemon orchestrator", async () => asStep(removeLemonAgent(project))));
  track(await step("Output style", async () => asStep(removeOutputStyle(project))));
  track(await step("Marketplace setting", async () => asStep(removeMarketplaceEntry(home))));
  track(await step("Plugin", async () => asStep(await uninstallPlugin(exec))));
  track(await step("Marketplace", async () => asStep(await removeMarketplace(exec))));
  out("");
  if (others.length) {
    out("Other projects are still trusted. Run the uninstall in each to clean their files:");
    for (const o of others) out(dim(`  ${o}`));
  }
  out("Left alone: ponytail, engram, unslop, stageshow, Playwright, and your .claude/verification and scripts/control.mjs.");
  out(failed ? `${MARK.fail} Finished with errors` : `${MARK.ok} Done`);
  out("Restart open Claude sessions.");
  return failed ? 1 : 0;
}
