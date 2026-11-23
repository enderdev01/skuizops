import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandViolation, editViolation, patchPaths } from "./path-guard.mjs";

const env = { HOME: "/Users/ada" };
const project = "/Users/ada/DEV/app";

describe("editViolation", () => {
  it("blocks the git hooks", () => assert.match(editViolation(`${project}/.githooks/pre-commit`, project, env), /ask the human/));
  it("blocks the copied guard", () => assert.ok(editViolation(`${project}/scripts/guard/branch-guard.mjs`, project, env)));
  it("blocks .git, also nested", () => assert.ok(editViolation(`${project}/sub/.git/config`, project, env)));
  it("blocks a relative path", () => assert.ok(editViolation(".githooks/pre-push", project, env)));
  it("blocks the trust list even outside ~/DEV", () =>
    assert.match(editViolation("/Users/ada/.config/skuizops/trusted-projects", "/tmp/x", env), /trusted-projects/));
  it("allows normal source files", () => assert.equal(editViolation(`${project}/scripts/control.mjs`, project, env), null));
  it("allows look-alike names", () => assert.equal(editViolation(`${project}/src/.githooks-docs.md`, project, env), null));
  it("blocks case variants (case-insensitive volumes)", () => {
    assert.ok(editViolation(`${project}/.GITHOOKS/pre-commit`, project, env));
    assert.ok(editViolation(`${project}/Scripts/Guard/x.mjs`, project, env));
    assert.ok(editViolation("/Users/ada/.config/Skuizops/trusted-projects", project, env));
  });
  it("blocks another project's hooks under ~/DEV", () => assert.ok(editViolation("/Users/ada/DEV/other/.githooks/x", project, env)));
  it("blocks the installed plugins", () => assert.ok(editViolation("/Users/ada/.claude/plugins/cache/zz/skuizops/9.9.9/scripts/branch-guard.mjs", project, env)));
  it("blocks a symlink that points at a protected folder", () => {
    const home = mkdtempSync(join(tmpdir(), "pg-"));
    const app = join(home, "DEV", "app");
    mkdirSync(join(app, ".githooks"), { recursive: true });
    mkdirSync(join(home, ".config", "skuizops"), { recursive: true });
    symlinkSync(join(app, ".githooks"), join(app, "hk"));
    symlinkSync(join(home, ".config", "skuizops"), join(app, "cfg"));
    assert.ok(editViolation(join(app, "hk", "pre-commit"), app, { HOME: home }));
    assert.ok(editViolation(join(app, "cfg", "trusted-projects"), app, { HOME: home }));
  });
  it("ignores projects outside ~/DEV", () => assert.equal(editViolation("/Users/ada/other/.githooks/x", "/Users/ada/other", env), null));
});

describe("hook entry point", () => {
  const script = fileURLToPath(new URL("./path-guard.mjs", import.meta.url));
  const run = (file) =>
    spawnSync("node", [script], {
      input: JSON.stringify({ tool_input: { file_path: file } }),
      env: { ...process.env, HOME: "/Users/ada", CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
    });
  it("exits 2 with the reason", () => {
    const r = run(`${project}/.githooks/pre-commit`);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.githooks/);
  });
  it("exits 0 on an allowed file", () => assert.equal(run(`${project}/src/a.ts`).status, 0));
});

