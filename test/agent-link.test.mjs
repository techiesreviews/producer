// The page's side of the agent connection (src/agent-link.mjs) against the real Worker and relay object: the token,
// the three states of Copy connect message (waiting, connected, off), a loop that stays connected through idle
// answers, the Test round trip with its seconds, Disconnect (the agent's next call gets 401) and another tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeTimers, pageSockets, relayWith, settle } from "./fakes.mjs";
import { checkToken, newToken } from "../src/token.mjs";
import { AGENT_QUIET_MS, AGENT_SAMPLE, AGENT_TEST_MS, ANSWERS_KEPT, createAgentLink } from "../src/agent-link.mjs";
import { CUE as CUE_NAMES, WAIT_HOLD_MS } from "../src/protocol.mjs";
import { createChat } from "../src/chat.mjs";

const { default: worker } = await import("../src/worker.mjs");
const SITE = "https://producer.test";


// Each setup's page and agent call from their own address, so the Worker's request limits (per address, in real
// time) never carry over from one test to the next.
let agents = 0;

/** The Worker with this relay behind it, a page link on fake timers, and an agent that calls /mcp with the token. */
function setup({ tokenReply, tokensOnPageClock = false, show, load, report, chat, chatOn } = {}) {
  const now = { t: Date.now() };
  const ip = `203.0.113.${(agents++ % 250) + 1}`;
  const kit = relayWith(now);
  const env = { ASSETS: { fetch: async () => new Response("page") }, RELAY: { idFromName: (n) => n, get: () => ({ op: (m) => kit.relay.op(m) }) } };
  const net = pageSockets(kit, (t) => checkToken(t, now.t));
  const timers = fakeTimers(now);
  const seen = [];
  const link = createAgentLink({
    net: { token: tokenReply ?? (tokensOnPageClock ? () => Promise.resolve(Response.json(newToken(now.t))) : () => worker.fetch(new Request(`${SITE}/api/agent-token`, { method: "POST", headers: { "cf-connecting-ip": ip } }), env)), socket: net.socket },
    onChange: (v) => seen.push(v),
    show,
    load,
    report,
    chat,
    chatOn,
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
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "cf-connecting-ip": ip },
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
  await timers.tick(WAIT_HOLD_MS);
  const idle = await wait;
  assert.deepEqual(idle.body.result.structuredContent, { idle: true, seq: 0 }, "the page answers idle after its hold");
  // The curl loop asks again at once, so the page stays connected round after round.
  for (let round = 0; round < 4; round++) {
    const again = call("wait_for_cue", { seq: 0 });
    await flush();
    await timers.tick(WAIT_HOLD_MS);
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

test("giving up the wait while the token is still on its way connects nothing; the next press starts clean", async () => {
  let release;
  let asked = 0;
  const { link, net } = setup({
    tokenReply: () => (++asked === 1 ? new Promise((r) => { release = r; }) : Promise.resolve(Response.json(newToken(Date.now())))),
  });
  const first = link.connect();
  assert.equal(link.view().state, "waiting");
  link.disconnect();
  assert.equal(link.view().state, "off");
  release(Response.json(newToken(Date.now())));
  assert.equal(await first, null, "the late token is let go");
  assert.equal(link.view().state, "off", "the late token does not bring the wait back");
  assert.equal(net.sockets.length, 0, "and opens no relay socket");
  const next = await link.connect();
  assert.match(next.token, /^pr1-/);
  assert.equal(asked, 2, "the next press asks for a new token");
  assert.equal(net.sockets.length, 1);
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
  await timers.tick(WAIT_HOLD_MS + AGENT_QUIET_MS);
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

// ---- Cues from the cue rules (card 10): the page hands a cue to the agent's wait, keeps the agent's latest answer
// for the question card, and shows each answer once. ----

const CUE = { cue: "pause", transcript: [{ speaker: "host", text: "How did it start?" }, { speaker: "guest", text: "In a garage." }], position: { segment: 2, title: "Her story", minutesLeft: 7 }, guestName: "Sam" };

test("a cue goes only to a connected agent; it reaches the wait held, with labels, the run position and the guest's name", async () => {
  const { link, call, connect, flush } = setup();
  assert.equal(link.send(CUE), false, "no agent: the cue is not taken");
  await connect();
  assert.equal(link.send(CUE), false, "waiting for the agent: not taken either");
  const wait = call("wait_for_cue", { seq: 0 });
  await flush();
  assert.equal(link.send(CUE), true);
  const cue = (await wait).body.result;
  assert.deepEqual(cue.structuredContent, { idle: false, cue: "pause", seq: 1, transcript: CUE.transcript, chat: [], guestName: "Sam", position: CUE.position });
  assert.match(cue.content[0].text, /Guest name: Sam[\s\S]*HOST: How did it start\?\nGUEST: In a garage\.[\s\S]*Run position: segment 2, Her story, 7 min left/);
  link.disconnect();
});

test("the end cue waits for a loop that went quiet, and reaches it when the loop comes back; show cues do not", async () => {
  const { link, call, connect, timers } = setup();
  await connect();
  await call("get_context");
  await timers.tick(AGENT_QUIET_MS);
  assert.equal(link.view().state, "waiting", "the loop went quiet");
  assert.equal(link.send(CUE), false, "a pause cue is not kept for a quiet loop");
  assert.equal(link.send({ cue: CUE_NAMES.endReport, transcript: [{ speaker: "guest", text: "Thanks for having me." }] }), true, "the end cue is taken");
  const back = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([back.cue, back.seq, back.transcript.map((l) => l.text)], [CUE_NAMES.endReport, 1, ["Thanks for having me."]], "the loop comes back and hears End");
  link.disconnect();
});

test("the end cue is not taken when no agent ever called: none, or a connect message never pasted, or another tab", async () => {
  const END = { cue: CUE_NAMES.endReport, transcript: [] };
  const { link, call, connect, timers } = setup();
  assert.equal(link.send(END), false, "no connection at all");
  await connect();
  assert.equal(link.send(END), false, "the message was copied, but no agent has called");
  await timers.tick(AGENT_QUIET_MS * 3);
  assert.equal(link.send(END), false, "still no call, minutes later");
  await call("get_context");
  link.disconnect();
  assert.equal(link.send(END), false, "after Disconnect the agent is gone");
  const other = setup();
  const { token } = await other.connect();
  await other.call("get_context");
  await other.kit.tab(checkToken(token).born); // a duplicated tab connects with the same token
  await other.flush();
  assert.equal(other.link.view().state, "elsewhere");
  assert.equal(other.link.send(END), false, "the agent talks to the other tab");
  other.link.disconnect();
});

test("a fresh connection after Disconnect does not carry the old agent's calls over to the end cue", async () => {
  const END = { cue: CUE_NAMES.endReport, transcript: [] };
  const now = { t: Date.now() };
  const timers = fakeTimers(now);
  const sockets = [];
  // A stand-in for the relay: each socket opens at once, and the test plays the agent's calls on the newest one.
  const net = {
    token: async () => Response.json({ token: `pr1-stand-in-${sockets.length}` }),
    socket() {
      const sock = Object.assign(new EventTarget(), { readyState: 1, send() {}, close() { sock.readyState = 3; } });
      sockets.push(sock);
      return sock;
    },
  };
  const link = createAgentLink({ net, now: () => now.t, timers });
  const agentCalls = () => sockets.at(-1).dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "call", id: "c1", tool: "get_context", args: {} }) }));
  await link.connect();
  agentCalls();
  await timers.tick(AGENT_QUIET_MS);
  assert.equal(link.view().state, "waiting");
  assert.equal(link.send(END), true, "the agent called on this connection, then went quiet: it takes the end cue");
  link.disconnect();
  await link.connect();
  assert.equal(link.view().state, "waiting");
  assert.equal(link.send(END), false, "a new connection no agent has called yet: not taken");
  link.disconnect();
});

