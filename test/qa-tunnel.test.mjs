// scripts/qa-tunnel.sh: arguments, the refusal when a secret file is in the repo, the link line, and the cleanup,
// with stand-ins for wrangler, cloudflared and the self-check (QA_TUNNEL_WRANGLER, _CLOUDFLARED and _CHECK).
// Each test runs in its own small git repo with its own origin and its own TMPDIR, so nothing of the real repo moves.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const realRoot = resolve(import.meta.dirname, "..");
const SCRIPT = readFileSync(join(realRoot, "scripts/qa-tunnel.sh"), "utf8");
const URL_LINE = "https://fake-words-here.trycloudflare.com";

const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com" } });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const never = (promise, ms) => {
  let timer;
  const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error(`still waiting after ${ms} ms`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

/** A repo with origin/dev holding the script, plus stand-ins. `files` are committed on dev. */
function world({ files = {}, check = "exit 0", cloudflared = null, wrangler = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "qa-tunnel-test-"));
  const origin = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const tmp = join(dir, "tmp");
  const fake = join(dir, "fake");
  for (const d of [tmp, fake, repo, join(dir, "home")]) mkdirSync(d, { recursive: true });
  git(dir, "init", "-q", "--bare", "-b", "dev", origin);
  git(repo, "init", "-q", "-b", "dev");
  git(repo, "remote", "add", "origin", origin);
  mkdirSync(join(repo, "scripts"), { recursive: true });
  writeFileSync(join(repo, "scripts/qa-tunnel.sh"), SCRIPT, { mode: 0o755 });
  writeFileSync(join(repo, "README.md"), "fixture\n");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(repo, name), text);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "dev");
  git(repo, "push", "-q", "origin", "dev");
  git(repo, "fetch", "-q", "origin");
  const script = (name, body) => { const file = join(fake, name); writeFileSync(file, body); chmodSync(file, 0o755); return file; };
  // wrangler: records its arguments and whether Cloudflare credentials reached it, serves 200 on --port.
  const wranglerBin = script("wrangler", wrangler?.replaceAll("__FAKE__", fake) ?? `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { createServer } = require("node:http");
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(join(fake, "wrangler.json"))}, JSON.stringify({ args, cwd: process.cwd(), token: process.env.CLOUDFLARE_API_TOKEN ?? null, account: process.env.CLOUDFLARE_ACCOUNT_ID ?? null, pid: process.pid }));
createServer((req, res) => res.end("fake page")).listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");
`);
  const cloudflaredBin = script("cloudflared", cloudflared?.replaceAll("__FAKE__", fake) ?? `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
writeFileSync(${JSON.stringify(join(fake, "cloudflared.json"))}, JSON.stringify({ args: process.argv.slice(2), pid: process.pid, tunnelToken: process.env.TUNNEL_TOKEN ?? null, tunnelTokenFile: process.env.TUNNEL_TOKEN_FILE ?? null, token: process.env.CLOUDFLARE_API_TOKEN ?? null, account: process.env.CLOUDFLARE_ACCOUNT_ID ?? null }));
console.error("2026-11-09T20:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):");
console.error("2026-11-09T20:00:00Z INF |  ${URL_LINE}  |");
console.error("2026-11-09T20:00:01Z INF Registered tunnel connection connIndex=0 connection=00000000-0000-0000-0000-000000000000 event=0 ip=198.41.200.43 location=ams18 protocol=quic");
setInterval(() => {}, 1000);
`);
  const checkBin = script("check", `#!/usr/bin/env bash\necho "check called with $1" > ${JSON.stringify(join(fake, "check.txt"))}\n${check.replaceAll("__FAKE__", fake)}\n`);
  const env = { ...process.env, TMPDIR: tmp, QA_TUNNEL_WRANGLER: wranglerBin, QA_TUNNEL_CLOUDFLARED: cloudflaredBin, QA_TUNNEL_CHECK: checkBin, CLOUDFLARE_API_TOKEN: "not-for-wrangler", CLOUDFLARE_ACCOUNT_ID: "not-for-wrangler", TUNNEL_TOKEN: "not-for-cloudflared", TUNNEL_TOKEN_FILE: "/not/for/cloudflared", HOME: join(dir, "home") };
  const info = (name) => JSON.parse(readFileSync(join(fake, name), "utf8"));
  return {
    dir, repo, tmp, fake, env, info,
    has: (name) => existsSync(join(fake, name)),
    /** Run the script to its end; resolves { code, out }. */
    run(args = [], { timeout = 30000 } = {}) {
      return never(new Promise((done) => {
        const child = spawn("bash", [join(repo, "scripts/qa-tunnel.sh"), ...args], { cwd: repo, env });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) => done({ code, out }));
      }), timeout);
    },
    /** Start it and hand back the child, its output so far and a way to wait for a line. */
    start(args = []) {
      const child = spawn("bash", [join(repo, "scripts/qa-tunnel.sh"), ...args], { cwd: repo, env });
      const state = { child, out: "", closed: new Promise((done) => child.on("close", (code) => done(code))) };
      const waiters = [];
      const feed = (d) => { state.out += d; waiters.splice(0).forEach((w) => w()); };
      child.stdout.on("data", feed);
      child.stderr.on("data", feed);
      state.until = (re, ms = 20000) => never(new Promise((done) => { const look = () => (re.test(state.out) ? done() : waiters.push(look)); look(); }), ms);
      return state;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const settle = () => new Promise((done) => setTimeout(done, 200));
function assertStopped(w) {
  for (const name of ["wrangler.json", "cloudflared.json"]) if (w.has(name)) assert.equal(alive(w.info(name).pid), false, `${name} process still alive`);
  assert.deepEqual(readdirSync(w.tmp), [], "the temporary folder is gone");
  assert.equal(git(w.repo, "worktree", "list").trim().split("\n").length, 1, "the temporary worktree is gone");
}

// Each test has its own repo, folders, stand-ins and ports, so they run side by side (kit unit stays quick).
describe("qa-tunnel.sh", { concurrency: 8 }, () => {
  test("qa-tunnel: --help says how to start it, and a bad argument is refused before anything starts", async () => {
    const w = world();
    try {
      const help = await w.run(["--help"]);
      assert.equal(help.code, 0);
      assert.match(help.out, /Usage: scripts\/qa-tunnel\.sh/);
      assert.match(help.out, /--here/);
      assert.match(help.out, /--hours/);
      for (const bad of [["--nope"], ["--hours", "0"], ["--hours", "abc"], ["--hours"], ["one", "two"], ["--port", "99999"], ["--here", "main"]]) {
        const result = await w.run(bad);
        assert.equal(result.code, 2, bad.join(" "));
        assert.match(result.out, /Usage: scripts\/qa-tunnel\.sh/);
      }
      assert.equal(w.has("wrangler.json"), false);
      assert.equal(w.has("cloudflared.json"), false);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: a secret file committed on the branch is refused, and nothing starts", async () => {
    const w = world({ files: { ".dev.vars": "SOMETHING=1\n" } });
    try {
      const result = await w.run();
      assert.equal(result.code, 1);
      assert.match(result.out, /secret file/i);
      assert.match(result.out, /\.dev\.vars/);
      assert.equal(w.has("wrangler.json"), false);
      assert.equal(w.has("cloudflared.json"), false);
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: every kind of secret file name is refused, in any folder", async () => {
    for (const name of [".env", ".env.local", "deep/er/server.key", "cert.pem", "sub/.dev.vars.production", "dist/leftover.pem", "dist/.env"]) {
      const w = world();
      try {
        mkdirSync(join(w.repo, "deep/er"), { recursive: true });
        mkdirSync(join(w.repo, "sub"), { recursive: true });
        mkdirSync(join(w.repo, "dist"), { recursive: true });
        writeFileSync(join(w.repo, name), "x\n");
        const result = await w.run(["--here"]);
        assert.equal(result.code, 1, name);
        assert.match(result.out, /secret file/i, name);
        assert.equal(w.has("wrangler.json"), false, name);
      } finally { w.cleanup(); }
    }
  });

  test("qa-tunnel: a secret file that is a symbolic link is refused too, and so is a folder that cannot be searched", async () => {
    const w = world();
    try {
      symlinkSync("/dev/null", join(w.repo, ".dev.vars"));
      const result = await w.run(["--here"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /\.dev\.vars/);
      assert.equal(w.has("wrangler.json"), false);
    } finally { w.cleanup(); }
    const through = world();
    try {
      mkdirSync(join(through.dir, "elsewhere"));
      writeFileSync(join(through.dir, "elsewhere", "id.pem"), "x\n");
      symlinkSync(join(through.dir, "elsewhere"), join(through.repo, "linked"));
      const result = await through.run(["--here"]);
      assert.equal(result.code, 1, "a secret inside a linked folder");
      assert.match(result.out, /linked\/id\.pem/);
    } finally { through.cleanup(); }
    if (process.getuid?.() === 0) return; // root can read any folder
    const locked = world();
    const folder = join(locked.repo, "locked");
    try {
      mkdirSync(folder);
      chmodSync(folder, 0o000);
      const result = await locked.run(["--here"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /could not look through/);
      assert.equal(locked.has("wrangler.json"), false);
    } finally { chmodSync(folder, 0o755); locked.cleanup(); }
  });

  test("qa-tunnel: a tag that exists only on GitHub is fetched and served", async () => {
    const w = world();
    try {
      const other = join(w.dir, "other");
      git(w.dir, "clone", "-q", join(w.dir, "origin.git"), other);
      git(other, "switch", "-q", "--detach");
      writeFileSync(join(other, "tagged.txt"), "only under a tag\n");
      git(other, "add", "-A");
      git(other, "commit", "-q", "-m", "tagged");
      git(other, "tag", "qa-only-tag");
      git(other, "push", "-q", "origin", "qa-only-tag");
      const sha = git(other, "rev-parse", "HEAD").trim();
      assert.throws(() => git(w.repo, "rev-parse", "--verify", "--quiet", "qa-only-tag^{commit}"), "this computer does not have it yet");
      const result = await w.run(["qa-only-tag", "--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, new RegExp(`Serving qa-only-tag \\(${sha.slice(0, 7)}\\)`));
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: secret-looking names inside node_modules, .scratch or .wrangler are not part of what is served, so --here still starts", async () => {
    const w = world();
    try {
      for (const folder of ["node_modules/pkg", ".scratch", ".wrangler"]) {
        mkdirSync(join(w.repo, folder), { recursive: true });
        writeFileSync(join(w.repo, folder, "test.pem"), "x\n");
      }
      const result = await w.run(["--here", "--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: a REF that is a refspec (+x:refs/heads/dev) is never given to git fetch, and no local branch changes", async () => {
    const w = world();
    try {
      const before = git(w.repo, "rev-parse", "dev").trim();
      const result = await w.run(["+x:refs/heads/dev"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /no such branch, tag or commit/);
      assert.equal(git(w.repo, "rev-parse", "dev").trim(), before);
      assert.equal(w.has("wrangler.json"), false);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: a cloudflared config file is named when cloudflared gives no address", async () => {
    const w = world({ cloudflared: "#!/usr/bin/env bash\necho 'cloudflared: refused' >&2\nexit 3\n" });
    try {
      mkdirSync(join(w.dir, "home/.cloudflared"), { recursive: true });
      writeFileSync(join(w.dir, "home/.cloudflared/config.yml"), "tunnel: x\n");
      const result = await w.run();
      assert.equal(result.code, 1);
      assert.match(result.out, /a cloudflared config file exists at .*config\.yml/);
      assert.doesNotMatch(result.out, /The link no longer works/, "no link was ever given");
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: without setsid it still stops both programs", async () => {
    const w = world();
    try {
      const bin = join(w.dir, "bin");
      mkdirSync(bin);
      for (const tool of ["bash", "env", "git", "node", "curl", "find", "sed", "grep", "awk", "date", "mktemp", "tail", "head", "sleep", "rm", "cat", "dirname", "sort", "tr", "wc", "ps", "readlink", "uname"]) {
        try { symlinkSync(execFileSync("which", [tool], { encoding: "utf8" }).trim(), join(bin, tool)); } catch { /* not needed here */ }
      }
      assert.equal(existsSync(join(bin, "setsid")), false);
      const env = { ...w.env, PATH: bin };
      const result = await never(new Promise((done) => {
        const child = spawn(join(bin, "bash"), [join(w.repo, "scripts/qa-tunnel.sh"), "--hours", "0.0003"], { cwd: w.repo, env });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (out += d));
        child.on("close", (code) => done({ code, out }));
      }), 30000);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, /^Link for the test: /m);
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: --here also refuses a secret file that git ignores (wrangler would read it)", async () => {
    const w = world({ files: { ".gitignore": ".dev.vars\n" } });
    try {
      writeFileSync(join(w.repo, ".dev.vars"), "TOKEN=1\n");
      assert.equal(git(w.repo, "status", "--porcelain").includes(".dev.vars"), false, "git ignores it");
      const result = await w.run(["--here"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /\.dev\.vars/);
      assert.equal(w.has("wrangler.json"), false);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: an unknown ref is refused with its name", async () => {
    const w = world();
    try {
      const result = await w.run(["no-such-branch"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /no-such-branch/);
      assert.equal(w.has("wrangler.json"), false);
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: runs wrangler locally, tunnels it, checks it, prints one link line and a reminder, stops by the time limit, and cleans up", async () => {
    const w = world();
    try {
      const result = await w.run(["--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      const links = result.out.split("\n").filter((line) => line.includes(URL_LINE));
      assert.equal(links.filter((line) => /^Link for the test: /.test(line)).length, 1, "one clear link line");
      assert.match(result.out, /Anyone with this link can open the page/);
      assert.match(result.out, /stores nothing/);
      assert.match(result.out, /stopped/i);
      // wrangler: local only, the preview build (kept out of search engines), state in the temporary folder, no login.
      const wr = w.info("wrangler.json");
      assert.equal(wr.args[0], "dev");
      assert.ok(wr.args.includes("--local"));
      assert.ok(!wr.args.includes("--remote"));
      assert.equal(wr.args[wr.args.indexOf("--env") + 1], "preview");
      assert.equal(wr.args[wr.args.indexOf("--ip") + 1], "127.0.0.1");
      assert.ok(wr.args[wr.args.indexOf("--persist-to") + 1].startsWith(w.tmp), "its state lives in the temporary folder");
      assert.equal(wr.token, null, "no Cloudflare token reaches wrangler");
      assert.equal(wr.account, null, "no Cloudflare account reaches wrangler");
      assert.notEqual(wr.cwd, w.repo, "it ran in a temporary worktree of origin/dev");
      // cloudflared: a quick tunnel to the local port, no account.
      const cf = w.info("cloudflared.json");
      const port = wr.args[wr.args.indexOf("--port") + 1];
      assert.deepEqual(cf.args.slice(0, 1), ["tunnel"]);
      assert.equal(cf.args[cf.args.indexOf("--url") + 1], `http://127.0.0.1:${port}`);
      assert.ok(!cf.args.includes("run") && !cf.args.includes("--token"));
    assert.equal(cf.tunnelToken, null, "a named-tunnel token in the shell never reaches cloudflared (it would not be a quick tunnel)");
    assert.equal(cf.token, null, "no Cloudflare API token reaches cloudflared");
    assert.equal(cf.tunnelTokenFile, null);
    assert.equal(cf.account, null);
      assert.match(readFileSync(join(w.fake, "check.txt"), "utf8"), new RegExp(URL_LINE));
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: --here serves the current checkout, not a temporary worktree", async () => {
    const w = world();
    try {
      const result = await w.run(["--here", "--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      assert.equal(w.info("wrangler.json").cwd, w.repo);
    assert.match(result.out, /your checkout was left as it was/i);
    assert.doesNotMatch(result.out, /temporary copy/);
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: a ref serves that ref", async () => {
    const w = world();
    try {
      git(w.repo, "switch", "-q", "-c", "topic");
      writeFileSync(join(w.repo, "topic.txt"), "on topic\n");
      git(w.repo, "add", "-A");
      git(w.repo, "commit", "-q", "-m", "topic");
      const sha = git(w.repo, "rev-parse", "topic").trim();
      const result = await w.run(["topic", "--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, new RegExp(sha.slice(0, 7)), "the link block names the commit it serves");
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: a branch that is newer on GitHub than on this computer serves the GitHub copy", async () => {
    const w = world();
    try {
      git(w.repo, "switch", "-q", "-c", "topic");
      writeFileSync(join(w.repo, "topic.txt"), "one\n");
      git(w.repo, "add", "-A");
      git(w.repo, "commit", "-q", "-m", "topic one");
      git(w.repo, "push", "-q", "origin", "topic");
      // Someone else pushes a newer commit; this computer's own topic stays behind.
      const other = join(w.dir, "other");
      git(w.dir, "clone", "-q", join(w.dir, "origin.git"), other);
      git(other, "switch", "-q", "topic");
      writeFileSync(join(other, "topic.txt"), "two\n");
      git(other, "commit", "-q", "-am", "topic two");
      git(other, "push", "-q", "origin", "topic");
      const newer = git(other, "rev-parse", "HEAD").trim();
      assert.notEqual(git(w.repo, "rev-parse", "topic").trim(), newer);
      const result = await w.run(["topic", "--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, new RegExp(`Serving origin/topic \\(${newer.slice(0, 7)}\\)`));
      // The default is the latest origin/dev the same way.
      const dev = await w.run(["--hours", "0.0003"]);
      assert.equal(dev.code, 0, dev.out);
    assert.match(dev.out, /Serving origin\/dev \(/);
    await settle();
    assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: HEAD means this checkout's commit, not GitHub's default branch (origin/HEAD)", async () => {
    const w = world();
    try {
      git(w.repo, "remote", "set-head", "origin", "dev");
      assert.match(git(w.repo, "symbolic-ref", "refs/remotes/origin/HEAD"), /origin\/dev/);
      git(w.repo, "switch", "-q", "-c", "topic");
      writeFileSync(join(w.repo, "topic.txt"), "local only\n");
      git(w.repo, "add", "-A");
      git(w.repo, "commit", "-q", "-m", "local topic");
      const head = git(w.repo, "rev-parse", "HEAD").trim();
      const result = await w.run(["HEAD", "--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, new RegExp(`Serving HEAD \\(${head.slice(0, 7)}\\)`));
      assert.doesNotMatch(result.out, /origin\/HEAD/);
      const back = await w.run(["HEAD~1", "--hours", "0.0003"]);
      assert.equal(back.code, 0, back.out);
      assert.match(back.out, new RegExp(`Serving HEAD~1 \\(${git(w.repo, "rev-parse", "--short=7", "HEAD~1").trim()}\\)`));
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: a --port that something else already listens on is refused before anything starts", async () => {
    const w = world();
    const busy = createServer();
    try {
      const port = await new Promise((done) => busy.listen(0, "127.0.0.1", () => done(busy.address().port)));
      const result = await w.run(["--port", String(port), "--hours", "0.0003"]);
      assert.equal(result.code, 1);
      assert.match(result.out, new RegExp(`port ${port} is already in use`));
      assert.equal(w.has("wrangler.json"), false);
      assert.equal(w.has("cloudflared.json"), false);
      assert.doesNotMatch(result.out, /^Link for the test: /m);
      assertStopped(w);
    } finally { busy.close(); w.cleanup(); }
  });

  test("qa-tunnel: --port reaches wrangler and the tunnel", async () => {
    const w = world();
    try {
      const free = await new Promise((done) => { const s = createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => done(port)); }); });
      const result = await w.run(["--port", String(free), "--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      const args = w.info("wrangler.json").args;
      assert.equal(args[args.indexOf("--port") + 1], String(free));
      const cf = w.info("cloudflared.json").args;
      assert.equal(cf[cf.indexOf("--url") + 1], `http://127.0.0.1:${free}`);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: if the tunnel dies while the link is up, it says the link no longer works and cleans up", async () => {
    const dies = `#!/usr/bin/env node
  console.error("INF |  ${URL_LINE}  |");
  console.error("INF Registered tunnel connection connIndex=0");
  setTimeout(() => process.exit(1), 1500);
  `;
    const w = world({ cloudflared: dies });
    try {
      const result = await w.run(["--hours", "0.05"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /^Link for the test: /m);
      assert.match(result.out, /the tunnel stopped; the link no longer works/);
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: if the local Worker dies while the link is up, it says the link no longer works and cleans up", async () => {
    const dies = `#!/usr/bin/env node
  const args = process.argv.slice(2);
  require("node:http").createServer((req, res) => res.end("fake page")).listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");
  setTimeout(() => { console.error("wrangler: workerd crashed"); process.exit(1); }, 2000);
  `;
    const w = world({ wrangler: dies });
    try {
      const result = await w.run(["--hours", "0.05"]);
      assert.equal(result.code, 1);
      assert.match(result.out, /workerd crashed/);
      assert.match(result.out, /the local Worker stopped; the link no longer works/);
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  // A key press at a real terminal goes to whatever the script is waiting on (curl, sleep, the self-check), not to the
  // script itself, so this runs the script under a pseudo-terminal and sends Ctrl+C there.
  const hasPty = (() => { try { execFileSync("script", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
  for (const [moment, options] of [
    ["while the Worker is still starting", { wrangler: `#!/usr/bin/env bash\necho "{\\"pid\\":$$}" > "__FAKE__/wrangler.json"\necho started > "__FAKE__/wrangler-started"\nexec sleep 60\n` }],
    ["during the self-check", { check: "touch __FAKE__/check-running; exec sleep 60" }],
  ]) {
    test(`qa-tunnel: Ctrl+C at a terminal ${moment} stops everything`, { skip: !hasPty && "no script(1) for a pseudo-terminal" }, async () => {
      const w = world(options);
      let child;
      try {
        child = spawn("script", ["-qefc", `bash ${join(w.repo, "scripts/qa-tunnel.sh")}`, "/dev/null"], { cwd: w.repo, env: w.env, detached: true });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        const closed = new Promise((done) => child.on("close", (code) => done(code)));
        const marker = options.check ? "check-running" : "wrangler-started";
        const until = Date.now() + 15000;
        while (!w.has(marker) && Date.now() < until) await new Promise((done) => setTimeout(done, 50));
        assert.ok(w.has(marker), `never reached: ${moment}`);
        await new Promise((done) => setTimeout(done, 400));
        child.stdin.write("\x03");
        const code = await never(closed, 20000);
        assert.equal(code, 0, `exit ${code}: ${out}`);
        assert.doesNotMatch(out, /self-check failed|stopped before/);
        assert.match(out, /Stopped/);
        await settle();
        assertStopped(w);
      } finally {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* it has ended */ }
        w.cleanup();
      }
    });
  }

  test("qa-tunnel: Ctrl+C stops both processes and removes the temporary worktree and folder", async () => {
    const w = world();
    try {
      const run = w.start();
      await run.until(/^Link for the test: /m);
      assert.ok(alive(w.info("wrangler.json").pid) && alive(w.info("cloudflared.json").pid), "both run while the link is up");
      run.child.kill("SIGINT");
      const code = await never(run.closed, 20000);
      assert.ok(code === 0 || code === 130, `exit ${code}`);
      assert.match(run.out, /stopped/i);
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: a failed self-check stops everything, prints no link and exits 1", async () => {
    const w = world({ check: "echo 'check: relay failed'; exit 1" });
    try {
      const result = await w.run();
      assert.equal(result.code, 1);
      assert.doesNotMatch(result.out, /^Link for the test: /m);
      assert.match(result.out, /relay failed/);
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: the self-check waits until cloudflared says the tunnel is connected (an early lookup of a new address fails and is remembered)", async () => {
    const late = `#!/usr/bin/env node
  const { writeFileSync } = require("node:fs");
  console.error("INF |  ${URL_LINE}  |");
  setTimeout(() => { writeFileSync("__FAKE__/registered.txt", "yes"); console.error("INF Registered tunnel connection connIndex=0"); }, 700);
  setInterval(() => {}, 1000);
  `;
    const w = world({ cloudflared: late, check: '[[ -f __FAKE__/registered.txt ]] || { echo "check ran before the tunnel was connected"; exit 1; }' });
    try {
      const result = await w.run(["--hours", "0.0003"]);
      assert.equal(result.code, 0, result.out);
      assert.match(result.out, /^Link for the test: /m);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: cloudflared that dies at once is reported, and wrangler is stopped", async () => {
    const w = world({ cloudflared: "#!/usr/bin/env bash\necho 'cloudflared: no network' >&2\nexit 3\n" });
    try {
      const result = await w.run();
      assert.equal(result.code, 1);
      assert.match(result.out, /cloudflared/i);
      assert.doesNotMatch(result.out, /^Link for the test: /m);
      await settle();
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: wrangler that never comes up is reported with its last lines, and the tunnel never starts", async () => {
    const w = world({ wrangler: "#!/usr/bin/env bash\necho 'wrangler: build failed here' >&2\nexit 4\n" });
    try {
      const result = await w.run();
      assert.equal(result.code, 1);
      assert.match(result.out, /build failed here/);
      assert.equal(w.has("cloudflared.json"), false);
      assertStopped(w);
    } finally { w.cleanup(); }
  });

  test("qa-tunnel: the script never sends anything to Cloudflare itself (no deploy, no login, no account)", () => {
    assert.doesNotMatch(SCRIPT, /wrangler[^\n]*\b(deploy|login|publish|secret)\b/);
    assert.doesNotMatch(SCRIPT, /--remote/);
    assert.doesNotMatch(SCRIPT, /tunnel (login|create|run|delete)/);
    assert.match(SCRIPT, /--local/);
    assert.match(SCRIPT, /CLOUDFLARE_API_TOKEN/, "credentials are removed from wrangler's environment");
  });

  test("qa-tunnel: package.json has the qa:tunnel shortcut", () => {
    const pkg = JSON.parse(readFileSync(join(realRoot, "package.json"), "utf8"));
    assert.equal(pkg.scripts["qa:tunnel"], "bash scripts/qa-tunnel.sh");
  });
});
