// The viewer chat (TOOLS-336): the Restream chat of a live show on the host's producer screen. There is no Restream
// app and no Restream login on this site: the host's own agent reads the chat through its own Restream connection
// and hands the messages over with its post_chat tool, through the same relay as everything else. The host presses
// "Connect Restream chat" (a read_chat cue to the agent); the agent answers with post_chat: new messages, the viewer
// question it picks as a good one for what comes next (with a few words why), "waiting" while no stream is live, or
// "problem" when it cannot read the chat.
// readChat is the check both sides run (the Worker before the page hears it, and the page again). createChat is the
// page's model: the button's phase, the messages, the question on the card and the agent's pick. Use puts a question
// on the card (again takes it off); Answered and Skip mark it (again reopens it). Nothing is stored: it lives in this
// page's memory and is gone when the tab closes.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines), in one
// scope with the other page files, so its own helpers carry a "chat" name.
import { CUE, TOOL } from "./protocol.mjs";

/** What one post_chat may carry: messages in one call, and the characters of each field. */
export const CHAT_LIMITS = { messages: 50, author: 60, platform: 30, text: 500, time: 40, pick: 120, note: 200 };
/** The agent gets this long to answer "Connect Restream chat"; then the button says so (a later answer still counts). */
export const CHAT_WAIT_MS = 120_000;
/** Plain messages kept in memory at most; questions are always kept. */
const CHAT_KEPT = 2000;
const CHAT_FIELDS = ["messages", "waiting", "problem"];
const CHAT_MESSAGE_FIELDS = ["author", "platform", "text", "time", "question", "pick"];

const chatLine = (v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const chatFits = (v, max) => typeof v === "string" && chatLine(v) !== "" && chatLine(v).length <= max;

/**
 * The agent's post_chat, checked: { ok: true, chat: { messages: [{ author, text, platform?, time?, question?, pick? }],
 * waiting?, problem? } } with every line made one line and an optional field only when it was given, so what the Worker
 * passes on passes the page's own check again unchanged; or { ok: false, reason } (a plain line for the agent).
 */
export function readChat(args) {
  const no = (reason) => ({ ok: false, reason });
  if (!args || typeof args !== "object" || Array.isArray(args)) return no("Send the chat as { messages: [{ author, platform, text, time, question, pick }] }.");
  const extra = Object.keys(args).find((k) => !CHAT_FIELDS.includes(k));
  if (extra) return no(`"${extra}" is not a ${TOOL.chat} field. Use messages, waiting or problem.`);
  for (const k of ["waiting", "problem"]) {
    if (args[k] !== undefined && !chatFits(args[k], CHAT_LIMITS.note)) return no(`"${k}" is one short line, at most ${CHAT_LIMITS.note} characters.`);
  }
  const list = args.messages ?? [];
  if (!Array.isArray(list) || list.length > CHAT_LIMITS.messages) return no(`"messages" is a list of at most ${CHAT_LIMITS.messages} chat messages: send the newest ones.`);
  const messages = [];
  for (const m of list) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return no("Each message is { author, text } with optional platform, time, question and pick.");
    const field = Object.keys(m).find((k) => !CHAT_MESSAGE_FIELDS.includes(k));
    if (field) return no(`"${field}" is not a message field. Use author, platform, text, time, question and pick.`);
    if (!chatFits(m.author, CHAT_LIMITS.author)) return no(`Each message needs "author", at most ${CHAT_LIMITS.author} characters.`);
    if (!chatFits(m.text, CHAT_LIMITS.text)) return no(`Each message needs "text", at most ${CHAT_LIMITS.text} characters.`);
    if (m.platform !== undefined && !chatFits(m.platform, CHAT_LIMITS.platform)) return no(`"platform" is a short name, at most ${CHAT_LIMITS.platform} characters.`);
    if (m.time !== undefined && !chatFits(m.time, CHAT_LIMITS.time)) return no(`"time" is the message's time as the chat gave it, at most ${CHAT_LIMITS.time} characters.`);
    if (m.question !== undefined && typeof m.question !== "boolean") return no("\"question\" is true or false.");
    if (m.pick !== undefined && !chatFits(m.pick, CHAT_LIMITS.pick)) return no(`"pick" is a few words why this question fits what comes next, at most ${CHAT_LIMITS.pick} characters.`);
    messages.push({
      author: chatLine(m.author),
      ...(m.platform !== undefined ? { platform: chatLine(m.platform) } : {}),
      text: chatLine(m.text),
      ...(m.time !== undefined ? { time: chatLine(m.time) } : {}),
      ...(m.question !== undefined ? { question: m.question } : {}),
      ...(m.pick !== undefined ? { pick: chatLine(m.pick) } : {}),
    });
  }
  const notes = Object.fromEntries(["waiting", "problem"].filter((k) => args[k] !== undefined).map((k) => [k, chatLine(args[k])]));
  return { ok: true, chat: { messages, ...notes } };
}

