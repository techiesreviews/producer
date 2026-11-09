// The page's side of the agent connection (src/agent-link.mjs) against the real Worker and relay object: the token,
// the three states of Copy connect message (waiting, connected, off), a loop that stays connected through idle
// answers, the Test round trip with its seconds, Disconnect (the agent's next call gets 401) and another tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeTimers, pageSockets, relayWith, settle } from "./fakes.mjs";
import { checkToken, newToken } from "../src/token.mjs";
import { AGENT_HOLD_MS, AGENT_QUIET_MS, AGENT_SAMPLE, AGENT_TEST_MS, createAgentLink } from "../src/agent-link.mjs";

const { default: worker } = await import("../src/worker.mjs");
const SITE = "https://producer.test";


/** The Worker with this relay behind it, a page link on fake timers, and an agent that calls /mcp with the token. */
function setup({ tokenReply, tokensOnPageClock = false } = {}) {
  const now = { t: Date.now() };
  const kit = relayWith(now);
  const env = { ASSETS: { fetch: async () => new Response("page") }, RELAY: { idFromName: (n) => n, get: () => ({ op: (m) => kit.relay.op(m) }) } };
  const net = pageSockets(kit, (t) => checkToken(t, now.t));
  const timers = fakeTimers(now);
  const seen = [];
  const link = createAgentLink({
    net: { token: tokenReply ?? (tokensOnPageClock ? () => Promise.resolve(Response.json(newToken(now.t))) : () => worker.fetch(new Request(`${SITE}/api/agent-token`, { method: "POST" }), env)), socket: net.socket },
    onChange: (v) => seen.push(v),
    now: () => now.t,
    timers,
  });
  let token;
  let issued = 0;
  // Let the calls in flight reach the page: a call to /mcp hashes its token on Node's thread pool on the way, so this
  // waits in real time (at most 300 ms: a refused call never arrives).
  const flush = async () => {
    for (const end = Date.now() + 300; net.calls < issued && Date.now() < end;) await new Promise((r) => setTimeout(r, 2));
    for (let i = 0; i < 20; i++) await settle();
  };
  const call = async (name, args = {}) => {
    issued += 1;
    const res = await worker.fetch(new Request(`${SITE}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.9" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }), env);
    return { status: res.status, body: await res.json() };
  };
  const connect = async () => { const r = await link.connect(); token = r?.token; await flush(); return r; };
  return { now, kit, net, timers, link, seen, call, connect, flush };
}

test("Copy connect message gets an eight-hour producer token and waits; the agent's first call shows it connected", async () => {
  const { link, call, connect, net } = setup();
  assert.equal(link.view().state, "off");
  const r = await connect();
  assert.match(r.token, /^pr1-/);
  assert.equal(link.view().state, "waiting");
  assert.deepEqual(net.sockets[0].protocols, ["producer", `t.${r.token}`], "the token travels as a subprotocol");
  const ctx = await call("get_context");
  assert.equal(ctx.status, 200);
  assert.deepEqual(ctx.body.result.structuredContent, { questions: [], segments: [], seq: 0 }, "no show loaded yet");
  assert.equal(link.view().state, "on");
  link.disconnect();
});

test("the loop stays connected through idle answers, and the page waits again once the loop goes quiet", async () => {
  const { link, call, connect, timers, flush } = setup();
  await connect();
  const wait = call("wait_for_cue", { seq: 0 });
  await flush();
  assert.equal(link.view().state, "on");
  await timers.tick(AGENT_HOLD_MS);
  const idle = await wait;
  assert.deepEqual(idle.body.result.structuredContent, { idle: true, seq: 0 }, "the page answers idle after its hold");
  // The curl loop asks again at once, so the page stays connected round after round.
  for (let round = 0; round < 4; round++) {
    const again = call("wait_for_cue", { seq: 0 });
    await flush();
    await timers.tick(AGENT_HOLD_MS);
    assert.equal((await again).body.result.structuredContent.idle, true);
    assert.equal(link.view().state, "on", `round ${round + 1}: still connected`);
  }
  // The loop ended (the agent quit, or its command hit an error): no call for a minute.
  await timers.tick(AGENT_QUIET_MS);
  assert.equal(link.view().state, "waiting", "back to waiting for the agent");
  await call("get_context");
  assert.equal(link.view().state, "on", "a call brings it back");
  link.disconnect();
});

test("Test hands a sample cue to the waiting agent and shows the seconds until its answer comes back, once", async () => {
  const { link, call, connect, now, seen, flush } = setup();
  await connect();
  const wait = call("wait_for_cue", { seq: 0 });
  await flush();
  link.test();
  assert.equal(link.view().test.state, "busy");
  const cue = (await wait).body.result;
  assert.equal(cue.structuredContent.cue, "suggest_now");
  assert.equal(cue.structuredContent.seq, 1);
  assert.deepEqual(cue.structuredContent.transcript, AGENT_SAMPLE);
  assert.match(cue.content[0].text, /HOST: You moved your whole studio[\s\S]*GUEST: Honestly as a joke/, "the agent reads host and guest labels");
  now.t += 4_200;
  const answer = { seq: 1, suggestions: [{ text: "What did the first month on the road cost you?", why: "follows the van story" }] };
  const next = call("wait_for_cue", answer);
  await flush();
  assert.deepEqual(link.view().test, { state: "ok", seconds: 4.2, sample: "What did the first month on the road cost you?" });
  // The curl loop sends the same body again after each idle round: the answer counts once.
  const changes = seen.length;
  now.t += 30_000;
  call("wait_for_cue", answer);
  await flush();
  assert.equal(seen.length, changes, "a repeated answer changes nothing");
  assert.equal(link.view().test.seconds, 4.2);
  link.disconnect();
  await next;
});

test("a Test with no wait held reaches the agent's next wait; with no answer in time it fails, and a late answer still counts", async () => {
  const { link, call, connect, timers, now, flush } = setup();
  await connect();
  await call("get_context");
  link.test();
  now.t += 1_000;
  const wait = call("wait_for_cue", { seq: 0 });
  await flush();
  assert.equal((await wait).body.result.structuredContent.seq, 1, "the cue goes out on the next wait");
  // An answer lost on the way: the agent asks again with the old seq and gets the same cue.
  const again = await call("wait_for_cue", { seq: 0 });
  assert.equal(again.body.result.structuredContent.cue, "suggest_now");
  await timers.tick(AGENT_TEST_MS);
  assert.equal(link.view().test.state, "fail");
  call("post_suggestions", { suggestions: [{ question: 2 }] });
  await flush();
  assert.equal(link.view().test.state, "ok");
  assert.equal(link.view().test.sample, "Question 2");
  assert.equal(link.view().test.seconds, AGENT_TEST_MS / 1000, "timed from when the cue was handed over");
  link.disconnect();
});

test("the page answers the other tools without a show: no transcript yet, suggestions shown, no report", async () => {
  const { link, call, connect } = setup();
  await connect();
  assert.equal((await call("get_new_transcript", { seq: 0 })).body.result.structuredContent.transcript.length, 0);
  assert.equal((await call("post_suggestions", { suggestions: [{ text: "Why a van?" }] })).body.result.structuredContent.shown, 1);
  const report = await call("post_report", { topics: ["vans"] });
  assert.equal(report.body.result.isError, true);
  assert.match(report.body.result.content[0].text, /no show to report on yet/);
  link.disconnect();
});

test("Disconnect revokes the token: the agent's next call gets 401, and the page is back to Copy connect message", async () => {
  const { link, call, connect, net, kit, flush } = setup();
  await connect();
  await call("get_context");
  const wait = call("wait_for_cue", { seq: 0 });
  await flush();
  link.disconnect();
  assert.deepEqual(link.view(), { state: "off", failed: false, test: { state: "idle" }, passed: false }, "off at once");
  await flush();
  const ended = await wait;
  assert.equal(ended.status, 401, "the wait in progress ends with 401");
  assert.match(ended.body.error.message, /Unauthorized: this connection was ended with Disconnect/);
  assert.equal((await call("wait_for_cue", { seq: 0 })).status, 401, "and so does the next call");
  assert.equal((await kit.ctx.storage.get("meta")).revoked, true);
  assert.ok(net.sockets.every((s) => s.readyState === 3), "the page's relay socket is closed");
});

test("another tab takes the relay: this one offers Use this tab, which takes it back", async () => {
  const { link, call, connect, kit, net, flush } = setup();
  const { token } = await connect();
  await call("get_context");
  await kit.tab(checkToken(token).born); // a duplicated tab connects with the same token
  await flush();
  assert.equal(link.view().state, "elsewhere");
  link.useHere();
  assert.equal(link.view().state, "waiting");
  await flush();
  assert.equal(net.sockets.length, 2, "a fresh relay socket");
  await call("get_context");
  assert.equal(link.view().state, "on");
  link.disconnect();
});

test("no token from the Worker (offline, or too many tries): the button says so, and the next press tries again", async () => {
  let reply = () => Promise.reject(new Error("offline"));
  const { link, connect } = setup({ tokenReply: () => reply() });
  assert.equal(await connect(), null);
  assert.deepEqual(link.view(), { state: "off", failed: true, test: { state: "idle" }, passed: false });
  reply = () => Promise.resolve(Response.json({ error: "Too many requests" }, { status: 429 }));
  await connect();
  assert.equal(link.view().failed, true);
  reply = () => Promise.resolve(Response.json(newToken()));
  await connect();
  assert.deepEqual(link.view(), { state: "waiting", failed: false, test: { state: "idle" }, passed: false });
  link.disconnect();
});

test("after eight hours the page lets the token go, like Disconnect", async () => {
  const { link, call, connect, timers } = setup();
  await connect();
  await call("get_context");
  await timers.tick(8 * 60 * 60 * 1000);
  assert.equal(link.view().state, "off");
});

test("the loop going quiet during a Test: the page waits again, and the Test shows its result once the agent is back", async () => {
  const { link, call, connect, timers, flush } = setup();
  await connect();
  await call("get_context");
  link.test();
  await timers.tick(AGENT_QUIET_MS);
  assert.equal(link.view().state, "waiting");
  assert.equal(link.view().test.state, "busy", "the Test keeps waiting for its answer");
  assert.equal(link.view().passed, false);
  const cue = await call("wait_for_cue", { seq: 0 });
  assert.equal(link.view().state, "on");
  call("wait_for_cue", { seq: cue.body.result.structuredContent.seq, suggestions: [{ text: "Back again?" }] });
  await flush();
  assert.equal(link.view().test.state, "ok");
  assert.equal(link.view().passed, true);
  await timers.tick(AGENT_HOLD_MS + AGENT_QUIET_MS);
  assert.deepEqual([link.view().state, link.view().passed], ["waiting", true], "passed stays for the connection; the page shows done only while connected");
  link.disconnect();
});

test("Disconnect while the relay socket is down still revokes the token", async () => {
  const { link, call, connect, net, kit, flush } = setup();
  await connect();
  await call("get_context");
  net.sockets[0].server.close(1006, "gone"); // the network drops; the page waits to reconnect
  await flush();
  link.disconnect();
  await flush();
  assert.equal((await kit.ctx.storage.get("meta")).revoked, true, "a fresh socket carried the revoke");
  assert.equal((await call("get_context")).status, 401);
});

test("a token past its eight hours whose timer is late (a laptop waking up): the next press starts clean", async () => {
  // Tokens made on the test's clock, so the relay (on the same clock) takes the new one.
  const { link, call, connect, now, timers, kit } = setup({ tokensOnPageClock: true });
  const first = await connect();
  await call("get_context");
  now.t += 8 * 60 * 60 * 1000 + 1; // the clock moved on, the timers did not run
  await kit.ctx.storage.deleteAll(); // a new token has its own relay object; this test has one, so empty it
  const second = await connect();
  assert.notEqual(second.token, first.token, "a new token");
  assert.equal(link.view().state, "waiting");
  await timers.tick(1);
  assert.equal(link.view().state, "waiting", "the old token's timer does not drop the new connection");
  link.disconnect();
});
