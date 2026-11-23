import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { normalize } from "node:path";
import { checkCommand, commitViolation, isPlainGhCall, isProtected, pushViolation } from "./branch-guard.mjs";

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
    it("passes the -C path unnormalized (symlinks)", () => {
      const seen = [];
      checkCommand("git -C ../wt/lnk/.. commit -m x", S, (d) => (seen.push(d), "fix/x"));
      assert.deepEqual(seen, ["../wt/lnk/.."]);
    });
  });
});

describe("issue 61/63: text is data, each git is judged by its own dir", () => {
  const at = (d) => ({ "/abs/wt": "fix/x", "/abs/repo": "develop", "../wt": "fix/x", "../repo": "develop" })[d] ?? null;
  const run = (cmd, branch = "develop") => checkCommand(cmd, branch, at);
  const on = (branch) => (branch ? ` on ${branch}` : "");
  const allowed = (cmd, branch) => it(`allows ${JSON.stringify(cmd)}${on(branch)}`, () => assert.equal(run(cmd, branch), null));
  const blocked = (cmd, branch, re = /blocked|forbidden/) => it(`blocks ${JSON.stringify(cmd)}${on(branch)}`, () => assert.match(run(cmd, branch) ?? "allowed", re));

  // #61 table (session on develop, worktree /abs/wt on fix/x)
  allowed("cat > /tmp/x.md <<'EOF'\n# notes\ngit commit -m x\ngit push origin main\nEOF");
  allowed('echo "remember to git commit"');
  allowed("cat > /tmp/pr.md <<'EOF'\nRun git commit; then git push origin main | tee.\nEOF\ngh pr create --title t --body-file /tmp/pr.md");
  allowed("cat > /tmp/pr.md <<'EOF' && gh pr create --title t --body-file /tmp/pr.md\nRun git commit; then git push origin main.\nEOF");
  allowed("cat > /tmp/re.mjs <<'EOF'\nconst re = /git commit|git push|git merge/;\nEOF");
  allowed("W=/abs/wt; git -C $W commit -m x");
  allowed("W=/abs/wt; git -C /abs/wt merge origin/develop");
  allowed("git fetch -q && git -C /abs/wt merge origin/develop");
  allowed("git -C /abs/wt merge origin/develop");
  blocked("git commit -m x");

  allowed('echo "never use git commit --no-verify"');
  allowed("echo git commit -m x");
  allowed("tee /tmp/n.md <<'EOF'\ngit commit\nEOF");
  allowed('W=/abs/wt; git -C "$W" commit -m x');
  allowed("W=/abs/wt; git -C ${W} commit -m x");
  allowed("cd /abs/wt && git add -A && git commit -m x");
  allowed('git log --oneline | grep "git commit"');
  allowed("git -c user.name=a -C /abs/wt commit -m x");

  // #63: only -C and safe -c may precede the subcommand
  blocked("git --bare -C /abs/wt push origin HEAD");
  blocked("git --git-dir=/abs/repo/.git -C /abs/wt commit -m x");
  blocked("git -p -C /abs/wt commit -m x");
  blocked("git -c core.editor=x -C /abs/wt commit -m x");

  // the dir really is protected
  blocked("W=/abs/repo; git -C $W commit -m x", "feat/a");
  blocked("git fetch -q && git -C /abs/repo commit -m x", "feat/a");
  blocked("cd /abs/repo; git commit -m x", "feat/a");
  blocked("cd /abs/wt; git commit -m x");
  blocked("git -C /abs/wt status && cd /abs/repo && git commit -m x", "feat/a");
  blocked("cd /abs/wt && pushd /abs/repo && git commit -m x");

  // a dir that cannot be read is judged by the session branch, with a hint
  blocked("W=/abs/wt; W=/abs/repo; git -C $W commit -m x", undefined, /literal path/);
  blocked("git -C $UNSET commit -m x", undefined, /literal path/);
  blocked("W=/abs/wt git -C $W commit -m x");
  blocked('_=/abs/wt; git -C "$_" commit -m x');
  blocked("W=/abs/wt; W+=/../repo; git -C $W commit -m x");
  blocked("W=/abs/wt; W[1,-1]=/abs/repo; git -C $W commit -m x");
  blocked("W=/abs/wt; read W; git -C $W commit -m x");
  blocked("false && W=/abs/wt; git -C $W commit -m x");
  blocked('W=/abs/wt; git -C "$W"p commit -m x');

  // text that reaches a shell is still inspected
  blocked('eval "git commit -m x"');
  blocked('bash -c "git -C /abs/wt status; git commit -m x"');
  blocked("printf 'git commit -m x' | sh");
  blocked('echo "git commit -m x" | bash');
  blocked("cat <<'EOF' | bash\ngit commit -m x\nEOF");
  blocked("cat <<EOF > /tmp/a\n$(git commit -m x)\nEOF");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit -m x\nEOF\nbash /tmp/a.sh");
  blocked("x=$(cat <<'EOF'\ngit commit -m x\nEOF\n); eval \"$x\"");
  blocked("tee >(bash) <<'EOF'\ngit commit -m x\nEOF");
  blocked('echo "x" && git commit --no-verify -m x', "feat/a");

  // cherry round 1: shapes where the shell runs what the parser took for data
  blocked("cat <<<'EOF'\ngit commit -m x\nEOF");
  blocked("cat <<EO\\F\nEOF\ngit commit -m x\nEO");
  blocked("cat <<'EO'F\nEOF\ngit commit -m x\nEO");
  blocked("gh config set browser 'git commit --allow-empty -m'; gh browse");
  blocked("GH_BROWSER='git commit --allow-empty -m' gh browse");
  blocked("printf -v x %s 'a[$(git commit -m x)]'; echo $[x]");

  // cherry round 2: the same words quoted, and a continuation that forms the delimiter
  blocked("printf '-v' x %s 'a[$(git commit -m x)]'; echo $[x]");
  blocked('printf -""v x %s \'a[$(git commit -m x)]\'; echo $[x]');
  blocked("gh \"config\" set browser 'git commit --allow-empty -m'; gh browse");
  blocked("gh $'config' set browser 'git commit --allow-empty -m'; gh browse");
  blocked("gh 'alias' set --shell gc 'git commit --allow-empty -m x'; gh gc");
  blocked("cat <<EOF\nEO\\\nF\ngit commit -m x\nEOF");
});

