import { test } from "node:test";
import assert from "node:assert/strict";
import { fakePage, PROTOCOL, relayWith, settle, T0 } from "./fakes.mjs";
import { FakeSocket } from "./runtime.mjs";
import { MAX_AGE_MS } from "../src/token.mjs";

const { ALARM_SLACK_MS, MAX_CALL_MS } = await import("../src/relay.mjs");
const TRANSCRIPT = "a private sentence nobody may store";

test("relay: the protocol name is the producer's own", () => {
  assert.equal(PROTOCOL, "producer");
});

test("relay: a tab's note lasts until birth + 8 h, with an alarm just after; pings are answered without waking it", async () => {
  const now = { t: T0 + 1000 };
  const { ctx, relay, tab } = relayWith(now);
  assert.deepEqual([ctx.autoResponse.request, ctx.autoResponse.response], ['{"type":"ping"}', '{"type":"pong"}']);
  const ws = await tab();
  assert.deepEqual(ws.sent[0], { type: "ready", createdAt: T0 });
  assert.deepEqual(ctx.storage.data.get("meta"), { createdAt: T0, expiresAt: T0 + MAX_AGE_MS, revoked: false, agent: null });
  assert.equal(ctx.alarm, T0 + MAX_AGE_MS + ALARM_SLACK_MS);
  assert.deepEqual(await relay.op({ op: "auth", born: T0 }), { status: "ok" });
  now.t = T0 + MAX_AGE_MS;
  assert.deepEqual(await relay.op({ op: "auth", born: T0 }), { status: "unauthorized" }, "past expiresAt: refused before the alarm");
});

test("relay: forwards a call to the tab and its result back; the talk is never stored, only the note", async () => {
  const now = { t: T0 };
  const { ctx, relay, tab } = relayWith(now);
  const ws = await tab();
  await relay.op({ op: "agent", name: "claude-code", version: "2.1", born: T0 });
  assert.deepEqual(ws.sent.at(-1), { type: "agent", name: "claude-code", version: "2.1" }, "the tab hears who connected");
  const answer = relay.op({ op: "call", tool: "wait_for_cue", args: { seq: 0 }, born: T0 });
  await settle();
  const call = ws.sent.at(-1);
  assert.equal(call.type, "call");
  assert.deepEqual([call.tool, call.args], ["wait_for_cue", { seq: 0 }]);
  const result = { idle: false, cue: "pause", seq: 1, transcript: [{ speaker: "guest", text: TRANSCRIPT }] };
  await relay.webSocketMessage(ws, JSON.stringify({ type: "result", id: call.id, result }));
  assert.deepEqual(await answer, { status: "ok", result, error: undefined });
  assert.deepEqual([...ctx.storage.data.keys()], ["meta"], "storage holds the note only");
  assert.deepEqual(Object.keys(ctx.storage.data.get("meta")).sort(), ["agent", "createdAt", "expiresAt", "revoked"]);
  assert.ok(!JSON.stringify([...ctx.storage.data.values()]).includes(TRANSCRIPT), "no talk in storage");
  assert.deepEqual(ctx.storage.data.get("meta").agent, { name: "claude-code", version: "2.1" });
  const again = await tab();
  assert.deepEqual(again.sent.map((m) => m.type), ["ready", "agent"], "a reconnecting tab hears the agent at once");
});

test("relay: no tab, a tab that does not answer, and a tab error", async () => {
  const now = { t: T0 };
  const { relay, tab } = relayWith(now);
  const ws = await tab();
  assert.deepEqual(await relay.op({ op: "call", tool: "get_context", args: {}, born: T0, timeout: 1000 }), { status: "timeout" });
  const failing = relay.op({ op: "call", tool: "get_context", args: {}, born: T0 });
  await settle();
  await relay.webSocketMessage(ws, JSON.stringify({ type: "result", id: ws.sent.at(-1).id, error: "No show loaded." }));
  assert.equal((await failing).error, "No show loaded.");
  ws.close(1000);
  assert.deepEqual(await relay.op({ op: "call", tool: "get_context", args: {}, born: T0 }), { status: "no-tab" });
});

test("relay: a call is held up to 30 s (never past 35 s) and answered when the page answers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const now = { t: T0 };
  const { relay, tab } = relayWith(now);
  const ws = await tab();
  let outcome;
  relay.op({ op: "call", tool: "wait_for_cue", args: {}, born: T0, timeout: 30_000 }).then((r) => { outcome = r; });
  await settle();
  t.mock.timers.tick(29_999);
  await settle();
  assert.equal(outcome, undefined, "still held at 29.999 s");
  await relay.webSocketMessage(ws, JSON.stringify({ type: "result", id: ws.sent.at(-1).id, result: { idle: true, seq: 0 } }));
  await settle();
  assert.deepEqual(outcome, { status: "ok", result: { idle: true, seq: 0 }, error: undefined });
  // A page that never answers: the relay gives up at the asked time, and no later than MAX_CALL_MS.
  outcome = undefined;
  relay.op({ op: "call", tool: "wait_for_cue", args: {}, born: T0, timeout: 30_000 }).then((r) => { outcome = r; });
  await settle();
  t.mock.timers.tick(30_000);
  await settle();
  assert.deepEqual(outcome, { status: "timeout" });
  outcome = undefined;
  relay.op({ op: "call", tool: "wait_for_cue", args: {}, born: T0, timeout: 600_000 }).then((r) => { outcome = r; });
  await settle();
  t.mock.timers.tick(MAX_CALL_MS - 1);
  await settle();
  assert.equal(outcome, undefined);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(outcome, { status: "timeout" }, "clamped to 35 s");
  assert.equal(MAX_CALL_MS, 35_000);
});