/** A message's state: "" for plain chat; a question is "open", "card" (on the card), "answered" or "skipped". */
const chatIsQuestion = (text) => /\?\s*$/.test(text);

/**
 * createChat({ waitMs, onChange, timers }): ask(name, send) is the host's press on Connect Restream chat (send() sends
 * the cue and says whether the agent took it); agentPost(args, at) the agent's post_chat (at: the show time now, "m:ss",
 * or ""), giving { result } or { error }; disconnect() the host's press on a connected button; agentLink(state, name)
 * the agent link's state; `at` may be a function of the message (its own time against the show clock). mark(id, what, at) is a question's buttons: "card" (Use), "answered" or "skipped".
 * view() gives { phase, name, reason, note, messages, card, pick, open, asked }, phase being off, asking, waiting, on or
 * failed. onChange is called when the wait runs out on its own.
 */
export function createChat({ waitMs = CHAT_WAIT_MS, onChange = () => {}, timers = globalThis } = {}) {
  const link = { phase: "off", name: "", reason: "", note: "", timer: 0, asked: false };
  const messages = [];
  const byKey = new Map();
  let nextId = 1;
  let card = null; // the id of the question on the card
  let pickSeq = 0;
  let doneSeq = 0;

  const find = (id) => messages.find((m) => m.id === id) ?? null;
  const stopTimer = () => timers.clearTimeout(link.timer);
  const failed = (reason) => { stopTimer(); Object.assign(link, { phase: "failed", reason, note: "" }); };

  function add(m, stamp) {
    const key = `${m.author}\n${m.time ?? ""}\n${m.text}`.toLowerCase();
    let got = byKey.get(key);
    const question = m.question ?? (got ? got.q : chatIsQuestion(m.text));
    if (!got) {
      // A plain message past the cap is let go; a question is always kept.
      if (!question && !m.pick && messages.length >= CHAT_KEPT) return false;
      got = { id: nextId++, key, who: m.author, where: m.platform ?? "", text: m.text, at: typeof stamp === "function" ? stamp(m) : stamp, q: false, s: "", doneAt: "", done: 0, pick: "", picked: 0 };
      messages.push(got);
      byKey.set(key, got);
    }
    // The agent's pick makes it a question it found worth asking; a pick on a question already done is let go.
    if ((question || m.pick) && !got.q) { got.q = true; got.s = "open"; }
    // One pick at a time: a new pick lets the older ones go (they were for a point that has passed).
    if (m.pick && got.s === "open") {
      for (const other of messages) if (other !== got) other.pick = "";
      Object.assign(got, { pick: m.pick, picked: ++pickSeq });
    }
    return true;
  }

  return {
    ask(name, send) {
      if (link.phase === "asking" || link.phase === "on" || link.phase === "waiting") return false;
      if (!send()) return false;
      stopTimer();
      Object.assign(link, { phase: "asking", name, reason: "", note: "", asked: true });
      link.timer = timers.setTimeout(() => {
        if (link.phase !== "asking") return;
        failed(`No answer from ${name} in ${Math.round(waitMs / 60_000)} minutes. Check ${name}, then try again.`);
        onChange();
      }, waitMs);
      return true;
    },

    agentPost(args, at = "") {
      if (link.phase === "off") return { error: `The host has not connected the viewer chat, or switched it off. Stop reading the chat until a cue says ${CUE.chat}.` };
      const read = readChat(args);
      if (!read.ok) return { error: read.reason };
      const { messages: list, waiting, problem } = read.chat;
      if (problem) {
        failed(problem);
        return { result: { shown: 0 } };
      }
      stopTimer();
      let shown = 0;
      for (const m of list) if (add(m, at)) shown += 1;
      if (waiting && !list.length && link.phase !== "on") Object.assign(link, { phase: "waiting", note: waiting, reason: "" });
      else Object.assign(link, { phase: "on", note: "", reason: "" });
      return { result: { shown } };
    },

    disconnect() {
      stopTimer();
      Object.assign(link, { phase: "off", reason: "", note: "" });
    },

    agentLink(state, name) {
      if (state === "on" || link.phase === "off" || link.phase === "failed") return;
      // A quiet loop may come back: the chat waits for it. A gone agent ends the chat.
      if (state === "off") failed(`${name || link.name} disconnected, so the chat stopped. Connect your agent, then try again.`);
      else if (state === "elsewhere") failed("Your agent moved to another tab, so the chat stopped.");
    },

    mark(id, what, at = "") {
      const m = find(id);
      if (!m?.q) return false;
      if (what === "card") {
        // Off the card again: the agent's pick on it is let go (it comes back only if the agent picks it again).
        if (m.s === "card") { Object.assign(m, { s: "open", pick: "" }); card = null; return true; }
        const old = card !== null ? find(card) : null;
        if (old && old !== m) old.s = "open";
        Object.assign(m, { s: "card", doneAt: "", done: 0 });
        card = m.id;
        return true;
      }
      if (what !== "answered" && what !== "skipped") return false;
      if (m.s === what) Object.assign(m, { s: "open", doneAt: "", done: 0 });
      else {
        Object.assign(m, { s: what, doneAt: at, done: ++doneSeq });
        if (card === m.id) card = null;
      }
      return true;
    },

    view() {
      const onCard = card !== null ? find(card) : null;
      // The agent's newest pick that is still open (not on the card, answered or skipped).
      let pick = null;
      for (const m of messages) if (m.pick && m.s === "open" && (!pick || m.picked > pick.picked)) pick = m;
      return {
        phase: link.phase,
        name: link.name,
        reason: link.reason,
        note: link.note,
        asked: link.asked,
        messages: messages.map((m) => ({ ...m })),
        card: onCard ? { ...onCard } : null,
        pick: pick ? { ...pick } : null,
        open: messages.filter((m) => m.s === "open" || m.s === "card").length,
      };
    },
  };
}