describe("PR #76 review: every dir an `||` chain may leave the shell in is judged", () => {
  const at = (d) => ({ "/abs/wt": "fix/x", "/abs/wt2": "fix/y", "/abs/repo": "develop", "/abs/repo/sub": "develop", "/abs/wt/sub": "fix/x" })[normalize(d)] ?? null;
  const run = (cmd, branch) => checkCommand(cmd, branch, at);
  const allowed = (cmd, branch) => it(`allows ${JSON.stringify(cmd)} on ${branch}`, () => assert.equal(run(cmd, branch), null));
  const blocked = (cmd, branch) => it(`blocks ${JSON.stringify(cmd)} on ${branch}`, () => assert.match(run(cmd, branch) ?? "allowed", /blocked/));

  // the session is on a work branch, /abs/repo is on develop
  blocked("cd /abs/repo || cd /abs/wt && git commit -m x", "feat/a");
  blocked("cd /abs/wt || cd /abs/repo && git commit -m x", "feat/a");
  blocked("cd /abs/wt || cd /abs/wt2 || cd /abs/repo && git commit -m x", "feat/a");
  blocked("cd /abs/repo || cd /abs/wt; git commit -m x", "feat/a");
  blocked("cd /abs/repo || cd /abs/wt\ngit commit -m x", "feat/a");
  blocked("cd /abs/repo || cd /abs/wt && git push -u origin HEAD", "feat/a");
  blocked("cd /abs/repo || true && git commit -m x", "feat/a");
  blocked("cd /abs/repo && cd /nope || git commit -m x", "feat/a");
  blocked("cd /abs/repo || git -C /abs/wt status && git commit -m x", "feat/a");
  blocked("cd /abs/repo || cd /abs/wt && git -C ./sub commit -m x", "feat/a");
  blocked("cd /abs/wt || cd /abs/repo && git -C ./sub commit -m x", "feat/a");
  // the session itself is protected: a chain where every cd may fail still reaches it
  blocked("cd /abs/wt || cd /abs/wt2; git commit -m x", "develop");
  blocked("cd /abs/wt && cd /nope || git commit -m x", "develop");

  // every dir the chain may reach is a work worktree
  allowed("cd /abs/wt || cd /abs/wt2 && git commit -m x", "develop");
  allowed("cd /abs/wt || cd /abs/wt2 && git push -u origin HEAD", "develop");
  allowed("cd /abs/wt || cd /abs/repo && git -C /abs/wt2 commit -m x", "develop");
  allowed("git -C /abs/wt commit -m x || git -C /abs/wt2 commit -m x", "develop");
  allowed("cd /abs/wt && git add -A && git commit -m x", "develop");
  allowed("cd /abs/wt || cd /abs/repo && git -C /abs/wt/sub commit -m x", "develop");
});

