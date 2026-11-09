// The browser's own speech service (src/web-speech.mjs) against a fake SpeechRecognition: the way it is started
// (with the microphone's track), the pieces it hands on (the same shape the speech model's worker posts), a session
// the browser ends by itself, a stop that lets nothing more out, and the plain reasons it fails with.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrowserSpeech } from "../src/web-speech.mjs";
import { createCues } from "../src/cues.mjs";

/** A result as the browser hands it over: [alternative] with the text, and whether it is final. */
const result = (text, isFinal) => Object.assign([{ transcript: text }], { isFinal });

/** A SpeechRecognition class that remembers what the page did to it; `say` plays what the service would send back. */
function fakeService() {
  class Recognition {
    constructor() { Recognition.made.push(this); this.log = []; }
    start(...args) { this.log.push(["start", ...args]); }
    abort() { this.log.push(["abort"]); }
    say(results, resultIndex = 0) { this.onresult?.({ resultIndex, results }); }
    fail(error) { this.onerror?.({ error }); }
    end() { this.onend?.(); }
  }
  Recognition.made = [];
  return Recognition;
}

function setup() {
  const Recognition = fakeService();
  let ms = 0;
  const texts = [];
  const fails = [];
  const pauses = [];
  // A clock the check moves by hand: `at` sets the time; `advance` sets it and runs the timers that came due.
  const timers = new Set();
  const setTimer = (fn, wait) => { const timer = { fn, due: ms + wait }; timers.add(timer); return timer; };
  const clearTimer = (timer) => timers.delete(timer);
  const advance = (t) => {
    ms = t;
    for (const timer of [...timers].filter((x) => x.due <= ms).sort((a, b) => a.due - b.due)) { timers.delete(timer); timer.fn(); }
  };
  const speech = createBrowserSpeech({ Recognition, now: () => ms, onText: (t) => texts.push(t), onFail: (r) => fails.push(r), onPause: (at) => pauses.push(at), setTimer, clearTimer });
  return { Recognition, speech, texts, fails, pauses, timers, advance, at: (t) => { ms = t; }, current: () => Recognition.made.at(-1) };
}

test("it is told to listen to the microphone's own track, in English, with drafts as it goes", () => {
  const { speech, current } = setup();
  const track = { kind: "audio" };
  speech.start(track);
  const service = current();
  assert.deepEqual(service.log, [["start", track]], "started with the track the page already holds, so no second microphone opens");
  assert.equal(service.lang, "en-US");
  assert.equal(service.continuous, true);
  assert.equal(service.interimResults, true);
  assert.equal(service.maxAlternatives, 1);
});

test("a draft grows into one final piece, timed from when listening began", () => {
  const { speech, texts, at, current } = setup();
  at(1000);
  speech.start({});
  at(3500);
  current().say([result("hello", false)]);
  at(4200);
  current().say([result("hello there", false)]);
  at(5000);
  current().say([result("Hello there.", true)]);
  assert.deepEqual(texts, [
    { piece: 1, final: false, text: "hello", start: 2.5, end: 2.5 },
    { piece: 1, final: false, text: "hello there", start: 2.5, end: 3.2 },
    { piece: 1, final: true, text: "Hello there.", start: 2.5, end: 4 },
  ]);
});

test("two results in one session are two pieces; only the results that changed are handed on", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  const first = result("one", true);
  current().say([first, result("two", false)]);
  current().say([first, result("two words", true)], 1);
  assert.deepEqual(texts.map((t) => [t.piece, t.final, t.text]), [[1, true, "one"], [2, false, "two"], [2, true, "two words"]]);
});

test("Chrome's split draft (a settled start and a shaky end) is one draft, and the final that replaces it is not heard twice", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  current().say([result("hello how are", false), result(" you", false)]);
  assert.deepEqual(texts.map((t) => [t.piece, t.final, t.text]), [[1, false, "hello how are you"]], "both parts are one draft, one piece");
  current().say([result("Hello, how are you?", true)]);
  current().end();
  assert.deepEqual(texts.filter((t) => t.final).map((t) => [t.piece, t.text]), [[1, "Hello, how are you?"]], "one final line, nothing left to flush");
});

