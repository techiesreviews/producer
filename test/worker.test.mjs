import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { lastServer, PROTOCOL, relayWith, settle, T0 } from "./fakes.mjs";
import { McpLimiter } from "../src/limiter.mjs";
import { FUTURE_SLACK_MS, MAX_AGE_MS, newToken, relayName, TOKEN_RE } from "../src/token.mjs";

const { default: worker } = await import("../src/worker.mjs");
const SITE = "https://producer.techies.tools";
const src = (file) => readFileSync(resolve(import.meta.dirname, "..", file), "utf8").replace(/^\s*\/\/.*$/gm, "");
const SOURCES = ["src/worker.mjs", "src/relay.mjs", "src/mcp.mjs", "src/limiter.mjs", "src/token.mjs"];

/** A Worker environment with a fake page asset and fake Durable Object namespaces that record what they are asked. */
function env({ status = "ok" } = {}) {
  const calls = { idFromName: [], fetch: [], op: [], assets: [], limiter: 0 };
  return {
    calls,
    ASSETS: { fetch: async (request) => { calls.assets.push(request); return new Response("page", { status: 200 }); } },
    RELAY: {
      idFromName: (name) => { calls.idFromName.push(name); return { name }; },
      get: (id) => ({
        fetch: async (url, init) => { calls.fetch.push({ id, url, init }); return new Response("to the relay"); },
        op: async (m) => { calls.op.push({ id, ...m }); return m.op === "call" ? { status, result: { idle: true, seq: 0 } } : { status }; },
      }),
    },
  };
}

test("a GET or HEAD goes to the static page and comes back as it is", async () => {
  for (const method of ["GET", "HEAD"]) {
    const e = env();
    const request = new Request(`${SITE}/`, { method });
    const response = await worker.fetch(request, e);
    assert.equal(response.status, 200);
    assert.deepEqual(e.calls.assets, [request]);
  }
});

test("any other method on the page is refused with 405 and never reaches the page or its body", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const e = env();
    const body = ["POST", "PUT", "PATCH"].includes(method) ? "private talk" : undefined;
    const request = new Request(`${SITE}/`, { method, body });
    const response = await worker.fetch(request, e);
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(e.calls.assets.length, 0, `${method} did not reach the page`);
    assert.equal(request.bodyUsed, false, `${method}: the body was never read`);
  }
});

test("/api/agent-token: a fresh token with the Worker's time, POST from this site only, never stored", async () => {
  const before = Date.now();
  const e = env();
  const res = await worker.fetch(new Request(`${SITE}/api/agent-token`, { method: "POST", headers: { Origin: SITE } }), e);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["createdAt", "token"]);
  assert.match(body.token, TOKEN_RE);
  assert.equal(parseInt(body.token.split("-")[1], 36), body.createdAt);
  assert.ok(body.createdAt >= before && body.createdAt <= Date.now());
  assert.deepEqual([e.calls.idFromName.length, e.calls.fetch.length], [0, 0], "no relay object is touched");
  assert.equal((await worker.fetch(new Request(`${SITE}/api/agent-token`, { method: "POST", headers: { Origin: "https://evil.example" } }), e)).status, 403);
  const get = await worker.fetch(new Request(`${SITE}/api/agent-token`), e);
  assert.deepEqual([get.status, get.headers.get("Allow")], [405, "POST"]);
  assert.equal((await worker.fetch(new Request(`${SITE}/api/other`), e)).status, 404);
  assert.equal(e.calls.assets.length, 0, "/api never falls through to the page");
});

test("/api/agent-token and /api/relay: an in-memory guard per client", async () => {
  const e = env();
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await worker.fetch(new Request(`${SITE}/api/agent-token`, { method: "POST", headers: { "cf-connecting-ip": "198.51.100.77" } }), e)).status);
  assert.deepEqual([statuses.slice(0, 20).every((s) => s === 200), statuses[20]], [true, 429], "20 tokens a minute per client");
  const { token } = newToken();
  const relayed = [];
  for (let i = 0; i < 31; i++) relayed.push((await worker.fetch(relayRequest(token, { ip: "198.51.100.78" }), e)).status);
  assert.equal(relayed.at(-1), 429, "30 relay connects a minute per client");
  assert.equal((await worker.fetch(new Request(`${SITE}/api/agent-token`, { method: "POST", headers: { "cf-connecting-ip": "198.51.100.79" } }), e)).status, 200, "another client is not affected");
});

