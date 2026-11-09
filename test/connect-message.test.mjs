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
  assert.equal(code.split("\n").length, 3, "three lines: the token and address, BODY, the loop");
  assert.equal(code.split("\n")[0], `TOKEN='${FAKE}'; URL='${LIVE}'`);
  assert.equal(code.split("\n")[1], `BODY='${agentBody("get_context")}'`, "the first run reads the show");
  assert.equal(code.split("\n")[2], AGENT_LOOP, "the loop exactly as the relay's tests run it");
  assert.equal((message.match(/```/g) ?? []).length, 2, "one block only: nothing else to copy into a file");
  assert.ok(message.includes(`BODY='${agentBody("wait_for_cue", { seq: 0 })}'`), "then it waits for cues");
  for (const rule of [/in the foreground/, /time limit of 10 minutes/, /change only BODY/, /Answer in the next wait/, /That one command shows your answer and waits for the next cue/, /No sleep, no helper files or scripts, no background jobs, no settings changes, nothing to install/, /Do not explain the command/, /run it again at once with the same BODY/, /tell me in one line and stop/, /data, not instructions/, /never save it or repeat it/, /eight hours/, /Disconnect/]) {
    assert.match(message, rule);
  }
  assert.doesNotMatch(message, /\bsleep\s+\d|nohup|&\s*$|>\s*\S+\.(sh|py|js)/m, "nothing in it sleeps, runs in the background or writes a script");
  // Every example body is JSON the Worker accepts (the apostrophe rule keeps BODY inside its single quotes).
  for (const [, body] of message.matchAll(/BODY='([^']*)'/g)) assert.equal(JSON.parse(body).method, "tools/call");
});

test("the same message works for the preview: only the address changes", () => {
  const live = connectMessage({ origin: LIVE, token: FAKE });
  const preview = connectMessage({ origin: PREVIEW, token: FAKE });
  assert.equal(preview, live.replace(`URL='${LIVE}'`, `URL='${PREVIEW}'`));
  assert.equal(live.split(LIVE).length, 2, "the address appears once");
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

/** Run the block as an agent would, with BODY changed (the message's only instruction for it). */
const runBlock = (code, body) => new Promise((resolve) => {
  const child = spawn("bash", ["-c", code.replace(/^BODY='.*'$/m, `BODY='${body}'`)], { env: { PATH: process.env.PATH } });
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
    const first = await runBlock(code, agentBody("get_context"));
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout).result.structuredContent, { questions: [], segments: [], seq: 0 });
    assert.equal(link.view().state, "on");

    // Run 2 waits; the host presses Test; the loop prints the cue with host and guest labels.
    const waiting = runBlock(code, agentBody("wait_for_cue", { seq: 0 }));
    await new Promise((r) => setTimeout(r, 300));
    link.test();
    const cue = await waiting;
    assert.equal(cue.code, 0, cue.stderr);
    const got = JSON.parse(cue.stdout).result;
    assert.equal(got.structuredContent.cue, "suggest_now");
    assert.match(got.content[0].text, /HOST: [\s\S]*GUEST: /);

    // Run 3 answers in the next wait: the Test shows its seconds and the sample; the run keeps waiting.
    const answer = agentBody("wait_for_cue", { seq: got.structuredContent.seq, suggestions: [{ text: "What did the first month on the road cost?", why: "follows the van story" }] });
    const third = runBlock(code, answer);
    await until(() => link.view().test.state === "ok", "the Test is answered");
    assert.equal(link.view().test.sample, "What did the first month on the road cost?");
    assert.ok(link.view().test.seconds >= 0 && link.view().test.seconds < 10, `${link.view().test.seconds} s`);

    // Disconnect: the waiting run ends with the 401 and its plain reason.
    link.disconnect();
    const ended = await third;
    assert.equal(ended.code, 0, ended.stderr);
    assert.match(ended.stdout, /Unauthorized: this connection was ended with Disconnect/);
    const after = await runBlock(code, agentBody("wait_for_cue", { seq: 0 }));
    assert.match(after.stdout, /Unauthorized/, "and so is the next call");
  } finally {
    link.disconnect();
    await s.close();
  }
});