test("a draft part that goes away is not kept: an emptied draft flushes nothing", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  current().say([result("one two", false), result(" three", false)]);
  current().say([result("one two", false), result("", false)]);
  assert.equal(texts.at(-1).text, "one two", "the draft follows the newest text");
  current().say([result("", false)]);
  current().end();
  assert.deepEqual(texts.filter((t) => t.final), [], "an emptied draft is not written out as a line");
});

test("a final and a new draft in one event are two pieces, the final keeping the draft's number", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  current().say([result("first part", false)]);
  current().say([result("First part.", true), result("second", false)]);
  assert.deepEqual(texts.map((t) => [t.piece, t.final, t.text]), [[1, false, "first part"], [1, true, "First part."], [2, false, "second"]]);
  current().say([result("First part.", true), result("Second one.", true)], 1);
  assert.deepEqual(texts.at(-1).piece, 2);
});

test("a failure in the middle of a sentence keeps the half-said words as a final piece", () => {
  const { speech, texts, fails, at, current } = setup();
  at(0);
  speech.start({});
  at(1000);
  current().say([result("half", false)]);
  at(1500);
  current().fail("network");
  assert.deepEqual(texts.at(-1), { piece: 1, final: true, text: "half", start: 1, end: 1 }, "the final ends where the draft last grew, not at the failure");
  assert.deepEqual(fails, ["the browser's speech service could not be reached"]);
});

test("a service that sends every earlier final again does not write a line twice", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  const one = result("one.", true);
  const two = result("two.", true);
  current().say([one]);
  current().say([one, two]);
  current().say([one, two], 0);
  current().say([one, two, result("three.", true)], 0);
  assert.deepEqual(texts.filter((t) => t.final).map((t) => t.text), ["one.", "two.", "three."]);
});

test("a service that starts its result list over keeps its new finals", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  current().say([result("one.", true), result("two.", true)]);
  current().say([result("three.", true)]);
  assert.deepEqual(texts.filter((t) => t.final).map((t) => t.text), ["one.", "two.", "three."]);
});

test("about 1.5 s after the last words the service reports a pause, once, as the model's worker does", () => {
  const { speech, pauses, advance, at, current } = setup();
  at(0);
  speech.start({});
  advance(1000);
  current().say([result("hello", false)]);
  advance(2000);
  assert.deepEqual(pauses, [], "not yet: 1 s of quiet");
  advance(2500);
  assert.deepEqual(pauses, [2.5], "1.5 s after the last words (at 1 s), in seconds since Listen");
  advance(10000);
  assert.equal(pauses.length, 1, "one pause per quiet stretch");
  current().say([result("Hello again.", true)]);
  advance(11499);
  assert.equal(pauses.length, 1);
  advance(11500);
  assert.deepEqual(pauses, [2.5, 11.5], "new words, a new pause");
});

test("new words keep a pause away; a stop, a failure or no words at all report none", () => {
  const a = setup();
  a.at(0); a.speech.start({});
  a.advance(1000); a.current().say([result("one", false)]);
  a.advance(2000); a.current().say([result("one two", false)]);
  a.advance(3000);
  assert.deepEqual(a.pauses, [], "words 1 s ago: no pause yet");
  a.advance(3500);
  assert.equal(a.pauses.length, 1);
  const b = setup();
  b.at(0); b.speech.start({});
  b.advance(5000);
  assert.deepEqual(b.pauses, [], "no words, so nothing to pause");
  const c = setup();
  c.at(0); c.speech.start({});
  c.advance(1000); c.current().say([result("words", false)]);
  c.speech.stop();
  c.advance(9000);
  assert.deepEqual([c.pauses, c.timers.size], [[], 0], "a stop leaves no timer and no pause");
  const d = setup();
  d.at(0); d.speech.start({});
  d.advance(1000); d.current().say([result("words", false)]);
  d.current().fail("network");
  d.advance(9000);
  assert.deepEqual([d.pauses, d.timers.size], [[], 0], "a failure leaves no timer and no pause");
});