/**
 * The "Connect Restream chat" button in the setup, from plain facts: the stream picked in "I stream with", the agent link's state,
 * the chat's view and the agent's name. off is the reason it is switched off ("" when it can be pressed).
 */
export function chatButton({ stream, agent, chat, name }) {
  const label = "Connect Restream chat";
  if (stream !== "restream") return { state: null, text: label, tip: "", off: "Viewer chat works with Restream streams only." };
  if (chat.phase === "on") return { state: "ok", text: "Restream chat connected ✓", tip: `${chat.name || name} reads your Restream chat. Press to disconnect.`, off: "" };
  if (chat.phase === "waiting") return { state: "busy", text: "Chat · waiting for your live stream", tip: `${chat.name || name}: ${chat.note}. The chat shows once you are live. Press to disconnect.`, off: "" };
  if (chat.phase === "asking" && (agent === "on" || agent === "waiting")) return { state: "busy", text: "Connecting chat…", tip: `Waiting for ${chat.name || name} to read your Restream chat.`, off: "" };
  if (agent === "elsewhere") return { state: null, text: label, tip: "", off: "Your agent is connected in another tab." };
  if (agent !== "on") return { state: null, text: label, tip: "", off: "Connect your agent first (step 3)." };
  if (chat.phase === "failed") return { state: "error", text: "Chat not connected · try again", tip: chat.reason, off: "" };
  return { state: null, text: label, tip: `${name} reads your Restream chat with its own Restream connection and shows it here. Nothing is stored.`, off: "" };
}
