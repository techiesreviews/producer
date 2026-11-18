// The viewer chat (src/chat.mjs, TOOLS-336): the check both sides run on the agent's post_chat, the page's model (the
// button's phase, the messages, the question on the card, the agent's pick, Use, Answered and Skip) and the words on
// the setup's Connect Restream chat button. Made-up names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeTimers } from "./fakes.mjs";
import { CHAT_LIMITS, CHAT_WAIT_MS, chatButton, createChat, readChat } from "../src/chat.mjs";

const msg = (text, over = {}) => ({ author: "Person 1", platform: "YouTube", text, time: "2026-12-01T19:20:00Z", ...over });

/** A chat the host connected, on fake timers. */
function connected() {
  const now = { t: 0 };
  const timers = fakeTimers(now);
  const chat = createChat({ timers });
  assert.equal(chat.ask("Claude Code", () => true), true);
  return { chat, timers };
}

test("readChat: messages with author and text, the optional fields made one line, and nothing else", () => {
  const read = readChat({ messages: [msg("  How do you\n test a restore? ", { question: true, pick: " fits the backup part " })] });
  assert.deepEqual(read, { ok: true, chat: { messages: [{ author: "Person 1", platform: "YouTube", text: "How do you test a restore?", time: "2026-12-01T19:20:00Z", question: true, pick: "fits the backup part" }], waiting: "", problem: "" } });
  assert.deepEqual(readChat({}), { ok: true, chat: { messages: [], waiting: "", problem: "" } }, "an empty call is fine: nothing new");
  assert.equal(readChat({ waiting: "no live event yet" }).chat.waiting, "no live event yet");
  assert.equal(readChat({ problem: "No Restream connection" }).chat.problem, "No Restream connection");
});

test("readChat: refuses what does not fit, with a plain reason", () => {
  const no = (args) => { const r = readChat(args); assert.equal(r.ok, false, JSON.stringify(args)); return r.reason; };
  assert.match(no(null), /messages/);
  assert.match(no([]), /messages/);
  assert.match(no({ guestAgreed: true }), /"guestAgreed" is not a post_chat field/);
  assert.match(no({ messages: [{ text: "hi" }] }), /author/);
  assert.match(no({ messages: [{ author: "A" }] }), /text/);
  assert.match(no({ messages: [msg("x".repeat(CHAT_LIMITS.text + 1))] }), /text/);
  assert.match(no({ messages: [msg("hi", { url: "https://example.com" })] }), /"url" is not a message field/);
  assert.match(no({ messages: [msg("hi", { question: "yes" })] }), /true or false/);
  assert.match(no({ messages: [msg("hi", { pick: "" })] }), /pick/);
  assert.match(no({ messages: Array.from({ length: CHAT_LIMITS.messages + 1 }, (_, i) => msg(`m${i}`)) }), /at most 50/);
  assert.match(no({ waiting: "x".repeat(CHAT_LIMITS.note + 1) }), /waiting/);
});

test("the chat only takes messages once the host connected it, and not after the host switched it off", () => {
  const chat = createChat({ timers: fakeTimers({ t: 0 }) });
  assert.match(chat.agentPost({ messages: [msg("hi")] }).error, /has not connected the viewer chat/);
  assert.equal(chat.view().messages.length, 0);
  assert.equal(chat.ask("Claude Code", () => false), false, "no agent took the cue: nothing changes");
  assert.equal(chat.view().phase, "off");
  assert.equal(chat.ask("Claude Code", () => true), true);
  assert.equal(chat.view().phase, "asking");
  assert.deepEqual(chat.agentPost({ messages: [msg("hi")] }), { result: { shown: 1 } });
  assert.equal(chat.view().phase, "on");
  chat.disconnect();
  assert.equal(chat.view().phase, "off");
  assert.match(chat.agentPost({ messages: [msg("again")] }).error, /switched it off/);
  assert.equal(chat.view().messages.length, 1, "what was shown stays on the screen");
});

