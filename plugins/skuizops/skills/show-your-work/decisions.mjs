#!/usr/bin/env node
// Append one row to the project's decision log. The log is append-only: a wrong row is superseded by a later one.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMain } from "../../scripts/scope.mjs";

const HEADER = "ts\tphase\tdecision\tevidence\tresult\n";

// One TSV cell: no tabs or newlines, and a leading quote when a spreadsheet would treat it as a formula.
export function cell(value) {
  const clean = String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
  if (!clean) return "";
  return /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return "";
  const value = argv[i + 1];
  return value && !value.startsWith("--") ? value : "";
}

// `.skuizops/` stays untracked. An unignored log changes the verify-gate tree hash and the skip never hits.
export function ensureGitignore(root) {
  const file = join(root, ".gitignore");
  const line = ".skuizops/";
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (text.split("\n").some((entry) => [".skuizops/", "/.skuizops/", ".skuizops", "/.skuizops"].includes(entry.trim()))) return false;
  const sep = text.length && !text.endsWith("\n") ? "\n" : "";
  writeFileSync(file, `${text}${sep}${line}\n`);
  return true;
}

export function appendDecision(root, fields) {
  const missing = ["phase", "decision", "evidence", "result"].filter((name) => !cell(fields[name]));
  if (missing.length) return { ok: false, error: `missing ${missing.join(", ")}` };
  ensureGitignore(root);
  const dir = join(root, ".skuizops");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "decisions.tsv");
  if (!existsSync(file)) writeFileSync(file, HEADER);
  const row = [new Date().toISOString(), fields.phase, fields.decision, fields.evidence, fields.result].map(cell).join("\t");
  appendFileSync(file, `${row}\n`);
  return { ok: true, file };
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv[0] !== "append") {
    process.stderr.write("usage: node decisions.mjs append --phase <phase> --decision <text> --evidence <pointer> --result <result>\n");
    process.exit(1);
  }
  const result = appendDecision(process.cwd(), {
    phase: flag(argv, "phase"),
    decision: flag(argv, "decision"),
    evidence: flag(argv, "evidence"),
    result: flag(argv, "result"),
  });
  if (!result.ok) {
    process.stderr.write(`FAIL ${result.error}\n`);
    process.exit(1);
  }
  process.stdout.write(`${result.file}\n`);
}