const relayRequest = (token, { origin, protocol = PROTOCOL, ip = "203.0.113.5" } = {}) => {
  const headers = new Headers({ Upgrade: "websocket", "Sec-WebSocket-Protocol": `${protocol}, t.${token}`, "cf-connecting-ip": ip });
  if (origin) headers.set("Origin", origin);
  return new Request(`${SITE}/api/relay`, { headers });
};

test("/api/relay: a good token reaches its relay (by hash) with its birth time; bad ones never do", async () => {
  const { token, born } = newToken();
  const good = env();
  const res = await worker.fetch(relayRequest(token, { origin: SITE }), good);
  assert.equal(await res.text(), "to the relay");
  assert.deepEqual(good.calls.idFromName, [await relayName(token)]);
  assert.equal(good.calls.fetch[0].init.headers["X-Token-Born"], String(born));
  const now = Date.now();
  for (const [bad, reason] of [[newToken(now - MAX_AGE_MS - 1000).token, "expired"], [newToken(now + 3600_000).token, "invalid"]]) {
    const e = env();
    const closed = await worker.fetch(relayRequest(bad), e);
    assert.equal(closed.status, 101);
    assert.equal(closed.headers.get("Sec-WebSocket-Protocol"), PROTOCOL, "browsers need the subprotocol to hear the close");
    assert.deepEqual([lastServer().accepted, lastServer().code, lastServer().reason], [true, 4003, reason]);
    assert.deepEqual([e.calls.idFromName.length, e.calls.fetch.length], [0, 0]);
  }
  const prompterToken = `tp1-${T0.toString(36)}-${"A".repeat(43)}`;
  for (const req of [relayRequest("pr1-short"), relayRequest(token, { protocol: "prompter" }), relayRequest(prompterToken)]) {
    const e = env();
    assert.equal((await worker.fetch(req, e)).status, 401, "a Prompter token or protocol does not open the producer's relay");
    assert.equal(e.calls.idFromName.length, 0);
  }
  assert.equal((await worker.fetch(relayRequest(token, { origin: "https://evil.example" }), env())).status, 403);
  assert.equal((await worker.fetch(new Request(`${SITE}/api/relay`), env())).status, 426);
});

test("/mcp: a token passes its birth time to its relay; an old, foreign or revoked one gets 401", async () => {
  const mcp = (token, body = { jsonrpc: "2.0", id: 1, method: "tools/list" }) => new Request(`${SITE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const old = env();
  const res = await worker.fetch(mcp(newToken(Date.now() - MAX_AGE_MS - FUTURE_SLACK_MS).token), old);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("WWW-Authenticate"), "Bearer");
  assert.equal(old.calls.idFromName.length, 0, "no relay touched for an expired token");
  const prompter = env();
  assert.equal((await worker.fetch(mcp(`tp1-${Date.now().toString(36)}-${"A".repeat(43)}`), prompter)).status, 401);
  assert.equal(prompter.calls.idFromName.length, 0, "a Prompter token never reaches a relay");
  const { token, born } = newToken();
  const good = env();
  const list = await worker.fetch(mcp(token), good);
  assert.equal(list.status, 200);
  assert.ok((await list.json()).result.tools.some((t) => t.name === "wait_for_cue"));
  assert.deepEqual(good.calls.op.map((o) => [o.op, o.born]), [["auth", born]]);
  assert.deepEqual(good.calls.idFromName, [await relayName(token)]);
  assert.equal((await worker.fetch(mcp(token), env({ status: "unauthorized" }))).status, 401);
  const none = await worker.fetch(new Request(`${SITE}/mcp`, { method: "POST", body: "{}" }), env());
  assert.equal(none.status, 401, "no token, no tools");
  assert.equal((await worker.fetch(new Request(`${SITE}/mcp/`, { method: "POST", body: "{}" }), env())).status, 401, "also with the trailing slash");
});

test("/mcp: the per-client limit counts in a Durable Object, which the Worker reaches by a hash of the address", async () => {
  const e = env();
  const names = [];
  const objects = new Map();
  e.MCP_LIMITER = {
    idFromName: (n) => { names.push(n); return n; },
    get: (id) => { if (!objects.has(id)) objects.set(id, new McpLimiter({}, {})); return { fetch: (url, init) => objects.get(id).fetch(new Request(url, init)) }; },
  };
  const { token } = newToken();
  const hit = () => worker.fetch(new Request(`${SITE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "cf-connecting-ip": "203.0.113.50" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }), e);
  const codes = [];
  for (let i = 0; i < 11; i++) codes.push((await hit()).status);
  assert.deepEqual(codes, [...Array(10).fill(200), 429]);
  assert.ok(names.every((n) => /^[0-9a-f]{64}$/.test(n) && !n.includes("203")), "the object never sees the address");
});