test("a session the browser ends by itself does not lose the pause that is due", () => {
  const { speech, pauses, advance, at, current } = setup();
  at(0);
  speech.start({});
  advance(1000);
  current().say([result("before the restart", true)]);
  advance(1200);
  current().end();
  advance(2500);
  assert.deepEqual(pauses, [2.5], "the pause still comes 1.5 s after the words");
});

test("a result list that starts over, at any length, keeps its new finals and writes no old one twice", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  current().say([result("one.", true)]);
  current().say([result("two.", true)]);
  current().say([result("three.", true), result("four.", true)]);
  assert.deepEqual(texts.filter((t) => t.final).map((t) => t.text), ["one.", "two.", "three.", "four."]);
  current().say([result("three.", true), result("four.", true)]);
  current().say([result("three.", true), result("four.", true), result("five.", true)]);
  assert.deepEqual(texts.filter((t) => t.final).map((t) => t.text), ["one.", "two.", "three.", "four.", "five."], "a repeat of what was handed on adds nothing");
});

test("a finished line with no draft before it still counts the time it took to say (the cues add up speech time from start to end)", () => {
  const { speech, texts, at, advance, current } = setup();
  at(0);
  speech.start({});
  advance(10_000);
  current().say([result("one two three four five.", true)]);
  assert.deepEqual([texts[0].start, texts[0].end], [8, 10], "five words at about 2.5 words a second: 2 s before it arrived");
  advance(12_000);
  const one = result("one two three four five.", true);
  current().say([one, result("six seven.", true), result("eight nine ten eleven.", true)]);
  const lines = texts.filter((t) => t.final).slice(1);
  // The 2 s since the last words are shared end to end (2.4 s of estimated speech scaled to fit), never overlapping.
  assert.deepEqual(lines.map((t) => [t.text, +t.start.toFixed(2), +t.end.toFixed(2)]), [["six seven.", 10, 10.67], ["eight nine ten eleven.", 10.67, 12]]);
  assert.ok(lines.every((t) => t.start >= 10 && t.end > t.start), "none starts before the previous words arrived, none is empty");
  assert.ok(Math.abs(lines.reduce((sum, t) => sum + (t.end - t.start), 0) - 2) < 1e-9, "and together they never count more speech than the time that passed");
});

test("a drafted line and the lines that finish with it share the time without overlapping", () => {
  const { speech, texts, at, advance, current } = setup();
  at(0);
  speech.start({});
  advance(1000);
  current().say([result("alpha beta gamma", false)]);
  advance(4000);
  current().say([result("Alpha beta gamma.", true), result("delta epsilon zeta eta theta.", true)]);
  const [first, second] = texts.filter((t) => t.final);
  assert.deepEqual([first.start, first.end], [1, 2.2], "the drafted line starts when its draft did and lasts as long as three words take");
  assert.ok(second.start >= first.end - 1e-9 && second.end <= 4 + 1e-9, "the next line follows it and ends when the event arrived");
});

test("empty text is dropped", () => {
  const { speech, texts, current } = setup();
  speech.start({});
  current().say([result("  ", false)]);
  current().say([result("", true)]);
  assert.deepEqual(texts, []);
});

test("a session the browser ends by itself starts again while listening, and piece numbers go on", () => {
  const { speech, texts, Recognition, at, current } = setup();
  at(0);
  speech.start({ id: 1 });
  at(500);
  current().say([result("before", true)]);
  at(61000);
  current().end();
  assert.equal(Recognition.made.length, 2, "a new session began");
  assert.equal(Recognition.made[0].onresult, null, "the old one is let go");
  assert.deepEqual(Recognition.made[1].log, [["start", { id: 1 }]], "with the same track");
  at(62000);
  current().say([result("after", true)]);
  assert.deepEqual(texts.map((t) => [t.piece, t.text]), [[1, "before"], [2, "after"]]);
});

test("a draft that never became final is handed on as final when its session ends", () => {
  const { speech, texts, at, current } = setup();
  at(0);
  speech.start({});
  at(1000);
  current().say([result("half a sentence", false)]);
  at(2000);
  current().end();
  assert.deepEqual(texts.at(-1), { piece: 1, final: true, text: "half a sentence", start: 1, end: 1 });
});

