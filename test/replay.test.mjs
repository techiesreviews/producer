// The Relevant now list replayed (TOOLS-346): a stretch of talk goes through the real cue rules, the real Worker over
// HTTP, the relay object and the page's own link to an agent, one pause at a time, and each answer lands in the page's
// question card (src/questions.mjs) as it does on screen: the best match on the card, the other matches in Relevant
// now, grouped by part. Each pause names the questions that should show; the replay checks that one of them is on the
// card or in the list, and how long the list took after the pause.
// The committed run uses a made-up show (test/fixtures/stand-in-script.md) and a made-up stretch
// (test/fixtures/stand-in-replay.json) with a stand-in agent that picks the questions sharing the most words with what
// was said: it proves the way through, not an agent's judgement. A real show and a real agent stay out of this public
// repo: point PRODUCER_REAL_SCRIPT_DIR at a show's folder (its prompter.md) and PRODUCER_REPLAY_FILE at a stretch in
// the same format, and set PRODUCER_REPLAY_AGENT=claude to have Claude Code (Connect with MCP) answer each pause.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pageSockets, relayWith } from "./fakes.mjs";
import { checkToken, newToken } from "../src/token.mjs";
import { createAgentLink } from "../src/agent-link.mjs";
import { createCues } from "../src/cues.mjs";
import { createQuestions } from "../src/questions.mjs";
import { readLoad } from "../src/agent-load.mjs";

const { default: worker } = await import("../src/worker.mjs");

const PAUSE_S = 1.5; // the speech worker's pause: silence after the last word before a cue goes
const PIECE_S = 35; // each piece of the stretch counts as 35 s of speech, past the 30 s a pause cue needs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const middle = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const rpcBody = (name, args = {}) => JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

/** The show as the agent loads it from its prompter script: questions with their parts. */
function showFrom(script, { show = "", guest = "" } = {}) {
  const loaded = readLoad({ show, guest, script });
  assert.equal(loaded.ok, true, loaded.reason);
  return loaded.plan;
}

/** The Worker on a local port, one relay object behind it, the page's link, its cue rules and its question card. */
async function setup(plan) {
  const now = { t: Date.now() };
  const kit = relayWith(now);
  const env = {
    ASSETS: { fetch: async () => new Response("page") },
    RELAY: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => kit.relay.fetch(new Request(url, init)), op: (m) => kit.relay.op(m) }) },
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const out = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: { ...req.headers, "cf-connecting-ip": "203.0.113.7" }, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const questions = createQuestions();
  questions.setPlan(plan.questions);
  const net = pageSockets(kit, (t) => checkToken(t, now.t));
  const show = () => ({ showTitle: plan.show, guestName: plan.guest, questions: plan.questions.map((text, i) => ({ n: i + 1, text })), segments: plan.parts.map((p) => ({ title: p.name, plannedMinutes: p.minutes })) });
  const link = createAgentLink({ net: { token: () => Promise.resolve(Response.json(newToken(now.t))), socket: net.socket }, show, report: () => ({ result: { ok: true } }) });
  const landed = [];
  link.onSuggestions((answer) => {
    questions.suggest(answer);
    const { main, relevant } = questions.view();
    landed.push({ seq: answer.seq, ms: answer.ms, main: main?.n ?? null, relevant: (relevant ?? []).map((q) => q.n) });
  });
  // The real rules, as the page sends them (the pause after 30 s of new speech), with the minute's spacing taken out:
  // the replay waits for each answer before the next piece instead. The cue names what was asked, as the page does.
  const cues = createCues({
    send: (item) => link.send(item),
    autoEveryMs: 0,
    manualEveryMs: 0,
    context: () => {
      const { asked, skipped } = questions.marked();
      const done = [...asked, ...skipped].sort((a, b) => a - b);
      return { guestName: plan.guest || undefined, ...(done.length ? { position: { done } } : {}) };
    },
  });
  const { token } = await link.connect();
  const close = () => new Promise((r) => { link.disconnect(); server.closeAllConnections(); server.close(r); });
  return { url, token, link, cues, questions, landed, close, held: () => kit.relay.pending.size > 0 };
}

