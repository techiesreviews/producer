// The speed target (card 10): on the fast way a suggestion is on the page within 5 s (middle) and 10 s (slowest 1 in
// 10) after the speech ends. Most of that is the agent's own thinking, measured with real agents in TOOLS-154; this
// proves the page's own share. A stand-in agent answers each cue after a set delay, through the real Worker over
// HTTP and the relay object, in real time (no fake clock): from the pause to the answer kept on the page, minus the
// agent's own delay, must stay under 0.3 s on each of 10 cues. Both ways are run: one tool call per turn (Connect with
// MCP) and the ready-made curl loop from the connect message, run in bash for real (Copy connect message).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { pageSockets, relayWith } from "./fakes.mjs";
import { checkToken, newToken } from "../src/token.mjs";
import { createAgentLink } from "../src/agent-link.mjs";
import { createCues } from "../src/cues.mjs";
import { AGENT_LOOP, agentBody } from "../src/agent-message.mjs";

const { default: worker } = await import("../src/worker.mjs");

const CUES = 10;
const AGENT_DELAY_MS = 400; // the stand-in agent's "thinking"
const PAGE_BUDGET_MS = 300;
// TOOLS-154 (fleet inbox, 2026-11-09): seconds from a cue handed over to the answer posted, fast ways, middle / slowest.
const AGENT_FAST = { middle: 2.5, slowest: 5.9 };
const PAUSE_S = 1.5; // the speech worker's pause: silence after the last word before a cue can go

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const middle = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

/** The Worker on a local port with one relay object behind it, a page link (real timers) and the cue rules on it. */
async function setup() {
  const now = { t: Date.now() };
  const kit = relayWith(now);
  const env = {
    ASSETS: { fetch: async () => new Response("page") },
    RELAY: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => kit.relay.fetch(new Request(url, init)), op: (m) => kit.relay.op(m) }) },
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const out = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": "203.0.113.5" }, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const net = pageSockets(kit, (t) => checkToken(t, now.t));
  const link = createAgentLink({ net: { token: () => Promise.resolve(Response.json(newToken(now.t))), socket: net.socket } });
  const kept = [];
  link.onSuggestions((s) => kept.push({ ...s, at: performance.now() }));
  // The real rules, with the spacing taken out so ten cues fit in a few seconds (the rules have their own checks).
  const cues = createCues({ send: (item) => link.send(item), autoEveryMs: 0, manualEveryMs: 0 });
  const { token } = await link.connect();
  const close = () => new Promise((r) => { link.disconnect(); server.closeAllConnections(); server.close(r); });
  // The agent's next wait is held by the page: a call waits in the relay for the page's answer.
  const held = () => kit.relay.pending.size > 0;
  return { url, token, link, cues, kept, close, held };
}

/** A point of 31 s of speech, then the worker's pause: the cue goes. */
function point(cues, i) {
  cues.heard({ source: "guest", text: `Point ${i}: we tried it, it failed, then it worked.`, start: i * 40, end: i * 40 + 31 });
  assert.equal(cues.pause(), true, `cue ${i} goes`);
}

/** Runs CUES cues: each waits until the agent's previous answer is kept and its next wait is held. */
async function runCues({ cues, kept, agent }) {
  const rows = [];
  for (let i = 1; i <= CUES; i++) {
    await agent.ready(i);
    point(cues, i);
    for (const end = Date.now() + 5_000; kept.length < i;) {
      assert.ok(Date.now() < end, `cue ${i}: no answer kept within 5 s`);
      await sleep(1);
    }
    const s = kept[i - 1];
    const think = agent.thinking[i - 1];
    rows.push({ total: s.ms, think, page: s.ms - think });
  }
  return rows;
}

