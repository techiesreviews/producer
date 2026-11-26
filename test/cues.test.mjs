// The cue rules (src/cues.mjs) on a fake clock: a cue at a pause only after 30 s of new speech and at most once a
// minute, Suggest now at least 10 s apart, Slow down doubling both spacings, and the cursor (each cue carries only
// what was heard since the last cue that went). The rules know nothing about how the agent is reached.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUE_RULES, createCues, speakerOf } from "../src/cues.mjs";

/** Cue rules on a clock the test moves, sending into a list (an agent that is there unless `away` is set). */
function setup(options = {}) {
  const clock = { t: 1_000_000 };
  const sent = [];
  const agent = { away: false };
  const context = { position: { segment: 2, title: "Her story", minutesLeft: 7 }, guestName: "Sam" };
  const cues = createCues({ send: (m) => (agent.away ? false : (sent.push(m), true)), context: () => context, now: () => clock.t, ...options });
  /** One final line of speech, `seconds` long, ending now. */
  const say = (source, text, seconds) => cues.heard({ source, text, start: 100, end: 100 + seconds });
  const wait = (ms) => { clock.t += ms; };
  return { clock, sent, agent, context, cues, say, wait };
}

test("the rules' starting points: 30 s of new speech, once a minute at a pause, Suggest now 10 s apart, Slow down doubles", () => {
  assert.deepEqual(
    { speechMs: CUE_RULES.speechMs, autoEveryMs: CUE_RULES.autoEveryMs, manualEveryMs: CUE_RULES.manualEveryMs, slowFactor: CUE_RULES.slowFactor },
    { speechMs: 30_000, autoEveryMs: 60_000, manualEveryMs: 10_000, slowFactor: 2 },
  );
});

test("a pause sends a cue only after at least 30 s of new speech", () => {
  const { sent, cues, say } = setup();
  say("guest", "We started in a garage.", 12);
  assert.equal(cues.pause(), false, "12 s of speech: no cue yet");
  say("mic", "And then?", 2);
  say("guest", "Then the first customer called.", 15);
  assert.equal(cues.pause(), false, "29 s: still no cue");
  say("guest", "It was a bakery.", 1.5);
  assert.equal(cues.pause(), true, "30.5 s: the pause sends a cue");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].cue, "pause");
});

test("the cue carries the new text with host and guest labels, the run position and the guest's name", () => {
  const { sent, cues, say } = setup();
  say("mic", "  How did it start?  ", 2);
  say("guest", "In a garage, honestly.", 29);
  say("guest", "   ", 1);
  cues.pause();
  assert.deepEqual(sent[0], {
    cue: "pause",
    transcript: [{ speaker: "host", text: "How did it start?" }, { speaker: "guest", text: "In a garage, honestly." }],
    position: { segment: 2, title: "Her story", minutesLeft: 7 },
    guestName: "Sam",
  });
});

test("the host's microphone is HOST and the shared tab is GUEST", () => {
  assert.equal(speakerOf("mic"), "host");
  assert.equal(speakerOf("host"), "host");
  assert.equal(speakerOf("guest"), "guest");
  assert.equal(speakerOf(undefined), "host");
});

test("automatic cues come at most once a minute, however much is said", () => {
  const { sent, cues, say, wait } = setup();
  say("guest", "First long point.", 40);
  assert.equal(cues.pause(), true);
  wait(30_000);
  say("guest", "Second long point.", 40);
  assert.equal(cues.pause(), false, "30 s after the last cue: too soon");
  wait(29_999);
  assert.equal(cues.pause(), false, "59.999 s: still too soon");
  wait(1);
  assert.equal(cues.pause(), true, "a minute after the last cue: the next pause sends");
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].transcript, [{ speaker: "guest", text: "Second long point." }], "the text held back went with the next cue");
});

test("the cursor: each cue carries only what was heard since the last cue that went", () => {
  const { sent, cues, say, wait } = setup();
  say("guest", "One.", 31);
  cues.pause();
  wait(60_000);
  say("guest", "Two.", 31);
  cues.pause();
  wait(10_000);
  cues.suggestNow();
  assert.deepEqual(sent.map((s) => s.transcript.map((l) => l.text)), [["One."], ["Two."], []]);
  assert.deepEqual(sent.map((s) => s.cue), ["pause", "pause", "suggest_now"]);
});

test("Suggest now works with any amount of speech but at least 10 s apart, and says how long to wait", () => {
  const { sent, cues, say, wait } = setup();
  assert.deepEqual(cues.suggestNow(), { ok: true }, "the first press sends at once, even with nothing heard");
  say("guest", "A short answer.", 3);
  wait(4_000);
  assert.deepEqual(cues.suggestNow(), { ok: false, waitMs: 6_000 });
  wait(6_000);
  assert.deepEqual(cues.suggestNow(), { ok: true });
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].transcript, [{ speaker: "guest", text: "A short answer." }]);
});

test("Suggest now and the automatic cue share one clock: a press resets the minute, a cue blocks a press for 10 s", () => {
  const { sent, cues, say, wait } = setup();
  say("guest", "Long point.", 35);
  assert.equal(cues.pause(), true);
  wait(5_000);
  assert.equal(cues.suggestNow().ok, false, "5 s after an automatic cue");
  wait(5_000);
  assert.equal(cues.suggestNow().ok, true);
  wait(55_000);
  say("guest", "Another long point.", 35);
  assert.equal(cues.pause(), false, "55 s after the press: the minute counts from the press");
  wait(5_000);
  assert.equal(cues.pause(), true);
  assert.equal(sent.length, 3);
});

