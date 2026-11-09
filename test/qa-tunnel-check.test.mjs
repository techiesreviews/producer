// The QA link's self-check (scripts/qa-tunnel-check.mjs): the page loads and stays out of search engines, /mcp
// refuses a call with no token, and the relay works. Run here against stand-ins for fetch and WebSocket.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createServer } from "node:http";
import { openRelaySocket, runChecks } from "../scripts/qa-tunnel-check.mjs";

const BASE = "https://example-words.trycloudflare.com";

/** A Worker stand-in: the page, /mcp with and without a token, the token route. `fault` bends one part. */
function fakeWorld(fault = {}) {
  const calls = [];
  const sockets = [];
  const fetch = async (url, init = {}) => {
    const { pathname } = new URL(url);
    calls.push(`${init.method || "GET"} ${pathname}`);
    const headers = init.headers || {};
    if (pathname === "/") return new Response("<!doctype html><title>Producer</title>", { status: fault.pageStatus ?? 200, headers: fault.noRobotsHeader ? {} : { "x-robots-tag": "noindex" } });
    if (pathname === "/api/agent-token") {
      if ((headers.origin ?? headers.Origin) !== (fault.originIs ?? BASE)) return Response.json({ error: "Forbidden" }, { status: 403 });
      return Response.json({ token: `pr1-abcdefgh-${"A".repeat(43)}`, createdAt: 1 });
    }
    if (pathname === "/mcp") {
      const authed = String(headers.authorization || "").startsWith("Bearer pr1-");
      if (!authed) return Response.json({ error: "no" }, { status: fault.mcpOpen ? 200 : 401 });
      return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "wait_for_cue" }] } }, { status: fault.mcpAuthStatus ?? 200 });
    }
    return new Response("nope", { status: 404 });
  };
  class FakeWebSocket {
    constructor(url, init) {
      this.url = url;
      this.protocols = init.protocols;
      this.origin = init.headers?.origin;
      this.closed = false;
      sockets.push(this);
      queueMicrotask(() => {
        if (fault.relayDown || this.origin !== (fault.originIs ?? BASE)) return this.onerror?.({});
        if (!fault.relaySilent) this.onmessage?.({ data: fault.relayRaw ?? JSON.stringify({ type: fault.relayFirst ?? "ready", createdAt: 1 }) });
      });
    }
    close() { this.closed = true; }
  }
  return { fetch, WebSocket: FakeWebSocket, calls, sockets };
}

// A clock that moves one second at every sleep, so a wait of 60 seconds costs no time here.
function clockedRun(world, extra = {}) {
  let t = 0;
  return runChecks(BASE, { ...world, sleep: async () => { t += 1000; }, now: () => t, log: () => {}, waitSeconds: 5, relaySeconds: 0.05, ...extra });
}
const run = (world, extra) => clockedRun(world, { resolves: async () => true, ...extra });

test("check: a healthy link passes all four steps and closes the relay socket", async () => {
  const world = fakeWorld();
  const result = await run(world);
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map((s) => [s.name, s.ok]), [["page", true], ["not indexed", true], ["mcp refuses no token", true], ["relay", true]]);
  assert.equal(world.sockets.length, 1);
  assert.equal(world.sockets[0].url, "wss://example-words.trycloudflare.com/api/relay");
  assert.deepEqual(world.sockets[0].protocols, ["producer", `t.pr1-abcdefgh-${"A".repeat(43)}`], "the token travels as a subprotocol, not in the address");
  assert.equal(world.sockets[0].closed, true);
  assert.equal(world.sockets[0].origin, BASE, "the socket carries the page's Origin, as a browser's does");
});

test("check: asks for the page only after the new address exists in public name servers, and goes on if they cannot be asked", async () => {
  const world = fakeWorld();
  let looks = 0;
  const calls = [];
  const resolves = async () => looks++ >= 3;
  const spy = async (url, init) => { calls.push(looks); return world.fetch(url, init); };
  const result = await run({ ...world, fetch: spy }, { resolves, waitSeconds: 60 });
  assert.equal(result.ok, true);
  assert.ok(calls[0] >= 4, "no page request before the name was found");
  // Name servers that never answer: the page is still tried, in the second half of the wait.
  const never = await run(fakeWorld(), { resolves: async () => false, waitSeconds: 10 });
  assert.equal(never.ok, true);
});

test("check: sends the Origin a browser would, so a Worker that refuses a foreign Origin is tested as the page meets it", async () => {
  const wrong = await run(fakeWorld({ originIs: "https://some-other-words.trycloudflare.com" }));
  assert.equal(wrong.ok, false);
  assert.match(wrong.steps.at(-1).detail, /refused \(403\)/);
});