test("cues sent while the agent is busy wait for its next call, joined, with the newest reason; a lost answer gets the same again", async () => {
  const { link, call, connect } = setup();
  await connect();
  await call("get_context");
  link.send({ cue: "pause", transcript: [{ speaker: "guest", text: "One." }] });
  link.send({ cue: "suggest_now", transcript: [{ speaker: "guest", text: "Two." }], position: { segment: 3, title: "Pricing", minutesLeft: 12 } });
  const first = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([first.cue, first.seq, first.transcript.map((l) => l.text), first.position.title], ["suggest_now", 2, ["One.", "Two."], "Pricing"]);
  const again = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual(again, first, "asking again with the same seq returns the same material");
  link.send({ cue: "pause", transcript: [{ speaker: "guest", text: "Three." }] });
  const next = (await call("wait_for_cue", { seq: 2 })).body.result.structuredContent;
  assert.deepEqual([next.seq, next.transcript.map((l) => l.text)], [3, ["Three."]], "only what is new after the agent's seq");
  assert.deepEqual((await call("get_new_transcript", { seq: 2 })).body.result.structuredContent.transcript.map((l) => l.text), ["Three."]);
  link.disconnect();
});

test("the agent's answer is kept as the latest suggestion with the seconds since the cue went, and shown once", async () => {
  const got = [];
  const { link, call, connect, flush, now } = setup();
  link.onSuggestions((s) => got.push(s));
  await connect();
  const wait = call("wait_for_cue", { seq: 0 });
  await flush();
  link.send(CUE);
  await wait;
  now.t += 2_340;
  const answer = { seq: 1, suggestions: [{ question: 2, why: "follows the garage" }, { text: "Who paid first?" }] };
  call("wait_for_cue", answer);
  await flush();
  const latest = { seq: 1, cue: "pause", suggestions: answer.suggestions, ms: 2_340 };
  assert.deepEqual(got, [latest]);
  assert.deepEqual(link.suggestion(), latest, "kept in memory for the question card");
  // The curl loop resends the same body on every idle round: nothing new is shown.
  now.t += 25_000;
  call("wait_for_cue", answer);
  await flush();
  assert.equal(got.length, 1, "shown once");
  link.disconnect();
  assert.equal(link.suggestion(), null, "gone with the connection");
});

