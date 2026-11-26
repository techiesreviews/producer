// The speech worker keeps one stream per source ("host" the microphone, "guest" the shared tab) and never mixes them
// (src/speech/lanes.mjs): each source has its own cutting into pieces, its own resampler and its own piece numbers,
// and every piece comes back labelled with the source it was heard on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobs, createLanes, SOURCES } from "../src/speech/lanes.mjs";

const RATE = 16000;
const silence = (s) => new Float32Array(Math.round(s * RATE));
// A "voice": syllables of a tone, 200 ms each with a 60 ms near-silent gap, as speech has.
const voice = (s, amp = 0.2, hz = 200) => Float32Array.from({ length: Math.round(s * RATE) }, (_, i) => ((i / RATE) % 0.26 < 0.2 ? amp : 0.002) * Math.sin((2 * Math.PI * hz * i) / RATE));
const cat = (...parts) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
const feed = (lanes, source, audio, rate = RATE, chunk = 4096) => {
  const events = [];
  for (let i = 0; i < audio.length; i += chunk) events.push(...lanes.push(source, audio.subarray(i, i + chunk), rate));
  return events;
};
const finals = (events) => events.filter((e) => e.type === "final");

test("the two sources are the host's microphone and the guest's tab, nothing else", () => {
  assert.deepEqual(SOURCES, ["host", "guest"]);
  const lanes = createLanes();
  assert.deepEqual(lanes.push("tab", voice(1), RATE), [], "an unknown source is ignored");
  assert.deepEqual(lanes.push(undefined, voice(1), RATE), []);
  assert.deepEqual(lanes.stop("tab"), []);
});

test("every piece carries the source it was heard on", () => {
  const lanes = createLanes();
  const host = feed(lanes, "host", cat(silence(1), voice(2), silence(1)));
  const guest = feed(lanes, "guest", cat(silence(1), voice(2), silence(1)));
  assert.ok(host.length > 0 && guest.length > 0);
  assert.ok(host.every((e) => e.source === "host"), "host events say host");
  assert.ok(guest.every((e) => e.source === "guest"), "guest events say guest");
});

test("sound on one source never makes a piece on the other: the host talking leaves the guest silent", () => {
  const lanes = createLanes();
  const events = [];
  // A guest source that is open the whole time but quiet, beside a host who speaks twice.
  for (const part of [cat(silence(1), voice(2), silence(2)), cat(voice(2), silence(2))]) {
    events.push(...feed(lanes, "host", part));
    events.push(...feed(lanes, "guest", silence(part.length / RATE)));
  }
  events.push(...lanes.stop());
  assert.equal(finals(events).filter((e) => e.source === "guest").length, 0, "no piece on the guest source");
  assert.equal(finals(events).filter((e) => e.source === "host").length, 2, "two on the host source");
  assert.equal(events.filter((e) => e.type === "pause" && e.source === "guest").length, 0, "and no pause on it");
});

test("two people taking turns come out as two labelled streams, each piece with its own audio", () => {
  const lanes = createLanes();
  const quiet = voice(1.5, 0.05, 120);
  const loud = voice(1.5, 0.4, 300);
  const events = [];
  // Host speaks, then the guest, then the host again; both sources stay open and each hears silence while the other talks.
  const turns = [["host", quiet], ["guest", loud], ["host", quiet]];
  for (const [who, sound] of turns) {
    const heard = cat(silence(0.5), sound, silence(1.5));
    events.push(...feed(lanes, who, heard));
    events.push(...feed(lanes, who === "host" ? "guest" : "host", silence(heard.length / RATE)));
  }
  events.push(...lanes.stop());
  const out = finals(events);
  assert.deepEqual(out.map((e) => e.source), ["host", "guest", "host"], "who spoke, in order");
  const peak = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak(out[0].audio) < 0.1 && peak(out[2].audio) < 0.1, "the host's pieces hold only the host's sound");
  assert.ok(peak(out[1].audio) > 0.3, "the guest's piece holds only the guest's sound");
});

test("each source numbers its own pieces and keeps counting across Stop", () => {
  const lanes = createLanes();
  const first = finals(feed(lanes, "host", cat(voice(1), silence(1))));
  const guest = finals(feed(lanes, "guest", cat(voice(1), silence(1))));
  assert.deepEqual([first[0].piece, guest[0].piece], [1, 1], "each source starts at piece 1");
  lanes.stop("host");
  const again = finals(feed(lanes, "host", cat(voice(1), silence(1))));
  assert.equal(again[0].piece, 2, "after Stop the host's next piece is a new number");
  const guestMore = finals(feed(lanes, "guest", cat(voice(1), silence(1))));
  assert.equal(guestMore[0].piece, 2, "the guest source went on without a Stop");
});