describe("editViolation: more protected files", () => {
  for (const file of [".claude/settings.json", ".claude/settings.local.json", ".gitconfig", ".config/git/ignore", ".zshrc", ".zshenv", ".zprofile", ".bashrc", ".bash_profile", ".profile"]) {
    it(`blocks ~/${file} even outside ~/DEV`, () => assert.ok(editViolation(`/Users/ada/${file}`, "/tmp/x", env)));
  }
  it("blocks a project .claude/settings*.json under a scope root only", () => {
    assert.ok(editViolation(`${project}/.claude/settings.json`, project, env));
    assert.ok(editViolation(`${project}/.claude/settings.local.json`, project, env));
    assert.equal(editViolation("/Users/ada/other/.claude/settings.json", "/Users/ada/other", env), null);
  });
  it("allows the feature map", () => assert.equal(editViolation(`${project}/.claude/verification/features/README.md`, project, env), null));
  // PR #76 review: a gh alias, pager, editor or browser written to gh's config runs shell on the next gh call.
  it("blocks gh's config dir even outside ~/DEV", () => {
    assert.ok(editViolation("/Users/ada/.config/gh/config.yml", "/tmp/x", env));
    assert.ok(editViolation("/Users/ada/.config/GH/hosts.yml", "/tmp/x", env));
    assert.ok(editViolation("/Users/ada/ghc/config.yml", "/tmp/x", { ...env, GH_CONFIG_DIR: "/Users/ada/ghc" }));
    assert.ok(editViolation("/Users/ada/xdg/gh/config.yml", "/tmp/x", { ...env, XDG_CONFIG_HOME: "/Users/ada/xdg" }));
  });
  it("allows look-alikes of gh's config dir", () => {
    assert.equal(editViolation("/Users/ada/.config/ghostty/config", "/tmp/x", env), null);
    assert.equal(editViolation("/Users/ada/xdg/gh/config.yml", "/tmp/x", env), null);
  });
});

