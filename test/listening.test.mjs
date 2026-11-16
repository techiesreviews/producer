// The listening session (src/listening.mjs): the one owner of the host's microphone, the guest's shared tab, the speech
// engine and the flags between them. The browser's pieces are passed in, so these checks drive it with fakes: a
// microphone and a tab picker that answer when told, an audio tap that hands over sound when told, a speech worker
// that answers when told and a stand-in for the browser's speech service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createListening } from "../src/listening.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fakeTrack(kind, surface) {
  const listeners = [];
  return {
    kind,
    stopped: false,
    stop() { this.stopped = true; },
    addEventListener(type, fn) { if (type === "ended") listeners.push(fn); },
    end() { for (const fn of listeners) fn(); },
    getSettings: () => (surface ? { displaySurface: surface } : {}),
  };
}

function fakeStream({ audio = true, surface = null } = {}) {
  const tracks = [...(surface ? [fakeTrack("video", surface)] : []), ...(audio ? [fakeTrack("audio")] : [])];
  return {
    tracks,
    getTracks: () => [...tracks],
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  };
}

/** A promise the check settles by hand. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup({ tabSound = { on: true }, webSpeech = { on: true, company: "Google" }, stream = "restream" } = {}) {
  const asks = { mic: [], tab: [] };
  const media = {
    // Each ask waits until the check answers it: asks.mic[i].give(stream) or .refuse(name).
    getUserMedia(constraints) {
      const d = deferred();
      asks.mic.push({ constraints, give: (s = fakeStream()) => { d.resolve(s); return s; }, refuse: (name) => d.reject(Object.assign(new Error(name), { name })) });
      return d.promise;
    },
    getDisplayMedia(options) {
      const d = deferred();
      asks.tab.push({ options, give: (s = fakeStream({ surface: "browser" })) => { d.resolve(s); return s; }, refuse: (name) => d.reject(Object.assign(new Error(name), { name })) });
      return d.promise;
    },
  };
  const taps = [];
  const openTap = async (s, onChunk) => {
    const tap = { stream: s, onChunk, closed: false, close() { this.closed = true; for (const t of s.getTracks()) t.stop(); } };
    taps.push(tap);
    return tap;
  };
  const workers = [];
  const newWorker = () => {
    const listeners = { message: [], error: [] };
    const w = {
      posted: [],
      terminated: false,
      postMessage(message, transfer) { w.posted.push({ message, transfer }); },
      addEventListener(type, fn) { listeners[type].push(fn); },
      terminate() { w.terminated = true; },
      emit(data) { for (const fn of listeners.message) fn({ data }); },
      crash() { for (const fn of listeners.error) fn({}); },
      sent: (type) => w.posted.map((p) => p.message).filter((m) => m.type === type),
    };
    workers.push(w);
    return w;
  };
  const service = { made: 0, log: [], hooks: null };
  const createService = (hooks) => {
    service.made++;
    service.hooks = hooks;
    return { start: (track) => service.log.push(["start", track]), stop: () => service.log.push(["stop"]) };
  };
  const out = { changes: 0, levels: [], texts: [], pauses: [], fails: [] };
  const picked = { stream };
  const session = createListening({
    media,
    openTap,
    newWorker,
    createService,
    features: { tabSound, webSpeech },
    stream: () => picked.stream,
    onChange: () => { out.changes++; },
    onLevel: (source, fill) => out.levels.push([source, fill]),
    onText: (piece) => out.texts.push(piece),
    onPause: (source, at) => out.pauses.push([source, at]),
    onFail: (engine, reason) => out.fails.push([engine, reason]),
  });
  return { session, asks, taps, workers, service, out, picked };
}

const chunk = (value, n = 4) => new Float32Array(n).fill(value);

/** The model on this computer, loaded and ready. */
function modelReady(t) {
  t.session.loadModel();
  t.workers.at(-1).emit({ type: "ready" });
  return t.workers.at(-1);
}