test("relay: a newer wait replaces an older one, which ends as superseded (an agent that restarted does not leave a cue stuck on a dead call)", async () => {
  const now = { t: T0 };
  const { relay, tab } = relayWith(now);
  const ws = await tab();
  const first = relay.op({ op: "call", tool: "wait_for_cue", args: { seq: 3 }, slot: "wait", born: T0, timeout: 30_000 });
  await settle();
  const second = relay.op({ op: "call", tool: "wait_for_cue", args: { seq: 3 }, slot: "wait", born: T0, timeout: 30_000 });
  await settle();
  assert.deepEqual(await first, { status: "superseded" });
  const other = relay.op({ op: "call", tool: "get_context", args: {}, born: T0 });
  await settle();
  await relay.webSocketMessage(ws, JSON.stringify({ type: "result", id: ws.sent.at(-1).id, result: { questions: [] } }));
  assert.equal((await other).status, "ok", "another tool does not replace the wait");
  const calls = ws.sent.filter((m) => m.type === "call");
  await relay.webSocketMessage(ws, JSON.stringify({ type: "result", id: calls[0].id, result: { idle: true, seq: 3 } }));
  await relay.webSocketMessage(ws, JSON.stringify({ type: "result", id: calls[1].id, result: { idle: false, seq: 4 } }));
  assert.deepEqual((await second).result, { idle: false, seq: 4 }, "the dead call's late answer changed nothing");
});

test("relay: with a page that holds 25 s, idle comes back after about 25 s and a repeated seq is harmless", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const now = { t: T0 };
  const { relay, tab } = relayWith(now);
  const ws = await tab();
  const page = fakePage(relay, ws, { hold: 25_000 });
  let idle;
  relay.op({ op: "call", tool: "wait_for_cue", args: { seq: 0 }, born: T0, timeout: 30_000 }).then((r) => { idle = r; });
  await settle();
  t.mock.timers.tick(24_999);
  await settle();
  assert.equal(idle, undefined, "still waiting at 24.999 s");
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(idle.result, { idle: true, seq: 0 });
  // A cue arrives; the agent asks twice with the same seq (a repeat after a lost answer): both get it, nothing is lost.
  page.cue({ cue: "pause", transcript: [{ speaker: "guest", text: TRANSCRIPT }] });
  const ask = async (seq) => { const p = relay.op({ op: "call", tool: "wait_for_cue", args: { seq }, born: T0, timeout: 30_000 }); await settle(); return p; };
  const one = await ask(0);
  const again = await ask(0);
  assert.deepEqual(again, one, "the same seq gives the same material");
  assert.equal(one.result.seq, 1);
  assert.deepEqual(one.result.transcript, [{ speaker: "guest", text: TRANSCRIPT }]);
  // With seq 1 there is nothing new: it holds again.
  let next;
  relay.op({ op: "call", tool: "wait_for_cue", args: { seq: 1 }, born: T0, timeout: 30_000 }).then((r) => { next = r; });
  await settle();
  assert.equal(next, undefined);
  page.cue({ cue: "suggest_now", transcript: [] });
  await settle();
  assert.equal(next.result.seq, 2);
});

test("relay: only the newest tab receives calls; the older one is closed with 4001", async () => {
  const now = { t: T0 };
  const { relay, tab } = relayWith(now);
  const first = await tab();
  const second = await tab();
  assert.deepEqual([first.code, first.reason], [4001, "Open in another tab"]);
  assert.equal(second.closed, false);
  const pending = relay.op({ op: "call", tool: "get_context", args: {}, born: T0 });
  await settle();
  assert.equal(second.sent.at(-1).type, "call");
  await relay.webSocketMessage(second, JSON.stringify({ type: "result", id: second.sent.at(-1).id, result: { questions: [] } }));
  assert.equal((await pending).status, "ok");
});

