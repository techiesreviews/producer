#!/usr/bin/env node
// The QA link's self-check, run by scripts/qa-tunnel.sh once the tunnel has an address.
// Usage: node scripts/qa-tunnel-check.mjs <https://address> [--wait <seconds>]
// It asks the PUBLIC address (so the whole way through the tunnel is tested) for four things and stops at the first
// that fails: the page loads, the page keeps search engines out (X-Robots-Tag: noindex), /mcp refuses a call with
// no token (401), and the relay works: a fresh agent token, the page's socket (/api/relay) says "ready", and an
// authorised /mcp call is accepted. A new tunnel address takes a few seconds to exist in the public name service;
// a lookup before that fails and this computer remembers the failure for about a minute. So the address is first
// looked up at public name servers directly (nothing is remembered), and only then is the page asked for.
// robots.txt is not checked: Cloudflare's tunnel adds its own robots.txt lines in front of the page's.
// It sends no talk and stores nothing; the token it asks for is its own and is never printed.

import { Resolver } from "node:dns/promises";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** True once the host has an address at a public name server (asked directly, so a "not yet" is not remembered). */
export async function resolvesPublicly(host) {
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  try { return (await resolver.resolve4(host)).length > 0; } catch { return false; }
}

/**
 * The page's own socket: the token travels as a subprotocol, never in the address, and the Origin is the page's.
 * Node's built-in WebSocket takes `{ protocols, headers }` as its second argument (test/qa-tunnel-check.test.mjs
 * proves the handshake with the real constructor).
 */
export function openRelaySocket(SocketClass, socketUrl, token, origin) {
  return new SocketClass(socketUrl, { protocols: ["producer", `t.${token}`], headers: { origin } });
}

/** One step: { name, ok, ms, detail }. */
export async function runChecks(base, {
  resolves = resolvesPublicly,
  fetch: fetchFn = globalThis.fetch,
  WebSocket: SocketClass = globalThis.WebSocket,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  now = () => Date.now(),
  log = () => {},
  waitSeconds = 60,
  relaySeconds = 10,
  requestSeconds = 15,
} = {}) {
  const url = (path) => new URL(path, base).href;
  // Every request has a deadline, so a tunnel that accepts a connection and then stalls cannot hold the check for minutes.
  const ask = (path, init = {}) => fetchFn(url(path), { ...init, signal: AbortSignal.timeout(requestSeconds * 1000) });
  // What the page's own requests carry: the Worker refuses a token or a socket whose Origin is not its own address.
  const origin = new URL(base).origin;
  const steps = [];
  const step = async (name, body) => {
    const started = now();
    let outcome;
    try { outcome = await body(); } catch (error) { outcome = { ok: false, detail: error?.message || String(error) }; }
    const entry = { name, ok: outcome.ok, ms: now() - started, detail: outcome.detail ?? "" };
    steps.push(entry);
    log(`${entry.ok ? "ok  " : "FAIL"} ${name}: ${entry.detail} (${(entry.ms / 1000).toFixed(1)} s)`);
    return entry.ok;
  };

  let page;
  const loaded = await step("page", async () => {
    const until = now() + waitSeconds * 1000;
    let last = "no answer";
    // Up to half the wait for the name to exist; if public name servers cannot be asked, go on to the page anyway.
    const host = new URL(base).hostname;
    while (now() < until - (waitSeconds * 1000) / 2 && !(await resolves(host))) await sleep(1000);
    do {
      try {
        const response = await ask("/", { redirect: "follow" });
        if (response.status === 200) { page = response; return { ok: true, detail: "loads (200)" }; }
        last = `answered ${response.status}`;
      } catch (error) { last = error?.cause?.code || error?.message || "no answer"; }
      await sleep(1000);
    } while (now() < until);
    return { ok: false, detail: `${last} for ${waitSeconds} s` };
  });
  if (!loaded) return { ok: false, steps };

  const indexed = await step("not indexed", async () => {
    const header = page.headers.get("x-robots-tag") || "";
    if (!/noindex/i.test(header)) return { ok: false, detail: "the page has no X-Robots-Tag: noindex" };
    return { ok: true, detail: "X-Robots-Tag: noindex" };
  });
  if (!indexed) return { ok: false, steps };

  const refuses = await step("mcp refuses no token", async () => {
    const response = await ask("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return response.status === 401 ? { ok: true, detail: "401 without a token" } : { ok: false, detail: `/mcp answered ${response.status} without a token, expected 401` };
  });
  if (!refuses) return { ok: false, steps };

  await step("relay", async () => {
    const minted = await ask("/api/agent-token", { method: "POST", headers: { origin } });
    if (minted.status !== 200) return { ok: false, detail: `a new token was refused (${minted.status})` };
    const { token } = await minted.json();
    const socketUrl = url("/api/relay").replace(/^http/, "ws");
    const socket = openRelaySocket(SocketClass, socketUrl, token, origin);
    try {
      const first = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ problem: "no answer from the relay" }), relaySeconds * 1000);
        socket.onmessage = (event) => {
          clearTimeout(timer);
          let said;
          try { said = JSON.parse(event.data)?.type; } catch { /* not JSON */ }
          resolve(said === "ready" ? {} : { problem: `the relay said ${said === undefined ? "something unreadable" : `"${said}"`}, expected "ready"` });
        };
        socket.onerror = () => { clearTimeout(timer); resolve({ problem: "the relay socket failed to open" }); };
        socket.onclose = () => { clearTimeout(timer); resolve({ problem: "the relay socket closed at once" }); };
      });
      if (first.problem) return { ok: false, detail: first.problem };
      const call = await ask("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      if (call.status !== 200) return { ok: false, detail: `/mcp refused the new token (${call.status})` };
      return { ok: true, detail: "token, page socket and /mcp call work" };
    } finally {
      try { socket.close(); } catch { /* already closed */ }
    }
  });
  return { ok: steps.every((s) => s.ok), steps };
}

// Fail closed: run only when started as the program (import.meta.main needs Node 24.2; on older Node it is missing and
// the check would quietly do nothing and look as if it had passed).
const startedAsProgram = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (startedAsProgram) {
  const args = process.argv.slice(2);
  const base = args[0];
  let waitSeconds = 60;
  const rest = args.slice(1);
  const waitOk = rest.length === 0 || (rest.length === 2 && rest[0] === "--wait" && Number.isFinite(Number(rest[1])) && Number(rest[1]) > 0);
  if (rest.length === 2 && waitOk) waitSeconds = Number(rest[1]);
  if (!base || !waitOk || !/^https:\/\/[a-z0-9.-]+\/?$/.test(base)) {
    console.error("Usage: node scripts/qa-tunnel-check.mjs <https://address> [--wait <seconds above 0>]");
    process.exit(2);
  }
  const result = await runChecks(base, { waitSeconds, log: (line) => console.log(`check: ${line}`) });
  process.exit(result.ok ? 0 : 1);
}