test("Slow down doubles the spacing: a pause at most every 2 minutes, Suggest now 20 s apart; off brings them back", () => {
  const { sent, cues, say, wait } = setup();
  cues.slowDown(true);
  assert.equal(cues.view().slow, true);
  say("guest", "Point.", 31);
  assert.equal(cues.pause(), true);
  wait(60_000);
  say("guest", "Point two.", 31);
  assert.equal(cues.pause(), false, "a minute is not enough while slowed down");
  wait(59_999);
  assert.equal(cues.pause(), false);
  wait(1);
  assert.equal(cues.pause(), true, "two minutes");
  wait(10_000);
  assert.deepEqual(cues.suggestNow(), { ok: false, waitMs: 10_000 }, "Suggest now needs 20 s while slowed down");
  cues.slowDown(false);
  assert.deepEqual(cues.suggestNow(), { ok: true }, "back to 10 s");
  assert.equal(sent.length, 3);
  assert.equal(cues.view().slow, false);
});

test("Slow down does not change how much new speech a pause needs", () => {
  const { cues, say } = setup();
  cues.slowDown(true);
  say("guest", "Point.", 29);
  assert.equal(cues.pause(), false);
  say("guest", "More.", 1);
  assert.equal(cues.pause(), true);
});

test("with no agent to take it, nothing is used up: the text stays for the next cue and the clock does not start", () => {
  const { sent, agent, cues, say, wait } = setup();
  agent.away = true;
  say("guest", "Said while the agent was away.", 31);
  assert.equal(cues.pause(), false);
  assert.deepEqual(cues.suggestNow(), { ok: false, noAgent: true });
  agent.away = false;
  wait(1_000);
  assert.deepEqual(cues.suggestNow(), { ok: true }, "no 10 s wait: nothing went before");
  assert.deepEqual(sent[0].transcript, [{ speaker: "guest", text: "Said while the agent was away." }]);
  assert.equal(cues.view().cues, 1);
});

test("the text held for the next cue keeps only the newest 20,000 characters", () => {
  const { sent, cues, say } = setup();
  for (let i = 0; i < 30; i++) say("guest", `${String(i).padStart(2, "0")} ${"x".repeat(997)}`, 2); // 1,000 characters each
  cues.pause();
  const total = sent[0].transcript.reduce((n, l) => n + l.text.length, 0);
  assert.ok(total <= 20_000, `${total} characters`);
  assert.equal(sent[0].transcript.at(-1).text.slice(0, 3), "29 ", "the newest line is kept");
  assert.equal(sent[0].transcript[0].text.slice(0, 3), "10 ", "the oldest lines go first");
});

test("the view counts the cues sent and says when Suggest now works again", () => {
  const { cues, wait } = setup();
  assert.deepEqual(cues.view(), { slow: false, cues: 0, suggestInMs: 0 });
  cues.suggestNow();
  wait(3_000);
  assert.deepEqual(cues.view(), { slow: false, cues: 1, suggestInMs: 7_000 });
});

test("the cue rules never name how the agent is reached (no MCP, token or curl): that stays in the agent's own part", () => {
  const source = readFileSync(new URL("../src/cues.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bmcp\b|token|curl|relay|websocket/i);
});

test("with two sources, a pause of one is no pause while the other is still talking", () => {
  const { sent, cues, say, wait } = setup();
  say("mic", "So tell me.", 2);
  say("guest", "Well, it started in a garage.", 30);
  cues.talking("guest"); // the guest goes on: a draft of the next piece
  assert.equal(cues.pause("host"), false, "the host is quiet, but the guest is talking");
  assert.equal(cues.pause("guest"), true, "the guest's own pause: both are quiet");
  assert.equal(sent.length, 1);
  wait(60_000);
  say("guest", "And then a shop.", 31);
  cues.talking("mic");
  wait(12_000);
  assert.equal(cues.pause("guest"), true, "a source with no text for 12 s (its pause was missed) no longer counts as talking");
});

test("with no plan and no clock running, a cue carries no run position and no guest's name", () => {
  for (const context of [() => ({}), () => null]) {
    const { sent, cues, say } = setup({ context });
    say("guest", "A long point.", 31);
    cues.pause();
    assert.deepEqual(Object.keys(sent[0]), ["cue", "transcript"]);
  }
});

test("End report sends one last cue at once, whatever the spacing, with what was heard since the last cue and its show times", () => {
  const { sent, cues, say, agent } = setup();
  cues.heard({ source: "host", text: "So how did it start?", start: 0, end: 2, at: "0:12" });
  say("guest", "With a van.", 3);
  assert.equal(cues.suggestNow().ok, true);
  cues.heard({ source: "guest", text: "And a lot of luck.", start: 5, end: 7, at: "0:20" });
  cues.heard({ source: "guest", text: "Odd time", start: 7, end: 8, at: 20 });
  assert.equal(cues.end(), true, "no spacing for the end");
  assert.deepEqual(sent[0].transcript, [{ speaker: "host", text: "So how did it start?", at: "0:12" }, { speaker: "guest", text: "With a van." }], "a line keeps its show time");
  assert.deepEqual(sent[1], {
    cue: "end_report",
    transcript: [{ speaker: "guest", text: "And a lot of luck.", at: "0:20" }, { speaker: "guest", text: "Odd time" }],
    position: { segment: 2, title: "Her story", minutesLeft: 7 },
    guestName: "Sam",
  });
  agent.away = true;
  assert.equal(cues.end(), false, "with no agent to take it, the end cue says so");
});