test("a draft flushed after a quiet gap counts no silence as speech and brings no second pause", () => {
  const { speech, texts, pauses, advance, at, current } = setup();
  at(0);
  speech.start({});
  advance(1000);
  current().say([result("half a sentence", false)]);
  advance(2500); // the pause comes 1.5 s after the draft
  assert.deepEqual(pauses, [2.5]);
  advance(3000);
  current().end(); // the browser ends the session; the draft is handed on as final
  assert.deepEqual(texts.at(-1), { piece: 1, final: true, text: "half a sentence", start: 1, end: 1 });
  advance(9000);
  assert.deepEqual(pauses, [2.5], "the flush did not arm a second pause");
  current().say([result("five more words right here.", true)]);
  const next = texts.at(-1);
  assert.ok(next.start >= 1 - 1e-9, "the next line is not back-dated before the flushed one ended");
});

test("stop aborts the session at once and nothing arrives after it", () => {
  const { speech, texts, Recognition, current } = setup();
  speech.start({});
  const service = current();
  service.say([result("Said before.", true)]);
  speech.stop();
  assert.deepEqual(service.log.at(-1), ["abort"]);
  assert.equal(service.onresult, null);
  assert.equal(service.onend, null);
  assert.equal(speech.listening, false);
  service.say?.([result("late", true)]);
  service.end();
  assert.equal(Recognition.made.length, 1, "no new session after a stop");
  assert.deepEqual(texts.map((t) => t.text), ["Said before."], "only what came before the stop");
  speech.stop();
  assert.equal(service.log.filter(([what]) => what === "abort").length, 1, "a second stop does nothing");
});

test("the half-said sentence at a stop becomes a final piece, as the model's worker does at a stop", () => {
  const { speech, texts, at, current } = setup();
  at(0);
  speech.start({});
  at(1000);
  current().say([result("the last words", false)]);
  at(2500);
  speech.stop();
  assert.deepEqual(texts.at(-1), { piece: 1, final: true, text: "the last words", start: 1, end: 1 });
  assert.equal(texts.length, 2);
});

test("a new Listen counts its times from zero again, as the model's worker does; a restart inside one Listen does not", () => {
  const { speech, texts, at, current } = setup();
  at(10000);
  speech.start({});
  at(11000);
  current().say([result("first", true)]);
  at(20000);
  current().end(); // the browser ends the session by itself: same Listen
  at(21000);
  current().say([result("same listen", true)]);
  speech.stop();
  at(50000);
  speech.start({});
  at(52000);
  current().say([result("new listen", true)]);
  // Lines with no draft before them start a little before they arrive (the time to say them), counted from their own Listen.
  assert.deepEqual(texts.map((t) => [t.text, +t.start.toFixed(1), t.end]), [["first", 0.6, 1], ["same listen", 10.2, 11], ["new listen", 1.2, 2]]);
});

test("a Recognition that cannot even be made fails with a plain reason", () => {
  const Recognition = class { constructor() { throw new Error("not available"); } };
  const fails = [];
  const speech = createBrowserSpeech({ Recognition, now: () => 0, onText() {}, onFail: (r) => fails.push(r) });
  speech.start({});
  assert.deepEqual(fails, ["the browser's speech service could not start"]);
  assert.equal(speech.listening, false);
  const none = createBrowserSpeech({ Recognition: undefined, now: () => 0, onText() {}, onFail: (r) => fails.push(r) });
  none.start({});
  assert.equal(fails.length, 2, "no service at all fails the same way");
});

test("a start after a stop is a new session and piece numbers go on", () => {
  const { speech, texts, Recognition, current } = setup();
  speech.start({});
  current().say([result("one", true)]);
  speech.stop();
  speech.start({});
  assert.equal(Recognition.made.length, 2);
  current().say([result("two", true)]);
  assert.deepEqual(texts.map((t) => t.piece), [1, 2]);
});

test("silence and an abort are not failures: the session starts again", () => {
  const { speech, fails, Recognition, current } = setup();
  speech.start({});
  current().fail("no-speech");
  current().end();
  current().fail("aborted");
  current().end();
  assert.deepEqual(fails, []);
  assert.equal(Recognition.made.length, 3);
});