test("messages: a question ends with a question mark or is marked by the agent; a repeat is shown once", () => {
  const { chat } = connected();
  chat.agentPost({ messages: [msg("Hello from Accra"), msg("How often do you test a restore?"), msg("Tell us about rooms", { question: true }), msg("Is this live?", { question: false })] }, "12:03");
  chat.agentPost({ messages: [msg("How often do you test a restore?")] }, "12:40");
  const v = chat.view();
  assert.deepEqual(v.messages.map((m) => [m.text, m.q, m.s, m.at]), [
    ["Hello from Accra", false, "", "12:03"],
    ["How often do you test a restore?", true, "open", "12:03"],
    ["Tell us about rooms", true, "open", "12:03"],
    ["Is this live?", false, "", "12:03"],
  ]);
  assert.equal(v.open, 2, "the open count is the questions waiting");
  assert.equal(v.messages[1].who, "Person 1");
  assert.equal(v.messages[1].where, "YouTube");
});

test("the agent's pick: the newest pick still open is the one to Use; a pick on a done question is let go", () => {
  const { chat } = connected();
  chat.agentPost({ messages: [msg("Who tells the client at night?", { pick: "fits Room 4: tell the client" }), msg("Does it work for one person?")] });
  assert.equal(chat.view().pick.text, "Who tells the client at night?");
  assert.equal(chat.view().pick.pick, "fits Room 4: tell the client");
  // A later pick of an older message (sent again with pick) takes over.
  chat.agentPost({ messages: [msg("Does it work for one person?", { pick: "fits the recap" })] });
  assert.equal(chat.view().pick.text, "Does it work for one person?");
  const id = chat.view().pick.id;
  chat.mark(id, "card");
  assert.equal(chat.view().pick.text, "Who tells the client at night?", "the pick on the card leaves the pick row; the older pick comes back");
  chat.mark(id, "answered", "20:10");
  const first = chat.view().pick.id;
  chat.mark(first, "skipped", "20:11");
  assert.equal(chat.view().pick, null, "no open pick left");
  chat.agentPost({ messages: [msg("Who tells the client at night?", { pick: "again" })] });
  assert.equal(chat.view().pick, null, "a skipped question is not picked again");
  chat.agentPost({ messages: [msg("Great stream", { pick: "a thank-you worth a word" })] });
  assert.equal(chat.view().pick.text, "Great stream", "a picked plain message counts as a question the agent found worth answering");
  assert.equal(chat.view().pick.q, true);
});

test("Use, Answered and Skip: one question on the card; each press again undoes itself", () => {
  const { chat } = connected();
  chat.agentPost({ messages: [msg("First?"), msg("Second?")] });
  const [a, b] = chat.view().messages.map((m) => m.id);
  chat.mark(a, "card");
  assert.equal(chat.view().card.id, a);
  chat.mark(b, "card");
  assert.deepEqual(chat.view().messages.map((m) => m.s), ["open", "card"], "Use on another question swaps it in");
  chat.mark(b, "card");
  assert.equal(chat.view().card, null, "Use again takes it off");
  chat.mark(a, "card");
  chat.mark(a, "answered", "21:00");
  assert.equal(chat.view().card, null, "an answered question leaves the card");
  assert.deepEqual([chat.view().messages[0].s, chat.view().messages[0].doneAt], ["answered", "21:00"]);
  chat.mark(a, "answered");
  assert.deepEqual([chat.view().messages[0].s, chat.view().messages[0].doneAt], ["open", ""], "Answered again reopens it");
  chat.mark(b, "skipped", "21:05");
  assert.equal(chat.view().open, 1);
  assert.equal(chat.mark(999, "card"), false);
  chat.agentPost({ messages: [msg("plain chat")] });
  assert.equal(chat.mark(chat.view().messages.at(-1).id, "card"), false, "plain chat has no buttons");
});

