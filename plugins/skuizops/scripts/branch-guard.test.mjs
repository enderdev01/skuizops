import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { checkCommand, commitViolation, isPlainGhCall, isProtected, pushViolation, targetDir } from "./branch-guard.mjs";

describe("isProtected", () => {
  for (const ref of ["develop", "desarrollo", "desa", "main", "master", "production", "prod", "test", "release", "release/1.2", "refs/heads/main", "MAIN"]) {
    it(`protects ${ref}`, () => assert.equal(isProtected(ref), true));
  }
  for (const ref of ["feat/login", "feat/main-menu", "testing", "maintenance"]) {
    it(`does not protect ${ref}`, () => assert.equal(isProtected(ref), false));
  }
});

describe("commitViolation", () => {
  it("allows feat/ branches", () => assert.equal(commitViolation("feat/login"), null));
  it("blocks protected branches", () => assert.match(commitViolation("main"), /protected/));
  for (const branch of ["fix/null-total", "hotfix/prod-crash"]) {
    it(`allows ${branch}`, () => assert.equal(commitViolation(branch), null));
  }
  it("blocks other prefixes", () => assert.match(commitViolation("chore/deps"), /not a feat\//));
  it("blocks detached HEAD", () => assert.match(commitViolation(null), /detached/));
});

describe("pushViolation", () => {
  it("allows feat/ targets", () => assert.equal(pushViolation("refs/heads/feat/login"), null));
  it("allows fix/ and hotfix/ targets", () => {
    assert.equal(pushViolation("refs/heads/fix/bug"), null);
    assert.equal(pushViolation("refs/heads/hotfix/urgent"), null);
  });
  it("blocks protected targets", () => assert.match(pushViolation("refs/heads/develop"), /protected/));
});

describe("checkCommand", () => {
  const onFeat = "feat/login";
  it("ignores non-git commands", () => assert.equal(checkCommand("npm test", "main"), null));
  it("allows commit on feat/", () => assert.equal(checkCommand('git commit -m "x"', onFeat), null));
  it("blocks commit on main", () => assert.match(checkCommand('git add . && git commit -m "x"', "main"), /blocked/));
  it("blocks --no-verify", () => assert.match(checkCommand('git commit --no-verify -m "x"', onFeat), /no-verify/));
  it("blocks core.hooksPath changes", () => assert.match(checkCommand("git config core.hooksPath /dev/null", onFeat), /hooksPath/));
  it("allows git config core.hooksPath .githooks", () => {
    assert.equal(checkCommand("git config core.hooksPath .githooks", onFeat), null);
    assert.equal(checkCommand("git config --local core.hooksPath .githooks", onFeat), null);
  });
  it("blocks git -c core.hooksPath=x commit", () => assert.match(checkCommand("git -c core.hooksPath=x commit -m y", onFeat), /hooksPath/));
  it("allows push of feat/", () => assert.equal(checkCommand("git push -u origin feat/login", onFeat), null));
  it("blocks push to protected refspec", () => assert.match(checkCommand("git push origin feat/login:main", onFeat), /protected/));
  it("blocks bare push from main", () => assert.match(checkCommand("git push", "main"), /protected/));
  it("blocks push --all", () => assert.match(checkCommand("git push --all origin", onFeat), /--all/));
  it("blocks merge while on develop", () => assert.match(checkCommand("git merge feat/login", "develop"), /blocked/));
  it("allows merging main into a feat/ branch", () => assert.equal(checkCommand("git merge main", onFeat), null));
});

// Regression cases found by the verifier in a real Claude Code session.
describe("checkCommand bypass regressions", () => {
  const onFeat = "feat/login";
  it("blocks commit on main with git -c options", () =>
    assert.match(checkCommand("git -c user.name=t -c user.email=t@t commit -m test", "main"), /blocked/));
  it("blocks commit on main with git -C dir", () => assert.match(checkCommand("git -C . commit -m x", "main"), /blocked/));
  it("blocks commit -n (short --no-verify)", () => assert.match(checkCommand("git commit -n -m x", onFeat), /no-verify/));
  it("blocks combined short flags containing n", () => assert.match(checkCommand('git commit -anm "x"', onFeat), /no-verify/));
  it("blocks git wrapped in bash -c quotes", () => assert.match(checkCommand("bash -c 'git commit -m t'", "main"), /blocked/));
  it("blocks git called by absolute path", () => assert.match(checkCommand("/usr/bin/git commit -m t", "main"), /blocked/));
  it("still allows commit on feat/ with -c options", () =>
    assert.equal(checkCommand("git -c user.name=t commit -m x", onFeat), null));
  it("does not treat merge -n (no-stat) as no-verify", () => assert.equal(checkCommand("git merge -n main", onFeat), null));
});

describe("checkCommand: hook-skipping and ref-moving forms", () => {
  const onFeat = "feat/login";
  const blocked = (command, branch = onFeat) => it(`blocks: ${JSON.stringify(command)} on ${branch}`, () => assert.ok(checkCommand(command, branch)));
  const allowed = (command, branch = onFeat) => it(`allows: ${JSON.stringify(command)} on ${branch}`, () => assert.equal(checkCommand(command, branch), null));

  blocked("git commit --no-verif -m x");
  blocked("git push --no-v origin feat/login");
  blocked('git commit "--no-verify" -m x');
  blocked("git commit '--no-verif' -m x");
  blocked("git status\ngit commit -m x", "main");
  blocked("git status & git commit -m x", "main");
  blocked("git status $(git commit -m x)", "main");
  allowed('git commit -m "git push origin main"');
  allowed("git push -u origin feat/login 2>&1 | tail -3");
  allowed("git push origin feat/login > push.log");
  blocked("git push origin main 2>&1");

  blocked("git rebase feat/login", "main");
  blocked("git am patch.mbox", "main");
  blocked("git reset --hard HEAD~1", "main");
  allowed("git rebase main");
  allowed("git reset --hard HEAD~1");

  blocked("git update-ref refs/heads/main HEAD");
  blocked("git commit-tree HEAD^{tree} -m x");
  blocked("git branch -f main HEAD");
  blocked("git branch -D main");
  blocked("git checkout -B main");
  blocked("git switch -C release/1.0");
  blocked("git branch -d main");
  blocked("git branch -D feat/old main");
  allowed("git branch -f feat/y main");
  allowed("git switch -C feat/y main");
  allowed("git branch -D feat/old");
  allowed("git checkout -b feat/x");
  allowed("git switch -c fix/y");

  blocked("git config include.path ../other.cfg");
  blocked("git config includeIf.gitdir:/x/.path other.cfg");
  blocked("HOME=/tmp/h git commit -m x");
  blocked("PATH=/tmp/bin:$PATH git commit -m x");
  blocked("GIT_DIR=/tmp/g git commit -m x");
  blocked("GIT_CONFIG_GLOBAL=/tmp/c git commit -m x");
  allowed("GIT_EDITOR=true git rebase --continue");
  allowed("GIT_PAGER=cat git log -3");
});

// Regression: the entry point compared paths without resolving symlinks, so the guard
// silently did nothing (failed open) when invoked through a symlinked path.
describe("entry point through a symlinked path", () => {
  it("still blocks a commit on main", async () => {
    const { spawnSync } = await import("node:child_process");
    const { mkdtempSync, symlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const base = mkdtempSync(join(tmpdir(), "guard-link-"));
    symlinkSync(dirname(fileURLToPath(import.meta.url)), join(base, "link"));
    const repo = mkdtempSync(join(tmpdir(), "guard-repo-"));
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
    const r = spawnSync("node", [join(base, "link", "branch-guard.mjs"), "pre-commit"], { cwd: repo, input: "", encoding: "utf8" });
    assert.equal(r.status, 2, r.stderr);
  });
});

describe("checkCommand: after the trust list check moved to path-guard bash", () => {
  it("still enforces the branch policy and allows the setup step", () => {
    assert.match(checkCommand('git commit -m "x"', "main"), /protected/);
    assert.equal(checkCommand("git config core.hooksPath .githooks", "feat/x"), null);
  });

  describe("target dir and quoted text", () => {
    const at = (d) => ({ "../wt": "fix/x", "../repo": "develop", [`${homedir()}/DEV/r-worktrees/x`]: "fix/x", [`${homedir()}/repo`]: "develop" })[d] ?? null;
    const run = (cmd, branch) => checkCommand(cmd, branch, at);
    const S = "develop";
    const onFeat = "feat/login";
    for (const cmd of [
      'git -C ../wt commit -m "fix: x"',
      `cd ../wt && git add . && git commit -m "fix: it's done"`,
      "git -C ../wt push -u origin fix/x",
      "cd ../wt && git push -u origin fix/x",
      "git -C ../wt commit -m \"$(cat <<'EOF'\nfix: a\nEOF\n)\"",
      "cd ../wt && git add -A && git commit -m \"$(cat <<'EOF'\nfix: a\nEOF\n)\"",
      "cd ../wt && git push -u origin HEAD 2>&1",
      "git -C ../wt push -u origin HEAD 2>&1 | tail -5",
      "git -C ../wt push -u origin HEAD >/dev/null 2>&1 | head -n 5",
      "git -C ../wt add -A && git -C ../wt commit -m 'fix: a'",
      "git -C ../wt add -A && git -C ../wt push -u origin HEAD",
      "git -C ~/DEV/r-worktrees/x commit -m x",
      "cd ~/DEV/r-worktrees/x && git commit -m x",
    ]) {
      it(`trusts the target dir: ${JSON.stringify(cmd)}`, () => assert.equal(run(cmd, S), null));
    }
    for (const cmd of ["git -C ../repo commit -m x", "cd ../repo && git commit -m x", "git -C ~/repo commit -m x"]) {
      it(`blocks a protected target dir: ${JSON.stringify(cmd)}`, () => assert.match(run(cmd, onFeat), /blocked/));
    }
    it("ignores git inside a plain gh call", () => {
      assert.equal(run('gh issue create --title "t" --body "run git -C ../wt commit and git commit -m x"', "main"), null);
      assert.equal(run("gh pr create --title \"t\" --body \"$(cat <<'EOF'\nit's done\ngit commit -m x\ngit push origin main\nEOF\n)\"", "main"), null);
    });
    it("does not trust a heredoc body that ends early", () => {
      assert.equal(isPlainGhCall("gh pr create --body \"$(cat <<'EOF'\nx\nEOF\ngit commit -m x\nEOF\n)\""), false);
    });
    const m = "-m x";
    for (const cmd of [
      `cd ../wt && { cd ../repo; git commit ${m}; }`,
      `cd ../wt && pushd ../repo && git commit ${m}`,
      `cd ../wt && builtin cd ../repo && git commit ${m}`,
      `cd ../wt && command cd ../repo && git commit ${m}`,
      `cd ../wt && if true; then cd ../repo; fi; git commit ${m}`,
      `cd ../wt && eval "cd ../repo" && git commit ${m}`,
      `cd ../wt && bash -c "cd ../repo; git commit ${m}"`,
      `cd ../wt && ! cd ../repo; git commit ${m}`,
      `D=repo; cd ../$D && git commit ${m}`,
      `D=repo; git -C ../$D commit ${m}`,
      `bash -c -- "git commit ${m}"`,
      `bash -c 'git "commit" ${m}'`,
      `bash -c "$(printf 'git commit ${m}')"`,
      `echo 'git commit ${m}' | bash`,
      `bash <<< "git commit ${m}"`,
      `cat <<EOF | bash\ngit commit ${m}\nEOF`,
      `env bash <<EOF\ngit commit ${m}\nEOF`,
      `python3 -c "import os; os.system('git commit ${m}')"`,
      `echo hi # "\ngit commit ${m}\necho # "`,
      `echo hi # it's\ngit commit ${m}\necho # that's`,
      `gh pr create --body "x" ; git commit ${m}`,
      `gh alias set --shell ci 'git commit ${m}'`,
      `cd wt && git commit ${m}`,
      `git -C ../wt -C ../repo commit ${m}`,
      `git -C ../wt add -A && git -C ../repo commit ${m}`,
      `git -C ../wt push 2>&1 | bash`,
      `git -C ../wt push | tail -1; git commit ${m}`,
      `git -C ../wt commit -m "$(cd ../repo)"`,
      `git -C ../wt "-C" ../repo commit ${m}`,
      `git -C ../wt commit -m "$(cat <<'EOF'\nx\nEOF\ngit -C ../repo commit ${m}\nEOF\n)"`,
      `git -C ~ commit ${m}`,
      `git -C ~root commit ${m}`,
    ]) {
      it(`blocks bypass: ${JSON.stringify(cmd)}`, () => assert.match(run(cmd, S), /blocked/));
    }
    it("returns the -C path unnormalized (symlinks)", () => assert.equal(targetDir("git -C ../wt/lnk/.. commit -m x"), "../wt/lnk/.."));
  });
});

// Issue #61: the target dir is read per git invocation. Text that mentions git stays inspected (blocked on purpose).
describe("checkCommand: dir per git", () => {
  const WT = "/Users/ada/DEV/app-worktrees/x";
  const MAIN = "/Users/ada/DEV/app";
  const TMP = "/tmp/t";
  const at = (d) => ({ [WT]: "fix/x", [MAIN]: "develop", [TMP]: "fix/t" })[d] ?? null;
  const run = (cmd) => checkCommand(cmd, "develop", at);
  const allowed = [
    `git fetch -q && git -C ${WT} merge -q origin/develop`,
    `cd ${WT} && git add -A && git commit -m x`,
    `git -C ${WT} merge feat/b -m merge; echo "exit=$?"`,
    `git -C ${WT} commit -m x && echo done`,
    `git -C ${TMP} -c user.name=t commit -m x`,
  ];
  for (const cmd of allowed) it(`allows ${JSON.stringify(cmd)}`, () => assert.equal(run(cmd), null));
  const blocked = [
    "git commit -m x",
    // text that mentions git is inspected like a command (flipped from allow: no text-as-data)
    "cat > /tmp/x.md <<'EOF'\nthen run git commit later\nEOF",
    'echo "remember to git commit"',
    'grep -n "git commit" README.md',
    "bash -c 'git commit -m x'",
    'sh -c "git commit"',
    'eval "git commit -m x"',
    'echo "git commit -m x" | sh',
    "echo 'git commit' | bash",
    "printf 'git commit' | xargs -I{} sh -c {}",
    "$(echo git commit -m x)",
    "`echo git commit`",
    "cat <<EOF\n$(git commit -m x)\nEOF",
    "bash <<'EOF'\ngit commit -m x\nEOF",
    "cat <<'EOF' | sh\ngit commit -m x\nEOF",
    "cat > /tmp/x.sh <<'EOF'\ngit commit -m x\nEOF\nbash /tmp/x.sh",
    `git -C ${WT} status && git commit -m x`,
    `cd ${WT}; git commit -m x`,
    // no variable resolution: any $ in -C, or a leading VAR=x statement, is judged by the session branch
    `W=${WT}; git -C $W commit -m x`,
    `W=${WT} && git -C "$W" commit -m x`,
    `W=${WT}; git -C \${W} merge origin/develop`,
    `W=${WT}; git -C ${WT} merge -q origin/develop`,
    `_=${WT}; git -C "$_" commit -m x`,
    `_=${WT} && git -C "$_" commit -m x`,
    `_=${WT}; git -C "\${_}" commit -m x`,
    `_=${WT}; git -C "$_" merge x`,
    `_=${WT}; git -C "$_" push origin main`,
    `1=${WT}; git -C "$1" commit -m x`,
    `W=${WT}; X=$[W=1]; git -C $W commit -m x`,
    `IFS=.; W=${MAIN}.--no-pager; git -C $W commit -m x`,
    `GIT_DIR=${MAIN}/.git; git -C ${WT} commit -m x`,
    `W=${MAIN}; git -C $W commit -m x`,
    "W=$(pwd); git -C $W commit -m x",
    `W=${WT}; W=${MAIN}; git -C $W commit -m x`,
    `git fetch && git -C ${MAIN} merge origin/x`,
    `git -C ${WT} status; git commit -m x`,
    `git -C ${WT} merge x; cd ${MAIN} && git commit -m y`,
    `git -C ${WT} merge x; sh -c "a; git commit -m y"`,
    `git -C ${TMP} -c core.worktree=${MAIN} commit -m x`,
    `git -C ${TMP} -c alias.commit=push commit -m x`,
    "printf '%s\\n' 'git push origin main'", // printf is not a data command any more (printf -v)
  ];
  for (const cmd of blocked) it(`blocks ${JSON.stringify(cmd)}`, () => assert.match(run(cmd), /blocked/));
  it("hints when a -C or cd could not be honored", () => {
    assert.match(run(`cd ${WT}; git commit -m x`), /target dir could not be read/);
    assert.match(run("W=$(pwd); git -C $W commit -m x"), /target dir could not be read/);
    assert.doesNotMatch(run("git commit -m x"), /target dir/);
    assert.doesNotMatch(run(`git -C ${MAIN} commit -m x`), /target dir/);
  });
});

// Found by cherry: every shape below makes a commit/merge/push on a protected branch.
describe("adversarial: text that reaches a shell", () => {
  const WT = "/Users/ada/DEV/app-worktrees/x";
  const FEAT = "/Users/ada/DEV/app-feat";
  const MAIN = "/Users/ada/DEV/app";
  const at = (d) => ({ [WT]: "fix/x", [FEAT]: "fix/y", [MAIN]: "develop" })[d] ?? null;
  const C = "git commit -m x";
  const cases = [
    `echo "${C}" | sh`,
    `echo $'\\'' ' '; ${C}; '' #'`,
    `printf -v c "${C}"; $c`,
    `printf -v c "${C}"; \${=c}`,
    `echo "${C}" | sh>/dev/null`,
    `echo "${C}" | "sh"`,
    `echo "${C}" | \\sh`,
    `echo "${C}" | $SHELL`,
    `echo "${C}" | tcsh`,
    `echo "${C}" | awk '{system($0)}'`,
    `echo "${C}" > /tmp/a; sh</tmp/a`,
    `cat <<'EOF' > >(tcsh)\n${C}\nEOF`,
    `echo "git push origin main" | "sh"`,
    `printf '%s\\n' "git merge feat/x" | $SHELL`,
    `echo "${C}" | $'sh'`,
    `echo "${C}" > /tmp/a; ./x.sh`,
    `echo "${C}" | node -e 'x'`,
    `W=${MAIN}p; Wp=${WT}; git -C \${W}p commit -m x`,
    `W=${MAIN}p; Wp=${WT}; git -C "$W"p commit -m x`,
    `W=${MAIN}; git -C $W/sub commit -m x`,
    // round 2: words glued from quotes or variables, and git/gh running data
    "$'git' commit -m x",
    "$'git' push origin main",
    "x=1 $'git' commit -m x",
    '$"git" commit -m x',
    'c="git commit -m x"; eval $c',
    'declare c="git commit -m x"; eval "$c"',
    'export c="git commit -m x"; sh -c "$c"',
    `env c="git commit -m x" sh -c '$c'`,
    'env -S"git commit -m x"',
    'c="git commit -m x"; $c',
    `echo "git commit -m x" | git -c alias.zz='!sh' zz`,
    "cat <<'EOF' | git -c alias.zz=!sh zz\ngit commit -m x\nEOF",
    `echo "git commit -m x" > /tmp/s.sh; git -c alias.zz='!sh /tmp/s.sh' zz`,
    "gh alias set --shell zz - <<'EOF'\ngit commit -m x\nEOF\ngh zz",
    'echo "git commit -m x" | gh alias set --shell zz - && gh zz',
  ];
  for (const cmd of cases) it(`blocks ${JSON.stringify(cmd)}`, () => assert.match(checkCommand(cmd, "develop", at), /blocked/));
});