describe("commandViolation", () => {
  const home = mkdtempSync(join(tmpdir(), "pg-cmd-"));
  const app = join(home, "DEV", "app");
  const cache = join(home, ".claude", "plugins", "cache", "skuizops");
  const trust = join(home, ".config", "skuizops", "trusted-projects");
  mkdirSync(join(app, ".githooks"), { recursive: true });
  mkdirSync(join(app, ".git"), { recursive: true });
  mkdirSync(cache, { recursive: true });
  mkdirSync(join(home, ".config", "skuizops"), { recursive: true });
  writeFileSync(trust, "");
  const check = (command) => commandViolation(command, { project: app, cwd: app, env: { HOME: home } });

  for (const command of [
    "echo x > .githooks/pre-commit",
    "echo x >> .githooks/pre-commit",
    "echo x >> .git/config",
    "sed -i s/a/b/ .githooks/pre-commit",
    "chmod -x .githooks/pre-commit",
    "cp x .githooks/pre-commit",
    "ln -s x .githooks/pre-commit",
    `mkdir -p ${cache}/x`,
    'rm .g""it/config',
    "cd .githooks; rm pre-commit",
    "ls\nrm .githooks/pre-commit",
    "echo $(rm .githooks/pre-commit)",
    "ls & rm .githooks/pre-commit",
    "git checkout HEAD~1 -- .githooks",
    "FOO=1 sudo rm .githooks/pre-commit",
    "echo x >| .githooks/pre-commit",
    "echo x >! .githooks/pre-commit",
    "echo x >>! .githooks/pre-commit",
    "echo x &>| .githooks/x",
    "echo x &>| ~/.zshrc",
    "echo x >& .githooks/pre-commit",
    "echo x >&.githooks/pre-commit",
    "echo x &> .githooks/x",
    "echo x &>> .githooks/x",
    "echo x 2>&1 > .githooks/x",
    "git -C .githooks checkout -- .",
    'sed -i "" s/a/b/ .githooks/x',
    "\\rm .githooks/pre-commit",
    "'rm' .githooks/pre-commit",
    "{ rm .githooks/pre-commit; }",
    "pushd .githooks && rm pre-commit",
    `rm ${home}/.config/skuizops/trusted-proj*`,
    "rm ~/.config/skuizops/trusted-proj*",
    "echo x->.githooks/pre-commit",
    "echo x=>.githooks/pre-commit",
    "echo x->~/.zshrc",
    "sed -i '' -es/a/b/ .githooks/pre-commit",
    "perl -pi -es/a/b/ .githooks/pre-commit",
    "perl -i -pe's/a/b/' .githooks/pre-commit",
    "sed -i --expression=s/a/b/ .githooks/pre-commit",
    "sed -i --file=/tmp/s .githooks/pre-commit",
    "sed -i -f/tmp/s .githooks/pre-commit",
  ]) it(`blocks: ${JSON.stringify(command)}`, () => assert.ok(check(command)));

  for (const command of [
    `cat ${app}/.githooks/pre-commit`,
    `ls ${app}/.git`,
    `cp ${cache}/templates/control.mjs scripts/control.mjs`,
    `node ${cache}/scripts/x.mjs`,
    'git commit -m "fix .githooks/pre-commit"',
    "git status",
    "grep -r foo --exclude-dir=.git .",
    "echo x > src/a.ts",
    'node -e "console.log([1].map(x=>x+1))"',
    'grep -- "->" f',
  ]) it(`allows: ${command}`, () => assert.equal(check(command), null));

  it("blocks shell writes to gh's config dir (PR #76 review)", () => {
    const ghEnv = { HOME: home, GH_CONFIG_DIR: join(home, "ghc"), XDG_CONFIG_HOME: join(home, "xdg") };
    const ghCheck = (command) => commandViolation(command, { project: app, cwd: app, env: ghEnv });
    for (const c of [
      "cat > ~/.config/gh/config.yml <<'EOF'\naliases:\n  ci: '!git commit --no-verify'\nEOF\ngh ci",
      "tee -a ~/.config/gh/config.yml <<'EOF'\npager: sh\nEOF",
      "echo 'pager: sh' >> $HOME/.config/gh/config.yml && gh pr view 1",
      "echo 'pager: sh'>~/.config/gh/config.yml",
      "cd ~/.config/gh && echo 'pager: sh' > config.yml",
      "cat > \"$GH_CONFIG_DIR/config.yml\" <<'EOF'\npager: sh\nEOF",
      "cat > ${XDG_CONFIG_HOME}/gh/config.yml <<'EOF'\npager: sh\nEOF",
      "cp /tmp/c.yml ~/.config/gh/config.yml",
      "cat >! ~/.config/gh/config.yml <<'EOF'\npager: sh\nEOF",
      "echo 'pager: sh' >>! ~/.config/gh/config.yml",
      "echo 'pager: sh' &>| ~/.config/gh/config.yml",
      "echo 'pager: sh' &>>| ~/.config/gh/config.yml",
      "echo 'pager: sh' &>! ~/.config/gh/config.yml",
      // PR #76 review round 3: parameter expansion with a default
      "echo 'pager: sh' > ${GH_CONFIG_DIR:-$HOME/.config/gh}/config.yml",
      'echo \'pager: sh\' > "${GH_CONFIG_DIR:-$HOME/.config/gh}/config.yml"',
      "echo 'pager: sh' > ${GH_CONFIG_DIR-~/.config/gh}/config.yml",
      "echo 'pager: sh' > ${XDG_CONFIG_HOME:-$HOME/.config}/gh/config.yml",
      "echo 'pager: sh' > ${XDG_CONFIG_HOME:=${HOME}/.config}/gh/config.yml",
      "echo 'pager: sh' > ${UNSET_VAR:-$HOME/.config/gh}/config.yml",
      "tee ${GH_CONFIG_DIR:-$HOME/.config/gh}/config.yml <<'EOF'\npager: sh\nEOF",
    ]) assert.match(ghCheck(c) ?? "allowed", /protected user file/, c);
    // the env value is not the only choice: with GH_CONFIG_DIR unset the default is the one written
    const unset = (command) => commandViolation(command, { project: app, cwd: app, env: { HOME: home } });
    assert.match(unset("echo 'pager: sh' > ${GH_CONFIG_DIR:-$HOME/.config/gh}/config.yml") ?? "allowed", /protected user file/);
    assert.match(unset("echo 'pager: sh' > ${XDG_CONFIG_HOME:-$HOME/.config}/gh/hosts.yml") ?? "allowed", /protected user file/);
    assert.equal(unset("echo x > ${TMPDIR:-/tmp}/notes.txt"), null);
    assert.equal(ghCheck("cat ~/.config/gh/config.yml"), null);
    assert.equal(ghCheck("gh pr view 1 > /tmp/pr.txt"), null);
  });

  // cherry rounds 1-2 (zsh `>!`, `&>|`): run every write syntax in the real shells; whatever path-guard allows must not touch gh's config.
  describe("what path-guard allows does not write gh's config in a real shell", () => {
    const ghFile = join(home, ".config", "gh", "config.yml");
    const forms = [">", ">>", ">|", ">!", ">>!", ">>|", "&>", "&>>", "&>|", "&>!", "&>>|", "&>>!", ">&", ">&!", "1>", "2>", "1>>!", "1<>"];
    for (const shell of ["/bin/bash", "/bin/zsh"].filter((s) => existsSync(s))) {
      for (const op of forms) {
        for (const cmd of [`echo x ${op} ~/.config/gh/config.yml`, `echo x ${op}~/.config/gh/config.yml`]) {
          it(`${shell}: ${cmd}`, () => {
            rmSync(join(home, ".config", "gh"), { recursive: true, force: true });
            mkdirSync(join(home, ".config", "gh"), { recursive: true });
            spawnSync(shell, ["-c", cmd], { cwd: app, env: { HOME: home, PATH: "/usr/bin:/bin" } });
            if (existsSync(ghFile)) assert.ok(check(cmd), `allowed, but ${shell} wrote ${ghFile}`);
          });
        }
      }
    }
  });

  it("allows a plain cat of the trust list", () => assert.equal(check(`cat ${trust}`), null));
  it("blocks cat of the trust list with a redirection", () => assert.ok(check(`cat ${trust} > x`)));
  it("blocks an interpreter one-liner mentioning the trust list", () =>
    assert.ok(check(`node -e "require('fs').appendFileSync('${trust}','y')"`)));

  it("blocks running install-hooks.mjs, however the name is spelled", () => {
    for (const c of ["node /p/scripts/install-hooks.mjs", 'node "$CLAUDE_PLUGIN_ROOT/scripts/install-hooks.mjs" /work/app', 'node /p/scripts/install-"hooks".mjs', "node /p/scripts/install-hooks\\.mjs"]) {
      assert.match(check(c), /\/skuizops:install-hooks/, c);
    }
  });
  it("allows reading install-hooks.mjs", () => assert.equal(check("cat /p/scripts/install-hooks.mjs"), null));

  it("blocks running publish.mjs", () => {
    for (const c of ["node plugins/skuizops/scripts/publish.mjs", 'node "$CLAUDE_PLUGIN_ROOT/scripts/publish.mjs" x/y']) {
      assert.match(check(c), /\/skuizops:publish/, c);
    }
  });
  // The entry point already prefixes "skuizops: ", so a message must not carry it again.
  it("returns block messages without the skuizops: prefix", () => {
    for (const c of ["node plugins/skuizops/scripts/publish.mjs", "node /p/scripts/install-hooks.mjs", `cat ${trust} > x`]) {
      assert.doesNotMatch(check(c), /^skuizops:/, c);
    }
  });
  it("allows testing and reading publish.mjs", () => {
    assert.equal(check("node --test plugins/skuizops/scripts/publish.test.mjs"), null);
    assert.equal(check("cat plugins/skuizops/scripts/publish.mjs"), null);
  });

  it("blocks agents from running the one-command setup", () => {
    for (const c of ["node bin/setup.mjs", "npx github:enderdev01/skuizops", "npx skuizops-setup", 'node "./bin/set"up.mjs', "cd /tmp && npx github:enderdev01/skuizops", "FOO=1 node bin/setup.mjs", "pnpm dlx github:enderdev01/skuizops", 'bash -c "npx github:enderdev01/skuizops"', "sh -c 'node bin/setup.mjs'", 'zsh -lc "cd /tmp && npx github:enderdev01/skuizops"', 'eval "npx github:enderdev01/skuizops"', `bash -c "bash -c 'npx github:enderdev01/skuizops'"`, "/usr/bin/env node bin/setup.mjs", "bash bin/setup.mjs", "npm x github:enderdev01/skuizops", "npm --yes exec github:enderdev01/skuizops"]) {
      assert.match(check(c), /npx github:enderdev01\/skuizops/, c);
    }
  });
  it("allows reading the setup", () => {
    for (const c of ["cat bin/setup.mjs", "grep npx README.md enderdev01/skuizops", "git switch -c x && grep -n trust bin/setup.mjs", "chmod 755 bin/setup.mjs", 'bash -c "grep -n x bin/setup.mjs"', 'gh pr create --title t --body "run npx github:enderdev01/skuizops"', 'git commit -m "docs: npx github:enderdev01/skuizops"']) assert.equal(check(c), null, c);
  });

  describe("entry point `bash`", () => {
    const script = fileURLToPath(new URL("./path-guard.mjs", import.meta.url));
    const outside = mkdtempSync(join(tmpdir(), "pg-out-"));
    const run = (args, payload) =>
      spawnSync("node", [script, ...args], { input: JSON.stringify(payload), env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: outside }, encoding: "utf8" });
    it("exits 2 on a write to the trust list from outside every scope root", () => {
      const r = run(["bash"], { cwd: outside, tool_input: { command: `echo ${outside} >> ${trust}` } });
      assert.equal(r.status, 2, r.stderr);
    });
    it("still handles Edit payloads without the argument", () =>
      assert.equal(run([], { cwd: outside, tool_input: { file_path: trust } }).status, 2));
  });
});