test("an older answer never replaces a newer one, and the Test's answer is not a suggestion", async () => {
  const got = [];
  const { link, call, connect, flush } = setup();
  link.onSuggestions((s) => got.push(s));
  await connect();
  await call("get_context");
  link.test();
  await call("wait_for_cue", { seq: 0 });
  const held = call("wait_for_cue", { seq: 1, suggestions: [{ text: "A sample answer?" }] });
  await flush();
  assert.equal(link.view().test.state, "ok");
  assert.deepEqual(got, [], "the Test's answer stays on the Test button");
  link.send(CUE); // seq 2, to the wait held
  assert.equal((await held).body.result.structuredContent.seq, 2);
  link.send(CUE); // seq 3, not handed over yet
  // The agent answers cue 2 with post_suggestions after cue 3 went: it counts for cue 2, not cue 3.
  call("post_suggestions", { suggestions: [{ text: "For two?" }] });
  await flush();
  assert.deepEqual([link.suggestion().seq, link.suggestion().suggestions[0].text], [2, "For two?"]);
  const three = await call("wait_for_cue", { seq: 2 });
  assert.equal(three.body.result.structuredContent.seq, 3);
  call("wait_for_cue", { seq: 3, suggestions: [{ text: "For three?" }] });
  await flush();
  call("wait_for_cue", { seq: 2, suggestions: [{ text: "Stale?" }] });
  await flush();
  assert.deepEqual(got.map((s) => [s.seq, s.suggestions[0].text]), [[2, "For two?"], [3, "For three?"]], "the stale answer to cue 2 is not kept");
  assert.equal(link.suggestion().seq, 3);
  link.disconnect();
});

