import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BURST_LIMIT, clientKey, durableLimiter, hashClient, LIMITS, McpLimiter, RATE_LIMIT, slidingWindow } from "../src/limiter.mjs";

test("limits: 60 per minute and a burst cap of 10 per 10 seconds", () => {
  assert.deepEqual(LIMITS, [{ max: RATE_LIMIT, ms: 60_000 }, { max: BURST_LIMIT, ms: 10_000 }]);
  assert.deepEqual([RATE_LIMIT, BURST_LIMIT], [60, 10]);
});

test("sliding window: burst cap, per-minute cap and exact Retry-After", () => {
  let t = 0;
  const w = slidingWindow(LIMITS, () => t);
  for (let i = 0; i < 10; i++) assert.equal(w.hit().success, true);
  assert.deepEqual(w.hit(), { success: false, retryAfter: 10, max: 10, ms: 10_000 });
  t = 4_000;
  assert.deepEqual(w.hit(), { success: false, retryAfter: 6, max: 10, ms: 10_000 }, "refusals are not counted");
  t = 10_000;
  assert.equal(w.hit().success, true, "the burst window has passed");
  // Spread 60 requests over the minute: the burst cap never trips, the minute cap does.
  let m = 0;
  const minute = slidingWindow(LIMITS, () => m);
  for (let i = 0; i < 60; i++) { m = i * 1_000; assert.equal(minute.hit().success, true, `request ${i}`); }
  m = 59_500;
  assert.deepEqual(minute.hit(), { success: false, retryAfter: 1, max: 60, ms: 60_000 }, "the first request leaves the window at 60 s");
  m = 60_000;
  assert.equal(minute.hit().success, true);
});

test("sliding window empties after a quiet spell as long as the longest window", () => {
  let t = 0;
  const w = slidingWindow(LIMITS, () => t);
  for (let i = 0; i < 10; i++) w.hit();
  assert.equal(w.size(), 10);
  t = 61_000;
  assert.equal(w.hit().success, true);
  assert.ok(w.size() <= 1, `still holds ${w.size()} times`);
});

test("a wait loop (one request about every 25 s, plus the answers) never meets either limit", () => {
  let t = 0;
  const w = slidingWindow(LIMITS, () => t);
  // Worst realistic case: an answer 3 s after each cue, a cue every 10 s, for ten minutes.
  for (; t < 600_000; t += 3_000) assert.equal(w.hit().success, true, `at ${t} ms`);
});

test("the Durable Object answers 204 or 429 with Retry-After and never touches storage", async () => {
  const storage = new Proxy({}, { get() { throw Error("storage must not be used"); } });
  const object = new McpLimiter({ storage }, {});
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await object.fetch(new Request("https://limiter.internal/", { method: "POST" }))).status);
  assert.deepEqual(codes, [...Array(10).fill(204), 429, 429]);
  const res = await object.fetch(new Request("https://limiter.internal/", { method: "POST" }));
  assert.ok(Number(res.headers.get("retry-after")) >= 1);
  assert.equal(res.headers.get("x-limit"), "10/10000", "names the burst limit that refused");
  const source = readFileSync(new URL("../src/limiter.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.storage|console\.|setInterval/);
});

test("client keys: IPv4 as is, IPv6 grouped by /64; the hash is salted SHA-256", async () => {
  assert.equal(clientKey("203.0.113.9"), "203.0.113.9");
  assert.equal(clientKey("2001:db8:0:1::5"), "2001:db8:0:1::/64");
  assert.equal(clientKey("2001:0DB8:0000:0001:aaaa:bbbb:cccc:dddd"), "2001:db8:0:1::/64");
  assert.equal(clientKey("::1"), "0:0:0:0::/64");
  assert.equal(clientKey("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(clientKey("::ffff:cb00:7109"), "203.0.113.9");
  assert.equal(clientKey("::203.0.113.9"), "203.0.113.9");
  const hash = await hashClient("203.0.113.9");
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes("203"));
  assert.equal(await hashClient("::ffff:203.0.113.9"), hash);
  const prompterSalted = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("techies-prompter/mcp-limit/v1|203.0.113.9"))), (b) => b.toString(16).padStart(2, "0")).join("");
  assert.notEqual(hash, prompterSalted, "the producer's own salt");
});

test("durable limiter: success, a refusal that names its limit, and fail-open on error or delay", async () => {
  const fake = (respond) => ({ idFromName: (n) => ({ n }), get: () => ({ fetch: respond }) });
  assert.deepEqual(await durableLimiter(fake(async () => new Response(null, { status: 204 }))).limit({ key: "a" }), { success: true });
  const refused = await durableLimiter(fake(async () => new Response(null, { status: 429, headers: { "Retry-After": "7", "X-Limit": "10/10000" } }))).limit({ key: "a" });
  assert.deepEqual(refused, { success: false, retryAfter: 7, max: 10, ms: 10_000 });
  assert.deepEqual(await durableLimiter(fake(async () => { throw new Error("down"); })).limit({ key: "a" }), { success: true });
  assert.deepEqual(await durableLimiter(fake(() => new Promise(() => {})), 20).limit({ key: "a" }), { success: true }, "slow: allowed");
});
