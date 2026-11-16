// The microphone's and the tab's sound off the page's main thread: the audio tap (src/audio-tap.mjs) sets up an
// AudioWorklet for one source, and the worklet (src/speech/tap-worklet.mjs) gathers the sound into chunks on the
// browser's audio thread and posts each chunk to the page. Checked here against a fake AudioContext and a fake
// worklet scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTapOpener, TAP_FRAMES, TAP_NAME, TAP_URL } from "../src/audio-tap.mjs";

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { tracks, getTracks: () => [...tracks] };
}

/** An AudioContext and AudioWorkletNode pair that remember what was asked of them. */
function fakeAudio({ addModule = async () => {} } = {}) {
  const log = [];
  const destination = { kind: "speakers" };
  class AudioContext {
    constructor() { this.sampleRate = 48000; this.destination = destination; this.closed = false; AudioContext.made.push(this); log.push("context"); }
    resume() { log.push("resume"); return Promise.resolve(); }
    close() { this.closed = true; log.push("close"); return Promise.resolve(); }
    createMediaStreamSource(stream) {
      log.push("source");
      return { stream, connect(node) { log.push(["connect source", node.kind]); this.to = node; }, disconnect() { log.push("disconnect source"); } };
    }
    createMediaStreamDestination() { return { kind: "silent end" }; }
  }
  AudioContext.made = [];
  AudioContext.prototype.audioWorklet = { addModule: (url) => { log.push(["addModule", url]); return addModule(url); } };
  class AudioWorkletNode {
    constructor(context, name, options) {
      log.push(["node", name]);
      Object.assign(this, { context, name, options, kind: "tap" });
      this.port = { onmessage: null, closed: false, close() { this.closed = true; } };
      AudioWorkletNode.made.push(this);
    }
    connect(target) { log.push(["connect tap", target.kind]); this.to = target; }
  }
  AudioWorkletNode.made = [];
  return { AudioContext, AudioWorkletNode, log };
}

test("a tap: the worklet module loads from this site first, then the source runs through it into a silent end, never the speakers", async () => {
  const audio = fakeAudio();
  const open = createTapOpener(audio);
  const stream = fakeStream();
  const tap = await open(stream, () => {});
  assert.equal(TAP_URL, "/speech/tap-worklet.mjs");
  assert.deepEqual(audio.log, ["context", "resume", ["addModule", TAP_URL], "source", ["node", TAP_NAME], ["connect source", "tap"], ["connect tap", "silent end"]]);
  const [node] = audio.AudioWorkletNode.made;
  assert.deepEqual(node.options, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit", processorOptions: { frames: TAP_FRAMES } });
  assert.equal(tap.stream, stream);
});

test("each chunk the worklet posts reaches the page with the sound's rate; after close nothing more does", async () => {
  const audio = fakeAudio();
  const got = [];
  const stream = fakeStream();
  const tap = await createTapOpener(audio)(stream, (samples, rate) => got.push([samples, rate]));
  const [node] = audio.AudioWorkletNode.made;
  const chunk = new Float32Array(TAP_FRAMES);
  node.port.onmessage({ data: chunk });
  assert.deepEqual(got, [[chunk, 48000]]);
  tap.close();
  assert.equal(node.port.onmessage, null, "a message already on its way is dropped");
  assert.equal(node.port.closed, true);
  assert.equal(stream.tracks[0].stopped, true, "the browser's light goes out");
  assert.equal(audio.AudioContext.made[0].closed, true);
  tap.close();
  assert.equal(audio.log.filter((e) => e === "close").length, 1, "a second close does nothing");
});

test("a tap that cannot be set up lets the sound go and says why", async () => {
  const audio = fakeAudio({ addModule: async () => { throw new Error("blocked"); } });
  const stream = fakeStream();
  await assert.rejects(createTapOpener(audio)(stream, () => {}), /blocked/);
  assert.equal(stream.tracks[0].stopped, true);
  assert.equal(audio.AudioContext.made[0].closed, true);
});

/** The worklet file run in a fake worklet scope: its registered processor class and every message it posts. */
async function loadWorklet() {
  const registered = {};
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { sent: [], postMessage(data, transfer) { this.sent.push({ data, transfer }); } }; } };
  globalThis.registerProcessor = (name, cls) => { registered[name] = cls; };
  await import(`../src/speech/tap-worklet.mjs?${Math.random()}`);
  delete globalThis.AudioWorkletProcessor;
  delete globalThis.registerProcessor;
  return registered;
}

const quantum = (from, n = 128) => Float32Array.from({ length: n }, (_, i) => from + i);

test("the worklet gathers the sound on the audio thread into whole chunks and moves each one to the page", async () => {
  const registered = await loadWorklet();
  assert.deepEqual(Object.keys(registered), [TAP_NAME]);
  const tap = new registered[TAP_NAME]({ processorOptions: { frames: 300 } });
  const output = [[new Float32Array(128)]];
  for (let q = 0; q < 5; q++) assert.equal(tap.process([[quantum(q * 128)]], output), true, "it keeps running");
  // 5 × 128 = 640 frames: two whole chunks of 300, 40 frames waiting for the next.
  assert.equal(tap.port.sent.length, 2);
  const [first, second] = tap.port.sent;
  assert.deepEqual([...first.data], Array.from({ length: 300 }, (_, i) => i));
  assert.deepEqual([...second.data], Array.from({ length: 300 }, (_, i) => 300 + i), "no frame lost or doubled across quanta");
  assert.deepEqual(first.transfer, [first.data.buffer], "moved, not copied");
  assert.notEqual(first.data.buffer, second.data.buffer, "each chunk is its own");
});

test("the worklet counts a quantum with no sound as silence, so pauses are still heard", async () => {
  const registered = await loadWorklet();
  const tap = new registered[TAP_NAME]({ processorOptions: { frames: 256 } });
  const output = [[new Float32Array(128)]];
  tap.process([[]], output);
  tap.process([[]], output);
  assert.equal(tap.port.sent.length, 1);
  assert.deepEqual([...tap.port.sent[0].data], Array(256).fill(0));
});

test("the worklet's chunk defaults to the page's size", async () => {
  const registered = await loadWorklet();
  const tap = new registered[TAP_NAME]({});
  const output = [[new Float32Array(128)]];
  for (let q = 0; q < TAP_FRAMES / 128; q++) tap.process([[quantum(0)]], output);
  assert.equal(tap.port.sent.length, 1);
  assert.equal(tap.port.sent[0].data.length, TAP_FRAMES);
});
