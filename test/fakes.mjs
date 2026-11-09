// Test helpers (not a test file): a fake Durable Object context, a relay object on it, and a fake producer page that
// answers calls the way the real page will (a cursor called seq: it returns everything after the agent's seq).
import assert from "node:assert/strict";
import "./runtime.mjs";
import { pairs } from "./runtime.mjs";

const { Relay, PROTOCOL } = await import("../src/relay.mjs");
export { Relay, PROTOCOL };

export const T0 = Date.UTC(2026, 10, 9, 20);
export const settle = () => new Promise((r) => setImmediate(r));
export const lastServer = () => pairs.at(-1)[1];

export function fakeCtx() {
  const data = new Map();
  const sockets = [];
  const ctx = {
    alarm: null,
    erased: false,
    storage: {
      get: async (k) => structuredClone(data.get(k)),
      put: async (k, v) => { data.set(k, structuredClone(v)); },
      setAlarm: async (t) => { ctx.alarm = t; },
      getAlarm: async () => ctx.alarm,
      deleteAlarm: async () => { ctx.alarm = null; },
      deleteAll: async () => { data.clear(); ctx.erased = true; },
      data,
    },
    acceptWebSocket(ws, tags) { ws.tags = tags; sockets.push(ws); },
    getWebSockets(tag) { return sockets.filter((s) => !s.closed && (!tag || s.tags.includes(tag))); },
    setWebSocketAutoResponse(pair) { ctx.autoResponse = pair; },
  };
  return ctx;
}

/** A relay object on a fake context. `now` is { t }: the relay's clock. `tab(born)` connects a tab and returns its socket. */
export function relayWith(now) {
  const ctx = fakeCtx();
  const relay = new Relay(ctx, {});
  relay.now = () => now.t;
  relay.graceMs = 0; // tests that need the grace for a reloading page set it
  // `attach(ws)` runs when the relay's side of the socket is made, before the relay sends anything on it (a real page
  // has its message handler in place by the time the first message arrives).
  const tab = async (born = T0, attach) => {
    pairs.onCreate = attach;
    const res = await relay.fetch(new Request("https://relay/tab", { headers: { Upgrade: "websocket", "X-Token-Born": String(born) } }));
    pairs.onCreate = undefined;
    assert.equal(res.status, 101);
    assert.equal(res.headers.get("Sec-WebSocket-Protocol"), PROTOCOL);
    return lastServer();
  };
  return { ctx, relay, tab };
}

export const QUESTIONS = [{ n: 1, text: "What made you start?" }, { n: 2, text: "What went wrong first?" }];

/**
 * A fake producer page on the tab's socket. `page.cue(item)` adds a cue ({ cue, transcript, chat }) with the next seq.
 * wait_for_cue answers at once with everything after the agent's seq, else holds for `hold` ms and answers idle.
 */
export function fakePage(relay, ws, { hold = 25_000 } = {}) {
  const page = { seq: 0, items: [], shown: [], waits: [], calls: [], held: [] };
  // The same answer to the same cue is shown once: a repeat (an idle round of the curl loop, or a retry) changes nothing.
  const answered = new Set();
  const show = (seq, suggestions) => {
    const key = `${seq}|${JSON.stringify(suggestions)}`;
    if (answered.has(key)) return;
    answered.add(key);
    page.shown.push(...suggestions);
  };
  const reply = (id, body) => relay.webSocketMessage(ws, JSON.stringify({ type: "result", id, ...body }));
  const material = (after) => {
    const fresh = page.items.filter((i) => i.seq > after);
    if (!fresh.length) return null;
    const last = fresh.at(-1);
    return { idle: false, cue: last.cue, seq: last.seq, ...(page.guestName ? { guestName: page.guestName } : {}), transcript: fresh.flatMap((i) => i.transcript ?? []), chat: fresh.flatMap((i) => i.chat ?? []), position: { segment: 2, title: "Main talk", minutesLeft: 11 } };
  };
  const answerWaits = () => {
    for (const w of [...page.held]) {
      const m = material(w.args.seq ?? 0);
      if (m) { clearTimeout(w.timer); page.held.splice(page.held.indexOf(w), 1); reply(w.id, { result: m }); }
    }
  };
  page.cue = (item) => { page.items.push({ ...item, seq: ++page.seq }); answerWaits(); };
  const handle = (msg) => {
    page.calls.push({ tool: msg.tool, args: msg.args });
    if (msg.tool === "get_context") return reply(msg.id, { result: { showTitle: "Live talk", questions: QUESTIONS, segments: [{ title: "Intro", plannedMinutes: 5 }, { title: "Main talk", plannedMinutes: 30, live: true }], notes: "Ask about the early days.", ...(page.guestName ? { guestName: page.guestName } : {}), seq: page.seq } });
    if (msg.tool === "get_new_transcript") return reply(msg.id, { result: { seq: page.seq, transcript: page.items.flatMap((i) => i.seq > (msg.args.seq ?? 0) ? i.transcript ?? [] : []) } });
    if (msg.tool === "post_suggestions") { show(page.seq, msg.args.suggestions); return reply(msg.id, { result: { shown: Math.min(msg.args.suggestions.length, page.maxShown ?? 3) } }); }
    if (msg.tool === "post_report") return reply(msg.id, { result: { saved: true } });
    if (msg.tool === "wait_for_cue") {
      page.waits.push(msg.args);
      if (msg.args.suggestions) show(msg.args.seq ?? 0, msg.args.suggestions);
      const m = material(msg.args.seq ?? 0);
      if (m) return reply(msg.id, { result: m });
      const w = { id: msg.id, args: msg.args };
      w.timer = setTimeout(() => { page.held.splice(page.held.indexOf(w), 1); reply(msg.id, { result: { idle: true, seq: msg.args.seq ?? 0 } }); }, hold);
      w.timer.unref?.();
      page.held.push(w);
      return;
    }
    return reply(msg.id, { error: `no such tool ${msg.tool}` });
  };
  const send = ws.send.bind(ws);
  ws.send = (text) => {
    send(text);
    const msg = JSON.parse(text);
    if (msg.type === "call") queueMicrotask(() => handle(msg));
  };
  return page;
}