function report(t, way, rows) {
  const page = rows.map((r) => r.page);
  for (const [i, r] of rows.entries()) assert.ok(r.page < PAGE_BUDGET_MS, `${way}, cue ${i + 1}: the page's share is ${r.page.toFixed(1)} ms (total ${r.total} ms, agent ${r.think.toFixed(1)} ms)`);
  // The budget from the end of speech: the pause, the page's share, the agent's own time (TOOLS-154).
  const worst = Math.max(...page) / 1000;
  const total = { middle: PAUSE_S + middle(page) / 1000 + AGENT_FAST.middle, slowest: PAUSE_S + worst + AGENT_FAST.slowest };
  // A note, not a check: the agent's part is measured with real agents (docs/wayfinder/producer/cues.md).
  t.diagnostic(`${way}: page share middle ${middle(page).toFixed(1)} ms, slowest ${Math.max(...page).toFixed(1)} ms over ${rows.length} cues; with the 1.5 s pause and TOOLS-154's fast agent: middle ${total.middle.toFixed(2)} s, slowest ${total.slowest.toFixed(2)} s`);
}

test("one tool call per turn (Connect with MCP): the page adds under 0.3 s to each of 10 cues", async (t) => {
  const s = await setup();
  const thinking = [];
  const held = [];
  let stop = false;
  // The stand-in agent: calls the tools directly, answers each cue after AGENT_DELAY_MS inside its next wait.
  const call = async (name, args) => {
    const res = await fetch(`${s.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: agentBody(name, args) });
    return (await res.json()).result.structuredContent;
  };
  const loop = (async () => {
    await call("get_context");
    let args = { seq: 0 };
    while (!stop) {
      held.push(args.seq);
      const r = await call("wait_for_cue", args);
      if (stop) break;
      if (r.idle) { args = { seq: r.seq }; continue; }
      const got = performance.now();
      await sleep(AGENT_DELAY_MS);
      thinking.push(performance.now() - got);
      args = { seq: r.seq, suggestions: [{ text: `Question for cue ${r.seq}?` }] };
    }
  })();
  try {
    const agent = { thinking, ready: async (i) => { while (held.length < i || !s.held()) await sleep(1); } };
    const rows = await runCues({ cues: s.cues, kept: s.kept, agent });
    report(t, "MCP way", rows);
    assert.deepEqual(s.kept.map((k) => k.suggestions[0].text), Array.from({ length: CUES }, (_, i) => `Question for cue ${i + 1}?`), "each answer kept once, in order");
  } finally {
    stop = true;
    await s.close();
    await loop.catch(() => {});
  }
});

test("the curl loop from the connect message, run in bash (Copy connect message): the page adds under 0.3 s to each of 10 cues", async (t) => {
  const s = await setup();
  const thinking = [];
  let rounds = 0;
  let stop = false;
  let child = null;
  const runLoop = (body) => new Promise((resolve) => {
    child = spawn("bash", ["-c", AGENT_LOOP], { env: { PATH: process.env.PATH, TOKEN: s.token, URL: s.url, BODY: body } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => resolve(out));
  });
  const loop = (async () => {
    await runLoop(agentBody("get_context"));
    let body = agentBody("wait_for_cue", { seq: 0 });
    while (!stop) {
      rounds += 1;
      const out = await runLoop(body);
      if (stop) break;
      const got = performance.now();
      const cue = JSON.parse(out).result.structuredContent;
      await sleep(AGENT_DELAY_MS);
      thinking.push(performance.now() - got);
      body = agentBody("wait_for_cue", { seq: cue.seq, suggestions: [{ text: `Question for cue ${cue.seq}?` }] });
    }
  })();
  try {
    // The loop's next run is held once its curl reached the page.
    const agent = { thinking, ready: async (i) => { while (rounds < i || !s.held()) await sleep(1); } };
    const rows = await runCues({ cues: s.cues, kept: s.kept, agent });
    report(t, "curl loop", rows);
    assert.equal(s.kept.length, CUES, "each answer kept once");
  } finally {
    stop = true;
    child?.kill();
    await s.close();
    await loop.catch(() => {});
  }
});