test("asking: from a show cue until the agent's turn on it ends; an answer to an older cue leaves a newer one asking", async () => {
  const ended = [];
  const { link, call, connect, flush } = setup();
  link.onSettled(() => ended.push(link.asking()));
  await connect();
  await call("get_context");
  assert.equal(link.asking(), false, "nothing asked yet");
  link.send(CUE); // seq 1
  assert.equal(link.asking(), true, "a cue went");
  await call("wait_for_cue", { seq: 0 }); // the agent takes cue 1
  link.send(CUE); // seq 2 waits for the agent's next call
  await call("wait_for_cue", { seq: 1, suggestions: [{ text: "For one?" }] }); // answers 1, takes 2 at once
  assert.equal(link.asking(), true, "the answer to cue 1 does not end the turn on cue 2");
  assert.deepEqual(ended, []);
  call("wait_for_cue", { seq: 2 }); // back past cue 2 with no answer
  await flush();
  assert.equal(link.asking(), false, "the agent gave no answer to cue 2: the turn is over");
  assert.deepEqual(ended, [false]);
  link.send(CUE); // seq 3, to the wait held
  call("wait_for_cue", { seq: 3, suggestions: [{ text: "For three?" }] });
  await flush();
  assert.deepEqual([link.asking(), ended], [false, [false, false]], "answered");
  link.test();
  assert.equal(link.asking(), false, "a Test cue is not a show question");
  link.disconnect();
  assert.equal(link.asking(), false);
});

test("asking ends with an answer through post_suggestions too", async () => {
  const ended = [];
  const { link, call, connect, flush } = setup();
  link.onSettled(() => ended.push(link.asking()));
  await connect();
  await call("get_context");
  link.send(CUE);
  await call("wait_for_cue", { seq: 0 });
  assert.equal(link.asking(), true);
  await call("post_suggestions", { suggestions: [{ text: "For one?" }] });
  await flush();
  assert.deepEqual([link.asking(), ended], [false, [false]]);
  link.disconnect();
});

test("a failed Test stays failed when the agent later answers a show cue", async () => {
  const { link, call, connect, flush, timers } = setup();
  await connect();
  await call("get_context");
  link.test();
  await timers.tick(AGENT_TEST_MS);
  assert.equal(link.view().test.state, "fail");
  await call("wait_for_cue", { seq: 0 }); // the agent comes back and gets the Test's cue
  link.send(CUE);
  const show = await call("wait_for_cue", { seq: 1 });
  call("wait_for_cue", { seq: show.body.result.structuredContent.seq, suggestions: [{ text: "About the garage?" }] });
  await flush();
  assert.equal(link.view().test.state, "fail", "a show answer is not the Test's");
  assert.equal(link.suggestion().suggestions[0].text, "About the garage?");
  link.disconnect();
});

test("the Test's made-up talk never joins the show's: a Test cue goes alone", async () => {
  const { link, call, connect } = setup();
  await connect();
  await call("get_context");
  link.send(CUE);
  link.test();
  link.send({ cue: "pause", transcript: [{ speaker: "guest", text: "After the Test." }] });
  const first = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([first.seq, first.transcript.map((l) => l.text)], [1, ["How did it start?", "In a garage."]], "the show cue first, alone");
  const test = (await call("wait_for_cue", { seq: 1 })).body.result.structuredContent;
  assert.deepEqual([test.seq, test.transcript], [2, AGENT_SAMPLE], "then the Test's cue, alone");
  const after = (await call("wait_for_cue", { seq: 2 })).body.result.structuredContent;
  assert.deepEqual([after.seq, after.transcript.map((l) => l.text)], [3, ["After the Test."]]);
  link.disconnect();
});

test("text the agent has not confirmed is capped at 20,000 characters, the oldest cue going first", async () => {
  const { link, call, connect, net } = setup();
  await connect();
  await call("get_context");
  // What the page itself sends (the Worker caps again on the way, so it is read on the page's socket).
  const sock = net.sockets[0];
  const send = sock.send.bind(sock);
  let sent;
  sock.send = (text) => { const m = JSON.parse(text); if (m.type === "result") sent = m.result; send(text); };
  for (let i = 0; i < 5; i++) link.send({ cue: "pause", transcript: [{ speaker: "guest", text: `${i}${"x".repeat(5_999)}` }] });
  await call("wait_for_cue", { seq: 0 });
  assert.deepEqual(sent.transcript.map((l) => l.text[0]), ["2", "3", "4"], "three cues of 6,000 fit");
  link.disconnect();
});

