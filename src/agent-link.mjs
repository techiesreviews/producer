// The page's side of the agent connection (docs/wayfinder/producer/agent-relay.md). Copy connect message asks this
// site for an eight-hour token and keeps a socket open to this site's relay; the host's agent then calls the page
// through it, and the page answers every call. State: "off", "waiting" (message copied, no call yet, or the agent's
// loop went quiet), "on" (the agent's loop is alive) and "elsewhere" (a newer tab took the relay). Test is the
// warm-up: one sample cue, timed until the agent's answer comes back.
// This is the agent's own part of the page: the cue rules (src/cues.mjs) hand it a cue with send(), it gives the agent
// the show (show()) and the cues, and passes each answer on once (onSuggestions, suggestion()). asking() says whether
// the newest show cue still waits for the agent's turn (the question card's thinking light). The agent's load_show
// call goes to load() (card 14): the page checks and takes the show, the link only passes it on and answers. The load
// cue (the host pressed Let my agent load it) goes alone and is not a question on the card. The agent's post_report
// goes to report() the same way (card 12), and its post_chat to chat() (TOOLS-336). The chat cue (the host pressed
// Connect Restream chat) goes alone like the load cue.
// Nothing is kept: the token, the cues and the answers live in this page's memory only, and a reload starts over.
// `net` gives the two calls the page makes, both to this site: token() and socket(protocols) (see src/app.js).
// The tool and cue names, the token's age, the wait's hold and the relay's close codes come from src/protocol.mjs,
// which the Worker shares. The build inlines this file and drops its import line and each `export`.
import { CUE, RELAY_CLOSE, relayProtocols, TOKEN_MAX_AGE_MS, TOOL, WAIT_HOLD_MS } from "./protocol.mjs";

/** No call and no held wait for this long: the agent's loop has stopped, so the page waits for it again. */
export const AGENT_QUIET_MS = 60_000;
/** The first answer after pasting took 7 to 25 s in TOOLS-154; a Test that waits longer has failed. */
export const AGENT_TEST_MS = 90_000;

/** The sample the Test sends: a made-up exchange, labelled host and guest like the real thing. */
export const AGENT_SAMPLE = [
  { speaker: "host", text: "You moved your whole studio into a van last year. How did that start?" },
  { speaker: "guest", text: "Honestly as a joke. The rent went up again, I found an old camper for sale, and two weeks later I was editing videos at a campsite with terrible wifi." },
];

/** Answers remembered for their cue's time and reason; older ones are let go. */
const SENT_KEPT = 50;
/** Answers already taken, remembered so a repeat counts once; older ones are let go (the loop repeats only its latest). */
export const ANSWERS_KEPT = 50;
/** Text the agent has not confirmed yet, at most (the Worker passes on no more either); the oldest goes first. */
const UNCONFIRMED_CHARS = 20_000;

/**
 * show() gives what get_context hands the agent: { showTitle?, guestName?, questions: [{ n, text }],
 * segments: [{ title, plannedMinutes, live? }], notes? }, or nothing before a plan is loaded. load(args) takes what the
 * agent's load_show sent and gives { result } or { error } (a plain line) for the agent; report(args) the same for
 * post_report, chat(args) for post_chat; chatOn() says whether the agent reads the viewer chat now; asked(numbers) hears
 * the prepared questions the host used on the Prompter's strip (wait_for_cue's asked), each number once per connection.
 */
