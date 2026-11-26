// One click sets up the Prompter too (TOOLS-464, src/prompter-link.mjs): the Producer gets a token from the Prompter's
// own /api/agent-token, opens the Prompter linked (`#producer`, never a token in the address), and hands the token over
// only to that tab, at the Prompter's address, once it says ready. The tab tells its link state back; Disconnect ends it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrompterLink, PROMPTER_MESSAGES, PROMPTER_ORIGIN, PROMPTER_TOKEN_MS, prompterToken } from "../src/prompter-link.mjs";

// A token-shaped stand-in, built from pieces so no file holds one.
const FAKE = ["tp1", "m0abcdef", "x".repeat(43)].join("-");

/** A Prompter tab stand-in: what was posted to it, and at which address. */
function tab() {
  const posted = [];
  return { posted, postMessage: (data, origin) => posted.push({ data, origin }) };
}

/** A link with a token route that answers `reply` and a window.open that returns `win`. */
function rig({ reply = { ok: true, json: async () => ({ token: FAKE, createdAt: 1 }) }, win = tab() } = {}) {
  const calls = { token: 0, open: [] };
  const changes = [];
  // The tab watch's interval, run by hand: `watching.size` is how many are set.
  const watching = new Map();
  let ids = 0;
  const timers = {
    setInterval: (fn, ms) => { watching.set(++ids, { fn, ms }); return ids; },
    clearInterval: (id) => watching.delete(id),
  };
  const link = createPrompterLink({
    net: {
      token: async () => { calls.token += 1; if (typeof reply === "function") return reply(); if (reply instanceof Error) throw reply; return reply; },
      open: (url, name) => { calls.open.push({ url, name }); return win; },
    },
    onChange: (view) => changes.push(view.state),
    timers,
  });
  const from = (data, { origin = PROMPTER_ORIGIN, source = win } = {}) => link.heard({ data, origin, source });
  const watch = () => { for (const { fn } of [...watching.values()]) fn(); };
  return { link, calls, changes, win, from, watching, watch };
}

test("the messages and the address match the Prompter's own wire list", () => {
  assert.equal(PROMPTER_ORIGIN, "https://prompter.techies.tools");
  assert.deepEqual(PROMPTER_MESSAGES, { ready: "prompter:ready", token: "prompter:token", link: "prompter:link", disconnect: "prompter:disconnect" });
});

test("only a Prompter-shaped token is taken: it goes into a shell line, so nothing else may", () => {
  assert.equal(prompterToken(FAKE), FAKE);
  for (const bad of [null, 3, "", "pr1-m0abcdef-" + "x".repeat(43), `${FAKE}'`, `${FAKE}; rm -rf ~`, FAKE.replace("tp1", "tp2")]) assert.equal(prompterToken(bad), null, String(bad));
});

test("prepare gets the token; open makes the linked tab, with no token in its address", async () => {
  const { link, calls, win } = rig();
  assert.equal(link.view().state, "off");
  assert.equal(await link.prepare(), FAKE);
  assert.equal(calls.token, 1);
  assert.equal(link.view().state, "ready");
  assert.equal(calls.open.length, 0, "nothing opens before the click asks");
  link.open();
  assert.deepEqual(calls.open, [{ url: `${PROMPTER_ORIGIN}/#producer`, name: "_blank" }], "a new tab: an old one reused would only change its hash, never load again and say ready");
  assert.ok(!calls.open[0].url.includes(FAKE), "the token never travels in the address");
  assert.equal(link.view().state, "opened");
  assert.deepEqual(win.posted, [], "nothing is posted before the tab says ready");
});

test("the token goes to the opened tab once, at the Prompter's address, only after it says ready", async () => {
  const { link, win, from } = rig();
  await link.prepare();
  link.open();
  from({ type: PROMPTER_MESSAGES.ready });
  assert.deepEqual(win.posted, [{ data: { type: PROMPTER_MESSAGES.token, token: FAKE }, origin: PROMPTER_ORIGIN }]);
  from({ type: PROMPTER_MESSAGES.ready });
  assert.equal(win.posted.length, 1, "a second ready gets nothing more");
});

test("a message from another address, another window or no window is ignored", async () => {
  const { link, win, from } = rig();
  await link.prepare();
  link.open();
  from({ type: PROMPTER_MESSAGES.ready }, { origin: "https://evil.example" });
  from({ type: PROMPTER_MESSAGES.ready }, { origin: "http://prompter.techies.tools" });
  from({ type: PROMPTER_MESSAGES.ready }, { source: tab() });
  from({ type: PROMPTER_MESSAGES.ready }, { source: null });
  from({ type: PROMPTER_MESSAGES.link, state: "on" }, { source: tab() });
  assert.deepEqual(win.posted, []);
  assert.equal(link.view().state, "opened");
});