test("stopping one source ends only that source's open piece; stopping all ends every open piece", () => {
  const lanes = createLanes();
  feed(lanes, "host", voice(1));
  feed(lanes, "guest", voice(1));
  const onlyGuest = lanes.stop("guest");
  assert.deepEqual(finals(onlyGuest).map((e) => e.source), ["guest"], "only the guest's piece ended");
  const rest = lanes.stop();
  assert.deepEqual(finals(rest).map((e) => e.source), ["host"], "then the host's");
  assert.deepEqual(lanes.stop(), [], "nothing left open");
});

test("each source is resampled from its own rate (a microphone at 48 kHz beside a tab at 44.1 kHz)", () => {
  const lanes = createLanes();
  const at = (rate, s) => Float32Array.from({ length: Math.round(s * rate) }, (_, i) => ((i / rate) % 0.26 < 0.2 ? 0.2 : 0.002) * Math.sin((2 * Math.PI * 200 * i) / rate));
  const host = feed(lanes, "host", cat(new Float32Array(48000), at(48000, 2), new Float32Array(48000)), 48000);
  const guest = feed(lanes, "guest", cat(new Float32Array(44100), at(44100, 2), new Float32Array(44100)), 44100);
  const [h] = finals(host);
  const [g] = finals(guest);
  assert.ok(Math.abs((h.end - h.start) - (g.end - g.start)) < 0.05, `the same two seconds on both (${h.end - h.start} and ${g.end - g.start})`);
  assert.ok(Math.abs(h.audio.length - Math.round((h.end - h.start) * RATE)) <= 1, "the host's piece is 16 kHz");
  assert.ok(Math.abs(g.audio.length - Math.round((g.end - g.start) * RATE)) <= 1, "and so is the guest's");
});

const piece = (source, id, type = "final") => ({ type, source, piece: id });

test("waiting pieces: every final first and in order, whatever the source", () => {
  const jobs = createJobs();
  jobs.add(piece("host", 1, "draft"));
  jobs.add(piece("guest", 1));
  jobs.add(piece("host", 1));
  jobs.add(piece("guest", 2));
  const order = [];
  for (let job = jobs.next(); job; job = jobs.next()) order.push(`${job.source}${job.piece}${job.type[0]}`);
  assert.deepEqual(order, ["guest1f", "host1f", "guest2f"], "the finals in the order they came; the host's draft of piece 1 went with its final");
});

test("waiting pieces: a draft is an offer: one per source, the oldest waiting taken first, a newer one goes to the back", () => {
  const jobs = createJobs();
  jobs.add(piece("host", 1, "draft"));
  jobs.add(piece("guest", 1, "draft"));
  jobs.add({ ...piece("host", 1, "draft"), newer: true });
  const first = jobs.next();
  assert.deepEqual([first.source, first.newer], ["guest", undefined], "the guest's draft is the oldest waiting");
  const second = jobs.next();
  assert.deepEqual([second.source, second.newer], ["host", true], "then the host's newer draft: its old one was replaced");
  assert.equal(jobs.next(), null, "nothing else waits");
});

test("waiting pieces: a draft never jumps a final, and Stop drops only the drafts it names", () => {
  const jobs = createJobs();
  jobs.add(piece("host", 1, "draft"));
  jobs.add(piece("guest", 1, "draft"));
  jobs.add(piece("guest", 7));
  assert.equal(jobs.next().piece, 7, "the final first");
  jobs.dropDrafts("guest");
  assert.deepEqual(jobs.next(), piece("host", 1, "draft"), "the host's draft stayed");
  jobs.add(piece("host", 2, "draft"));
  jobs.add(piece("host", 3));
  jobs.dropDrafts();
  assert.deepEqual([jobs.next().piece, jobs.next()], [3, null], "every draft dropped, the final kept");
});

test("waiting pieces: a pause waits behind the finals before it, so the text before a pause is read first", () => {
  const jobs = createJobs();
  jobs.add(piece("guest", 3));
  jobs.add({ type: "pause", source: "guest", at: 12.4 });
  jobs.add(piece("host", 1, "draft"));
  jobs.add(piece("host", 1));
  const order = [];
  for (let job = jobs.next(); job; job = jobs.next()) order.push(`${job.source}${job.type}`);
  assert.deepEqual(order, ["guestfinal", "guestpause", "hostfinal"]);
});