/**
 * Plays the stretch, one piece per pause, and waits for each answer (at most waitMs). Each pause: the piece's lines as
 * PIECE_S seconds of speech, the pause, the cue; then the answer as it lands on the card. Gives one row per piece.
 */
async function replay(s, pieces, { waitMs, ready = async () => {}, asked = () => [] }) {
  const rows = [];
  for (const [i, piece] of pieces.entries()) {
    await ready(i);
    const start = i * (PIECE_S + 10);
    const step = PIECE_S / piece.lines.length;
    piece.lines.forEach((line, k) => s.cues.heard({ source: line.speaker, text: line.text, start: start + k * step, end: start + (k + 1) * step }));
    const before = s.landed.length;
    assert.equal(s.cues.pause(), true, `piece ${i + 1}: the pause sends a cue`);
    for (const end = Date.now() + waitMs; s.landed.length === before && Date.now() < end;) await sleep(5);
    const got = s.landed[before];
    const shown = got ? [got.main, ...got.relevant] : [];
    rows.push({ piece: i + 1, expect: piece.expect, shown, hit: piece.expect.filter((n) => shown.includes(n)), ms: got?.ms ?? null });
    // The host asks what the piece's next line asks, so later pauses see it as asked, as on a real show.
    for (const n of asked(piece)) if (s.questions.pick(n)) s.questions.asked();
  }
  return rows;
}

function summary(t, label, rows) {
  const times = rows.map((r) => r.ms).filter((ms) => ms !== null);
  for (const r of rows) t.diagnostic(`${label} pause ${r.piece}: expected ${r.expect.join(", ")}; shown ${r.shown.join(", ") || "nothing"} (card first); ${r.ms === null ? "no answer" : `${(r.ms / 1000).toFixed(2)} s after the pause`}`);
  if (times.length) t.diagnostic(`${label}: from the pause to the list, middle ${(middle(times) / 1000).toFixed(2)} s, slowest ${(Math.max(...times) / 1000).toFixed(2)} s over ${times.length} pauses; from the end of speech add ${PAUSE_S} s: middle ${(middle(times) / 1000 + PAUSE_S).toFixed(2)} s, slowest ${(Math.max(...times) / 1000 + PAUSE_S).toFixed(2)} s`);
}

/** The stand-in agent: over MCP, like Connect with MCP; it answers each cue with the six prepared questions sharing the most words with the cue's talk. */
function standInAgent(s) {
  const words = (text) => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
  let questions = [];
  let stop = false;
  let calls = 0;
  const call = async (name, args) => {
    calls += 1;
    const res = await fetch(`${s.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: rpcBody(name, args) });
    return (await res.json()).result.structuredContent;
  };
  const pick = (cue) => {
    const said = words(cue.transcript.map((l) => l.text).join(" "));
    const done = new Set(cue.position?.done ?? []);
    return questions
      .filter((q) => !done.has(q.n))
      .map((q) => ({ n: q.n, score: [...words(q.text)].filter((w) => said.has(w)).length }))
      .filter((q) => q.score > 0)
      .sort((a, b) => b.score - a.score || a.n - b.n)
      .slice(0, 6)
      .map((q, i) => ({ question: q.n, ...(i === 0 ? { why: "shares their words" } : {}) }));
  };
  const loop = (async () => {
    questions = (await call("get_context")).questions;
    let args = { seq: 0 };
    while (!stop) {
      const r = await call("wait_for_cue", args);
      if (stop) break;
      args = r.idle ? { seq: r.seq } : { seq: r.seq, suggestions: pick(r) };
    }
  })();
  // Ready when the agent's next wait is held by the page (the one that carried its last answer).
  return { ready: async () => { while (!calls || !s.held()) await sleep(1); }, stop: async () => { stop = true; await s.close(); await loop.catch(() => {}); } };
}

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("a made-up stretch replayed through the real cue path: each pause's questions land on the card or in Relevant now, grouped by part", async (t) => {
  const plan = showFrom(fixture("stand-in-script.md"));
  const { pieces } = JSON.parse(fixture("stand-in-replay.json"));
  const s = await setup(plan);
  const agent = standInAgent(s);
  try {
    const rows = await replay(s, pieces, { waitMs: 5_000, ready: agent.ready, asked: (piece) => piece.asked ?? [] });
    summary(t, "stand-in", rows);
    for (const r of rows) {
      assert.notEqual(r.ms, null, `pause ${r.piece}: an answer landed`);
      assert.ok(r.hit.length > 0, `pause ${r.piece}: one of ${r.expect.join(", ")} shows (shown: ${r.shown.join(", ")})`);
      assert.ok(r.ms < 1000, `pause ${r.piece}: the page's own way adds ${r.ms} ms (the stand-in agent answers at once)`);
    }
    // What a pause after the asked question sees: the asked one never comes back.
    const asked = pieces.flatMap((p) => p.asked ?? []);
    for (const r of rows.slice(1)) for (const n of asked.filter((a) => pieces.slice(0, r.piece - 1).some((p) => (p.asked ?? []).includes(a)))) assert.ok(!r.shown.includes(n), `pause ${r.piece}: Q${n}, asked before, is left out`);
  } finally {
    await agent.stop();
  }
});

