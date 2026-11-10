// The ways to connect each agent (src/agent-ways.mjs): what each agent's chip says, and the one-line MCP setup that
// "Connect with MCP" copies for Claude Code and Codex. The lines are run for real in bash with stand-in `claude` and
// `codex` programs that record how they were called, so what the host pastes is what the agent's own command gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_WAYS, mcpLine, START } from "../src/agent-ways.mjs";

// A token-shaped stand-in, built from pieces so no file holds one.
const FAKE = ["pr1", "m0abcdef", "x".repeat(43)].join("-");
const LIVE = "https://producer.techies.tools";
const PREVIEW = "https://preview-producer.techies.tools";

test("the chips: Claude Code says nothing, Codex warns about safe mode, T3 Code is labelled slower", () => {
  assert.deepEqual(Object.keys(AGENT_WAYS), ["claude", "codex", "t3"]);
  const { claude, codex, t3 } = AGENT_WAYS;
  assert.equal(claude.name, "Claude Code");
  assert.equal(claude.chipTip, null, "a fast way carries no tooltip");
  assert.equal(claude.tag, null, "and no label");
  assert.equal(codex.name, "Codex");
  assert.equal(codex.chipTip, "Codex blocks the network in safe mode: allow network or use the MCP line");
  assert.equal(codex.tag, null);
  assert.equal(t3.name, "T3 Code");
  assert.equal(t3.tag, "slower");
  assert.match(t3.chipTip, /about 6 seconds/);
  assert.match(t3.chipTip, /cannot take a private MCP line/, "its tooltip says it has no MCP line");
  assert.equal(t3.mcp, null, "T3 Code has no MCP way");
  assert.ok(claude.mcp && codex.mcp, "Claude Code and Codex have one");
  // The paste way is the slower one for all three: Claude Code (4.3 s a cue with the shortened message, card 186; 5.3 s
  // with the first long one, TOOLS-170; MCP 2.5 s),
  // Codex (7.8 s against 3.3 s) and T3 Code (6.1 s). Claude Code and Codex have the faster MCP way beside it.
  assert.deepEqual([claude.pasteSlow, codex.pasteSlow, t3.pasteSlow], [true, true, true]);
  // The paste way's own note: only Codex has one (the same words as its chip).
  assert.deepEqual([claude.pasteNote, codex.pasteNote, t3.pasteNote], [null, codex.chipTip, null]);
});

test("a later chat without the token variable breaks nothing: Claude Code's header has a default that Claude Code reads without a warning", () => {
  const line = mcpLine({ agent: "claude", origin: LIVE, token: FAKE });
  assert.ok(line.includes("'Authorization: Bearer ${PRODUCER_TOKEN:-ended}'"), "a missing variable reads as 'ended': a refusal, never a startup warning");
  assert.ok(!mcpLine({ agent: "codex", origin: LIVE, token: FAKE }).includes("Bearer"), "Codex names the variable and holds no header text");
});

test("every way's wording tells the host who removes the entry: the host, with the agent's own remove command", () => {
  assert.equal(AGENT_WAYS.claude.mcp.remove, "claude mcp remove producer");
  assert.match(AGENT_WAYS.claude.mcp.onTip, /\(in the same folder\)$/, "Claude Code's entry belongs to the folder the line was run in");
  assert.equal(AGENT_WAYS.codex.mcp.remove, "codex mcp remove producer");
  for (const a of ["claude", "codex"]) {
    const { mcp, name } = AGENT_WAYS[a];
    assert.match(mcp.idleTip, new RegExp(`${name}'s settings`), `${a}: the line edits the agent's settings`);
    assert.match(mcp.idleTip, /eight hours/, `${a}: the token ends by itself`);
    assert.ok(mcp.idleTip.includes(mcp.remove), `${a}: the tooltip names the remove command`);
    assert.match(mcp.idleTip, /bash or zsh terminal/, `${a}: and says which terminals the line is for`);
    assert.ok(mcp.onTip.includes(mcp.remove), `${a}: and so does the connected one`);
    assert.match(mcp.onTip, /until you remove it/);
    for (const tip of Object.values({ idle: mcp.idleTip, on: mcp.onTip })) assert.ok(!tip.includes("\n"), `${a}: one line`);
  }
});