describe("PR #76 review: a gh config written in the same command is not data", () => {
  const run = (cmd, branch = "develop") => checkCommand(cmd, branch);
  const allowed = (cmd, branch) => it(`allows ${JSON.stringify(cmd)}`, () => assert.equal(run(cmd, branch), null));
  const blocked = (cmd, branch) => it(`blocks ${JSON.stringify(cmd)}`, () => assert.match(run(cmd, branch) ?? "allowed", /blocked|forbidden/));
  const alias = "aliases:\n  ci: '!git commit --no-verify -m x'";
  const pager = "pager: git commit --no-verify -m x";

  // an alias, then `gh <alias>`
  blocked(`cat > ~/.config/gh/config.yml <<'EOF'\n${alias}\nEOF\ngh ci`, "feat/a");
  blocked(`tee ~/.config/gh/config.yml <<'EOF'\n${alias}\nEOF\ngh ci`, "feat/a");
  blocked(`tee -a ~/.config/gh/config.yml >/dev/null <<'EOF'\n${alias}\nEOF\ngh ci`, "feat/a");
  blocked(`echo "aliases: {ci: '!git commit --no-verify'}" >> ~/.config/gh/config.yml && gh ci`, "feat/a");
  blocked(`cat > "$GH_CONFIG_DIR/config.yml" <<'EOF'\n${alias}\nEOF\ngh ci`, "feat/a");
  blocked(`cat > $XDG_CONFIG_HOME/gh/config.yml <<'EOF'\n${alias}\nEOF\ngh ci`, "feat/a");
  blocked(`cat > \${XDG_CONFIG_HOME}/gh/config.yml <<'EOF'\n${alias}\nEOF\ngh ci`, "feat/a");
  // an unknown gh subcommand may be an alias or an extension, wherever its config was written
  blocked(`cat > /tmp/notes.yml <<'EOF'\n${alias}\nEOF\ngh ci`, "feat/a");
  blocked("gh my-ext 'git commit --no-verify -m x'", "feat/a");
  // gh's own commands run the pager, editor or browser from the config written before them
  blocked(`cat > ~/.config/gh/config.yml <<'EOF'\n${pager}\nEOF\ngh pr view 1`, "feat/a");
  blocked(`echo '${pager}'>~/.config/gh/config.yml; gh pr view 1`, "feat/a");
  blocked(`cd ~/.config/gh && cat > config.yml <<'EOF'\n${pager}\nEOF\ngh pr view 1`, "feat/a");
  blocked(`cat > ~/.config/GH/config.yml <<'EOF'\n${pager}\nEOF\ngh pr view 1`, "feat/a");
  blocked(`cat > /tmp/g/config.yml <<'EOF'\n${pager}\nEOF\ngh pr view 1`, "feat/a");
  blocked(`cat > "$F" <<'EOF'\n${pager}\nEOF\ngh pr view 1`, "feat/a");
  blocked(`printf '%s\\n' '${pager}' | tee -a ~/.config/gh/config.yml; gh pr list`, "feat/a");
  blocked(`cat > ~/.config/gh/config.yml <<'EOF'\neditor: git commit -m x\nEOF\ngh pr create`);
  // cherry round 1: zsh writes past noclobber with `>!`, and a gh alias runs shell with `!git`
  blocked(`cat >! ~/.config/gh/config.yml <<'EOF'\n${pager}\nEOF\ngh pr view 1`, "feat/a");
  blocked(`cat >>! ~/.config/gh/config.yml <<'EOF'\n${pager}\nEOF\ngh pr view 1`, "feat/a");
  blocked(`echo '${pager}' >&! ~/.config/gh/config.yml; gh pr view 1`, "feat/a");
  blocked(`cat > ~/.config/gh/config.yml <<'EOF'\naliases:\n  ci: '!git commit -m x'\nEOF\ngh ci`);

  // #61: text written to a plain file next to a gh call is still data
  allowed("cat > /tmp/pr.md <<'EOF'\nnever git commit --no-verify; git push origin main\nEOF\ngh pr create --title t --body-file /tmp/pr.md");
  allowed("cat > /tmp/pr.md <<'EOF' && gh pr create --title t --body-file /tmp/pr.md\nRun git commit --no-verify; then git push origin main.\nEOF");
  allowed("gh pr view 1 > /tmp/pr.txt 2>&1; echo 'never git commit --no-verify'");
  allowed('echo "remember to git commit"');
  allowed('gh issue create --title t --body "never git commit --no-verify"');
  it("plain gh calls are only gh's own commands", () => {
    assert.equal(isPlainGhCall('gh pr create --title "t" --body "git commit"'), true);
    assert.equal(isPlainGhCall('gh ci --body "git commit"'), false);
    assert.equal(isPlainGhCall('gh "pr" create --body "git commit"'), false);
  });
});