test("an end-to-end call: agent, Worker, relay object and fake page, with only the note stored", async () => {
  const now = { t: Date.now() };
  const { token, born } = newToken(now.t);
  const kit = relayWith(now);
  const e = env();
  e.RELAY = { idFromName: (n) => n, get: () => ({ fetch: (url, init) => kit.relay.fetch(new Request(url, init)), op: (m) => kit.relay.op(m) }) };
  const opened = await worker.fetch(relayRequest(token, { origin: SITE }), e);
  assert.equal(opened.status, 101);
  const ws = lastServer();
  assert.deepEqual(ws.sent[0], { type: "ready", createdAt: born });
  const asked = worker.fetch(new Request(`${SITE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_context", arguments: {} } }) }), e);
  await settle();
  await settle();
  const call = ws.sent.at(-1);
  assert.deepEqual([call.type, call.tool], ["call", "get_context"]);
  await kit.relay.webSocketMessage(ws, JSON.stringify({ type: "result", id: call.id, result: { showTitle: "Live talk", questions: [{ n: 1, text: "Why?" }], seq: 0 } }));
  const body = await (await asked).json();
  assert.match(body.result.content[0].text, /1\. Why\?/);
  assert.deepEqual([...kit.ctx.storage.data.keys()], ["meta"]);
  assert.ok(!JSON.stringify([...kit.ctx.storage.data.values()]).includes("Why?"));
});

test("the Worker source: no logging, no storage, no outside call, and only the three bindings it needs", () => {
  for (const file of SOURCES) {
    const code = src(file);
    assert.doesNotMatch(code, /\bconsole\b|\bcaches\b|waitUntil|\bsetInterval\b|\bgetSocket\b|\bcf\.|navigator\./, file);
    assert.doesNotMatch(code, /(?<![.\w])fetch\(\s*["'`]https?:/, `${file} makes no outside call`);
    assert.doesNotMatch(code, /\bKV\b|\bD1\b|\bR2\b|\.sql\b|\.exec\(|\bsql\b/, `${file} uses no store`);
  }
  assert.doesNotMatch(src("src/worker.mjs"), /env\.(?!ASSETS\b|RELAY\b|MCP_LIMITER\b)/, "only ASSETS, RELAY and MCP_LIMITER");
  assert.doesNotMatch(src("src/mcp.mjs") + src("src/worker.mjs"), /request\.(text|json|formData|arrayBuffer|blob)\(/, "the body is read only by the capped reader");
});

test("the relay object writes only its short note, and the limiter never touches storage", () => {
  const relay = src("src/relay.mjs");
  const puts = [...relay.matchAll(/storage\.put\(([^,)]*)/g)].map((m) => m[1]);
  assert.deepEqual(puts, ['"meta"'], "one key, written in one place");
  assert.doesNotMatch(src("src/limiter.mjs"), /\.storage|\bctx\b/);
  assert.match(relay, /deleteAll\(\)/, "an alarm erases the note");
});