test("relay: the alarm refuses what waits, closes the tab with 4003 and erases everything; an early alarm is set again", async () => {
  const now = { t: T0 };
  const { ctx, relay, tab } = relayWith(now);
  const ws = await tab();
  const due = T0 + MAX_AGE_MS + ALARM_SLACK_MS;
  now.t = due - 10;
  await relay.alarm();
  assert.equal(ctx.alarm, due, "early: set again");
  assert.ok(ctx.storage.data.has("meta") && !ws.closed);
  now.t = T0 + 1000;
  const waiting = relay.op({ op: "call", tool: "wait_for_cue", args: {}, born: T0, timeout: 30_000 });
  await settle();
  now.t = due;
  await relay.alarm();
  assert.deepEqual(await waiting, { status: "unauthorized" });
  assert.deepEqual([ws.code, ws.reason], [4003, "expired"]);
  assert.equal(ctx.erased, true);
  assert.equal(ctx.storage.data.size, 0);
  assert.equal(ctx.alarm, null);
});

test("relay: a tab with a token past its time is refused with 4003 and nothing is written", async () => {
  const now = { t: T0 + MAX_AGE_MS };
  const { ctx, tab } = relayWith(now);
  const ws = await tab(T0);
  assert.deepEqual([ws.accepted, ws.tags, ws.code, ws.reason], [true, undefined, 4003, "expired"]);
  assert.equal(ctx.storage.data.size, 0);
  assert.equal(ctx.alarm, null);
});

test("relay: Disconnect (revoke) refuses the token until its alarm, closes with 4003, then the note is gone", async () => {
  const now = { t: T0 };
  const { ctx, relay, tab } = relayWith(now);
  const ws = await tab();
  await relay.op({ op: "agent", name: "claude-code", version: "2", born: T0 });
  const waiting = relay.op({ op: "call", tool: "wait_for_cue", args: {}, born: T0, timeout: 30_000 });
  await settle();
  await relay.webSocketMessage(ws, JSON.stringify({ type: "revoke" }));
  assert.deepEqual(await waiting, { status: "unauthorized" });
  assert.deepEqual([ws.code, ws.reason], [4003, "revoked"]);
  assert.deepEqual(ctx.storage.data.get("meta"), { createdAt: T0, expiresAt: T0 + MAX_AGE_MS, revoked: true, agent: null });
  assert.equal(ctx.alarm, T0 + MAX_AGE_MS + ALARM_SLACK_MS);
  now.t = T0 + MAX_AGE_MS - 1;
  assert.deepEqual(await relay.op({ op: "auth", born: T0 }), { status: "unauthorized" });
  const again = await tab();
  assert.deepEqual([again.code, again.reason], [4003, "revoked"], "a new tab does not bring it back");
  now.t = T0 + MAX_AGE_MS + ALARM_SLACK_MS;
  await relay.alarm();
  assert.equal(ctx.storage.data.size, 0);
});

test("relay: a revoke with no note keeps one for a token's whole life, with an alarm", async () => {
  const now = { t: T0 };
  const { ctx, relay } = relayWith(now);
  const ws = new FakeSocket();
  ctx.acceptWebSocket(ws, ["tab"]);
  await relay.webSocketMessage(ws, JSON.stringify({ type: "revoke" }));
  assert.deepEqual(ctx.storage.data.get("meta"), { createdAt: T0, expiresAt: T0 + MAX_AGE_MS, revoked: true, agent: null });
  assert.equal(ctx.alarm, T0 + MAX_AGE_MS + ALARM_SLACK_MS);
});

test("relay: an agent that calls before the tab has connected waits for it, instead of a 401", async () => {
  const now = { t: T0 + 5000 };
  const { ctx, relay, tab } = relayWith(now);
  assert.deepEqual(await relay.op({ op: "auth", born: T0 }), { status: "ok" }, "a young token with no note yet is fine");
  assert.deepEqual(await relay.op({ op: "agent", name: "codex", version: "1", born: T0 }), { status: "ok" });
  assert.deepEqual(await relay.op({ op: "call", tool: "get_context", args: {}, born: T0 }), { status: "no-tab" });
  assert.equal(ctx.storage.data.size, 0, "nothing is written before a tab connects (tokens are not signed)");
  assert.ok(!ctx.alarm, "and no alarm is set");
  const ws = await tab();
  assert.deepEqual(ctx.storage.data.get("meta"), { createdAt: T0, expiresAt: T0 + MAX_AGE_MS, revoked: false, agent: { name: "codex", version: "1" } });
  assert.deepEqual(ws.sent.map((m) => m.type), ["ready", "agent"]);
  assert.deepEqual(await relay.op({ op: "auth", born: T0 - MAX_AGE_MS }), { status: "unauthorized" }, "an old token is still refused");
});

test("relay: a call from a token past its time is refused, whatever the note says", async () => {
  const now = { t: T0 };
  const { relay, tab } = relayWith(now);
  await tab();
  now.t = T0 + MAX_AGE_MS + 1;
  assert.deepEqual(await relay.op({ op: "call", tool: "wait_for_cue", args: {}, born: T0 }), { status: "unauthorized" });
  assert.deepEqual(await relay.op({ op: "call", tool: "wait_for_cue", args: {}, born: 0 }), { status: "unauthorized" });
});

