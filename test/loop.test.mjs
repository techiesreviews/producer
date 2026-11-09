// The ready-made foreground curl loop (no sleep, no helper file) must work against this relay: it repeats while the
// answer is idle and ends on the first real answer or any error. Run for real: bash and curl against the Worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fakePage, lastServer, relayWith } from "./fakes.mjs";
import { newToken } from "../src/token.mjs";

const { default: worker } = await import("../src/worker.mjs");

/** The loop as the connect message will give it (card 08 owns the wording; the shape is fixed here). */
const LOOP = `while out=$(curl -sS -m 40 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$BODY" "$URL/mcp"); do case $out in *'"idle":true'*) ;; *) printf '%s' "$out"; break;; esac; done`;

async function serve(now, relay) {
  const requests = [];
  const env = {
    ASSETS: { fetch: async () => new Response("page") },
    RELAY: { idFromName: (n) => n, get: () => ({ fetch: (url, init) => relay.fetch(new Request(url, init)), op: (m) => relay.op(m) }) },
  };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = `http://${req.headers.host}${req.url}`;
    requests.push(JSON.parse(Buffer.concat(chunks).toString() || "null")?.params?.name ?? "other");
    const headers = { ...req.headers, "cf-connecting-ip": "203.0.113.77" };
    const out = await worker.fetch(new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
}

const run = (env) => new Promise((resolve) => {
  const child = spawn("bash", ["-c", LOOP], { env: { PATH: process.env.PATH, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  child.on("close", (code) => resolve({ code, stdout, stderr }));
});

test("the foreground curl loop waits through idle answers with no sleep and ends on the first cue", async () => {
  const now = { t: Date.now() };
  const { token, born } = newToken(now.t);
  const kit = relayWith(now);
  await kit.tab(born);
  const page = fakePage(kit.relay, lastServer(), { hold: 120 });
  const s = await serve(now, kit.relay);
  try {
    setTimeout(() => page.cue({ cue: "pause", transcript: [{ speaker: "guest", text: 'quote "idle":true if you like' }] }), 380);
    const BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait_for_cue", arguments: { seq: 0 } } });
    const r = await run({ TOKEN: token, BODY, URL: s.url });
    assert.equal(r.code, 0, r.stderr);
    const reply = JSON.parse(r.stdout);
    assert.equal(reply.result.structuredContent.cue, "pause");
    assert.equal(reply.result.structuredContent.idle, false);
    assert.ok(s.requests.length >= 3 && s.requests.length <= 6, `${s.requests.length} requests: it looped through idle answers`);
    assert.ok(s.requests.every((n) => n === "wait_for_cue"));
    assert.ok(s.requests.length < 10, "well under the burst limit of 10 per 10 seconds");
  } finally {
    await s.close();
  }
});

test("a loop that carries an answer repeats it on each idle round; the page shows it once", async () => {
  const now = { t: Date.now() };
  const { token, born } = newToken(now.t);
  const kit = relayWith(now);
  await kit.tab(born);
  const page = fakePage(kit.relay, lastServer(), { hold: 100 });
  page.cue({ cue: "pause", transcript: [{ speaker: "guest", text: "first point" }] });
  const s = await serve(now, kit.relay);
  try {
    setTimeout(() => page.cue({ cue: "suggest_now", transcript: [] }), 330);
    const BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait_for_cue", arguments: { seq: 1, suggestions: [{ question: 2, why: "next in the list" }] } } });
    const r = await run({ TOKEN: token, BODY, URL: s.url });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).result.structuredContent.seq, 2);
    assert.ok(page.waits.length >= 3, `${page.waits.length} rounds`);
    assert.ok(page.waits.every((w) => w.suggestions?.length === 1), "every round carried the answer");
    assert.deepEqual(page.shown, [{ question: 2, why: "next in the list" }], "shown once");
  } finally {
    await s.close();
  }
});

test("a host who reloads the page while the loop waits: the loop reaches the new page and does not stop", async () => {
  const now = { t: Date.now() };
  const { token, born } = newToken(now.t);
  const kit = relayWith(now);
  kit.relay.graceMs = 5_000;
  const old = await kit.tab(born);
  fakePage(kit.relay, old, { hold: 10_000 });
  const s = await serve(now, kit.relay);
  try {
    setTimeout(async () => {
      await kit.relay.webSocketClose(old, 1001); // the browser closes the old page first
      setTimeout(async () => {
        const fresh = await kit.tab(born);
        fakePage(kit.relay, fresh, { hold: 10_000 }).cue({ cue: "pause", transcript: [{ speaker: "guest", text: "after the reload" }] });
      }, 200);
    }, 100);
    const BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait_for_cue", arguments: { seq: 0 } } });
    const r = await run({ TOKEN: token, BODY, URL: s.url });
    assert.equal(r.code, 0, r.stderr);
    const reply = JSON.parse(r.stdout);
    assert.equal(reply.result.isError, undefined, "not \"the page is not open\"");
    assert.equal(reply.result.structuredContent.cue, "pause");
  } finally {
    await s.close();
  }
});

test("the loop ends at once when no page is open or the token is refused (it must not spin)", async () => {
  const now = { t: Date.now() };
  const { token } = newToken(now.t);
  const kit = relayWith(now);
  const s = await serve(now, kit.relay);
  try {
    const BODY = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wait_for_cue", arguments: { seq: 0 } } });
    const noTab = await run({ TOKEN: token, BODY, URL: s.url });
    assert.equal(noTab.code, 0, noTab.stderr);
    assert.equal(JSON.parse(noTab.stdout).result.isError, true);
    assert.equal(s.requests.length, 1);
    const refused = await run({ TOKEN: "pr1-nope", BODY, URL: s.url });
    assert.equal(refused.code, 0, refused.stderr);
    assert.match(refused.stdout, /Unauthorized/);
    assert.equal(s.requests.length, 2);
  } finally {
    await s.close();
  }
});