export function createAgentLink({ net, onChange = () => {}, show = () => null, load = () => ({ error: "This page cannot load a show." }), report = () => ({ error: "There is no show to report on yet." }), chat = () => ({ error: "This page shows no viewer chat." }), chatOn = () => false, asked: usedAsked = () => {}, now = () => Date.now(), timers = globalThis }) {
  const link = { state: "off", failed: false, token: null, at: 0, test: { state: "idle" }, passed: false };
  let ws = null;
  let pending = null; // a token on its way
  let epoch = 0; // counts every forget(): a token that arrives after the wait was given up is let go
  let retry = 0;
  let retryTimer = 0;
  let pingTimer = 0;
  let quietTimer = 0;
  let endTimer = 0;
  let testTimer = 0;
  let seq = 0; // the page's own counter: each cue gets the next one
  let cue = null; // the Test's cue: { seq, deliveredAt }
  let held = null; // the agent's wait the page is holding: { id, timer, after }
  let cues = []; // cues the agent has not confirmed yet (it comes back with a higher seq): { seq, cue, transcript, test, ... }
  let handed = 0; // the newest cue handed to the agent: what a post_suggestions answer answers
  let called = false; // the agent has called on this connection (a quiet loop may come back)
  const sent = new Map(); // seq -> { cue, sentAt, test }: what an answer to that seq answers
  let latest = null; // the agent's latest answer: { seq, cue, suggestions, ms }
  let suggested = () => {};
  const answered = new Set();
  const usedTaken = new Set(); // question numbers the agent said the host used on the Prompter's strip: each passed on once
  let askedSeq = 0; // the newest show cue sent
  let settledSeq = 0; // the newest cue the agent answered, or came back past with no answer
  let onSettled = () => {};
  function settle(upTo) {
    if (upTo <= settledSeq) return;
    settledSeq = upTo;
    if (settledSeq >= askedSeq) onSettled();
  }

  // passed: a Test was answered on this connection (the AI agent step is done while the agent is connected).
  const view = () => ({ state: link.state, failed: link.failed, test: { ...link.test }, passed: link.passed });
  const changed = () => onChange(view());
  const set = (state) => { if (link.state !== state) { link.state = state; changed(); } };
  const live = () => Boolean(link.token) && now() - link.at < TOKEN_MAX_AGE_MS;

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

  // What is new after the agent's seq in one cue: the lines joined, the newest reason, position and guest name. The
  // Test's made-up talk never joins the show's: a Test cue goes alone, and show cues go up to the next Test cue. A load
  // cue goes alone too: a later cue's words must not hide the host's request.
  function deliver(id, after) {
    const fresh = cues.filter((c) => c.seq > after);
    const end = fresh.findIndex((c) => c.kind !== fresh[0].kind);
    const group = end < 0 ? fresh : fresh.slice(0, end);
    const last = group.at(-1);
    if (!last) return reply(id, idle(after));
    if (last.seq === cue?.seq) cue.deliveredAt ??= now();
    handed = Math.max(handed, last.seq);
    const result = { idle: false, cue: last.cue, seq: last.seq, transcript: group.flatMap((c) => c.transcript), chat: [] };
    if (last.position) result.position = last.position;
    if (last.guestName) result.guestName = last.guestName;
    if (last.solo) result.solo = true;
    // Whether the agent reads the chat is the chat's state now, not when the cue was queued (the host may have switched it off).
    if (chatOn()) result.chatOn = true;
    reply(id, { result });
  }

  // Nothing new: idle, saying so when the agent reads the viewer chat, so it reads the chat on quiet stretches too (a
  // copied curl loop ends on it rather than waiting on).
  const idle = (after) => ({ result: { idle: true, seq: after, ...(chatOn() ? { chatOn: true } : {}) } });

  function queue(item, test = false) {
    seq += 1;
    const kind = test ? "test" : item.cue === CUE.load ? "load" : item.cue === CUE.chat ? "chat" : "show";
    // A second press while the first request still waits is the same request.
    if (kind === "load" || kind === "chat") cues = cues.filter((c) => c.kind !== kind);
    cues.push({ ...item, seq, test, kind });
    let chars = cues.reduce((n, c) => n + c.transcript.reduce((m, l) => m + l.text.length, 0), 0);
    // The oldest show cue goes first; a waiting Test cue stays, so the Test does not fail for it, and so do a load cue and
    // a chat cue, which hold no text and are the host's requests.
    for (let i = 0; chars > UNCONFIRMED_CHARS && i < cues.length - 1;) {
      if (cues[i].kind !== "show") { i += 1; continue; }
      chars -= cues.splice(i, 1)[0].transcript.reduce((m, l) => m + l.text.length, 0);
    }
    sent.set(seq, { cue: item.cue, sentAt: now(), test, kind });
    if (kind === "show") askedSeq = seq;
    if (sent.size > SENT_KEPT) sent.delete(sent.keys().next().value);
    if (held) {
      const { id, after } = held;
      drop();
      deliver(id, after);
    }
  }

  // An answer is taken once: the loop sends the same body again after each idle round. It answers the cue `after`.
  function take(after, suggestions) {
    if (!Array.isArray(suggestions) || !suggestions.length) return 0;
    const key = `${after}|${JSON.stringify(suggestions)}`;
    if (answered.has(key)) return suggestions.length;
    answered.add(key);
    if (answered.size > ANSWERS_KEPT) answered.delete(answered.values().next().value);
    const of = sent.get(after);
    // The Test's answer stays on the Test button; an older answer never replaces a newer one; the load cue takes none.
    if (of?.kind === "show" && after > (latest?.seq ?? 0)) {
      latest = { seq: after, cue: of.cue, suggestions, ms: now() - of.sentAt };
      suggested(latest);
    }
    if (of?.kind === "show") settle(after);
    // The Test is done by the answer to its cue, or, while it still runs, by any later answer.
    if (cue && link.test.state !== "ok" && (after === cue.seq || (link.test.state === "busy" && after > cue.seq))) {
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
    const asked = Number.isSafeInteger(args.seq) && args.seq >= 0 ? args.seq : 0;
    take(asked, args.suggestions);
    // Questions the host used on the Prompter's strip (TOOLS-347): a loop that sends the same body again passes none twice.
    const used = (Array.isArray(args.asked) ? args.asked : []).filter((n) => Number.isSafeInteger(n) && n >= 1 && !usedTaken.has(n) && usedTaken.add(n));
    if (used.length) usedAsked(used);
    // A seq ahead of this page (the agent kept it from another tab of the same connection) counts from the page's own.
    const after = Math.min(asked, seq);
    // Back past a cue with no answer: the agent chose to give none, so the page stops waiting for it.
    if (!Array.isArray(args.suggestions) || !args.suggestions.length) settle(after);
    drop(); // a newer wait replaces the one held (the relay has already ended it)
    cues = cues.filter((c) => c.seq > after); // the agent has seen these
    if (cues.length) return deliver(id, after);
    const hold = Math.min(Math.max(Number(args.holdMs) || WAIT_HOLD_MS, 1_000), WAIT_HOLD_MS);
    const timer = timers.setTimeout(() => { held = null; reply(id, idle(after)); }, hold);
    held = { id, timer, after };
  }

  // The page's answer to each protocol tool (test/protocol.test.mjs holds it to the protocol's list).
  const answers = {
    [TOOL.wait]: (id, a) => onWait(id, a),
    [TOOL.suggest]: (id, a) => reply(id, { result: { shown: take(handed, a.suggestions) } }),
    // The seq to wait from: just before the oldest cue the agent has not confirmed, so none is skipped.
    [TOOL.context]: (id) => reply(id, { result: { questions: [], segments: [], ...show(), seq: cues.length ? cues[0].seq - 1 : seq } }),
    [TOOL.load]: (id, a) => reply(id, load(a)),
    [TOOL.report]: (id, a) => reply(id, report(a)),
    [TOOL.chat]: (id, a) => reply(id, chat(a)),
    [TOOL.transcript](id, a) {
      // The show's own lines only: the Test's made-up talk never joins them.
      const after = Number(a.seq) || 0;
      reply(id, { result: { seq, transcript: cues.filter((c) => c.seq > after && !c.test).flatMap((c) => c.transcript) } });
    },
  };

  function onCall({ id, tool, args }) {
    const a = args && typeof args === "object" ? args : {};
    called = true;
    set("on");
    watch();
    if (Object.hasOwn(answers, tool)) return answers[tool](id, a);
    reply(id, { error: `Unknown tool: ${tool}` });
  }

  function open() {
    timers.clearTimeout(retryTimer);
    if (!live()) return forget();
    try { ws?.close(); } catch { /* closed */ }
    const sock = net.socket(relayProtocols(link.token));
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
      if (e.code === RELAY_CLOSE.elsewhere) return set("elsewhere");
      if (e.code === RELAY_CLOSE.ended) return forget();
      // Any other close (a network blip, a Worker restart): try again, waiting longer each time.
      const delay = Math.min(30_000, 1_000 * 2 ** retry++) * (0.75 + Math.random() * 0.5);
      retryTimer = timers.setTimeout(open, delay);
    });
  }

  function forget() {
    epoch += 1;
    pending = null;
    for (const t of [retryTimer, quietTimer, endTimer, testTimer]) timers.clearTimeout(t);
    timers.clearInterval(pingTimer);
    drop();
    const sock = ws;
    ws = null;
    try { sock?.close(1000, "bye"); } catch { /* closed */ }
    Object.assign(link, { state: "off", token: null, at: 0, test: { state: "idle" }, passed: false });
    cue = null;
    cues = [];
    handed = 0;
    called = false;
    sent.clear();
    latest = null;
    answered.clear();
    usedTaken.clear();
    askedSeq = 0;
    settledSeq = 0;
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
          const mine = epoch;
          link.failed = false;
          set("waiting");
          pending = net.token().then((r) => (r.ok ? r.json() : null)).then((b) => (typeof b?.token === "string" && b.token ? b.token : null)).catch(() => null);
          const token = await pending;
          if (mine !== epoch) return null; // Disconnect (or another pick) came first; a newer press owns `pending` now
          pending = null;
          if (!token) { link.failed = true; link.state = "off"; changed(); return null; }
          // Ages use this page's clock, counted from when the token arrived (the Worker's own clock checks it too).
          Object.assign(link, { token, at: now() });
          // A keepalive the relay answers without waking up; the token is dropped when its eight hours are up.
          pingTimer = timers.setInterval(() => { try { if (ws?.readyState === 1) ws.send('{"type":"ping"}'); } catch { /* closed */ } }, 45_000);
          endTimer = timers.setTimeout(forget, TOKEN_MAX_AGE_MS);
          open();
        } else if (!(await pending) || !link.token) return null; // no token, or the wait was given up meanwhile
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
        if (!sock || sock.readyState > 1) sock = net.socket(relayProtocols(token));
        if (sock.readyState === 1) revoke();
        else sock.addEventListener("open", revoke, { once: true });
      } catch { /* offline: the token still ends after eight hours */ }
      timers.setTimeout(close, 5_000);
    },

    /** Use this tab: take the relay back from a newer tab. The agent that called before is still this connection's,
     * so an end cue meanwhile waits for its next call here. */
    useHere() {
      if (link.state !== "elsewhere") return;
      set("waiting");
      open();
    },

    /** Test: one sample cue to the agent; done when its answer comes back, with the seconds since it was handed over. */
    test() {
      if (link.state !== "on" || link.test.state === "busy") return;
      cue = { seq: seq + 1, deliveredAt: null };
      link.test = { state: "busy" };
      timers.clearTimeout(testTimer);
      testTimer = timers.setTimeout(() => { if (link.test.state === "busy") { link.test = { state: "fail" }; changed(); } }, AGENT_TEST_MS);
      changed();
      cues = cues.filter((c) => !c.test); // an earlier Test's cue still waiting is replaced by this one
      queue({ cue: CUE.suggestNow, transcript: AGENT_SAMPLE }, true);
    },

    /**
     * A cue from the cue rules: { cue, transcript, position?, guestName? }. Taken while the agent's loop is alive
     * (true); it goes to the wait held, or to the agent's next call. The end cue is also taken while a loop that has
     * called on this connection is quiet: the show ends once, so the loop hears End when it comes back.
     */
    send(item) {
      const quiet = link.state === "waiting" && called && item.cue === CUE.endReport;
      if (link.state !== "on" && !quiet) return false;
      queue(item);
      return true;
    },

    /** Takes back a request of this cue (the chat request, say) the agent has not picked up yet: the host switched it off. */
    unsend(name) {
      cues = cues.filter((c) => c.test || c.cue !== name);
    },

    /** Called once with each new answer from the agent: { seq, cue, suggestions, ms } (ms since its cue went). */
    onSuggestions(fn) {
      suggested = fn;
    },

    /** How many answers are remembered as taken (for tests: at most ANSWERS_KEPT). */
    answersHeld: () => answered.size,

    /** The agent's latest answer, kept in memory for the question card (null before one, and after Disconnect). */
    suggestion: () => latest,

    /** True while the newest show cue waits for the agent's turn: no answer yet, and the agent has not come back past it. */
    asking: () => askedSeq > settledSeq,

    /** Called when the agent's turn on the newest show cue is over (answered, or passed by with no answer). */
    onSettled(fn) {
      onSettled = fn;
    },
  };
}
