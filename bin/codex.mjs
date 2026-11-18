// OpenAI Codex CLI side of the setup and uninstall. Every function takes home/root/exec injected, so tests never touch a real ~/.codex.
// exec(cmd, args) -> Promise<{ stdout }>, throws on failure. ui: { step, out, MARK, dim } from setup.mjs (importing it from here would deadlock).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKETPLACE = "juicebar";
const PLUGIN = `skuizops@${MARKETPLACE}`;
const REPO = "enderdev01/skuizops";
const AGENTS = ["kiwi", "fig", "mango", "cherry"];
const AGENTS_DIR = new URL("../plugins/skuizops/agents/", import.meta.url);
const BEGIN = "# skuizops:lemon begin";
const END = "# skuizops:lemon end";

export const PREAMBLE =
  "You run inside OpenAI Codex CLI. Claude Code tool names in these instructions map to Codex tools: Bash -> your shell tool, Edit/Write -> apply_patch, Read/Grep/Glob -> shell reads (rg, sed). Tools that only exist in Claude Code (Agent, TaskStop, ToolSearch, mcp__claude-in-chrome__*) are unavailable: skip those steps and say so in your report.";
const LEMON_PREAMBLE = `${PREAMBLE} Delegate to the subagents kiwi, fig, mango and cherry by name; there is no model override per call.`;

// --- pure helpers (tested) ---

// Claude agent markdown -> { name, description, model, body }. Frontmatter is flat `key: value` lines.
export function parseAgent(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error("agent file has no frontmatter");
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { name: meta.name, description: meta.description ?? "", model: meta.model, body: m[2].trim() };
}

export const codexModel = (claudeModel) => ({ haiku: "gpt-6.1-terra", sonnet: "gpt-6.2-sol" })[claudeModel];

// Literal multi-line string when possible, else a basic one with \ and " escaped.
export const tomlMultiline = (s) => (s.includes("'''") ? `"""\n${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}\n"""` : `'''\n${s}\n'''`);

export function agentToml(agent) {
  const model = codexModel(agent.model);
  return [
    `name = ${JSON.stringify(agent.name)}`,
    `description = ${JSON.stringify(agent.description)}`,
    ...(model ? [`model = ${JSON.stringify(model)}`] : []),
    `developer_instructions = ${tomlMultiline(`${PREAMBLE}\n\n${agent.body}`)}`,
    "",
  ].join("\n");
}

export const lemonBlock = (body) => `${BEGIN}\ndeveloper_instructions = ${tomlMultiline(`${LEMON_PREAMBLE}\n\n${body}`)}\n${END}\n`;

const blockRe = new RegExp(`${BEGIN}\\n[\\s\\S]*?${END}\\n(\\n?)`);

// --- file steps (tested) ---

export function writeAgents(home, source = AGENTS_DIR) {
  const dir = join(home, ".codex", "agents");
  mkdirSync(dir, { recursive: true });
  let changed = 0;
  for (const name of AGENTS) {
    const toml = agentToml(parseAgent(readFileSync(new URL(`${name}.md`, source), "utf8")));
    const file = join(dir, `skuizops-${name}.toml`);
    if (existsSync(file) && readFileSync(file, "utf8") === toml) continue;
    writeFileSync(file, toml);
    changed++;
  }
  return { status: changed ? "ok" : "skip", message: changed ? `wrote ${changed} agents` : "already up to date" };
}

export function removeAgents(home) {
  const dir = join(home, ".codex", "agents");
  if (!existsSync(dir)) return { status: "skip", message: "no agents" };
  const ours = readdirSync(dir).filter((f) => /^skuizops-.*\.toml$/.test(f));
  for (const f of ours) rmSync(join(dir, f));
  try {
    if (!readdirSync(dir).length) rmdirSync(dir);
  } catch {}
  return ours.length ? { status: "ok", message: `removed ${ours.length} agents` } : { status: "skip", message: "no agents" };
}