/**
 * A browser WebSocket class for src/agent-link.mjs whose other end is the relay object of `kit` (relayWith): what the
 * relay sends arrives as "message" events, what the page sends reaches relay.webSocketMessage, and a close from the
 * relay arrives as a "close" event with its code. The token's birth time comes from the subprotocol, as the Worker
 * reads it. `sockets` lists every socket made; `calls` counts the tool calls the relay handed to the page.
 */
export function pageSockets(kit, checkToken) {
  const sockets = [];
  let calls = 0;
  class PageSocket extends EventTarget {
    constructor(protocols) {
      super();
      this.protocols = protocols;
      this.readyState = 0;
      sockets.push(this);
      const token = protocols.find((p) => p.startsWith("t."))?.slice(2);
      queueMicrotask(async () => {
        const t = checkToken(token);
        const attach = (server) => {
          this.server = server;
          const send = server.send.bind(server);
          server.send = (text) => {
            send(text);
            if (JSON.parse(text).type === "call") calls += 1;
            queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data: text })));
          };
          const close = server.close.bind(server);
          server.close = (code = 1000, reason = "") => {
            if (server.closed) return;
            close(code, reason);
            if (this.readyState === 3) return;
            this.readyState = 3;
            queueMicrotask(() => this.dispatchEvent(Object.assign(new Event("close"), { code, reason })));
          };
        };
        await kit.tab(t.ok ? t.born : 1, attach);
        if (this.readyState === 0) { this.readyState = 1; this.dispatchEvent(new Event("open")); }
      });
    }
    send(text) {
      if (this.readyState !== 1) throw new Error("not open");
      kit.relay.webSocketMessage(this.server, text);
    }
    close(code = 1000) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      if (this.server) kit.relay.webSocketClose(this.server, code);
    }
  }
  return { sockets, socket: (protocols) => new PageSocket(protocols), get calls() { return calls; } };
}

/** Timers for the page under test: nothing runs until tick(ms) moves the clock `now` ({ t }) forward. */
export function fakeTimers(now) {
  let next = 1;
  const due = new Map();
  const timers = {
    setTimeout(fn, ms) { const id = next++; due.set(id, { at: now.t + Math.max(0, ms), fn }); return id; },
    clearTimeout(id) { due.delete(id); },
    setInterval(fn, ms) { const id = next++; const again = () => { due.set(id, { at: now.t + ms, fn: () => { again(); fn(); } }); }; again(); return id; },
    clearInterval(id) { due.delete(id); },
    async tick(ms) {
      const end = now.t + ms;
      for (;;) {
        const [id, first] = [...due].filter(([, d]) => d.at <= end).sort((a, b) => a[1].at - b[1].at)[0] ?? [];
        if (!first) break;
        due.delete(id);
        now.t = first.at;
        first.fn();
        await settle();
      }
      now.t = end;
      await settle();
    },
    pending: () => due.size,
  };
  return timers;
}