describe("PR #76 review round 3: four point findings", () => {
  const at = (d) => ({ "/abs/wt": "fix/x", "/abs/repo": "develop" })[d] ?? null;
  const run = (cmd, branch) => checkCommand(cmd, branch, at);
  const allowed = (cmd, branch) => it(`allows ${JSON.stringify(cmd)} on ${branch}`, () => assert.equal(run(cmd, branch), null));
  const blocked = (cmd, branch, re = /blocked|forbidden/) => it(`blocks ${JSON.stringify(cmd)} on ${branch}`, () => assert.match(run(cmd, branch) ?? "allowed", re));

  // 1. a git the parser did not record (`!git`, text an unknown gh subcommand or another command gets) next to a cd / -C
  // into a protected repo: never judged by the session's work branch
  blocked("cd /abs/repo && gh alias set x '!git status' && git commit -m x", "feat/a");
  blocked("cd /abs/repo && gh foo 'git x' && git commit -m x", "feat/a");
  blocked("cd /abs/repo && echo '!git log' > ~/.config/gh/config.yml && gh pr list && git commit -m x", "feat/a");
  blocked("git -C /abs/repo commit -m x && gh my-ext 'git status'", "feat/a");
  blocked("cd /abs/repo && : 'git x' && git push -u origin HEAD", "feat/a");
  // the parser saw every git: each is still judged by its own dir
  allowed("cd /abs/wt && gh pr create --title t --body 'git commit' && git push -u origin HEAD", "develop");

  // 2. hook-skipping git written to a file can be run by a later call
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit --no-verify -m x\nEOF\nbash /tmp/a.sh", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit --no-verify -m x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit -n -m x\nEOF\nbash /tmp/a.sh", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit -n -m x\nEOF", "feat/a");
  blocked("tee /tmp/a.sh <<'EOF'\ngit commit --no-verify -m x\nEOF\nsh /tmp/a.sh", "feat/a");
  blocked("tee /tmp/a.sh >/dev/null <<'EOF'\ngit commit -n -m x\nEOF", "feat/a");
  blocked("echo 'git commit -n -m x' | tee /tmp/a.sh", "feat/a");
  blocked("printf '%s\\n' 'git commit --no-verify -m x' > /tmp/a.sh", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit config core.hooksPath /dev/null\nEOF", "feat/a");
  // #61: a PR body or notes that only mention git stay data
  allowed("cat > /tmp/pr.md <<'EOF'\nRun git commit; then git push origin main.\nEOF\ngh pr create --title t --body-file /tmp/pr.md", "develop");
  allowed("cat > /tmp/pr.md <<'EOF'\nnever git commit --no-verify\nEOF\ngh pr create --title t --body-file /tmp/pr.md", "develop");
  allowed("cat > /tmp/pr.md <<'EOF'\nnever git commit -n\nEOF\ngh pr create --title t -F /tmp/pr.md", "develop");
  allowed("cat > /tmp/x.md <<'EOF'\n# notes\ngit commit -m x\nEOF", "develop");

  // 3. the shell expands an unquoted glob or brace in a git word
  blocked("git comm* -n", "feat/a");
  blocked("git com* -n -m x", "feat/a");
  blocked("git com{mit} -n", "feat/a");
  blocked("git com{mit,} -n -m x", "feat/a");
  blocked("git c?mmit -m x", "develop");
  blocked("git commit -{n,m} x", "feat/a");
  blocked("git commit -[n] -m x", "feat/a");
  blocked("bash -c 'git comm* -n'", "feat/a");
  blocked("bash -c 'git commit -{n,m} x'", "feat/a");
  allowed("echo 'git comm* -n'", "develop");
  // round 4 (fail closed): text written to a file is read as a shell would, and `/git comm*/` is git with a glob
  blocked("cat > /tmp/re.mjs <<'EOF'\nconst re = /git comm*/;\nEOF", "develop");
  allowed("git commit -m 'fix * and {a,b}?'", "feat/a");
  allowed("git log --oneline @{u}..HEAD", "feat/a");
  allowed("git add src/*.ts && git commit -m x", "feat/a");
  allowed("git add -- *.md", "feat/a");
  allowed("W=/abs/wt; git -C ${W} commit -m x", "develop");
});

describe("PR #76 review round 4: fail closed when the parser cannot resolve a command", () => {
  const at = (d) => ({ "/abs/wt": "fix/x", "/abs/wt2": "fix/y", "/abs/repo": "develop" })[d] ?? null;
  const run = (cmd, branch) => checkCommand(cmd, branch, at);
  const allowed = (cmd, branch) => it(`allows ${JSON.stringify(cmd)} on ${branch}`, () => assert.equal(run(cmd, branch), null));
  const blocked = (cmd, branch, re = /blocked|forbidden/) => it(`blocks ${JSON.stringify(cmd)} on ${branch}`, () => assert.match(run(cmd, branch) ?? "allowed", re));

  // 4661196015: hook-skipping written to a file in brace, glob or quoted form, then run by bash (now or in a later call)
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit -{n,m} x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit --no-{verify,} -m x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit --no-{verify,} -m x\nEOF\nbash /tmp/a.sh", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit -[n] -m x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit com* -n -m x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit -\"n\" -m x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit --no-ver\"ify\" -m x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit \\-n -m x\nEOF", "feat/a");
  blocked("cat > /tmp/a.sh <<'EOF'\ngit commit $F -m x\nEOF", "feat/a");
  blocked("echo 'git commit -{n,m} x' > /tmp/a.sh", "feat/a");
  blocked("echo 'git commit -\"n\" -m x' | tee /tmp/a.sh", "feat/a");
  blocked("printf 'git commit -%s -m x' n > /tmp/a.sh", "feat/a");
  blocked("echo 'git commit -\\x6e -m x' > /tmp/a.sh", "feat/a");
  blocked("cat <<< 'git commit -\"n\" -m x' > /tmp/a.sh", "feat/a");
  blocked("cat > /tmp/a.sh <<EOF\ngit commit $FLAG -m x\nEOF", "feat/a");
  // the same forms run directly
  blocked('git commit -"n" -m x', "feat/a");
  blocked("git commit \\-n -m x", "feat/a");
  blocked('git commit --no-"verify" -m x', "feat/a");
  blocked('"g"it commit -n -m x', "feat/a");
  blocked('g\\it commit --no-"verify" -m x', "feat/a");
  blocked("bash -c 'git push --no-\"verify\" origin feat/a'", "feat/a");
  blocked("F=-n; git commit $F -m x", "feat/a");
  blocked('git commit "$F" -m x', "feat/a");
  blocked("echo commit -n -m x | xargs git", "feat/a");
  // #61: notes and PR bodies that only mention git stay data
  allowed("cat > /tmp/x.md <<'EOF'\n# notes\ngit commit -m x\ngit push origin main\nEOF", "develop");
  allowed("cat > /tmp/pr.md <<'EOF'\nnever git commit -{n,m} or --no-{verify,}\nEOF\ngh pr create --title t --body-file /tmp/pr.md", "develop");
  allowed('git commit -m "$(cat <<\'EOF\'\nfix: never git commit -n\nEOF\n)"', "feat/a");
  allowed("git commit -F - <<'EOF'\nfix: never git commit -n\nEOF", "feat/a");

  // 4661198688: quoted or flag-prefixed -C / cd paths are resolved, never judged by the session's work branch
  blocked("git -C '/abs/repo' commit -m x", "feat/a");
  blocked('git -C "/abs/repo" commit -m x', "feat/a");
  blocked("cd -- /abs/repo && git commit -m x", "feat/a");
  blocked("cd -P /abs/repo && git commit -m x", "feat/a");
  blocked("builtin cd /abs/repo && git commit -m x", "feat/a");
  blocked("command cd /abs/repo && git commit -m x", "feat/a");
  blocked("cd '/abs/repo' && git push -u origin HEAD", "feat/a");
  allowed("git -C '/abs/wt' commit -m x", "develop");
  allowed('cd "/abs/wt" && git commit -m x', "develop");
  allowed("cd -- /abs/wt && git commit -m x", "develop");
  allowed("builtin cd /abs/wt && git push -u origin HEAD", "develop");

  // what cannot be resolved is blocked for a commit or push, whatever the session branch
  const dir = /cannot tell which repository|literal path/;
  blocked("cd $W && git commit -m x", "feat/a", dir);
  blocked("cd ${W:-/abs/wt} && git commit -m x", "feat/a", dir);
  blocked("cd ${W:+/abs/repo} && git commit -m x", "feat/a", dir);
  blocked('git -C "$W" commit -m x', "feat/a", dir);
  blocked("git -C ${W:-/abs/wt} commit -m x", "feat/a", dir);
  blocked("cd wt && git commit -m x", "feat/a", dir);
  blocked("cd - && git commit -m x", "feat/a", dir);
  blocked("cd && git commit -m x", "feat/a", dir);
  blocked("cd /abs/wt /abs/repo && git commit -m x", "feat/a", dir);
  blocked("pushd /abs/repo && git commit -m x", "feat/a", dir);
  blocked("npm test && git commit -m x", "feat/a", dir);
  blocked("z repo && git push -u origin HEAD", "feat/a", dir);
  blocked("cd /abs/wt && popd && git commit -m x", "feat/a", dir);
  blocked("bash -c 'git commit -m x'", "feat/a", dir);
  blocked("sudo git commit -m x", "feat/a", dir);
  blocked('git commit -m "$(date)"', "feat/a", dir);
  blocked("(cd /abs/repo && git commit -m x)", "feat/a", dir);
  blocked("for d in /abs/wt; do git -C $d commit -m x; done", "feat/a");
  allowed("npm test && git -C /abs/wt commit -m x", "develop");
  allowed("git fetch && git -C /abs/wt merge origin/develop", "develop");
  allowed("git status && git -C /abs/wt push -u origin HEAD", "develop");
  // an expansion before the subcommand, in a risky subcommand's arguments, or in the program name
  blocked("W='. commit -n'; git -C $W status", "feat/a");
  blocked("git $SUB -m x", "feat/a");
  blocked('git branch -D "$X"', "feat/a");
  blocked("G=git; $G commit -n -m x", "feat/a");
  blocked("${G}it commit -m x", "feat/a");
  blocked("$(echo git) commit -m x", "feat/a");
  blocked("X='git commit -n'; eval \"$X\"", "feat/a");
  allowed('git commit -m "$MSG"', "feat/a");
  allowed('git commit -F "$F"', "feat/a");
  allowed('git add "$F" && git commit -m x', "feat/a");
  // git config that runs a command or moves the hooks
  blocked("git -c core.fsmonitor='git commit -n' status", "feat/a");
  blocked("git -c core.pager='sh x' log", "feat/a");
  blocked("git -c alias.st='!git commit -n' st", "feat/a");
  allowed("git -c user.name=a -c color.ui=always log -1", "feat/a");
  // push --all and --mirror abbreviated
  blocked("git push --mirr origin", "feat/a");
  blocked("git push --branches origin", "feat/a");
});

