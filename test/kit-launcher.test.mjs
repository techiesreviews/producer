// The launcher kit init writes (scripts/agents/kit): --home prints a person's kit folder, a machine with no kit
// fails with one RESULT line and leaves nothing in the cache, and a clone address never shows its password.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const launcher = resolve(import.meta.dirname, "../scripts/agents/kit");

// A machine with no kit: an empty home, data and cache folder. Run from a folder outside git so only the launcher's own paths count.
function onEmptyMachine(extraEnv, fn) {
  const home = mkdtempSync(join(tmpdir(), "producer-launcher-"));
  try {
    const cache = join(home, "cache");
    const env = { PATH: process.env.PATH, HOME: home, XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: cache, ...extraEnv };
    const r = spawnSync("bash", [launcher, "--home"], { env, cwd: home, encoding: "utf8" });
    return fn(r, cache);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("--home prints the folder of the kit named by KIT_HOME and exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "producer-fakehome-"));
  try {
    writeFileSync(join(dir, "kit"), "#!/usr/bin/env bash\n");
    chmodSync(join(dir, "kit"), 0o755);
    writeFileSync(join(dir, "kit-lib.sh"), "");
    const r = spawnSync("bash", [launcher, "--home"], { env: { PATH: process.env.PATH, HOME: dir, KIT_HOME: dir }, cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `${dir}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("with no kit and an unreachable KIT_REPO it exits 2 with one RESULT line and leaves no clone folder", () => {
  onEmptyMachine({ KIT_REPO: "file:///nonexistent/agent-kit.git" }, (r, cache) => {
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^RESULT: fail no Agent Kit/);
    assert.equal(r.stdout.trim().split("\n").length, 1);
    const left = existsSync(cache) ? readdirSync(cache).filter((name) => name.startsWith("agent-kit")) : [];
    assert.deepEqual(left, []);
  });
});

test("the failure message never shows the user:password part of KIT_REPO", () => {
  onEmptyMachine({ KIT_REPO: "https://someuser:hunter2pass@example.invalid/x.git" }, (r) => {
    assert.equal(r.status, 2);
    assert.match(r.stdout, /^RESULT: fail no Agent Kit/);
    assert.match(r.stdout, /https:\/\/example\.invalid\/x\.git/);
    assert.doesNotMatch(r.stdout + r.stderr, /someuser|hunter2pass/);
  });
});

test("with no KIT_HOME --home prints the kit the machine's current link points at", () => {
  const home = mkdtempSync(join(tmpdir(), "producer-current-"));
  try {
    const data = join(home, "data");
    const kitDir = join(data, "agent-kit", "v1");
    mkdirSync(kitDir, { recursive: true });
    writeFileSync(join(kitDir, "kit"), "#!/usr/bin/env bash\n");
    chmodSync(join(kitDir, "kit"), 0o755);
    writeFileSync(join(kitDir, "kit-lib.sh"), "");
    symlinkSync("v1", join(data, "agent-kit", "current"));
    const env = { PATH: process.env.PATH, HOME: home, XDG_DATA_HOME: data, XDG_CACHE_HOME: join(home, "cache") };
    const r = spawnSync("bash", [launcher, "--home"], { env, cwd: home, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, `${realpathSync(kitDir)}\n`);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