test("the MCP line: one line, the token only in an export, never in the agent's settings", () => {
  for (const agent of ["claude", "codex"]) {
    const line = mcpLine({ agent, origin: LIVE, token: FAKE });
    assert.ok(!line.includes("\n"), `${agent}: one line`);
    assert.equal(line.split(FAKE).length, 2, `${agent}: the token appears once`);
    assert.ok(line.startsWith(`export PRODUCER_TOKEN='${FAKE}'; `), `${agent}: ... in an export, first`);
    assert.equal(line.split(LIVE).length, 2, `${agent}: the address appears once`);
    assert.ok(line.includes(`'${LIVE}/mcp'`), `${agent}: the /mcp address of this site`);
    assert.ok(line.includes(START), `${agent}: it starts the chat with the start words`);
    assert.doesNotMatch(line, /\bsleep\b|nohup/, `${agent}: nothing sleeps`);
    // The same line works on the preview: only the address changes.
    assert.equal(mcpLine({ agent, origin: PREVIEW, token: FAKE }), line.replace(LIVE, PREVIEW));
  }
  assert.equal(
    mcpLine({ agent: "claude", origin: LIVE, token: FAKE }),
    `export PRODUCER_TOKEN='${FAKE}'; claude mcp remove producer >/dev/null 2>&1; claude mcp add --transport http producer '${LIVE}/mcp' --header 'Authorization: Bearer \${PRODUCER_TOKEN:-ended}' && claude '${START}' --allowedTools mcp__producer`,
  );
  assert.equal(
    mcpLine({ agent: "codex", origin: LIVE, token: FAKE }),
    `export PRODUCER_TOKEN='${FAKE}'; codex mcp remove producer >/dev/null 2>&1; codex mcp add producer --url '${LIVE}/mcp' --bearer-token-env-var PRODUCER_TOKEN && codex -c 'mcp_servers.producer.default_tools_approval_mode="approve"' '${START}'`,
  );
  assert.equal(mcpLine({ agent: "t3", origin: LIVE, token: FAKE }), null, "T3 Code gets no line");
  assert.equal(mcpLine({ agent: "nobody", origin: LIVE, token: FAKE }), null);
});

test("the start words are plain, safe inside single quotes, and ask for nothing but the producer", () => {
  assert.doesNotMatch(START, /['"`$\\\n]/, "nothing the shell would read");
  assert.match(START, /producer/i);
  assert.ok(START.length < 120);
});

/** Stand-in programs for `claude` and `codex`: each logs its arguments and the token it was given. */
function standIns() {
  const dir = mkdtempSync(join(tmpdir(), "producer-ways-"));
  const log = join(dir, "log");
  for (const name of ["claude", "codex"]) {
    writeFileSync(join(dir, name), `#!/bin/sh\n{ printf '${name}:'; for a in "$@"; do printf ' [%s]' "$a"; done; printf ' token=%s\\n' "$PRODUCER_TOKEN"; } >> "${log}"\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const run = (line) => {
    writeFileSync(log, "");
    execFileSync("bash", ["-c", line], { env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir } });
    return readFileSync(log, "utf8").trim().split("\n");
  };
  return { run };
}

test("Claude Code's line, pasted into bash: removes an old entry, adds the new one with a header that reads the token, then opens a chat", () => {
  const { run } = standIns();
  const calls = run(mcpLine({ agent: "claude", origin: LIVE, token: FAKE }));
  assert.deepEqual(calls, [
    "claude: [mcp] [remove] [producer] token=" + FAKE,
    `claude: [mcp] [add] [--transport] [http] [producer] [${LIVE}/mcp] [--header] [Authorization: Bearer \${PRODUCER_TOKEN:-ended}] token=${FAKE}`,
    `claude: [${START}] [--allowedTools] [mcp__producer] token=${FAKE}`,
  ]);
  assert.ok(!calls.slice(0, 2).join("\n").replace(/token=\S+/g, "").includes(FAKE), "the settings entry never holds the token");
});

test("Codex's line, pasted into bash: removes an old entry, adds the new one that reads the token from the environment, then opens a chat that may use it", () => {
  const { run } = standIns();
  const calls = run(mcpLine({ agent: "codex", origin: LIVE, token: FAKE }));
  assert.deepEqual(calls, [
    "codex: [mcp] [remove] [producer] token=" + FAKE,
    `codex: [mcp] [add] [producer] [--url] [${LIVE}/mcp] [--bearer-token-env-var] [PRODUCER_TOKEN] token=${FAKE}`,
    `codex: [-c] [mcp_servers.producer.default_tools_approval_mode="approve"] [${START}] token=${FAKE}`,
  ]);
  assert.ok(!calls.slice(0, 2).join("\n").replace(/token=\S+/g, "").includes(FAKE), "the settings entry never holds the token");
});

test("a failing add stops the line: no chat is opened without the entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "producer-ways-"));
  const log = join(dir, "log");
  writeFileSync(join(dir, "claude"), `#!/bin/sh\necho "$1 $2" >> "${log}"\n[ "$2" = add ] && exit 1\nexit 0\n`);
  chmodSync(join(dir, "claude"), 0o755);
  writeFileSync(log, "");
  try {
    execFileSync("bash", ["-c", mcpLine({ agent: "claude", origin: LIVE, token: FAKE })], { env: { PATH: `${dir}:/usr/bin:/bin` }, stdio: "ignore" });
    assert.fail("the line should fail with the add");
  } catch (error) {
    assert.equal(error.status, 1);
  }
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["mcp remove", "mcp add"], "the chat never opened");
});