test("waiting for the live stream, a problem, and no answer in time", async () => {
  const { chat, timers } = connected();
  chat.agentPost({ messages: [], waiting: "no live stream yet" });
  assert.deepEqual([chat.view().phase, chat.view().note], ["waiting", "no live stream yet"]);
  chat.agentPost({ messages: [msg("hi")] });
  assert.equal(chat.view().phase, "on", "the first message ends the wait");
  chat.agentPost({ waiting: "stream ended" });
  assert.equal(chat.view().phase, "on", "a connected chat stays connected");

  const other = connected();
  other.chat.agentPost({ problem: "I have no Restream connection." });
  assert.deepEqual([other.chat.view().phase, other.chat.view().reason], ["failed", "I have no Restream connection."]);
  assert.equal(other.chat.ask("Claude Code", () => true), true, "a press tries again");

  const slow = connected();
  await slow.timers.tick(CHAT_WAIT_MS - 1);
  assert.equal(slow.chat.view().phase, "asking");
  await slow.timers.tick(1);
  assert.equal(slow.chat.view().phase, "failed");
  assert.match(slow.chat.view().reason, /No answer from Claude Code in 2 minutes/);
  slow.chat.agentPost({ messages: [msg("late")] });
  assert.equal(slow.chat.view().phase, "on", "a late answer still counts");
  assert.equal(timers.pending(), 0);
});

test("the agent going away ends the chat; a quiet loop does not", () => {
  const { chat } = connected();
  chat.agentPost({ messages: [] });
  chat.agentLink("waiting", "Claude Code");
  assert.equal(chat.view().phase, "on");
  chat.agentLink("off", "Claude Code");
  assert.deepEqual([chat.view().phase, chat.view().reason], ["failed", "Claude Code disconnected, so the chat stopped. Connect your agent, then try again."]);
  const moved = connected();
  moved.chat.agentLink("elsewhere");
  assert.equal(moved.chat.view().phase, "failed");
});

test("Connect Restream chat: switched off with its reason, then ready, connecting, connected, waiting or failed", () => {
  const chat = (over = {}) => ({ phase: "off", name: "", reason: "", note: "", ...over });
  const name = "Claude Code";
  assert.deepEqual(chatButton({ stream: "obs", agent: "on", chat: chat(), name }), { state: null, text: "Connect Restream chat", tip: "", off: "Viewer chat works with Restream streams only." });
  assert.equal(chatButton({ stream: "restream", agent: "off", chat: chat(), name }).off, "Connect your agent first (step 2).");
  assert.equal(chatButton({ stream: "restream", agent: "elsewhere", chat: chat(), name }).off, "Your agent is connected in another tab.");
  const ready = chatButton({ stream: "restream", agent: "on", chat: chat(), name });
  assert.deepEqual([ready.text, ready.off, ready.state], ["Connect Restream chat", "", null]);
  assert.match(ready.tip, /its own Restream connection/);
  assert.deepEqual(chatButton({ stream: "restream", agent: "on", chat: chat({ phase: "asking", name }), name }), { state: "busy", text: "Connecting chat…", tip: "Waiting for Claude Code to read your Restream chat.", off: "" });
  assert.deepEqual(chatButton({ stream: "restream", agent: "on", chat: chat({ phase: "on", name }), name }), { state: "ok", text: "Restream chat connected ✓", tip: "Claude Code reads your Restream chat. Press to disconnect.", off: "" });
  const waiting = chatButton({ stream: "restream", agent: "on", chat: chat({ phase: "waiting", name, note: "no live stream yet" }), name });
  assert.deepEqual([waiting.state, waiting.text], ["busy", "Chat · waiting for your live stream"]);
  assert.match(waiting.tip, /no live stream yet/);
  assert.deepEqual(chatButton({ stream: "restream", agent: "on", chat: chat({ phase: "failed", reason: "No Restream connection." }), name }), { state: "error", text: "Chat not connected · try again", tip: "No Restream connection.", off: "" });
  assert.equal(chatButton({ stream: "restream", agent: "on", chat: chat({ phase: "on", name }), name: "Codex" }).tip, "Claude Code reads your Restream chat. Press to disconnect.", "the agent that connected is named");
});