describe("marketplace source repo", () => {
  const home = mkdtempSync(join(tmpdir(), "pg-mk-"));
  const M = join(home, "DEV", "market");
  const other = join(home, "DEV", "other");
  mkdirSync(join(M, "plugins", "x", "agents"), { recursive: true });
  mkdirSync(join(M, "plugins", "x", "hooks"), { recursive: true });
  mkdirSync(`${M}-worktrees/x`, { recursive: true });
  mkdirSync(other, { recursive: true });
  mkdirSync(join(home, ".claude", "plugins"), { recursive: true });
  const known = join(home, ".claude", "plugins", "known_marketplaces.json");
  writeFileSync(known, JSON.stringify({
    m: { source: { source: "directory", path: M }, installLocation: M },
    g: { source: { source: "github", repo: "a/b" }, installLocation: other },
  }));
  const e = { HOME: home };
  const file = join(M, "plugins", "x", "agents", "a.md");
  it("blocks edits from another project", () => assert.match(editViolation(file, other, e), /source of an installed plugin marketplace/));
  it("blocks when there is no project", () => assert.ok(editViolation(file, undefined, e)));
  it("allows edits from inside the repo", () => {
    assert.equal(editViolation(file, M, e), null);
    assert.equal(editViolation(file, join(M, "plugins"), e), null);
  });
  it("ignores a look-alike sibling", () => assert.equal(editViolation(join(`${M}-worktrees/x`, "a.md"), other, e), null));
  it("ignores github marketplaces", () => assert.equal(editViolation(join(other, "a.md"), M, e), null));
  it("tolerates a malformed or missing file", () => {
    writeFileSync(known, "{nope");
    assert.equal(editViolation(file, other, e), null);
    assert.equal(editViolation(file, other, { HOME: join(home, "none") }), null);
  });
  it("covers shell writes, not reads", () => {
    writeFileSync(known, JSON.stringify({ m: { source: { source: "directory", path: M } } }));
    const hooks = join(M, "plugins", "x", "hooks", "hooks.json");
    const run = (c) => commandViolation(c, { project: other, cwd: other, env: e });
    assert.ok(run(`sed -i s/a/b/ ${hooks}`));
    assert.equal(run(`cat ${hooks}`), null);
  });
  it("sees git -C into the marketplace source as a write", () => {
    writeFileSync(known, JSON.stringify({ m: { source: { source: "directory", path: M } } }));
    const run = (c) => commandViolation(c, { project: other, cwd: other, env: e });
    for (const c of [`git -C ${M} checkout -- .`, `git -C ${M} stash`, `git -C ${M} reset --hard`, `git -C ${M} clean -fd`, `git -C ${M} checkout HEAD -- README.md`, `cd ${M} && git stash`]) {
      assert.match(run(c), /source of an installed plugin marketplace/, c);
    }
    assert.equal(run(`git -C ${M} status`), null);
    assert.equal(run("git stash"), null);
  });
  it("blocks unquoted -> redirects, glued sed scripts and --git-dir/--work-tree into the marketplace", () => {
    writeFileSync(known, JSON.stringify({ m: { source: { source: "directory", path: M } } }));
    const run = (c) => commandViolation(c, { project: other, cwd: other, env: e });
    for (const c of [`echo x->${M}/README.md`, `sed -i '' -es/a/b/ ${M}/README.md`, `git --work-tree=${M} --git-dir=${M}/.git checkout -- .`]) {
      assert.match(run(c), /source of an installed plugin marketplace/, c);
    }
  });
});

