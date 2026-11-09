// The hook launcher kit init writes: with no kit on the machine it must never block a session and
// must say the guards are off (bash-guard as a systemMessage, session-env as a plain line, context-card silent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const run = resolve(import.meta.dirname, "../scripts/agents/hooks/run.sh");

function noKit(mode) {
  const empty = mkdtempSync(join(tmpdir(), "producer-nokit-"));
  try {
    const env = { PATH: process.env.PATH, HOME: empty, XDG_DATA_HOME: join(empty, "data"), XDG_CACHE_HOME: join(empty, "cache") };
    return spawnSync("bash", [run, mode], { env, input: "{}", encoding: "utf8" });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

test("without a kit every hook mode exits 0", () => {
  for (const mode of ["bash-guard", "session-env", "agent-cap", "context-card", "brief-guard", "stop-guard"]) {
    assert.equal(noKit(mode).status, 0, mode);
  }
});

test("without a kit bash-guard says the guards are off as a system message", () => {
  const out = noKit("bash-guard").stdout;
  assert.match(JSON.parse(out).systemMessage, /^Agent Kit not found/);
});

test("without a kit session-env prints the plain warning and context-card stays silent", () => {
  assert.match(noKit("session-env").stdout, /^Agent Kit not found: guards are off/);
  assert.equal(noKit("context-card").stdout, "");
});

// A whole fake kit (an executable kit, kit-lib.sh and hooks/run.sh) under a machine data folder, with `current` pointing at it.
// Its hooks/run.sh prints its mode and the hook input, so the test sees what the launcher handed over.
function withFakeKit(fn) {
  const home = mkdtempSync(join(tmpdir(), "producer-fakekit-"));
  try {
    const data = join(home, "data");
    const kitDir = join(data, "agent-kit", "v1");
    mkdirSync(join(kitDir, "hooks"), { recursive: true });
    writeFileSync(join(kitDir, "kit"), "#!/usr/bin/env bash\n");
    chmodSync(join(kitDir, "kit"), 0o755);
    writeFileSync(join(kitDir, "kit-lib.sh"), "");
    writeFileSync(join(kitDir, "hooks", "run.sh"), '#!/usr/bin/env bash\nprintf "fake-kit:%s:" "$*"; cat\n');
    symlinkSync("v1", join(data, "agent-kit", "current"));
    const env = { PATH: process.env.PATH, HOME: home, XDG_DATA_HOME: data, XDG_CACHE_HOME: join(home, "cache") };
    return fn({ env, kitDir, home });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("with a kit on the machine the launcher hands the mode and the hook input to the kit's own hooks", () => {
  withFakeKit(({ env }) => {
    const r = spawnSync("bash", [run, "bash-guard"], { env, input: '{"probe":1}', encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'fake-kit:bash-guard:{"probe":1}');
  });
});

test("a pinned kit folder that has been removed is looked up again from the machine's current kit", () => {
  withFakeKit(({ env, home }) => {
    const gone = join(home, "removed-kit");
    const r = spawnSync("bash", [run, "stop-guard"], { env: { ...env, KIT_HOME: gone, KIT_HOME_PINNED: gone }, input: "{}", encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "fake-kit:stop-guard:{}");
  });
});
