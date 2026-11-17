// Make the current GitHub repo public with only collaborators able to push or open pull requests. Run by the human only,
// through the /skuizops:publish command (which the model cannot invoke); the Bash guard blocks agents from running this script.
//   node publish.mjs [owner/repo]   dry run without the argument; applies when it equals the repo's nameWithOwner
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PROTECTED } from "./branch-guard.mjs";
import { isMain } from "./scope.mjs";

const SECRET = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_rsa.*|id_ed25519.*|credentials.*)$/i;
const TEMPLATE = /\.(example|sample)$/i;
const RULESET = "skuizops-protected";

const run = promisify(execFile);
// The real exec: stdin (a string) is passed through to the child.
export const realExec = (cmd, args, { input, cwd } = {}) => {
  const p = run(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (input !== undefined) p.child.stdin.end(input);
  return p;
};

export const rulesetBody = () => ({
  name: RULESET,
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH", ...PROTECTED.flatMap((b) => [`refs/heads/${b}`, `refs/heads/${b}/**`])], exclude: [] } },
  // GitHub rejects (422) a pull_request rule missing any of these five parameters.
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    {
      type: "pull_request",
      parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false },
    },
  ],
});

export async function publish({ confirm = "", exec = realExec, cwd = process.cwd() } = {}) {
  let info;
  try {
    info = JSON.parse((await exec("gh", ["repo", "view", "--json", "nameWithOwner,visibility,defaultBranchRef"], { cwd })).stdout);
  } catch (error) {
    throw new Error(`Could not read the repo with gh (is gh installed, logged in, and is this a GitHub repo?): ${error.message}`);
  }
  const repo = info.nameWithOwner;
  const tracked = (await exec("git", ["ls-files"], { cwd })).stdout.split("\n").filter(Boolean);
  const secrets = tracked.filter((f) => SECRET.test(f) && !TEMPLATE.test(f));
  if (secrets.length) throw new Error(`Tracked files look like secrets; nothing was changed. Remove them from git (and rotate them) first:\n${secrets.join("\n")}`);

  const branches = ["the default branch", ...PROTECTED].join(", ");
  if (confirm.trim() !== repo) {
    return [
      `Plan for ${repo} (currently ${info.visibility}); nothing changed:`,
      "1. Only collaborators can open pull requests (pull_request_creation_policy=collaborators_only)",
      "2. The repo becomes public",
      `3. Ruleset "${RULESET}": no deletion, no force push, changes only through pull requests (0 approvals) on: ${branches}`,
      `To apply, run: /skuizops:publish ${repo}`,
    ].join("\n");
  }

  const done = [];
  const step = async (label, fn) => {
    try {
      await fn();
      done.push(label);
    } catch (error) {
      throw new Error(`${label} failed: ${error.message}. Already applied: ${done.length ? done.join("; ") : "nothing"}.`);
    }
  };
  await step("Only collaborators can open pull requests", () => exec("gh", ["api", "-X", "PATCH", `repos/${repo}`, "-f", "pull_request_creation_policy=collaborators_only"], { cwd }));
  if (info.visibility?.toUpperCase() === "PUBLIC") done.push("Repo was already public");
  else await step("Repo is public", () => exec("gh", ["repo", "edit", repo, "--visibility", "public", "--accept-visibility-change-consequences"], { cwd }));
  await step(`Ruleset "${RULESET}"`, async () => {
    const existing = JSON.parse((await exec("gh", ["api", `repos/${repo}/rulesets`], { cwd })).stdout || "[]").find((r) => r.name === RULESET);
    const [method, path] = existing ? ["PUT", `repos/${repo}/rulesets/${existing.id}`] : ["POST", `repos/${repo}/rulesets`];
    await exec("gh", ["api", "-X", method, path, "--input", "-"], { cwd, input: JSON.stringify(rulesetBody()) });
  });
  return [...done.map((d) => `ok: ${d}`), "Anyone can still fork a public repo; only collaborators can push or open pull requests here."].join("\n");
}

if (isMain(import.meta.url)) {
  try {
    process.stdout.write(`${await publish({ confirm: process.argv[2] ?? "" })}\n`);
  } catch (error) {
    process.stderr.write(`skuizops: ${error.message}\n`);
    process.exit(1);
  }
}