describe("cherry is read-only on the project", () => {
  const run = (c, readOnly = true) => commandViolation(c, { project, cwd: project, env, readOnly });
  for (const c of ["echo x > src/a.ts", "sed -i s/a/b/ src/a.ts", "git stash", "git stash push poi.ts", "git checkout -- poi.ts", "cd sub && rm f", "git worktree remove /Users/ada/DEV/app-worktrees/x", "git worktree remove --force .", 'git worktree remove --force "$(pwd)/wt"',
    "git am x.patch", "git pull", "git update-index --assume-unchanged a", "git update-ref -d refs/x", "git tag v1", "git tag -d v1",
    "git branch -d x", "git branch -D x", "git branch -f x", "git branch -m a b", "git branch -M a b", "git branch newname",
    "echo x > $PWD/README.md", "echo x > ${PWD}/README.md", "echo x &> src/a.ts", "echo x >&src/a.ts", "echo x &>> src/a.ts",
    "echo a->b", "sed -i '' -es/a/b/ README.md", "perl -pi -es/a/b/ README.md", "perl -i -pe's/a/b/' README.md", "sed -i --expression=s/a/b/ README.md",
    "sed -i --file=/tmp/s README.md", "sed -i -f/tmp/s README.md",
    'echo x > "$(pwd)/README.md"', 'rm -rf "$(pwd)/plugins"', 'echo x > "$(git rev-parse --show-toplevel)/README.md"',
    'cd "$(git rev-parse --show-toplevel)" && git stash', "cd $(pwd) && git stash",
    `cd /tmp && git --git-dir=${project}/.git --work-tree=${project} stash`,
    "cat > src/a.ts <<'EOF'\nx\nEOF", 'echo "<<X"\nrm -rf src', "echo '<<X'\nrm src\nX", "cat > /tmp/x <<EOF\nrm src", "cat > /tmp/x <<EOF\n$(rm -rf src)\nEOF", "cat > /tmp/x <<EOF\n`rm -rf src`\nEOF",
    "ln -s /tmp/a src/link", "ln -s /tmp/a", "ln -s /tmp/a -t src", "ln -s /tmp/a --target-directory=src", "ln -s /tmp/a -tsrc"]) {
    it(`blocks ${c}`, () => assert.match(run(c), /read-only on the project/));
  }
  for (const c of ["cat src/a.ts", "git diff", "git status", "node scripts/control.mjs verify", "echo x > $TMPDIR/foo", "git worktree add /tmp/somewhere", "git worktree remove --force /tmp/x", 'git worktree remove --force "$W"', `git worktree remove ${tmpdir()}/tmp.abc`,
    "node scripts/control.mjs verify 2>&1 | tail -40", "npm test 2>&1", "ls >/dev/null 2>&1", "echo x >&2", "echo x >&-",
    'node -e "console.log([1].map(x=>x+1))"', "echo err >&2",
    'git worktree add "$(mktemp -d)"', 'D=$(mktemp -d) && cp -R . "$D/repo"',
    'cp -R /some/dir "$(mktemp -d)"', 'cp -R . "$(mktemp -d)"', "sed -i '' s/a/b/ /tmp/wt/README.md", "sed -i -e s/a/b/ /tmp/wt/README.md",
    "perl -pi -e 's/a/b/' /tmp/wt/README.md", "sed -i s/a/b/ /tmp/wt/a.md", 'cd "$(mktemp -d)" && git stash',
    "git -C /tmp/wt checkout HEAD -- README.md", "cd /tmp/wt && git stash", "git stash list", "git stash show",
    "git tag", "git tag -l", "git branch", "git branch --list", "git branch -a",
    "S=/var/folders/x/T/tmp.Q; cat > $S/probe.test.ts <<'EOF'\nconst f = (p) => { return p; };\nEOF",
    'cat > "$(mktemp -d)/x" <<\'EOF\'\nconst f = (p) => p;\nif (a) > { b }\nEOF',
    'cat > /tmp/x <<EOF\na => b\nEOF\ncat > /tmp/y <<-"END"\n\t$(rm -rf src)\n\tEND',
    `ln -s ${project}/node_modules /tmp/wt/node_modules`, `ln -s ${project}/a -t /tmp/wt`]) {
    it(`allows ${c}`, () => assert.equal(run(c), null));
  }
  it("still checks the sed/perl file operands, not the script", () => {
    assert.match(run("sed -i '' s/a/b/ src/a.ts"), /read-only on the project/);
    assert.match(run("perl -pi -e 's/a/b/' src/a.ts"), /read-only on the project/);
    assert.match(run("sed -i -e s/a/b/ -f x src/a.ts"), /read-only on the project/);
  });
  it("is off for other agents", () => assert.equal(run("echo x > src/a.ts", false), null));
  describe("hook entry point", () => {
    const script = fileURLToPath(new URL("./path-guard.mjs", import.meta.url));
    const bash = (agent_type, command = "git stash") =>
      spawnSync("node", [script, "bash"], {
        input: JSON.stringify({ agent_type, cwd: project, tool_input: { command } }),
        env: { ...process.env, HOME: "/Users/ada", CLAUDE_PROJECT_DIR: project },
        encoding: "utf8",
      });
    it("exits 2 for cherry", () => assert.equal(bash("skuizops:cherry").status, 2));
    it("exits 0 for mango", () => assert.equal(bash("skuizops:mango").status, 0));
    it("exits 0 for cherry running verify with 2>&1 | tail", () =>
      assert.equal(bash("skuizops:cherry", "node scripts/control.mjs verify 2>&1 | tail -40").status, 0));
  });
});