// Top-level developer_instructions must sit before the first [table], so the block is prepended, never appended.
export function setLemonCodex(root, source = new URL("lemon.md", AGENTS_DIR)) {
  const file = join(root, ".codex", "config.toml");
  const block = lemonBlock(parseAgent(readFileSync(source, "utf8")).body);
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const rest = text.replace(blockRe, "");
  const topLevel = rest.split(/^\s*\[/m)[0];
  if (/^\s*developer_instructions\s*=/m.test(topLevel)) return { status: "skip", message: "kept your developer_instructions" };
  const next = blockRe.test(text) ? text.replace(blockRe, (_, gap) => block + gap) : `${block}${rest ? "\n" : ""}${rest}`;
  if (next === text) return { status: "skip", message: "already set" };
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(file, next);
  return { status: "ok", message: "set" };
}

export function removeLemonCodex(root) {
  const file = join(root, ".codex", "config.toml");
  if (!existsSync(file)) return { status: "skip", message: "no .codex/config.toml" };
  const text = readFileSync(file, "utf8");
  if (!blockRe.test(text)) return { status: "skip", message: "no lemon block" };
  const rest = text.replace(blockRe, "");
  if (rest.trim()) writeFileSync(file, rest);
  else {
    rmSync(file);
    try {
      if (!readdirSync(join(root, ".codex")).length) rmdirSync(join(root, ".codex"));
    } catch {}
  }
  return { status: "ok", message: "removed" };
}

// `codex plugin add` normally writes the enabled table itself; append it only when it is missing. Never rewrites the user's TOML.
export function ensurePluginEnabled(home) {
  const file = join(home, ".codex", "config.toml");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.includes(`[plugins."${PLUGIN}"]`)) return false;
  mkdirSync(join(home, ".codex"), { recursive: true });
  appendFileSync(file, `${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}[plugins."${PLUGIN}"]\nenabled = true\n`);
  return true;
}

