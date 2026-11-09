// The page's side of the agent connection (docs/wayfinder/producer/agent-relay.md). Copy connect message asks this
// site for an eight-hour token and keeps a socket open to this site's relay; the host's agent then calls the page
// through it, and the page answers every call. State: "off", "waiting" (message copied, no call yet, or the agent's
// loop went quiet), "on" (the agent's loop is alive) and "elsewhere" (a newer tab took the relay). Test is the
// warm-up: one sample cue, timed until the agent's answer comes back.
// Nothing is kept: the token lives in this page's memory only, and a reload starts over.
// `net` gives the two calls the page makes, both to this site: token() and socket(protocols) (see src/app.js).
// The inlined page script keeps this file's code as it is (the build only drops `export`).

export const AGENT_MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** No call and no held wait for this long: the agent's loop has stopped, so the page waits for it again. */
export const AGENT_QUIET_MS = 60_000;
/** The page holds a wait at most this long, then answers idle (the Worker waits 30 s for it). */
export const AGENT_HOLD_MS = 25_000;
/** The first answer after pasting took 7 to 25 s in TOOLS-154; a Test that waits longer has failed. */
export const AGENT_TEST_MS = 90_000;

/** The sample the Test sends: a made-up exchange, labelled host and guest like the real thing. */
export const AGENT_SAMPLE = [
  { speaker: "host", text: "You moved your whole studio into a van last year. How did that start?" },
  { speaker: "guest", text: "Honestly as a joke. The rent went up again, I found an old camper for sale, and two weeks later I was editing videos at a campsite with terrible wifi." },
];