test("get_context gives the agent the show the host pasted: name, guest, questions and the run order with the live part", async () => {
  const show = { showTitle: "Techies Live", guestName: "Sam", questions: [{ n: 1, text: "How did it start?" }], segments: [{ title: "Intro", plannedMinutes: 3 }, { title: "Her story", plannedMinutes: 10, live: true }] };
  const { link, call, connect } = setup({ show: () => show });
  await connect();
  const ctx = (await call("get_context")).body.result;
  assert.deepEqual(ctx.structuredContent, { ...show, seq: 0 });
  assert.match(ctx.content[0].text, /Prepared questions:\n1\. How did it start\?[\s\S]*2\. Her story \(10 min\) \(live now\)/);
  link.disconnect();
});

test("the cap lets a cue already handed over go when too much piles up unconfirmed, and keeps a waiting Test cue", async () => {
  const { link, call, connect, net, flush } = setup();
  await connect();
  await call("get_context");
  const sock = net.sockets[0];
  const send = sock.send.bind(sock);
  let sent;
  sock.send = (text) => { const m = JSON.parse(text); if (m.type === "result") sent = m.result; send(text); };
  const wait = call("wait_for_cue", { seq: 0 });
  await flush();
  link.send({ cue: "pause", transcript: [{ speaker: "guest", text: "Handed over." }] });
  assert.equal((await wait).body.result.structuredContent.seq, 1);
  link.test(); // seq 2, waiting
  for (let i = 0; i < 4; i++) link.send({ cue: "pause", transcript: [{ speaker: "guest", text: `${i}${"x".repeat(5_999)}` }] });
  await call("wait_for_cue", { seq: 0 });
  assert.deepEqual([sent.seq, sent.transcript], [2, AGENT_SAMPLE], "asking again from 0: cue 1 is gone, the Test's cue is kept and goes alone");
  await call("wait_for_cue", { seq: 2 });
  assert.deepEqual([sent.seq, sent.transcript.map((l) => l.text[0])], [6, ["1", "2", "3"]], "then the newest show cues that fit");
  link.disconnect();
});

test("Test pressed again after a failed Test: the old Test cue is replaced, and the seconds count from the new one", async () => {
  const { link, call, connect, flush, timers, now } = setup();
  await connect();
  await call("get_context");
  link.test();
  await timers.tick(AGENT_TEST_MS);
  assert.equal(link.view().test.state, "fail");
  await call("get_context"); // the agent is back (a quiet minute put the page back to waiting)
  link.send(CUE);
  link.test();
  const show = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([show.cue, show.transcript.map((l) => l.text)], ["pause", ["How did it start?", "In a garage."]], "the show cue alone: the old Test cue is gone");
  now.t += 5_000;
  const test = (await call("wait_for_cue", { seq: show.seq })).body.result.structuredContent;
  assert.deepEqual(test.transcript, AGENT_SAMPLE, "the sample talk once");
  now.t += 3_000;
  call("wait_for_cue", { seq: test.seq, suggestions: [{ text: "Retested?" }] });
  await flush();
  assert.deepEqual([link.view().test.state, link.view().test.seconds], ["ok", 3], "timed from when the new Test's cue was handed over");
  link.disconnect();
});

test("an agent whose seq is ahead of this page (kept from another tab) still gets the next cue", async () => {
  const { link, call, connect, flush } = setup();
  await connect();
  const wait = call("wait_for_cue", { seq: 9 });
  await flush();
  assert.equal(link.send(CUE), true);
  const cue = (await wait).body.result.structuredContent;
  assert.deepEqual([cue.idle, cue.seq], [false, 1]);
  link.send({ cue: "pause", transcript: [{ speaker: "guest", text: "Later." }] });
  assert.equal((await call("wait_for_cue", { seq: 1 })).body.result.structuredContent.seq, 2);
  link.disconnect();
});

test("the catch-up read never mixes the Test's talk in, and get_context's seq skips no cue the agent has not seen", async () => {
  const { link, call, connect } = setup();
  await connect();
  await call("get_context");
  link.send(CUE);
  link.test();
  link.send({ cue: "pause", transcript: [{ speaker: "guest", text: "After the Test." }] });
  const read = (await call("get_new_transcript", { seq: 0 })).body.result.structuredContent.transcript;
  assert.deepEqual(read.map((l) => l.text), ["How did it start?", "In a garage.", "After the Test."]);
  const ctx = (await call("get_context")).body.result.structuredContent;
  assert.equal(ctx.seq, 0, "wait from before the oldest cue not yet confirmed");
  assert.equal((await call("wait_for_cue", { seq: ctx.seq })).body.result.structuredContent.seq, 1);
  link.disconnect();
});