describe("mango edits with Edit or Write", () => {
  const run = (c, toolEditsOnly = true, p = project) => commandViolation(c, { project: p, cwd: p, env, toolEditsOnly });
  for (const c of ["cd /Users/ada/DEV/app-worktrees/x && python3 - <<'E'\np='src/a.ts'\ns=open(p).read()\nopen(p,'w').write(s.replace('a','b'))\nE",
    "cat >> src/storm.ts <<'EOF'\nexport const x = 1\nEOF", "echo x > src/a.ts", "echo x > /Users/ada/DEV/app-worktrees/x/src/a.ts",
    "sed -i '' s/a/b/ src/a.ts", "perl -pi -e s/a/b/ src/a.ts", "printf x | tee src/a.ts", `node -e "require('fs').writeFileSync('src/a.ts','x')"`]) {
    it(`blocks ${c}`, () => assert.match(run(c), /mango edits files with Edit or Write/));
  }
  for (const c of ["npm test", "node scripts/control.mjs verify > /tmp/v.log 2>&1", "cat > /tmp/u.sh <<'EOF'\necho hi\nEOF", "python3 - <<'EOF'\nimport json\nprint(1)\nEOF",
    "rm src/old.ts", "mkdir -p src/new", "git add -A && git commit -m x", "npm run build > /dev/null", "echo x > $S/out.txt", 'git worktree add "$(mktemp -d)" HEAD']) {
    it(`allows ${c}`, () => assert.equal(run(c), null));
  }
  it("is off unless toolEditsOnly", () => assert.equal(run("echo x > src/a.ts", false), null));
  it("is off outside the scope roots", () => assert.equal(run("echo x > src/a.ts", true, "/opt/app"), null));
});

