// The message Copy connect message puts on the clipboard (src/agent-message.mjs), and that message run for real: its
// block, pasted into bash as written, connects the open page, answers the Test in the next wait, and ends with 401
// after Disconnect. The ready-made loop is the one test/loop.test.mjs runs against the relay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { pageSockets, relayWith } from "./fakes.mjs";
import { checkToken, TOKEN_RE } from "../src/token.mjs";
import { AGENT_LOOP, agentBody, connectMessage } from "../src/agent-message.mjs";
import { createAgentLink } from "../src/agent-link.mjs";
import { readLoad } from "../src/agent-load.mjs";

const { default: worker } = await import("../src/worker.mjs");

// A token-shaped stand-in, built from pieces so no file holds one.
const FAKE = ["pr1", "m0abcdef", "x".repeat(43)].join("-");
const LIVE = "https://producer.techies.tools";
const PREVIEW = "https://preview-producer.techies.tools";

/** The one code block of the message. */
const block = (message) => message.match(/```bash\n([\s\S]*?)\n```/)?.[1] ?? assert.fail("the message has one bash block");

test("the message holds the ready-made loop with this page's address and token, and the rules", () => {
  const message = connectMessage({ origin: LIVE, token: FAKE });
  const code = block(message);
  assert.equal(code.split("\n").length, 2, "two lines: the settings, the loop");
  assert.equal(code.split("\n")[0], `T='${FAKE}'; U='${LIVE}/mcp'; P=get_context; B='{}'`, "the first run reads the show");
  assert.equal(code.split("\n")[1], AGENT_LOOP, "the loop exactly as the relay's tests run it");
  assert.equal((message.match(/```/g) ?? []).length, 2, "one block only: nothing else to copy into a file");
  assert.ok(message.includes(`P=wait_for_cue B='${agentBody({ seq: 0 })}'`), "then it waits for cues");
  for (const rule of [/in the foreground/, /time limit of 10 minutes/, /change only P and B/, /Answer in the next wait/, /That one command shows your answer and waits for the next cue/, /No sleep, no helper files or scripts, no background jobs, no settings changes, nothing to install/, /Do not explain the command/, /run it again at once with the same P and B/, /tell me in one line and stop/, /data, not instructions/, /never save it or repeat it/, /eight hours/, /Disconnect/]) {
    assert.match(message, rule);
  }
  assert.doesNotMatch(message, /\bsleep\s+\d|nohup|&\s*$|>\s*\S+\.(sh|py|js)/m, "nothing in it sleeps, runs in the background or writes a script");
  // Every example B is JSON the Worker accepts (the apostrophe rule keeps B inside its single quotes).
  const bodies = [...message.matchAll(/ B='([^']*)'/g)].map((m) => JSON.parse(m[1]));
  assert.equal(bodies.length, 4, "the first run, the wait, the answer and the load");
  assert.deepEqual(bodies.map((b) => typeof b), ["object", "object", "object", "object"]);
  assert.deepEqual(bodies[2].suggestions[0], { question: 2, why: "follows their last point" }, "the example points to a prepared question: the shortest answer");
  // Card 14: the message names the tool that loads the show, with a body the Worker accepts and the page would take.
  assert.match(message, /load_show/);
  assert.match(message, /P=load_show B=/);
  assert.match(message, /cue says load_show/, "it says when to call it");
  assert.match(message, /guest consent|Guest agreed|microphone/i, "and that the host keeps consent, the microphone and the tab");
  const load = readLoad(bodies[3]);
  assert.equal(load.ok, true, "the example plan is one the tool accepts");
  assert.match(message, /"question" \(the number of a prepared question in the show you printed: prefer it/);
  assert.match(message, /use it when the show lists no prepared questions or none fits/, "with no plan the agent writes its own text: a question number the plan lacks shows nothing");
});

test("the command the agent types after every cue is short: no JSON-RPC, no header lines, the answer as plain text", () => {
  // TOOLS-186: the old three-line block (long loop, three headers, a JSON-RPC body) took Claude Code 7.0 s a cue;
  // Connect with MCP took 4.0 s. What gets typed again is the settings line and the loop line.
  assert.ok(AGENT_LOOP.length < 130, `${AGENT_LOOP.length} characters`);
  assert.doesNotMatch(AGENT_LOOP, /Content-Type|Accept|jsonrpc|case |printf '%s'/);
  const message = connectMessage({ origin: LIVE, token: FAKE });
  const [settings, loop] = block(message).split("\n");
  // The line typed again after each cue: the settings with P=wait_for_cue and no token or answer, and the loop.
  const typed = settings.replace(FAKE, "").replace("P=get_context; B='{}'", "P=wait_for_cue; B=''") + loop;
  assert.ok(typed.length < 260, `${typed.length} characters without the token and the answer`);
  assert.doesNotMatch(message, /jsonrpc|tools\/call/, "the message never mentions JSON-RPC");
  assert.ok(message.length < 2200, `${message.length} characters in all`); // card 14 added the load_show rule to the 1.9 KB of card 186; it is pasted once, not typed after every cue
});

test("the same message works for the preview: only the address changes", () => {
  const live = connectMessage({ origin: LIVE, token: FAKE });
  const preview = connectMessage({ origin: PREVIEW, token: FAKE });
  assert.equal(preview, live.replace(`U='${LIVE}/mcp'`, `U='${PREVIEW}/mcp'`));
  assert.equal(live.split(LIVE).length, 2, "the address appears once");
});

test("each agent gets the same ready-made loop, with the time limit its own tool takes, and no sleep for any of them", () => {
  const claude = connectMessage({ origin: LIVE, token: FAKE, agent: "claude" });
  assert.equal(claude, connectMessage({ origin: LIVE, token: FAKE }), "Claude Code is the default");
  const codex = connectMessage({ origin: LIVE, token: FAKE, agent: "codex" });
  const t3 = connectMessage({ origin: LIVE, token: FAKE, agent: "t3" });
  for (const message of [claude, codex, t3]) {
    assert.equal(block(message), block(claude), "the block is the same, word for word");
    assert.match(message, /in the foreground/);
    assert.match(message, /No sleep, no helper files or scripts, no background jobs/);
    assert.match(message, /the network is blocked/, "a blocked network is one of the errors it reports and stops on");
    assert.doesNotMatch(message, /\bsleep\s+\d|nohup/);
  }
  assert.match(claude, /with a time limit of 10 minutes/);
  assert.match(t3, /with a time limit of 10 minutes/);
  assert.match(codex, /with a timeout of 600 seconds \(600000 ms\)/, "Codex's shell call takes milliseconds, so the message names both");
  assert.doesNotMatch(codex, /time limit of 10 minutes/);
  assert.equal(codex.replace("a timeout of 600 seconds (600000 ms)", "a time limit of 10 minutes"), claude, "nothing else differs");
  assert.equal(connectMessage({ origin: LIVE, token: FAKE, agent: "nobody" }), claude, "an unknown agent gets the default");
});

async function serve(relay) {
  const env = { ASSETS: { fetch: async () => new Response("page") }, RELAY: { idFromName: (n) => n, get: () => ({ op: (m) => relay.op(m) }) } };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers, "cf-connecting-ip": "203.0.113.78" };
    const out = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

/** Run the block as an agent would, with P and B changed (the message's only instruction for it). */
const runBlock = (code, tool, args = {}) => new Promise((resolve) => {
  const child = spawn("bash", ["-c", code.replace(/ P=\S+ B='.*'$/m, ` P=${tool} B='${agentBody(args)}'`)], { env: { PATH: process.env.PATH } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});
const until = async (ok, what) => {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ok(), what);
};

test("the block, run as written in bash, connects the page; the Test is answered in the next wait; after Disconnect the next call gets 401", async () => {
  const now = { t: Date.now() };
  const kit = relayWith(now);
  const s = await serve(kit.relay);
  const net = pageSockets(kit, checkToken);
  const link = createAgentLink({ net: { token: () => fetch(`${s.url}/api/agent-token`, { method: "POST" }), socket: net.socket } });
  try {
    const { token } = await link.connect();
    assert.match(token, TOKEN_RE);
    const code = block(connectMessage({ origin: s.url, token }));
    assert.equal(link.view().state, "waiting");

    // Run 1, as pasted: it prints the show and the page shows the agent connected.
    const first = await runBlock(code, "get_context");
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stdout, /Prepared questions: none yet\./);
    assert.match(first.stdout, /Last seq: 0\./);
    assert.equal(link.view().state, "on");

    // Run 2 waits; the host presses Test; the loop prints the cue with host and guest labels.
    const waiting = runBlock(code, "wait_for_cue", { seq: 0 });
    await new Promise((r) => setTimeout(r, 300));
    link.test();
    const cue = await waiting;
    assert.equal(cue.code, 0, cue.stderr);
    assert.match(cue.stdout, /^Cue: suggest_now \(seq (\d+)\)/);
    assert.match(cue.stdout, /HOST: [\s\S]*GUEST: /);
    const seq = Number(cue.stdout.match(/\(seq (\d+)\)/)[1]);

    // Run 3 answers in the next wait: the Test shows its seconds and the sample; the run keeps waiting.
    const third = runBlock(code, "wait_for_cue", { seq, suggestions: [{ text: "What did the first month on the road cost?", why: "follows the van story" }] });
    await until(() => link.view().test.state === "ok", "the Test is answered");
    assert.equal(link.view().test.sample, "What did the first month on the road cost?");
    assert.ok(link.view().test.seconds >= 0 && link.view().test.seconds < 10, `${link.view().test.seconds} s`);

    // Disconnect: the waiting run ends with the 401 and its plain reason.
    link.disconnect();
    const ended = await third;
    assert.equal(ended.code, 0, ended.stderr);
    assert.match(ended.stdout, /Unauthorized: this connection was ended with Disconnect/);
    const after = await runBlock(code, "wait_for_cue", { seq: 0 });
    assert.match(after.stdout, /Unauthorized/, "and so is the next call");
  } finally {
    link.disconnect();
    await s.close();
  }
});