test("load_show: the page's own check and load run on what the agent sent, and the answer goes back to the agent", async () => {
  const got = [];
  const { link, call, connect } = setup({ load: (args) => { got.push(args); return args.parts?.length ? { result: { loaded: true, questions: 1, parts: args.parts.length } } : { error: "Add the run order." }; } });
  await connect();
  const plan = { show: "Sample Show", questions: ["Why?"], parts: [{ name: "Intro", minutes: 5 }] };
  const ok = await call("load_show", plan);
  assert.equal(ok.status, 200);
  assert.deepEqual(got, [{ show: "Sample Show", guest: "", questions: ["Why?"], parts: plan.parts, notes: "" }], "what the Worker cleaned and passed on");
  assert.deepEqual(ok.body.result.structuredContent, { ok: true, questions: 1, parts: 1 });
  assert.equal(link.view().state, "on", "a load counts as the agent's own call");
  assert.equal(link.view().test.state, "idle", "and is not a Test");
  link.disconnect();
});

test("load_show on a page that cannot load: a plain refusal, never a crash", async () => {
  const { link, call, connect } = setup();
  await connect();
  const r = await call("load_show", { parts: [{ name: "Intro", minutes: 5 }] });
  assert.equal(r.body.result.isError, true);
  assert.match(r.body.result.content[0].text, /cannot load/i);
  link.disconnect();
});

test("the load cue goes alone, is not a question for the agent to answer, and never takes suggestions as an answer", async () => {
  const { link, call, connect, flush } = setup();
  link.onSuggestions(() => assert.fail("a load cue has no suggestions"));
  await connect();
  await call("get_context");
  link.send({ cue: CUE_NAMES.load, transcript: [] }); // seq 1
  assert.equal(link.asking(), false, "loading is not a question on the card");
  link.send(CUE); // seq 2
  const first = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([first.cue, first.seq, first.transcript], ["load_show", 1, []], "alone: the pause cue's words do not hide it");
  const second = (await call("wait_for_cue", { seq: 1, suggestions: [{ text: "Not an answer to the load" }] })).body.result.structuredContent;
  assert.deepEqual([second.cue, second.seq], ["pause", 2], "the next wait gets the pause cue");
  assert.equal(link.suggestion(), null, "an answer to the load cue is not a suggestion");
  // A second press while the first still waits replaces it.
  link.send({ cue: CUE_NAMES.load, transcript: [] }); // seq 3
  link.send({ cue: CUE_NAMES.load, transcript: [] }); // seq 4
  const again = (await call("wait_for_cue", { seq: 2 })).body.result.structuredContent;
  assert.deepEqual([again.cue, again.seq], ["load_show", 4]);
  await flush();
  link.disconnect();
});

test("the load cue is the host's request: the 20,000-character cap lets it stay while old show cues go", async () => {
  const { link, call, connect } = setup();
  await connect();
  await call("get_context");
  link.send({ cue: CUE_NAMES.load, transcript: [] }); // seq 1
  for (let i = 0; i < 5; i++) link.send({ cue: "pause", transcript: [{ speaker: "guest", text: `${i}${"x".repeat(5_999)}` }] });
  const first = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([first.cue, first.seq, first.transcript], [CUE_NAMES.load, 1, []], "the load request is still the first thing the agent gets");
  const next = (await call("wait_for_cue", { seq: 1 })).body.result.structuredContent;
  assert.deepEqual(next.transcript.map((l) => l.text[0]), ["2", "3", "4"], "the show cues were trimmed as before");
  link.disconnect();
});

test("post_report: the page's own report() takes what the agent sent, and its answer goes back to the agent", async () => {
  const got = [];
  const { link, call, connect } = setup({ report: (args) => { got.push(args); return args.topics.length ? { result: { shown: true } } : { error: "There is no show to report on yet." }; } });
  await connect();
  const report = { topics: ["Vans"], asked: [1], clips: [{ at: "7:42", note: "The van story" }] };
  const ok = await call("post_report", report);
  assert.equal(ok.status, 200);
  assert.deepEqual(got, [{ ...report, skipped: [] }], "what the Worker checked and passed on, every list filled in");
  assert.deepEqual(ok.body.result.structuredContent, { ok: true });
  const refused = await call("post_report", { topics: [] });
  assert.equal(refused.body.result.isError, true);
  assert.match(refused.body.result.content[0].text, /no show to report on yet/);
  link.disconnect();
});