test("a blocked or unreachable service fails once, with a plain reason, and does not start again", () => {
  for (const [error, reason] of [
    ["not-allowed", "the browser blocked its speech service"],
    ["service-not-allowed", "the browser blocked its speech service"],
    ["network", "the browser's speech service could not be reached"],
    ["audio-capture", "the microphone could not be used"],
    ["language-not-supported", "the browser's speech service does not do English here"],
    ["something-new", "the browser's speech service stopped"],
  ]) {
    const { speech, fails, Recognition, current } = setup();
    speech.start({});
    current().fail(error);
    current().end();
    assert.deepEqual(fails, [reason], error);
    assert.equal(Recognition.made.length, 1, `${error}: no new session`);
    assert.equal(speech.listening, false, `${error}: it stopped`);
  }
});

test("a session that keeps ending at once fails instead of looping", () => {
  const { speech, fails, Recognition, current, at } = setup();
  at(0);
  speech.start({});
  for (let i = 0; i < 10; i++) { at(i * 100); current().end(); }
  assert.deepEqual(fails, ["the browser's speech service keeps stopping"]);
  assert.ok(Recognition.made.length <= 7, `stopped after a few tries (${Recognition.made.length})`);
});

test("silence that ends a session at once counts toward the quick endings too", () => {
  const { speech, fails, at, current } = setup();
  at(0);
  speech.start({});
  for (let i = 0; i < 8; i++) { at(i * 100); current()?.fail("no-speech"); current()?.end(); }
  assert.deepEqual(fails, ["the browser's speech service keeps stopping"], "exactly once");
});

test("a session that ran a while resets the count of quick endings", () => {
  const { speech, fails, at, current } = setup();
  at(0);
  speech.start({});
  for (let i = 0; i < 4; i++) { at(i * 100); current().end(); }
  at(100000);
  current().end();
  for (let i = 0; i < 4; i++) { at(100000 + (i + 1) * 100); current().end(); }
  assert.deepEqual(fails, []);
});

test("a start the browser refuses fails with a plain reason", () => {
  const Recognition = class { start() { throw new Error("InvalidStateError"); } abort() {} };
  const fails = [];
  const speech = createBrowserSpeech({ Recognition, now: () => 0, onText() {}, onFail: (r) => fails.push(r) });
  speech.start({});
  assert.deepEqual(fails, ["the browser's speech service could not start"]);
  assert.equal(speech.listening, false);
});

test("the service feeds the agent's cues the way the model's worker does: lines, talking and a pause send one cue, labelled host", () => {
  // The page's own wiring in small: a final line is heard, a draft is talking, the service's pause is the cue's pause.
  const Recognition = fakeService();
  let ms = 0;
  const timers = new Set();
  const sent = [];
  const cues = createCues({ send: (item) => { sent.push(item); return true; }, now: () => ms });
  const speech = createBrowserSpeech({
    Recognition,
    now: () => ms,
    setTimer: (fn, wait) => { const t = { fn, due: ms + wait }; timers.add(t); return t; },
    clearTimer: (t) => timers.delete(t),
    onText: (piece) => (piece.final ? cues.heard({ source: "host", ...piece }) : cues.talking("host")),
    onPause: () => cues.pause("host"),
    onFail() {},
  });
  const advance = (t) => { ms = t; for (const timer of [...timers].filter((x) => x.due <= ms)) { timers.delete(timer); timer.fn(); } };
  speech.start({});
  const service = () => Recognition.made.at(-1);
  // 40 s of talking in sentences about ten seconds long.
  for (let i = 0; i < 4; i++) {
    advance(i * 10_000 + 1000);
    service().say([result(`part ${i}`, false)]);
    advance(i * 10_000 + 9000);
    service().say([result(`Part ${i}.`, true)]);
  }
  assert.deepEqual(sent, [], "no cue while the host is still talking");
  advance(41_000 + 1500);
  assert.equal(sent.length, 1, "at the pause one cue goes");
  assert.equal(sent[0].cue, "pause");
  assert.deepEqual(sent[0].transcript.map((l) => [l.speaker, l.text]), [["host", "Part 0."], ["host", "Part 1."], ["host", "Part 2."], ["host", "Part 3."]]);
});
