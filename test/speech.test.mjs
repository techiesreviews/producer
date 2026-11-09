// The speech worker's parts that need no browser: cutting sound into pieces at pauses, the 16 kHz resampler and the
// repeat guard; and what the worker's source may and may not do (it stays on this site and sends only text back).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSegmenter, SEGMENT } from "../src/speech/segmenter.mjs";
import { createResampler } from "../src/speech/resample.mjs";
import { guardRepeats } from "../src/speech/repeat.mjs";

const RATE = 16000;
const silence = (s) => new Float32Array(Math.round(s * RATE));
// A "voice": syllables of a 200 Hz tone, 200 ms each with a 60 ms near-silent gap between them, as speech has.
const voice = (s, amp = 0.2) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => ((i / RATE) % 0.26 < 0.2 ? amp : 0.002) * Math.sin((2 * Math.PI * 200 * i) / RATE));
const cat = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const feed = (seg, audio, chunk = 4096) => {
  const events = [];
  for (let i = 0; i < audio.length; i += chunk) events.push(...seg.push(audio.subarray(i, i + chunk)));
  return events;
};

test("silence and steady low noise make no piece and no pause", () => {
  const seg = createSegmenter();
  const noise = Float32Array.from({ length: RATE * 5 }, () => (Math.random() - 0.5) * 0.004);
  assert.deepEqual(feed(seg, cat(silence(3), noise)), []);
  assert.deepEqual(seg.flush(), []);
});

test("one sentence becomes one final piece after a short silence, with a lead-in and a short tail", () => {
  const seg = createSegmenter();
  const events = feed(seg, cat(silence(1), voice(2), silence(1)));
  const finals = events.filter((e) => e.type === "final");
  assert.equal(finals.length, 1);
  const [f] = finals;
  assert.ok(f.start >= 1 - SEGMENT.leadMs / 1000 - 0.04 && f.start < 1, `starts just before the voice (${f.start})`);
  assert.ok(f.end > 3 && f.end <= 3 + SEGMENT.tailMs / 1000 + 0.04, `ends just after it (${f.end})`);
  assert.equal(f.audio.length, Math.round((f.end - f.start) * RATE));
  // The final comes once the silence reached endSilenceMs, not later.
  const order = events.map((e) => e.type);
  assert.ok(order.indexOf("final") >= 0 && order.at(-1) !== "draft");
});

test("while someone speaks, a draft is offered about once a second; then the final", () => {
  const seg = createSegmenter();
  const events = feed(seg, cat(voice(3.5), silence(1)), 480);
  const drafts = events.filter((e) => e.type === "draft");
  assert.ok(drafts.length >= 3 && drafts.length <= 4, `${drafts.length} drafts in 3.5 s`);
  for (let i = 1; i < drafts.length; i++) assert.ok(drafts[i].end - drafts[i - 1].end >= SEGMENT.draftEveryMs / 1000 - 0.04, "a second apart");
  assert.ok(drafts.every((d) => d.piece === drafts[0].piece && d.start === drafts[0].start), "drafts of one piece grow from its start");
  const final = events.find((e) => e.type === "final");
  assert.equal(final.piece, drafts[0].piece);
  assert.ok(events.indexOf(final) > events.indexOf(drafts.at(-1)));
});

test("a pause is a silence of about 1.5 s after speech, told once", () => {
  const seg = createSegmenter();
  const short = feed(seg, cat(voice(1), silence(1.2), voice(1), silence(1)));
  assert.equal(short.filter((e) => e.type === "pause").length, 0, "1.2 s and 1 s are no pause");
  const long = feed(seg, silence(2));
  const pauses = long.filter((e) => e.type === "pause");
  assert.equal(pauses.length, 1, "the next 0.5 s makes it one");
  assert.ok(Math.abs(pauses[0].at - 3.2) < 0.1, `at the end of the speech (${pauses[0].at})`);
  assert.equal(feed(seg, silence(5)).length, 0, "and only once until someone speaks again");
  assert.equal(SEGMENT.pauseMs, 1500);
});

test("a long stretch of talk is cut at the length cap and goes on in a new piece", () => {
  const seg = createSegmenter();
  const events = feed(seg, cat(voice(30), silence(1)));
  const finals = events.filter((e) => e.type === "final");
  assert.equal(finals.length, 3, "12 s, 12 s and the rest");
  for (const f of finals) assert.ok(f.end - f.start <= SEGMENT.maxPieceMs / 1000 + 0.001);
  assert.deepEqual(finals.map((f) => f.piece), [finals[0].piece, finals[0].piece + 1, finals[0].piece + 2]);
});