/** Claude Code as the agent, connected with MCP to the local Worker; it runs until the end report. */
function claudeAgent(s) {
  const dir = mkdtempSync(join(tmpdir(), "producer-replay-"));
  const config = join(dir, "mcp.json");
  writeFileSync(config, JSON.stringify({ mcpServers: { producer: { type: "http", url: `${s.url}/mcp`, headers: { Authorization: `Bearer ${s.token}` } } } }));
  const tools = ["get_context", "wait_for_cue", "post_suggestions", "post_report"].map((n) => `mcp__producer__${n}`).join(",");
  const model = process.env.PRODUCER_REPLAY_MODEL || "claude-opus-5-5";
  const prompt = "Be my live-show producer. My producer page is connected to you as the producer MCP server. Follow its instructions: call get_context once, then wait_for_cue again and again, answering each cue in your next wait_for_cue. Keep going until a cue says End report.";
  const child = spawn("claude", ["-p", prompt, "--model", model, "--mcp-config", config, "--strict-mcp-config", "--allowedTools", tools, "--output-format", "text"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const done = new Promise((r) => child.on("close", r));
  return {
    model,
    ready: async () => { for (const end = Date.now() + 120_000; !s.held(); await sleep(20)) if (Date.now() > end) throw new Error(`Claude Code never waited for a cue: ${out.slice(-500)}`); },
    stop: async () => {
      s.cues.end();
      await Promise.race([done, sleep(60_000)]);
      child.kill();
      await s.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const REAL = process.env.PRODUCER_REAL_SCRIPT_DIR;
const STRETCH = process.env.PRODUCER_REPLAY_FILE;
const AGENT = process.env.PRODUCER_REPLAY_AGENT;
test("a real show's stretch replayed with a real agent (opt-in: PRODUCER_REAL_SCRIPT_DIR, PRODUCER_REPLAY_FILE, PRODUCER_REPLAY_AGENT=claude)", { skip: !(REAL && STRETCH && AGENT === "claude") && "set PRODUCER_REAL_SCRIPT_DIR, PRODUCER_REPLAY_FILE and PRODUCER_REPLAY_AGENT=claude", timeout: 15 * 60_000 }, async (t) => {
  const plan = showFrom(readFileSync(join(REAL, "prompter.md"), "utf8"));
  const { pieces } = JSON.parse(readFileSync(STRETCH, "utf8"));
  const s = await setup(plan);
  const agent = claudeAgent(s);
  try {
    const rows = await replay(s, pieces, { waitMs: 30_000, ready: agent.ready, asked: (piece) => piece.asked ?? [] });
    summary(t, `Claude Code (${agent.model}, Connect with MCP)`, rows);
    const hits = rows.filter((r) => r.hit.length).length;
    t.diagnostic(`right questions shown at ${hits} of ${rows.length} pauses`);
    for (const r of rows) assert.notEqual(r.ms, null, `pause ${r.piece}: an answer landed within 30 s`);
    assert.ok(hits >= Math.ceil(rows.length * 0.8), `the right questions show at ${hits} of ${rows.length} pauses (at least 4 in 5)`);
  } finally {
    await agent.stop();
  }
});