test("the tab's link state shows here: waiting, on, elsewhere; off after it was linked reads ended", async () => {
  const { link, from, changes } = rig();
  await link.prepare();
  link.open();
  from({ type: PROMPTER_MESSAGES.ready });
  for (const state of ["waiting", "on", "elsewhere", "on"]) {
    from({ type: PROMPTER_MESSAGES.link, state });
    assert.equal(link.view().state, state);
  }
  from({ type: PROMPTER_MESSAGES.link, state: "bogus" });
  assert.equal(link.view().state, "on", "an unknown state changes nothing");
  from({ type: PROMPTER_MESSAGES.link, state: "off" });
  assert.equal(link.view().state, "ended", "the host pressed Disconnect MCP there, or the tab went");
  assert.deepEqual(changes, ["fetching", "ready", "opened", "waiting", "on", "elsewhere", "on", "ended"]);
});

test("Disconnect tells the tab (before or after the token went) and forgets the token", async () => {
  for (const ready of [false, true]) {
    const { link, win, from } = rig();
    await link.prepare();
    link.open();
    if (ready) from({ type: PROMPTER_MESSAGES.ready });
    link.disconnect();
    assert.deepEqual(win.posted.at(-1), { data: { type: PROMPTER_MESSAGES.disconnect }, origin: PROMPTER_ORIGIN });
    assert.equal(link.view().state, "off");
    const before = win.posted.length;
    from({ type: PROMPTER_MESSAGES.ready });
    from({ type: PROMPTER_MESSAGES.link, state: "on" });
    assert.equal(win.posted.length, before, "a late ready gets no token");
    assert.equal(link.view().state, "off", "and a late state changes nothing");
  }
});

test("a token not yet opened is simply dropped on Disconnect: no tab, nothing posted", async () => {
  const { link, calls } = rig();
  await link.prepare();
  link.disconnect();
  link.open();
  assert.equal(calls.open.length, 0, "open after Disconnect opens nothing: the token is gone");
  assert.equal(link.view().state, "off");
});

test("a token route that fails, refuses or answers nonsense: failed, and no tab opens", async () => {
  for (const reply of [new Error("network"), { ok: false, json: async () => ({ error: "Forbidden" }) }, { ok: true, json: async () => ({ token: "nope" }) }]) {
    const { link, calls } = rig({ reply });
    assert.equal(await link.prepare(), null);
    assert.equal(link.view().state, "failed");
    link.open();
    assert.equal(calls.open.length, 0);
  }
});

test("a blocked new tab reads blocked; open again (a fresh click) tries once more with the same token", async () => {
  const win = tab();
  let allow = false;
  const calls = [];
  const link = createPrompterLink({
    net: { token: async () => ({ ok: true, json: async () => ({ token: FAKE }) }), open: (url) => { calls.push(url); return allow ? win : null; } },
    onChange: () => {},
  });
  await link.prepare();
  link.open();
  assert.equal(link.view().state, "blocked");
  allow = true;
  link.open();
  assert.equal(link.view().state, "opened");
  link.heard({ data: { type: PROMPTER_MESSAGES.ready }, origin: PROMPTER_ORIGIN, source: win });
  assert.deepEqual(win.posted[0].data, { type: PROMPTER_MESSAGES.token, token: FAKE });
  assert.equal(calls.length, 2);
  link.disconnect(); // stops the tab watch's real interval
});

test("a Disconnect while the token is still on its way: the late token is dropped", async () => {
  let answer;
  const link = createPrompterLink({
    net: { token: () => new Promise((r) => { answer = r; }), open: () => tab() },
    onChange: () => {},
  });
  const got = link.prepare();
  link.disconnect();
  answer({ ok: true, json: async () => ({ token: FAKE }) });
  assert.equal(await got, null);
  assert.equal(link.view().state, "off");
});