// The parser approximates the shell. Wherever the two disagree, an allowed command can run git. So run each
// command in the real shells with a `git` shim: whatever the guard allows must never reach git commit/merge/push.
describe("issue 61/63: what the guard allows does not run git commit, merge or push in a real shell", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "guard-shell-"));
  writeFileSync(join(dir, "git"), '#!/bin/sh\necho "$@" >> "$GIT_LOG"\n', { mode: 0o755 });
  const shells = ["/bin/bash", "/bin/zsh"].filter((s) => existsSync(s));
  const corpus = [
    "cat > x.md <<'EOF'\n# notes\ngit commit -m x\nEOF",
    'echo "remember to git commit"',
    "cat > re.mjs <<'EOF'\nconst re = /git commit|git push|git merge/;\nEOF",
    "tee n.md <<'EOF'\ngit commit\nEOF\n",
    "cat <<-EOF\n\tgit push origin main\n\tEOF",
    "echo hi # git commit -m x",
    "cat <<<'EOF'\ngit commit -m x\nEOF",
    "cat <<EO\\F\nEOF\ngit commit -m x\nEO",
    "cat <<'EO'F\nEOF\ngit commit -m x\nEO",
    "cat <<EOF\nEO\\\nF\ngit commit -m x\nEOF",
    "printf -v x %s 'a[$(git commit -m x)]'; echo $[x]",
    "printf '-v' x %s 'a[$(git commit -m x)]'; echo $[x]",
    "cat <<'A' <<'B'\ngit commit\nA\ngit push origin main\nB",
    "echo x; cat <<'EOF'\nEOF\ngit merge feat/x",
    // PR #76 review round 3: brace expansion turns these into `git commit …`
    "git com{mit,} -m x",
    "git {commit,-m,x}",
    // round 4: quotes, backslashes and variables in the program name
    '"g"it commit -m x',
    "g\\it commit -m x",
    "G=git; $G commit -m x",
    "G=g; ${G}it commit -m x",
    "echo commit -m x | xargs git",
    "bash <<< 'git commit -m x'",
  ];
  for (const shell of shells) {
    for (const cmd of corpus) {
      it(`${shell}: ${JSON.stringify(cmd)}`, () => {
        if (checkCommand(cmd, "develop") !== null) return; // blocked: nothing to prove
        const log = join(dir, "log");
        rmSync(log, { force: true });
        spawnSync(shell, ["-c", cmd], { cwd: dir, env: { PATH: `${dir}:/usr/bin:/bin`, GIT_LOG: log }, encoding: "utf8" });
        const ran = existsSync(log) ? readFileSync(log, "utf8") : "";
        assert.doesNotMatch(ran, /^(commit|merge|push)\b/m, `allowed, but the shell ran: git ${ran}`);
      });
    }
  }
});

