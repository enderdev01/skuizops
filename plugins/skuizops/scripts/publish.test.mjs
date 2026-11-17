import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publish } from "./publish.mjs";

// Fake exec: records every call; `rulesets` is what the list endpoint returns, `failOn` makes a matching call reject.
function fake({ visibility = "PRIVATE", files = ["README.md"], rulesets = [], failOn } = {}) {
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    const line = `${cmd} ${args.join(" ")}`;
    calls.push({ line, input: opts.input });
    if (failOn && line.includes(failOn)) throw new Error("boom");
    if (line.startsWith("gh repo view")) return { stdout: JSON.stringify({ nameWithOwner: "o/r", visibility, defaultBranchRef: { name: "main" } }) };
    if (line.startsWith("git ls-files")) return { stdout: files.join("\n") };
    if (line === "gh api repos/o/r/rulesets") return { stdout: JSON.stringify(rulesets) };
    return { stdout: "" };
  };
  const mutating = () => calls.filter((c) => /-X|repo edit/.test(c.line));
  return { exec, calls, mutating };
}

describe("publish", () => {
  it("dry run without confirm changes nothing and shows the plan", async () => {
    const f = fake();
    const out = await publish({ exec: f.exec });
    assert.equal(f.mutating().length, 0);
    assert.match(out, /To apply, run: \/skuizops:publish o\/r/);
    assert.match(out, /main/);
  });

  it("dry run with a wrong confirm changes nothing", async () => {
    const f = fake();
    await publish({ confirm: "x/y", exec: f.exec });
    assert.equal(f.mutating().length, 0);
  });

  it("a tracked secret stops before any mutating call", async () => {
    const f = fake({ files: ["src/a.js", "config/.env.production", "deploy/server.pem"] });
    await assert.rejects(publish({ confirm: "o/r", exec: f.exec }), /\.env\.production[\s\S]*server\.pem/);
    assert.equal(f.mutating().length, 0);
  });

  it("allows .example and .sample templates", async () => {
    const f = fake({ files: [".env.example", "id_rsa.sample", "credentials.sample"] });
    await publish({ confirm: "o/r", exec: f.exec });
    assert.equal(f.mutating().length, 3);
  });

  it("applies policy, then visibility, then ruleset", async () => {
    const f = fake();
    const out = await publish({ confirm: "o/r", exec: f.exec });
    const m = f.mutating().map((c) => c.line);
    assert.equal(m.length, 3);
    assert.match(m[0], /^gh api -X PATCH repos\/o\/r -f pull_request_creation_policy=collaborators_only$/);
    assert.match(m[1], /^gh repo edit o\/r --visibility public --accept-visibility-change-consequences$/);
    assert.match(m[2], /^gh api -X POST repos\/o\/r\/rulesets --input -$/);
    assert.match(out, /fork/);
  });

  it("skips the visibility edit when already public", async () => {
    const f = fake({ visibility: "PUBLIC" });
    await publish({ confirm: "o/r", exec: f.exec });
    assert.equal(f.calls.filter((c) => c.line.includes("repo edit")).length, 0);
  });

  it("updates an existing ruleset with PUT instead of creating another", async () => {
    const f = fake({ rulesets: [{ id: 7, name: "skuizops-protected" }] });
    await publish({ confirm: "o/r", exec: f.exec });
    const m = f.mutating().map((c) => c.line);
    assert.match(m.at(-1), /^gh api -X PUT repos\/o\/r\/rulesets\/7 --input -$/);
    assert.equal(m.filter((l) => l.includes("POST")).length, 0);
  });

  it("sends a ruleset body covering the default and protected branches", async () => {
    const f = fake();
    await publish({ confirm: "o/r", exec: f.exec });
    const body = JSON.parse(f.calls.find((c) => c.line.includes("POST")).input);
    assert.equal(body.name, "skuizops-protected");
    assert.equal(body.target, "branch");
    assert.equal(body.enforcement, "active");
    assert.ok(body.conditions.ref_name.include.includes("~DEFAULT_BRANCH"));
    assert.ok(body.conditions.ref_name.include.includes("refs/heads/main"));
    assert.ok(body.conditions.ref_name.include.includes("refs/heads/main/**"));
    assert.deepEqual(body.conditions.ref_name.exclude, []);
    const types = body.rules.map((r) => r.type);
    assert.ok(types.includes("deletion") && types.includes("non_fast_forward"));
    // Every parameter GitHub's REST schema marks required for a pull_request rule, or the API answers 422.
    assert.deepEqual(body.rules.find((r) => r.type === "pull_request").parameters, {
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: false,
      require_code_owner_review: false,
      require_last_push_approval: false,
      required_review_thread_resolution: false,
    });
  });

  it("a failure in the visibility step reports that the policy step applied", async () => {
    const f = fake({ failOn: "repo edit" });
    await assert.rejects(publish({ confirm: "o/r", exec: f.exec }), /Repo is public failed[\s\S]*Already applied: Only collaborators can open pull requests/);
    assert.equal(f.calls.filter((c) => c.line.includes("rulesets")).length, 0);
  });

  it("fails clearly when gh cannot read the repo", async () => {
    await assert.rejects(publish({ exec: async () => { throw new Error("ENOENT"); } }), /gh/);
  });
});