test("a second click while the tab waits keeps its token and tab; after Disconnect a new round opens a new tab", async () => {
  const { link, calls, win, from } = rig();
  await link.prepare();
  link.open();
  from({ type: PROMPTER_MESSAGES.ready });
  from({ type: PROMPTER_MESSAGES.link, state: "waiting" });
  assert.equal(await link.prepare(), FAKE, "the same token: the tab already holds it");
  link.open();
  assert.equal(calls.token, 1, "no second token");
  assert.equal(calls.open.length, 1, "no second tab");
  assert.equal(link.view().state, "waiting");
  assert.equal(win.posted.length, 1, "the token went once");
  link.disconnect();
  await link.prepare();
  link.open();
  assert.equal(calls.token, 2, "a new round, a new token");
  assert.equal(calls.open.length, 2, "and a new tab");
});

test("a Prompter that hangs: after PROMPTER_TOKEN_MS the round reads failed, so the producer's own message goes without it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = { open: [] };
  const hang = createPrompterLink({ net: { token: () => new Promise(() => {}), open: (url) => calls.open.push(url) }, onChange: () => {} });
  const got = hang.prepare();
  assert.equal(hang.view().state, "fetching");
  t.mock.timers.tick(PROMPTER_TOKEN_MS);
  assert.equal(await got, null);
  assert.equal(hang.view().state, "failed");
  hang.open();
  assert.equal(calls.open.length, 0, "no tab without a token");
  assert.ok(PROMPTER_TOKEN_MS <= 3000, "short enough to keep the click's clipboard and new-tab window");
});

test("a token in hand that no tab holds yet (ready, blocked, held) is used again by the next click, not fetched anew", async () => {
  for (const before of ["ready", "blocked", "held"]) {
    let allow = before !== "blocked";
    const win = tab();
    let fetched = 0;
    const link = createPrompterLink({
      net: { token: async () => { fetched += 1; return { ok: true, json: async () => ({ token: FAKE }) }; }, open: () => (allow ? win : null) },
      onChange: () => {},
    });
    await link.prepare();
    if (before === "blocked") link.open();
    if (before === "held") link.hold();
    assert.equal(link.view().state, before);
    allow = true;
    assert.equal(await link.prepare(), FAKE, before);
    assert.equal(fetched, 1, `${before}: one token, never two left working`);
  }
});

test("a copy that failed holds the tab back: the switch opens it from a click, once the host copied by hand", async () => {
  const { link, calls, win, from } = rig();
  await link.prepare();
  link.hold();
  assert.equal(link.view().state, "held");
  assert.equal(calls.open.length, 0, "the new tab would take the focus from the message box");
  link.open();
  assert.equal(link.view().state, "opened");
  from({ type: PROMPTER_MESSAGES.ready });
  assert.deepEqual(win.posted[0].data, { type: PROMPTER_MESSAGES.token, token: FAKE });
  const off = rig();
  await off.link.prepare();
  off.link.disconnect();
  off.link.hold();
  assert.equal(off.link.view().state, "off", "nothing to hold without a token");
});

test("two quick clicks share the token request still on its way: one token, and both get it", async () => {
  let answer;
  const { link, calls } = rig({ reply: () => new Promise((r) => { answer = r; }) });
  const first = link.prepare();
  const second = link.prepare();
  answer({ ok: true, json: async () => ({ token: FAKE }) });
  assert.deepEqual(await Promise.all([first, second]), [FAKE, FAKE]);
  assert.equal(calls.token, 1, "never a second token left working");
  assert.equal(link.view().state, "ready");
});

test("a Prompter tab the host closes reads ended here, so nothing still says both are connected", async () => {
  const { link, win, from, watching, watch } = rig();
  await link.prepare();
  assert.equal(watching.size, 0, "nothing to watch before a tab opens");
  link.open();
  assert.equal(watching.size, 1, "the open tab is watched");
  assert.ok([...watching.values()][0].ms <= 1000, "checked at least once a second");
  from({ type: PROMPTER_MESSAGES.ready });
  from({ type: PROMPTER_MESSAGES.link, state: "on" });
  watch();
  assert.equal(link.view().state, "on", "an open tab stays on");
  win.closed = true;
  watch();
  assert.equal(link.view().state, "ended");
  assert.equal(watching.size, 0, "the watch stops with the tab");
  const off = rig();
  await off.link.prepare();
  off.link.open();
  off.link.disconnect();
  assert.equal(off.watching.size, 0, "Disconnect stops the watch");
});

test("a closed tab is not kept: the next round gets a new token and tab", async () => {
  const { link, calls, win, from } = rig();
  await link.prepare();
  link.open();
  from({ type: PROMPTER_MESSAGES.ready });
  win.closed = true;
  await link.prepare();
  link.open();
  assert.equal(calls.token, 2);
  assert.equal(calls.open.length, 2);
});