/** The setup done the usual way: guest yes, microphone on, tab shared, model ready. */
async function readySetup(t) {
  t.session.answerGuest("yes");
  const micPress = t.session.pressMic();
  t.asks.mic.at(-1).give();
  await micPress;
  const share = t.session.pressTab();
  t.asks.tab.at(-1).give();
  await share;
  return modelReady(t);
}

test("the microphone: a press turns it on (its meter moves), a second press turns it off and lets the tracks go", async () => {
  const t = setup();
  assert.equal(t.session.view().mic, false);
  const press = t.session.pressMic();
  assert.equal(t.session.view().micBusy, true, "busy while the browser asks");
  assert.equal(t.asks.mic.length, 1);
  assert.deepEqual(t.asks.mic[0].constraints, { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  t.session.pressMic();
  assert.equal(t.asks.mic.length, 1, "a second press while the browser asks does nothing");
  const stream = t.asks.mic[0].give();
  await press;
  assert.deepEqual({ mic: t.session.view().mic, busy: t.session.view().micBusy }, { mic: true, busy: false });
  t.taps[0].onChunk(chunk(0.1), 48000);
  assert.equal(t.out.levels.length, 1);
  assert.equal(t.out.levels[0][0], "host");
  assert.ok(t.out.levels[0][1] > 0, "the host's meter moves with the sound");
  await t.session.pressMic();
  assert.equal(t.session.view().mic, false);
  assert.equal(t.taps[0].closed, true, "the tap is closed");
  assert.ok(stream.tracks.every((tr) => tr.stopped), "the browser's microphone light goes out");
});

test("a refused microphone says why on the view; the next press asks again and clears it", async () => {
  const t = setup();
  let press = t.session.pressMic();
  t.asks.mic[0].refuse("NotAllowedError");
  await press;
  assert.deepEqual({ mic: t.session.view().mic, error: t.session.view().micError, busy: t.session.view().micBusy }, { mic: false, error: "NotAllowedError", busy: false });
  press = t.session.pressMic();
  assert.equal(t.session.view().micBusy, true);
  t.asks.mic[1].give();
  await press;
  assert.deepEqual({ mic: t.session.view().mic, error: t.session.view().micError }, { mic: true, error: "" });
});

test("a microphone that ends on its own (unplugged) turns off at once", async () => {
  const t = setup();
  const press = t.session.pressMic();
  const stream = t.asks.mic[0].give();
  await press;
  stream.getAudioTracks()[0].end();
  assert.equal(t.session.view().mic, false);
  assert.equal(t.taps[0].closed, true);
});

test("listening: Open starts it with the model ready; each source's sound goes to the worker under its own label, only while listening", async () => {
  const t = setup();
  const worker = await readySetup(t);
  const [micTap, tabTap] = t.taps;
  micTap.onChunk(chunk(0.1), 48000);
  assert.equal(worker.sent("audio").length, 0, "nothing goes to the worker before listening");
  t.session.open();
  assert.equal(t.session.view().listening, true);
  const samples = chunk(0.2);
  micTap.onChunk(samples, 48000);
  tabTap.onChunk(chunk(0.3), 44100);
  const audio = worker.posted.filter((p) => p.message.type === "audio");
  assert.deepEqual(audio.map((p) => [p.message.source, p.message.rate]), [["host", 48000], ["guest", 44100]], "never mixed: each labelled with its source");
  assert.equal(audio[0].message.samples, samples, "the tap's own chunk, handed on");
  assert.deepEqual(audio[0].transfer, [samples.buffer], "moved to the worker, not copied");
  assert.deepEqual(t.out.levels.map(([source]) => source), ["host", "host", "guest"], "both meters move");
});

test("listening needs the microphone and a ready engine: without the model the sign stays off", async () => {
  const t = setup();
  t.session.answerGuest("solo");
  const press = t.session.pressMic();
  t.asks.mic[0].give();
  await press;
  t.session.open();
  assert.equal(t.session.view().listening, false, "no model yet");
  assert.equal(t.session.view().speech, false);
  modelReady(t);
  assert.equal(t.session.view().speech, true);
  t.session.open();
  assert.equal(t.session.view().listening, true);
});

test("Stop ends listening at once: the microphone and the guest tab go, the worker hears both stop, and the flags reset", async () => {
  const t = setup();
  const worker = await readySetup(t);
  t.session.open();
  await t.session.pressListen(); // listening: the press is Stop
  const v = t.session.view();
  assert.deepEqual({ mic: v.mic, tab: v.tab, listening: v.listening, tabPhase: v.tabPhase }, { mic: false, tab: false, listening: false, tabPhase: "idle" });
  assert.ok(t.taps.every((tap) => tap.closed), "both taps closed");
  assert.deepEqual(worker.sent("stop").map((m) => m.source), ["host", "guest"]);
  assert.equal(t.asks.tab.length, 1);
  // Listen asks for both again: the tab picker opens straight from the press, beside the microphone.
  const listen = t.session.pressListen();
  assert.equal(t.session.view().listen.phase, "busy");
  assert.equal(t.asks.tab.length, 2, "the tab is asked for again");
  assert.equal(t.asks.mic.length, 2);
  t.asks.mic[1].give();
  await listen;
  assert.deepEqual({ mic: t.session.view().mic, listening: t.session.view().listening, phase: t.session.view().listen.phase }, { mic: true, listening: true, phase: "idle" });
  t.asks.tab[1].give();
  await settle();
  assert.equal(t.session.view().tab, true, "the tab joins once picked");
});

test("the guest tab: shared from its button, stopped by a second press; a tab that ends while listening is asked for again on Listen", async () => {
  const t = setup();
  const worker = await readySetup(t);
  assert.deepEqual({ tab: t.session.view().tab, phase: t.session.view().tabPhase }, { tab: true, phase: "on" });
  const options = t.asks.tab[0].options;
  assert.equal(options.systemAudio, "exclude");
  assert.equal(options.selfBrowserSurface, "exclude");
  assert.deepEqual(options.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false });
  t.session.pressTab();
  assert.equal(t.session.view().tab, false);
  assert.equal(t.taps[1].closed, true);
  assert.deepEqual(worker.sent("stop").map((m) => m.source), ["guest"]);
  // Shared again, then ended from the browser's own bar while listening.
  const share = t.session.pressTab();
  t.asks.tab[1].give();
  await share;
  t.session.open();
  t.taps[2].stream.getVideoTracks()[0].end();
  assert.equal(t.session.view().tab, false);
  await t.session.pressListen(); // Stop
  const listen = t.session.pressListen();
  assert.equal(t.asks.tab.length, 3, "Listen asks for the tab again");
  t.asks.mic.at(-1).give();
  await listen;
});

test("a tab that ends while not listening is not asked for again", async () => {
  const t = setup();
  await readySetup(t);
  t.taps[1].stream.getAudioTracks()[0].end();
  t.session.open();
  await t.session.pressListen(); // Stop
  const listen = t.session.pressListen();
  assert.equal(t.asks.tab.length, 1);
  t.asks.mic.at(-1).give();
  await listen;
});

test("the tab picker's failures show on the button; a window or a tab without sound is let go", async () => {
  const t = setup();
  t.session.answerGuest("yes");
  let share = t.session.pressTab();
  assert.equal(t.session.view().tabPhase, "busy");
  t.session.pressTab();
  assert.equal(t.asks.tab.length, 1, "a press while the picker is open does nothing");
  t.asks.tab[0].refuse("NotAllowedError");
  await share;
  assert.deepEqual({ phase: t.session.view().tabPhase, problem: t.session.view().tabFailure }, { phase: "error", problem: "NotAllowedError" });
  share = t.session.pressTab();
  const window = t.asks.tab[1].give(fakeStream({ surface: "window" }));
  await share;
  assert.deepEqual({ phase: t.session.view().tabPhase, problem: t.session.view().tabFailure }, { phase: "error", problem: "NotATab" });
  assert.ok(window.tracks.every((tr) => tr.stopped));
  share = t.session.pressTab();
  const silent = t.asks.tab[2].give(fakeStream({ audio: false, surface: "browser" }));
  await share;
  assert.equal(t.session.view().tabFailure, "NoTabSound");
  assert.ok(silent.tracks.every((tr) => tr.stopped));
  assert.equal(t.taps.length, 0, "no tap was opened for any of them");
});

test("a guest who says no, or a solo show, stops a shared tab, and a tab picked after the answer is let go", async () => {
  const t = setup();
  await readySetup(t);
  t.session.answerGuest("no");
  assert.equal(t.session.view().tab, false);
  assert.equal(t.taps[1].closed, true);
  assert.equal(t.session.tabView().off, true, "the tab button is switched off with the reason");
  // Yes again, the picker opens, and the host says Solo show while it is open.
  t.session.answerGuest("yes");
  const share = t.session.pressTab();
  t.session.answerGuest("solo");
  assert.equal(t.session.view().tabPhase, "idle");
  const late = t.asks.tab[1].give();
  await share;
  assert.equal(t.session.view().tab, false, "the late tab is not kept");
  assert.ok(t.taps.at(-1).closed && late.tracks.every((tr) => tr.stopped), "and its sharing light goes out");
});

test("OBS has no studio tab: picking it stops a shared tab", async () => {
  const t = setup();
  await readySetup(t);
  t.picked.stream = "obs";
  t.session.streamChanged();
  assert.equal(t.session.view().tab, false);
  assert.equal(t.taps[1].closed, true);
  assert.equal(t.session.tabView().off, true);
});

test("speech results flow: the worker's progress and ready show on the view, its text and pauses go to the page", async () => {
  const t = setup();
  t.session.loadModel();
  const worker = t.workers[0];
  assert.deepEqual(worker.sent("load"), [{ type: "load" }]);
  assert.deepEqual(t.session.view().model, { phase: "loading", percent: 0, reason: "" });
  t.session.loadModel();
  assert.equal(t.workers.length, 1, "one worker");
  worker.emit({ type: "progress", loaded: 41, total: 82 });
  assert.equal(t.session.view().model.percent, 50);
  worker.emit({ type: "ready" });
  assert.equal(t.session.view().model.phase, "ready");
  const piece = { type: "text", source: "guest", piece: 3, final: true, text: "Hello there", start: 1, end: 2 };
  worker.emit(piece);
  worker.emit({ type: "pause", source: "guest", at: 3.5 });
  assert.deepEqual(t.out.texts, [piece]);
  assert.deepEqual(t.out.pauses, [["guest", 3.5]]);
});

test("a model that fails: the page hears it first, the worker is ended, the view says why and the model can be loaded again", async () => {
  const t = setup();
  await readySetup(t);
  t.session.open();
  const worker = t.workers[0];
  worker.emit({ type: "error", reason: "out of memory" });
  assert.deepEqual(t.out.fails, [["local", "out of memory"]]);
  assert.equal(worker.terminated, true);
  assert.deepEqual(t.session.view().model, { phase: "error", percent: 0, reason: "out of memory" });
  assert.equal(t.session.view().speech, false);
  worker.emit({ type: "text", source: "host", piece: 1, final: true, text: "late", start: 0, end: 1 });
  assert.equal(t.out.texts.length, 0, "nothing from the ended worker");
  t.session.loadModel();
  assert.equal(t.workers.length, 2);
  t.workers[1].crash();
  assert.equal(t.session.view().model.reason, "the speech worker could not start");
});

test("the browser's speech service: picked, it lets the tab go and hears the host's microphone track; its text is the host's", async () => {
  const t = setup();
  await readySetup(t);
  t.session.pickEngine("browser");
  assert.equal(t.session.view().engine, "browser");
  assert.equal(t.session.view().tab, false, "the guest tab is let go");
  assert.equal(t.taps[1].closed, true);
  assert.equal(t.session.tabView().off, true);
  assert.equal(t.session.view().speech, true, "nothing to download");
  t.session.open();
  assert.equal(t.session.view().listening, true);
  const track = t.taps[0].stream.getAudioTracks()[0];
  assert.deepEqual(t.service.log, [["start", track]]);
  t.taps[0].onChunk(chunk(0.2), 48000);
  assert.equal(t.workers[0].sent("audio").length, 0, "the model gets no sound while the service is used");
  t.service.hooks.onText({ piece: 1, final: true, text: "Hi", start: 0, end: 1 });
  t.service.hooks.onPause(2);
  assert.deepEqual(t.out.texts, [{ piece: 1, final: true, text: "Hi", start: 0, end: 1, source: "host" }]);
  assert.deepEqual(t.out.pauses, [["host", 2]]);
});

test("a browser without the service stays on the model", () => {
  const t = setup({ webSpeech: { on: false, reason: "none" } });
  t.session.pickEngine("browser");
  assert.equal(t.session.view().engine, "local");
});

test("the service's failure: the page hears it first, then the model is picked again with the reason kept until the service is picked again", async () => {
  const t = setup();
  await readySetup(t);
  t.session.pickEngine("browser");
  t.session.open();
  const seen = [];
  t.service.hooks.onFail("the browser blocked its speech service");
  seen.push(t.session.view().engine);
  assert.deepEqual(t.out.fails, [["browser", "the browser blocked its speech service"]]);
  assert.deepEqual(seen, ["local"]);
  assert.equal(t.session.view().serviceFailure, "the browser blocked its speech service");
  assert.ok(t.service.log.some(([what]) => what === "stop"), "the service is stopped");
  t.session.pickEngine("browser");
  assert.equal(t.session.view().serviceFailure, "");
});

test("a Listen whose microphone fails says so on Listen; a tab picked meanwhile is let go and asked for again next time", async () => {
  const t = setup();
  await readySetup(t);
  t.session.open();
  await t.session.pressListen(); // Stop
  const listen = t.session.pressListen();
  t.asks.mic.at(-1).refuse("NotFoundError");
  await listen;
  assert.deepEqual(t.session.view().listen, { phase: "error", error: "NotFoundError" });
  assert.equal(t.session.view().micError, "NotFoundError");
  t.asks.tab.at(-1).give();
  await settle();
  assert.equal(t.session.view().tab, false, "no microphone, so the tab is let go");
  assert.equal(t.taps.at(-1).closed, true);
  const again = t.session.pressListen();
  assert.equal(t.asks.tab.length, 3, "and asked for again");
  t.asks.mic.at(-1).give();
  await again;
  assert.deepEqual(t.session.view().listen, { phase: "idle", error: "" });
  t.session.open();
  assert.equal(t.session.view().listen.phase, "idle");
});

test("End & report: everything stops, and a microphone the browser grants after End is let go at once", async () => {
  const t = setup();
  const worker = await readySetup(t);
  t.session.open();
  await t.session.pressListen(); // Stop
  const listen = t.session.pressListen();
  t.session.end();
  const late = t.asks.mic.at(-1).give();
  await listen;
  assert.equal(t.session.view().mic, false);
  assert.equal(t.session.view().listening, false);
  assert.ok(late.tracks.every((tr) => tr.stopped), "the late microphone is let go");
  assert.equal(t.session.view().tab, false);
  assert.ok(worker.sent("stop").length >= 2);
});

test("every change is told to the page", async () => {
  const t = setup();
  const before = t.out.changes;
  t.session.answerGuest("yes");
  assert.ok(t.out.changes > before);
  const after = t.out.changes;
  const press = t.session.pressMic();
  t.asks.mic[0].give();
  await press;
  assert.ok(t.out.changes >= after + 2, "busy, then on");
});