test("check: a request that never answers ends at its deadline instead of holding the check", async () => {
  const world = fakeWorld();
  const stalls = (url, init) => new Promise((_, no) => init.signal.addEventListener("abort", () => no(init.signal.reason)));
  const started = Date.now();
  const result = await run({ ...world, fetch: stalls }, { requestSeconds: 0.03, waitSeconds: 3 });
  assert.equal(result.ok, false);
  assert.match(result.steps[0].detail, /timed? ?out|abort/i);
  assert.ok(Date.now() - started < 2000, "ended by its own deadline");
  // The same for a later request: the token call hangs.
  const hang = async (url, init) => (new URL(url).pathname === "/api/agent-token" ? stalls(url, init) : world.fetch(url, init));
  const later = await run({ ...world, fetch: hang }, { requestSeconds: 0.03 });
  assert.equal(later.ok, false);
  assert.equal(later.steps.at(-1).name, "relay");
});

test("check: waits for the page, then goes on (a new tunnel address takes a few seconds to answer)", async () => {
  const world = fakeWorld();
  let tries = 0;
  const flaky = async (url, init) => {
    if (new URL(url).pathname === "/" && tries++ < 3) throw new TypeError("fetch failed");
    return world.fetch(url, init);
  };
  const result = await run({ ...world, fetch: flaky });
  assert.equal(result.ok, true);
  assert.ok(tries >= 4);
});

test("check: a page that never loads fails, and says so, without trying the rest", async () => {
  const world = fakeWorld({ pageStatus: 530 });
  const result = await run(world, { waitSeconds: 3 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.steps.map((s) => s.name), ["page"]);
  assert.match(result.steps[0].detail, /530/);
});

test("check: a page that search engines may index fails", async () => {
  assert.equal((await run(fakeWorld({ noRobotsHeader: true }))).steps.find((s) => s.name === "not indexed").ok, false);
});

test("check: /mcp that answers without a token fails", async () => {
  const result = await run(fakeWorld({ mcpOpen: true }));
  assert.equal(result.ok, false);
  assert.equal(result.steps.find((s) => s.name === "mcp refuses no token").ok, false);
});

test("check: the relay must say ready, and an agent call with the token must be accepted", async () => {
  assert.equal((await run(fakeWorld({ relaySilent: true }))).steps.at(-1).ok, false, "no ready message");
  assert.equal((await run(fakeWorld({ relayDown: true }))).steps.at(-1).ok, false, "socket error");
  assert.equal((await run(fakeWorld({ relayFirst: "nope" }))).steps.at(-1).ok, false, "wrong first message");
  for (const relayRaw of ["{}", "not json", "null"]) {
    const odd = (await run(fakeWorld({ relayRaw }))).steps.at(-1);
    assert.equal(odd.ok, false, relayRaw);
    assert.match(odd.detail, /^the relay said something unreadable, expected "ready"$/, "a plain message, not a crash");
  }
  assert.match((await run(fakeWorld({ relayFirst: "nope" }))).steps.at(-1).detail, /the relay said "nope"/);
  const refused = await run(fakeWorld({ mcpAuthStatus: 401 }));
  assert.equal(refused.steps.at(-1).ok, false, "the token is not accepted by /mcp");
});

test("check: only the public address is called", async () => {
  const world = fakeWorld();
  const seen = [];
  const spy = async (url, init) => { seen.push(new URL(url).origin); return world.fetch(url, init); };
  await run({ ...world, fetch: spy });
  assert.deepEqual([...new Set(seen)], [BASE]);
});

test("check: the command line stops with usage and exit 2 for a missing or odd address, never quietly with 0", () => {
  const script = resolve(import.meta.dirname, "../scripts/qa-tunnel-check.mjs");
  for (const args of [[], ["not-a-url"], ["http://example.com"], ["https://example.com", "--wait"], ["https://example.com", "--wait", "0"], ["https://example.com", "--wait", "abc"], ["https://example.com", "--nope"], ["https://example.com", "--wait", "Infinity"], ["https://example.com", "--wait", "1e999"]]) {
    const run = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(run.status, 2, args.join(" "));
    assert.match(run.stderr, /^Usage: node scripts\/qa-tunnel-check\.mjs/);
  }
});

test("check: a valid address whose checks fail exits 1 (not 0, not 2)", () => {
  const script = resolve(import.meta.dirname, "../scripts/qa-tunnel-check.mjs");
  const run = spawnSync(process.execPath, [script, "https://qa-tunnel-test.invalid", "--wait", "2"], { encoding: "utf8", timeout: 20000 });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stdout, /FAIL page/);
});

test("check: Node's real WebSocket sends the relay protocols and the page's Origin in the handshake", async () => {
  const seen = await new Promise((done, fail) => {
    const server = createServer().on("upgrade", (request, socket) => {
      done({ origin: request.headers.origin, protocols: request.headers["sec-websocket-protocol"], path: request.url });
      socket.destroy();
      server.close();
    }).listen(0, "127.0.0.1", () => {
      const socket = openRelaySocket(globalThis.WebSocket, `ws://127.0.0.1:${server.address().port}/api/relay`, "pr1-abcdefgh-TOKEN", "https://example-words.trycloudflare.com");
      socket.onerror = () => {};
    });
    setTimeout(() => fail(new Error("no handshake")), 5000).unref();
  });
  assert.equal(seen.origin, "https://example-words.trycloudflare.com");
  assert.equal(seen.protocols, "producer, t.pr1-abcdefgh-TOKEN");
  assert.equal(seen.path, "/api/relay", "the token is not in the address");
});