// PR #76 review: the same differential check for directories. Real dirs, a `git` shim that logs where it ran; the session
// is on a work branch and `repo` is on develop. Whatever the guard allows must never commit or push inside `repo`.
describe("PR #76 review: what the guard allows never commits in a protected dir in a real shell", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "guard-dirs-")));
  const [bin, session, repo, wt, wt2] = ["bin", "session", "repo", "wt", "wt2"].map((d) => join(root, d));
  for (const d of [bin, session, join(repo, "sub"), join(wt, "sub"), wt2]) mkdirSync(d, { recursive: true });
  // The shim logs the dir it acts in: its cwd, moved by each leading `-C`.
  writeFileSync(join(bin, "git"), '#!/bin/sh\nwhile [ "$1" = -C ]; do cd "$2" || exit 1; shift 2; done\necho "$PWD $*" >> "$GIT_LOG"\n', { mode: 0o755 });
  const at = (d) => ({ [repo]: "develop", [join(repo, "sub")]: "develop", [wt]: "fix/x", [join(wt, "sub")]: "fix/y", [wt2]: "fix/y" })[normalize(d)] ?? null;
  const shells = ["/bin/bash", "/bin/zsh"].filter((s) => existsSync(s));
  const corpus = [
    `cd ${repo} || cd ${wt} && git commit -m x`,
    `cd ${wt} || cd ${repo} && git commit -m x`,
    `cd ${repo} || cd ${wt}; git commit -m x`,
    `cd ${repo} || true && git commit -m x`,
    `cd ${repo} && cd /nope || git commit -m x`,
    `cd ${repo} || git -C ${wt} status && git commit -m x`,
    `cd ${repo} || cd ${wt} && git -C ./sub commit -m x`,
    `cd ${repo} || cd ${wt} && git push -u origin HEAD`,
    `cd ${wt} || cd ${wt2} && git commit -m x`,
    `cd ${wt} && git commit -m x`,
    `cd ${wt} || cd ${repo} && git -C ${wt2} commit -m x`,
    // PR #76 review round 3: git text the parser does not record next to the cd
    `cd ${repo} && : 'git x' && git commit -m x`,
    `cd ${repo} && : '!git x'; git push -u origin HEAD`,
    // round 4: quoted and flag-prefixed paths, and commands that move the shell without a plain cd
    `git -C '${repo}' commit -m x`,
    `cd "${repo}" && git commit -m x`,
    `cd -- ${repo} && git commit -m x`,
    `cd -P ${repo} && git commit -m x`,
    `builtin cd ${repo} && git commit -m x`,
    `command cd ${repo} && git push -u origin HEAD`,
    `pushd ${repo} >/dev/null && git commit -m x`,
    `R=${repo}; cd \${R:-${wt}} && git commit -m x`,
    `cd \${HOME:+${repo}} && git commit -m x`,
    `cd ${wt} && cd ${repo} /nope 2>/dev/null; git commit -m x`,
  ];
  for (const shell of shells) {
    for (const cmd of corpus) {
      it(`${shell}: ${JSON.stringify(cmd)}`, () => {
        const log = join(root, "log");
        rmSync(log, { force: true });
        spawnSync(shell, ["-c", cmd], { cwd: session, env: { PATH: `${bin}:/usr/bin:/bin`, GIT_LOG: log }, encoding: "utf8" });
        const ran = existsSync(log) ? readFileSync(log, "utf8") : "";
        const inRepo = ran.split("\n").some((l) => /^\S+ (commit|push)\b/.test(l) && at(l.split(" ")[0]) === "develop");
        if (inRepo) assert.match(checkCommand(cmd, "feat/a", at) ?? "allowed", /blocked/, `the shell ran git in a protected dir: ${ran}`);
      });
    }
  }
  // cherry round 1 (zsh `>!`): any redirect syntax the parser misreads would let a gh config write pass as data.
  // So run each command with a temp HOME: when the guard allows it, gh's config must be untouched.
  const home = join(root, "home");
  const ghConfig = join(home, ".config", "gh", "config.yml");
  const payload = "<<'EOF'\npager: git commit --no-verify -m x\nEOF";
  const writes = [
    `cat > ~/.config/gh/config.yml ${payload}`,
    `cat >! ~/.config/gh/config.yml ${payload}`,
    `cat >>! ~/.config/gh/config.yml ${payload}`,
    `cat >| ~/.config/gh/config.yml ${payload}`,
    `cat &>! ~/.config/gh/config.yml ${payload}`,
    `cat >&! ~/.config/gh/config.yml ${payload}`,
    `cat 1<> ~/.config/gh/config.yml ${payload}`,
    `cat ${payload.split("\n")[0]}>~/.config/gh/config.yml\n${payload.split("\n").slice(1).join("\n")}`,
    `tee ~/.config/gh/config.yml ${payload}`,
    `cd ~/.config/gh && cat > config.yml ${payload}`,
    `cat > ~/.config/"gh"/config.yml ${payload}`,
    `cat > ~/.config/g\\h/config.yml ${payload}`,
  ];
  for (const shell of shells) {
    for (const w of writes) {
      const cmd = `${w}\ngh pr view 1`;
      it(`${shell}: gh config untouched unless blocked: ${JSON.stringify(cmd)}`, () => {
        rmSync(home, { recursive: true, force: true });
        mkdirSync(join(home, ".config", "gh"), { recursive: true });
        spawnSync(shell, ["-c", cmd], { cwd: session, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, GIT_LOG: join(root, "log") }, encoding: "utf8" });
        if (existsSync(ghConfig)) assert.ok(checkCommand(cmd, "feat/a", at), `allowed, but the shell wrote ${ghConfig}`);
      });
    }
  }

  // round 4 (4661196015): a file written in one call and run in a later one. Whatever write the guard allows, running the
  // file must never pass git a hook-skipping flag.
  const script = join(root, "s.sh");
  const skipWrites = [
    "git commit -{n,m} x",
    "git commit --no-{verify,} -m x",
    "git commit -[n] -m x",
    'git commit -"n" -m x',
    "git commit \\-n -m x",
    "git commit --no-ver'ify' -m x",
    "F=-n; git commit $F -m x",
    "git commit -m x",
  ].flatMap((body) => [`cat > ${script} <<'EOF'\n${body}\nEOF`, `echo '${body.replaceAll("'", "'\\''")}' > ${script}`]);
  for (const shell of shells) {
    for (const w of [...skipWrites, `printf 'git commit -%s -m x\\n' n > ${script}`]) {
      it(`${shell}: a file the guard lets be written never skips hooks when run: ${JSON.stringify(w)}`, () => {
        const log = join(root, "log");
        rmSync(log, { force: true });
        rmSync(script, { force: true });
        spawnSync(shell, ["-c", w], { cwd: session, env: { PATH: `${bin}:/usr/bin:/bin` } });
        spawnSync(shell, [script], { cwd: session, env: { PATH: `${bin}:/usr/bin:/bin`, GIT_LOG: log } });
        const ran = existsSync(log) ? readFileSync(log, "utf8") : "";
        if (/ commit .*(^| )(-[a-zA-Z]*n[a-zA-Z]*|--no-v\S*)( |$)/m.test(ran)) assert.ok(checkCommand(w, "feat/a", at), `allowed, but running the file ran: git ${ran}`);
      });
    }
  }

  it("the corpus does reach the protected dir", () => {
    const log = join(root, "log");
    rmSync(log, { force: true });
    spawnSync("/bin/sh", ["-c", corpus[0]], { cwd: session, env: { PATH: `${bin}:/usr/bin:/bin`, GIT_LOG: log } });
    assert.match(readFileSync(log, "utf8"), new RegExp(`^${repo} commit`));
  });
});
