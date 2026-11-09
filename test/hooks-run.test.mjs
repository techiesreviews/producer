// The hook launcher kit init writes: with no kit on the machine it must never block a session and
// must say the guards are off (bash-guard as a systemMessage, session-env as a plain line, context-card silent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