test("a click shorter than a word is dropped; Stop (flush) ends an open piece", () => {
  const seg = createSegmenter();
  assert.deepEqual(feed(seg, cat(silence(1), voice(0.1), silence(1))).filter((e) => e.type === "final"), []);
  feed(seg, voice(1.5));
  const flushed = seg.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].type, "final");
  assert.deepEqual(seg.flush(), [], "nothing left after it");
});

test("the resampler turns 48 kHz and 44.1 kHz into 16 kHz, in chunks of any size, without a jump", () => {
  for (const from of [48000, 44100]) {
    const second = Float32Array.from({ length: from }, (_, i) => Math.sin((2 * Math.PI * 300 * i) / from));
    const whole = createResampler(from)(second);
    const chunked = createResampler(from);
    const parts = [];
    for (let i = 0; i < second.length; i += 1000) parts.push(chunked(second.subarray(i, i + 1000)));
    const joined = cat(...parts);
    assert.ok(Math.abs(whole.length - 16000) <= 1, `${from}: one second is 16000 samples (${whole.length})`);
    assert.equal(joined.length, whole.length, `${from}: chunked gives the same length`);
    for (let i = 0; i < whole.length; i++) assert.ok(Math.abs(joined[i] - whole[i]) < 1e-6, `${from}: and the same samples`);
    let jump = 0;
    for (let i = 1; i < joined.length; i++) jump = Math.max(jump, Math.abs(joined[i] - joined[i - 1]));
    assert.ok(jump < 0.15, `${from}: a 300 Hz tone stays smooth (${jump})`);
  }
  assert.deepEqual([...createResampler(16000)(Float32Array.of(0.1, 0.2))].map((x) => +x.toFixed(3)), [0.1, 0.2], "16 kHz passes through");
  assert.throws(() => createResampler(0));
});

test("the repeat guard stops a looping phrase and keeps ordinary repeats", () => {
  const loop = `So ${"I need five hour ".repeat(88)}and then`;
  assert.equal(guardRepeats(loop), "So I need five hour I need five hour and then");
  assert.equal(guardRepeats("No, no, no, I said no."), "No, no, no, I said no.");
  assert.equal(guardRepeats("no no no no no no"), "no no no");
  assert.equal(guardRepeats("It was very, very good."), "It was very, very good.");
  assert.equal(guardRepeats("thank you. Thank you. thank you, thank you."), "thank you. Thank you.");
  assert.equal(guardRepeats("  "), "");
  assert.equal(guardRepeats("One two three."), "One two three.");
});

const workerSource = ["worker", "segmenter", "resample", "repeat"].map((f) => readFileSync(resolve(import.meta.dirname, `../src/speech/${f}.mjs`), "utf8").replace(/^\s*\/\/.*$/gm, "")).join("\n");

test("the speech worker stays on this site and keeps only the model", () => {
  assert.doesNotMatch(workerSource, /https?:\/\//, "names no outside address");
  assert.doesNotMatch(workerSource, /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|importScripts|cookie|console)\b/);
  // Every download is a path of this site, built by here(); the model library's own download is turned off.
  for (const m of workerSource.matchAll(/\bfetch\(([^,)]+)/g)) assert.match(m[1], /^here\(/, `fetch(${m[1]}) is a path of this site`);
  assert.match(workerSource, /env\.fetch = async \(\) => new Response\(null, \{ status: 404 \}\)/);
  assert.match(workerSource, /env\.allowLocalModels = false/);
  // Imports are files of /speech/ only.
  for (const m of workerSource.matchAll(/\bimport\s*(?:\(|[^"']*from\s*)["']([^"']+)["']/g)) assert.match(m[1], /^\.\//, `${m[1]} is beside the worker`);
  // The only storage is the browser cache named for the model.
  assert.match(workerSource, /caches\.open\(CACHE_PREFIX \+ manifest\.version\)/);
});

test("the speech worker sends only text, progress and state back: never the sound", () => {
  const posts = [...workerSource.matchAll(/post\((\{[^}]*\})\)/g)].map((m) => m[1]);
  assert.ok(posts.length >= 4);
  for (const p of posts) assert.doesNotMatch(p, /\b(audio|samples|whole|buffer)\b/, p);
  assert.doesNotMatch(workerSource, /\bpost\((?!\{)/, "every message is written out field by field");
});
