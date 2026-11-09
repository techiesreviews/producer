import { test } from "node:test";
import assert from "node:assert/strict";
import { checkToken, FUTURE_SLACK_MS, MAX_AGE_MS, newToken, relayName, TOKEN_RE } from "../src/token.mjs";

const T0 = Date.UTC(2026, 10, 9, 20);
// The random part of a token, which may itself hold "-" (base64url).
const randomPart = (token) => token.split("-").slice(2).join("-");

test("token: pr1-<birth time>-<32 random bytes>, made and checked by the Worker's clock, eight hours", () => {
  const { token, born } = newToken(T0);
  assert.match(token, TOKEN_RE);
  assert.ok(token.startsWith("pr1-"));
  assert.equal(parseInt(token.split("-")[1], 36), T0);
  assert.equal(born, T0);
  assert.equal(MAX_AGE_MS, 8 * 60 * 60 * 1000);
  assert.notEqual(newToken(T0).token, token, "random part");
  assert.deepEqual(checkToken(token, T0 + 1000), { ok: true, born: T0 });
  assert.deepEqual(checkToken(token, T0 + MAX_AGE_MS - 1), { ok: true, born: T0 });
  assert.deepEqual(checkToken(token, T0 + MAX_AGE_MS), { ok: false, reason: "expired" });
  assert.deepEqual(checkToken(token, T0 - FUTURE_SLACK_MS - 1), { ok: false, reason: "invalid" }, "from the future");
  assert.deepEqual(checkToken(token, T0 - FUTURE_SLACK_MS), { ok: true, born: T0 }, "a minute of slack");
  for (const bad of ["", "pr1-abc", `tp1-${T0.toString(36)}-${"A".repeat(43)}`, `${token}x`, null, undefined]) {
    assert.equal(checkToken(bad, T0).ok, false, String(bad));
  }
});

test("token: a Prompter token is not a producer token and names another relay object", async () => {
  const prompterToken = `tp1-${T0.toString(36)}-${"A".repeat(43)}`;
  assert.equal(TOKEN_RE.test(prompterToken), false);
  assert.deepEqual(checkToken(prompterToken, T0), { ok: false, reason: "invalid" });
  // The same birth time and random part under the producer's prefix still lands on another object than the Prompter would use.
  const lookalike = `pr1-${T0.toString(36)}-${"A".repeat(43)}`;
  assert.equal(checkToken(lookalike, T0).ok, true);
  const prompterName = async (token) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`techies-prompter/relay/v1|${token}`));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  assert.notEqual(await relayName(lookalike), await prompterName(lookalike), "own salt");
  assert.notEqual(await relayName(lookalike), await prompterName(prompterToken));
});

test("token: the relay object is named by a salted SHA-256 of the token, never the token", async () => {
  const { token } = newToken();
  const name = await relayName(token);
  assert.match(name, /^[0-9a-f]{64}$/);
  assert.ok(!name.includes(randomPart(token)));
  assert.equal(await relayName(token), name);
  assert.notEqual(await relayName(newToken().token), name);
});