test("B5: the answers already taken are bounded: the newest ANSWERS_KEPT stay, a repeat of one of them still counts once", async () => {
  const now = { t: 1_000_000 };
  const timers = fakeTimers(now);
  let sock;
  const net = {
    token: async () => Response.json({ token: newToken(now.t).token }),
    socket(protocols) {
      sock = new EventTarget();
      Object.assign(sock, { protocols, readyState: 1, sent: [], send: (d) => sock.sent.push(JSON.parse(d)), close: () => { sock.readyState = 3; } });
      return sock;
    },
  };
  const link = createAgentLink({ net, now: () => now.t, timers });
  await link.connect();
  let n = 0;
  const post = (text) => sock.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "call", id: `c${++n}`, tool: "post_suggestions", args: { suggestions: [{ text }] } }) }));
  const answers = [];
  link.onSuggestions((a) => answers.push(a));
  for (let i = 0; i < ANSWERS_KEPT * 3; i++) post(`Question number ${i}?`);
  assert.equal(link.answersHeld(), ANSWERS_KEPT, "an eight-hour link with many answers keeps only the newest");
  const before = sock.sent.length;
  post(`Question number ${ANSWERS_KEPT * 3 - 1}?`);
  assert.equal(sock.sent.at(-1).result.shown, 1, "a repeat is still answered");
  assert.equal(sock.sent.length, before + 1);
  assert.equal(link.answersHeld(), ANSWERS_KEPT);
  link.disconnect();
  assert.equal(link.answersHeld(), 0, "Disconnect lets them all go");
});

// ---- TOOLS-336: the viewer chat ----