describe("lemon edits with Edit or Write", () => {
  const run = (c, p = project) => commandViolation(c, { project: p, cwd: p, env: { ...env, TMPDIR: "/var/folders/ab/T" }, toolEditsOnly: "lemon" });
  for (const c of ["python3 - <<'EOF'\np='src/a.ts'\nopen(p,'w').write('x')\nEOF", "sed -i '' s/a/b/ src/a.ts"]) {
    it(`blocks ${c}`, () => assert.match(run(c), /lemon edits files with Edit or Write \(apply_patch in Codex\)/));
  }
  for (const c of ["echo x > $TMPDIR/a.txt", "cat > /tmp/claude-501/x/pr-body.md <<'EOF'\nbody\nEOF", "git commit -m x && git push -u origin fix/x",
    "gh pr create --body-file /tmp/claude-501/x/pr-body.md", "pnpm install", "node scripts/control.mjs verify", 'git worktree add "$(mktemp -d)" HEAD',
    "git merge --no-ff feat/x"]) {
    it(`allows ${c}`, () => assert.equal(run(c), null));
  }
  it("a main session without agent_type is unchanged", () => {
    const hook = (agent_type) => spawnSync("node", [fileURLToPath(new URL("./path-guard.mjs", import.meta.url)), "bash"], {
      input: JSON.stringify({ ...(agent_type && { agent_type }), cwd: project, tool_input: { command: "echo x > src/a.ts" } }),
      env: { ...process.env, HOME: "/Users/ada", CLAUDE_PROJECT_DIR: project }, encoding: "utf8" });
    assert.equal(hook().status, 0);
    assert.equal(hook("skuizops:lemon").status, 2);
  });
});