export function createAgentLink({ net, onChange = () => {}, now = () => Date.now(), timers = globalThis }) {
  const link = { state: "off", failed: false, token: null, at: 0, test: { state: "idle" }, passed: false };
  let ws = null;
  let pending = null; // a token on its way
  let retry = 0;
  let retryTimer = 0;
  let pingTimer = 0;
  let quietTimer = 0;
  let endTimer = 0;
  let testTimer = 0;
  let seq = 0; // the page's own counter: each cue gets the next one
  let cue = null; // the Test's cue: { seq, deliveredAt }
  let held = null; // the agent's wait the page is holding: { id, timer }
  const answered = new Set();

  // passed: a Test was answered on this connection (step 2 is done while the agent is connected).
  const view = () => ({ state: link.state, failed: link.failed, test: { ...link.test }, passed: link.passed });
  const changed = () => onChange(view());
  const set = (state) => { if (link.state !== state) { link.state = state; changed(); } };
  const live = () => Boolean(link.token) && now() - link.at < AGENT_MAX_AGE_MS;

  function reply(id, payload) {
    try { if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "result", id, ...payload })); } catch { /* closed */ }
  }
  function drop() {
    if (!held) return;
    timers.clearTimeout(held.timer);
    held = null;
  }
  // Quiet for AGENT_QUIET_MS with no wait held: the loop has stopped (the agent quit or hit an error).
  function watch() {
    timers.clearTimeout(quietTimer);
    quietTimer = timers.setTimeout(() => { if (held) watch(); else if (link.state === "on") set("waiting"); }, AGENT_QUIET_MS);
  }

  function deliver(id) {
    cue.deliveredAt ??= now();
    reply(id, { result: { idle: false, cue: "suggest_now", seq: cue.seq, transcript: AGENT_SAMPLE, chat: [] } });
  }

  // An answer is taken once: the loop sends the same body again after each idle round.
  function take(after, suggestions) {
    if (!Array.isArray(suggestions) || !suggestions.length) return 0;
    const key = `${after}|${JSON.stringify(suggestions)}`;
    if (answered.has(key)) return suggestions.length;
    answered.add(key);
    if (cue && after >= cue.seq && link.test.state !== "ok") {
      timers.clearTimeout(testTimer);
      const first = suggestions[0];
      const sample = typeof first.text === "string" ? first.text : `Question ${first.question}`;
      link.test = { state: "ok", seconds: Math.round((now() - (cue.deliveredAt ?? now())) / 100) / 10, sample };
      link.passed = true;
      changed();
    }
    return suggestions.length;
  }

  function onWait(id, args) {
    const after = Number.isSafeInteger(args.seq) && args.seq >= 0 ? args.seq : 0;
    take(after, args.suggestions);
    drop(); // a newer wait replaces the one held (the relay has already ended it)
    if (cue && cue.seq > after) return deliver(id);
    const hold = Math.min(Math.max(Number(args.holdMs) || AGENT_HOLD_MS, 1_000), AGENT_HOLD_MS);
    const timer = timers.setTimeout(() => { held = null; reply(id, { result: { idle: true, seq: after } }); }, hold);
    held = { id, timer };
  }

  function onCall({ id, tool, args }) {
    const a = args && typeof args === "object" ? args : {};
    set("on");
    watch();
    if (tool === "wait_for_cue") return onWait(id, a);
    if (tool === "post_suggestions") return reply(id, { result: { shown: take(seq, a.suggestions) } });
    if (tool === "get_context") return reply(id, { result: { questions: [], segments: [], seq } });
    if (tool === "get_new_transcript") return reply(id, { result: { seq, transcript: cue && (Number(a.seq) || 0) < cue.seq ? AGENT_SAMPLE : [] } });
    reply(id, { error: tool === "post_report" ? "There is no show to report on yet." : `Unknown tool: ${tool}` });
  }

  function open() {
    timers.clearTimeout(retryTimer);
    if (!live()) return forget();
    try { ws?.close(); } catch { /* closed */ }
    const sock = net.socket(["producer", `t.${link.token}`]);
    ws = sock;
    sock.addEventListener("open", () => { if (ws === sock) retry = 0; });
    sock.addEventListener("message", (e) => {
      if (ws !== sock) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m?.type === "call" && typeof m.id === "string") onCall(m);
    });
    sock.addEventListener("close", (e) => {
      if (ws !== sock) return;
      ws = null;
      drop();
      if (e.code === 4001) return set("elsewhere");
      if (e.code === 4003) return forget();
      // Any other close (a network blip, a Worker restart): try again, waiting longer each time.
      const delay = Math.min(30_000, 1_000 * 2 ** retry++) * (0.75 + Math.random() * 0.5);
      retryTimer = timers.setTimeout(open, delay);
    });
  }

  function forget() {
    for (const t of [retryTimer, quietTimer, endTimer, testTimer]) timers.clearTimeout(t);
    timers.clearInterval(pingTimer);
    drop();
    const sock = ws;
    ws = null;
    try { sock?.close(1000, "bye"); } catch { /* closed */ }
    Object.assign(link, { state: "off", token: null, at: 0, test: { state: "idle" }, passed: false });
    cue = null;
    answered.clear();
    changed();
  }

  return {
    view,

    /** Copy connect message: a fresh token when there is none, the relay opened, and the message's parts. */
    async connect() {
      // A token past its eight hours whose timer has not fired yet (a laptop waking from sleep): let it go first.
      if (link.token && !live()) forget();
      if (link.state === "on") return null;
      if (!live()) {
        if (!pending) {
          link.failed = false;
          set("waiting");
          pending = net.token().then((r) => (r.ok ? r.json() : null)).then((b) => (typeof b?.token === "string" && b.token ? b.token : null)).catch(() => null);
          const token = await pending;
          pending = null;
          if (!token) { link.failed = true; link.state = "off"; changed(); return null; }
          // Ages use this page's clock, counted from when the token arrived (the Worker's own clock checks it too).
          Object.assign(link, { token, at: now() });
          // A keepalive the relay answers without waking up; the token is dropped when its eight hours are up.
          pingTimer = timers.setInterval(() => { try { if (ws?.readyState === 1) ws.send('{"type":"ping"}'); } catch { /* closed */ } }, 45_000);
          endTimer = timers.setTimeout(forget, AGENT_MAX_AGE_MS);
          open();
        } else if (!(await pending)) return null;
      } else if (!ws) open();
      if (link.state !== "on") set("waiting");
      return { token: link.token };
    },

    /** Disconnect: the relay forgets the token, so the agent's next call gets 401. */
    disconnect() {
      const token = link.token;
      let sock = ws;
      ws = null; // its close no longer reconnects
      forget();
      if (!token) return;
      const close = () => { try { sock?.close(1000, "bye"); } catch { /* closed */ } };
      const revoke = () => { try { sock.send('{"type":"revoke"}'); } catch { /* closed */ } timers.setTimeout(close, 200); };
      try {
        if (!sock || sock.readyState > 1) sock = net.socket(["producer", `t.${token}`]);
        if (sock.readyState === 1) revoke();
        else sock.addEventListener("open", revoke, { once: true });
      } catch { /* offline: the token still ends after eight hours */ }
      timers.setTimeout(close, 5_000);
    },

    /** Use this tab: take the relay back from a newer tab. */
    useHere() {
      if (link.state !== "elsewhere") return;
      set("waiting");
      open();
    },

    /** Test: one sample cue to the agent; done when its answer comes back, with the seconds since it was handed over. */
    test() {
      if (link.state !== "on" || link.test.state === "busy") return;
      seq += 1;
      cue = { seq, deliveredAt: null };
      link.test = { state: "busy" };
      timers.clearTimeout(testTimer);
      testTimer = timers.setTimeout(() => { if (link.test.state === "busy") { link.test = { state: "fail" }; changed(); } }, AGENT_TEST_MS);
      changed();
      if (held) {
        const { id } = held;
        drop();
        deliver(id);
      }
    },
  };
}