test("post_chat: the page's chat takes what the agent sent, and the answer goes back to the agent", async () => {
  const got = [];
  const { link, call, connect } = setup({ chat: (args) => { got.push(args); return { result: { shown: args.messages.length } }; } });
  await connect();
  const ok = await call("post_chat", { messages: [{ author: "Person 1", text: "How often do you test a restore?" }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(got, [{ messages: [{ author: "Person 1", text: "How often do you test a restore?" }] }]);
  assert.deepEqual(ok.body.result.structuredContent, { ok: true, shown: 1 });
  assert.equal(link.view().state, "on", "a chat post counts as the agent's own call");
  link.disconnect();
});

test("post_chat on a page with no chat: a plain refusal, never a crash", async () => {
  const { link, call, connect } = setup();
  await connect();
  const r = await call("post_chat", { messages: [] });
  assert.equal(r.body.result.isError, true);
  assert.match(r.body.result.content[0].text, /chat/i);
  link.disconnect();
});

test("the chat cue is the host's request: the 20,000-character cap lets it stay while old show cues go", async () => {
  const { link, call, connect } = setup();
  await connect();
  await call("get_context");
  link.send({ cue: CUE_NAMES.chat, transcript: [] }); // seq 1
  for (let i = 0; i < 5; i++) link.send({ cue: "pause", transcript: [{ speaker: "host", text: `${i}${"x".repeat(5_999)}` }] });
  const first = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([first.cue, first.seq], [CUE_NAMES.chat, 1], "the chat request is still the first thing the agent gets");
  link.disconnect();
});

test("a solo show's cue says so, so the agent knows to pick viewer questions rather than suggest", async () => {
  const { link, call, connect } = setup();
  await connect();
  await call("get_context");
  link.send({ ...CUE, guestName: undefined, solo: true });
  const r = (await call("wait_for_cue", { seq: 0 })).body.result;
  assert.equal(r.structuredContent.solo, true);
  assert.match(r.content[0].text, /solo show takes no suggestions/);
  link.disconnect();
});

test("a cue says chatOn by the chat's state when the agent gets it, not when it was queued", async () => {
  let on = true;
  const { link, call, connect } = setup({ chatOn: () => on });
  await connect();
  await call("get_context");
  link.send({ ...CUE, solo: true, chatOn: true }); // queued while the chat is on (the page says so in the cue)
  on = false; // the host switches the chat off before the agent comes back
  const r = (await call("wait_for_cue", { seq: 0 })).body.result;
  assert.equal(r.structuredContent.chatOn, undefined, "the agent is not told to read a chat that is off");
  assert.doesNotMatch(r.content[0].text, /post_chat/);
  link.disconnect();
});

test("a chat request the agent has not picked up is taken back when the host switches the chat off", async () => {
  const { link, call, connect } = setup();
  await connect();
  await call("get_context");
  link.send({ cue: CUE_NAMES.chat, transcript: [] }); // seq 1, not picked up yet
  link.unsend(CUE_NAMES.chat);
  link.send(CUE); // seq 2
  const next = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([next.cue, next.seq], ["pause", 2], "the agent never hears the request that was taken back");
  link.disconnect();
});

test("the chat cue goes alone, is not a question on the card, and never takes suggestions as an answer", async () => {
  const { link, call, connect, flush } = setup();
  link.onSuggestions(() => assert.fail("a chat cue has no suggestions"));
  await connect();
  await call("get_context");
  link.send({ cue: CUE_NAMES.chat, transcript: [] }); // seq 1
  assert.equal(link.asking(), false, "reading the chat is not a question on the card");
  link.send(CUE); // seq 2
  const first = (await call("wait_for_cue", { seq: 0 })).body.result.structuredContent;
  assert.deepEqual([first.cue, first.seq, first.transcript], ["read_chat", 1, []], "alone: the pause cue's words do not hide it");
  const second = (await call("wait_for_cue", { seq: 1, suggestions: [{ text: "Not an answer to the chat cue" }] })).body.result.structuredContent;
  assert.deepEqual([second.cue, second.seq], ["pause", 2]);
  assert.equal(link.suggestion(), null);
  await flush();
  link.disconnect();
});

test("through the real Worker into the page's chat: a short message, a pick, waiting and a problem all land", async () => {
  const viewers = createChat();
  const { link, call, connect } = setup({ chat: (args) => viewers.agentPost(args, "1:00") });
  await connect();
  viewers.ask("Claude Code", () => true);
  const waiting = await call("post_chat", { waiting: "no live stream yet" });
  assert.equal(waiting.body.result.isError, undefined, JSON.stringify(waiting.body.result));
  assert.equal(viewers.view().phase, "waiting");
  const posted = await call("post_chat", { messages: [{ author: "Person 1", text: "Hello" }, { author: "Person 2", platform: "YouTube", text: "How often do you test a restore?", time: "2026-12-01T19:20:00Z", pick: "fits the backup part" }] });
  assert.equal(posted.body.result.isError, undefined, JSON.stringify(posted.body.result));
  assert.deepEqual(posted.body.result.structuredContent, { ok: true, shown: 2 });
  assert.equal(viewers.view().pick.text, "How often do you test a restore?");
  const problem = await call("post_chat", { problem: "I have no Restream connection." });
  assert.equal(problem.body.result.isError, undefined);
  assert.deepEqual([viewers.view().phase, viewers.view().reason], ["failed", "I have no Restream connection."]);
  link.disconnect();
});

test("with the viewer chat on, a held wait that runs out says chatOn, so the agent reads the chat on quiet stretches too", async () => {
  let on = false;
  const { link, call, connect, timers, flush } = setup({ chatOn: () => on });
  await connect();
  const off = call("wait_for_cue", { seq: 0 });
  await flush();
  await timers.tick(WAIT_HOLD_MS);
  assert.deepEqual((await off).body.result.structuredContent, { idle: true, seq: 0 }, "chat off: a plain idle");
  on = true;
  const quiet = call("wait_for_cue", { seq: 0 });
  await flush();
  await timers.tick(WAIT_HOLD_MS);
  const r = (await quiet).body.result;
  assert.deepEqual(r.structuredContent, { idle: true, seq: 0, chatOn: true }, "chat on: the idle answer says so");
  assert.match(r.content[0].text, /post_chat/);
  link.disconnect();
});