describe("apply_patch (Codex)", () => {
  const script = fileURLToPath(new URL("./path-guard.mjs", import.meta.url));
  const run = (patch) =>
    spawnSync("node", [script], {
      input: JSON.stringify({ cwd: project, tool_name: "apply_patch", tool_input: { command: `*** Begin Patch\n${patch}\n*** End Patch` } }),
      env: { ...process.env, HOME: "/Users/ada", CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
    });
  it("blocks Update File on a protected file", () => {
    const r = run("*** Update File: .githooks/pre-commit\n@@\n-x\n+y");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\.githooks/);
  });
  it("blocks Add File on a protected file", () => assert.equal(run("*** Add File: .githooks/new\n+x").status, 2));
  it("blocks Delete File on a protected file", () => assert.equal(run("*** Delete File: .githooks/pre-commit").status, 2));
  it("blocks Move to a protected target", () => assert.equal(run("*** Update File: src/a.ts\n*** Move to: .githooks/a.ts\n@@\n-x\n+y").status, 2));
  it("allows a patch on a normal file", () => assert.equal(run("*** Update File: src/a.ts\n@@\n-x\n+y").status, 0));
  it("blocks a multi-file patch when only the second file is protected", () =>
    assert.equal(run("*** Update File: src/a.ts\n@@\n-x\n+y\n*** Update File: .githooks/pre-commit\n@@\n-x\n+y").status, 2));
  it("blocks an indented header on a protected file", () => assert.equal(run("  *** Update File: .githooks/pre-commit\n@@\n-x\n+y").status, 2));
  it("blocks apply_patch run from the shell on a protected file", () => {
    const r = spawnSync("node", [script, "bash"], {
      input: JSON.stringify({ cwd: project, tool_name: "Bash", tool_input: { command: "apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: .githooks/pre-commit\n@@\n-x\n+y\n*** End Patch\nEOF" } }),
      env: { ...process.env, HOME: "/Users/ada", CLAUDE_PROJECT_DIR: project },
      encoding: "utf8",
    });
    assert.equal(r.status, 2);
  });
  it("extracts all four header kinds, relative paths resolved against cwd", () =>
    assert.deepEqual(patchPaths("*** Add File: a\n*** Update File: /b\n*** Move to: c\n*** Delete File: d", "/w"), ["/w/a", "/b", "/w/c", "/w/d"]));
});