// Codex loads <project>/.codex/config.toml only when ~/.codex/config.toml lists that exact path as trusted. Appends only; a table the user wrote is never touched.
const TRUST_NOTE = "# skuizops: trusted so Codex loads this project's .codex/config.toml";
const trustTable = (root) => `[projects.${JSON.stringify(root)}]`;
// TOML dotted key ("projects" . '/p' ...) -> decoded parts, or null when it does not parse.
const KEY_TOKEN = String.raw`"(?:[^"\\]|\\.)*"|'[^']*'|[\w-]+`;
function keyParts(s) {
  const re = new RegExp(String.raw`\s*(${KEY_TOKEN})\s*(\.|$)`, "y");
  const parts = [];
  for (let m; parts.length === 0 || re.lastIndex < s.length; ) {
    if (!(m = re.exec(s))) return null;
    const tok = m[1];
    try {
      parts.push(tok[0] === '"' ? JSON.parse(tok) : tok[0] === "'" ? tok.slice(1, -1) : tok);
    } catch {
      return null;
    }
    if (!m[2]) break;
  }
  return parts;
}
// True when config text already defines projects.<root> in any TOML form: [projects."r"], [projects.'r'], spaced headers,
// `"r" = {...}` under [projects], or a dotted key projects."r".x = ... Comment lines are ignored.
// shortcut: a `projects = { "r" = ... }` top-level inline table and header-like lines inside multi-line strings are not recognised.
export function hasProjectTrust(text, root) {
  let table = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const header = /^\s*\[(?!\[)(.*?)\]\s*(?:#.*)?$/.exec(line);
    if (header) {
      table = keyParts(header[1]) ?? [];
      if (table[0] === "projects" && table[1] === root && table.length === 2) return true;
      continue;
    }
    const kv = new RegExp(String.raw`^\s*((?:(?:${KEY_TOKEN})\s*\.?\s*)+)=`).exec(line);
    const full = kv && keyParts(kv[1].trim());
    if (full && [...table, ...full][0] === "projects" && [...table, ...full][1] === root) return true;
  }
  return false;
}
// Ensure adds exactly one "\n" before its note and remove strips exactly one, so the round trip restores any original bytes,
// with or without a trailing newline.
export function ensureCodexProjectTrust(home, root) {
  const file = join(home, ".codex", "config.toml");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (hasProjectTrust(text, root)) return { status: "skip", message: "already trusted" };
  mkdirSync(join(home, ".codex"), { recursive: true });
  appendFileSync(file, `\n${TRUST_NOTE}\n${trustTable(root)}\ntrust_level = "trusted"\n`);
  return { status: "ok", message: `trusted ${root} in ~/.codex/config.toml` };
}

// Removes only the three lines ensureCodexProjectTrust appended, and only when they are exactly ours.
export function removeCodexProjectTrust(home, root) {
  const file = join(home, ".codex", "config.toml");
  const ours = `${TRUST_NOTE}\n${trustTable(root)}\ntrust_level = "trusted"\n`;
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const at = text.indexOf(ours);
  if (at < 0) return { status: "skip", message: "no skuizops trust entry" };
  const from = at > 0 && text[at - 1] === "\n" ? at - 1 : at;
  writeFileSync(file, text.slice(0, from) + text.slice(at + ours.length));
  return { status: "ok", message: `removed trust of ${root}` };
}

// codex plugin marketplace list --json -> { marketplaces: [{ name }] }; codex plugin list --json -> { installed: [{ pluginId, version }] }
export const pickCodexMarketplaceAction = (json) => (json.marketplaces?.some((m) => m.name === MARKETPLACE) ? "upgrade" : "add");
export const isCodexPluginInstalled = (json) => !!json.installed?.some((p) => p.pluginId === PLUGIN);

const hasCodex = async (exec) => {
  try {
    await exec("codex", ["--version"]);
    return true;
  } catch {
    return false;
  }
};
const codexJson = async (exec, ...args) => JSON.parse((await exec("codex", [...args, "--json"])).stdout);
const asStep = (r) => {
  if (r.status === "fail") throw new Error(r.message);
  return { status: r.status, text: r.message };
};

// Returns true when a step failed.
export async function setupCodex({ step, out, MARK, dim }, { home, root, exec }) {
  if (!(await hasCodex(exec))) {
    out(`${MARK.skip} Codex ${dim("CLI not found, skipped")}`);
    return false;
  }
  let failed = false;
  const track = async (label, fn) => (failed ||= (await step(label, fn)).status === "fail");
  await track("Codex marketplace", async () => {
    const action = pickCodexMarketplaceAction(await codexJson(exec, "plugin", "marketplace", "list"));
    await (action === "add" ? exec("codex", ["plugin", "marketplace", "add", REPO]) : exec("codex", ["plugin", "marketplace", "upgrade", MARKETPLACE]));
    return { status: "ok", text: action === "add" ? "added" : "upgraded" };
  });
  await track("Codex plugin", async () => {
    if (isCodexPluginInstalled(await codexJson(exec, "plugin", "list"))) return { status: "skip", text: "already installed" };
    await exec("codex", ["plugin", "add", PLUGIN]);
    ensurePluginEnabled(home);
    return { status: "ok", text: "installed" };
  });
  await track("Codex agents", async () => asStep(writeAgents(home)));
  await track("Codex lemon orchestrator", async () => (root ? asStep(setLemonCodex(root)) : { status: "skip", text: "not a git repository" }));
  await track("Codex project trust", async () => (root ? asStep(ensureCodexProjectTrust(home, root)) : { status: "skip", text: "not a git repository" }));
  out(dim("  Codex: open codex in this project and run /hooks to review and trust the skuizops hooks."));
  return failed;
}

// Returns true when a step failed. Quiet (no output) when codex is absent, but the files of ours are still removed.
export async function uninstallCodex({ step, out, MARK, dim }, { home, root, exec }) {
  let failed = false;
  const track = async (label, fn) => (failed ||= (await step(label, fn)).status === "fail");
  await track("Codex agents", async () => asStep(removeAgents(home)));
  await track("Codex lemon orchestrator", async () => (root ? asStep(removeLemonCodex(root)) : { status: "skip", text: "not a git repository" }));
  await track("Codex project trust", async () => (root ? asStep(removeCodexProjectTrust(home, root)) : { status: "skip", text: "not a git repository" }));
  if (!(await hasCodex(exec))) {
    out(`${MARK.skip} Codex ${dim("CLI not found, plugin and marketplace left alone")}`);
    return failed;
  }
  await track("Codex plugin", async () => {
    if (!isCodexPluginInstalled(await codexJson(exec, "plugin", "list"))) return { status: "skip", text: "not installed" };
    await exec("codex", ["plugin", "remove", PLUGIN]);
    return { status: "ok", text: "removed" };
  });
  await track("Codex marketplace", async () => {
    if (pickCodexMarketplaceAction(await codexJson(exec, "plugin", "marketplace", "list")) === "add") return { status: "skip", text: "not added" };
    await exec("codex", ["plugin", "marketplace", "remove", MARKETPLACE]);
    return { status: "ok", text: "removed" };
  });
  return failed;
}
