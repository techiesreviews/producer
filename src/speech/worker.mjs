// The speech worker: turns the microphone's sound into text inside this browser, off the page's own thread.
// Served as is from /speech/worker.mjs with its own policy (scripts/build.mjs): it may load scripts and files from
// this site only, and nothing else. The sound never leaves the computer: it arrives from the page as numbers,
// is cut into pieces (segmenter.mjs), read by the model and dropped. Only text goes back to the page.
// The model and its engine come from this site once (manifest.json lists every file and its parts), are checked
// against their SHA-256 and kept in the browser's cache, so a later visit loads without downloading.
//
// One stream per source: "host" (the microphone) and "guest" (the shared tab), kept apart in lanes.mjs and never mixed.
// Page -> worker: { type: "load" }, { type: "audio", source, samples: Float32Array, rate },
//   { type: "stop" } (every source) or { type: "stop", source }.
// Worker -> page: { type: "progress", loaded, total }, { type: "ready" }, { type: "error", reason },
//   { type: "text", source, piece, final, text, start, end } and { type: "pause", source, at }.
// Times are seconds of the sound that source has delivered since it last started.
import { guardRepeats } from "./repeat.mjs";
import { createJobs, createLanes } from "./lanes.mjs";

const CACHE_PREFIX = "producer-speech-";
const MODEL_ID = "speech/model";
const here = (path) => new URL(path, self.location.href).href;

let asr = null;
let loading = null;
const lanes = createLanes();
const jobs = createJobs();
let busy = false;

const post = (message) => self.postMessage(message);

async function sha256(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The model and the engine's WebAssembly go in the cache; the engine's scripts are imported like any script. */
const cached = (file) => !/\.m?js$/.test(file.path);

/** Every cached file of the manifest in the cache, downloading only what is missing; progress counts bytes. */
async function fillCache(manifest) {
  const cache = await caches.open(CACHE_PREFIX + manifest.version);
  // An older model version is removed, so the browser keeps one copy only.
  for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== CACHE_PREFIX + manifest.version) await caches.delete(name);
  const files = manifest.files.filter(cached);
  const total = files.reduce((n, f) => n + f.size, 0);
  let loaded = 0;
  let shown = -1;
  const report = () => {
    const step = Math.floor((loaded / total) * 100);
    if (step !== shown) { shown = step; post({ type: "progress", loaded, total }); }
  };
  for (const file of files) {
    if (!file.parts.length) throw new Error("the speech model is missing on this site");
    const url = here(file.path);
    if (await cache.match(url)) { loaded += file.size; report(); continue; }
    const whole = new Uint8Array(file.size);
    let at = 0;
    for (const part of file.parts) {
      const response = await fetch(here(part), { cache: "no-store" });
      if (!response.ok) throw new Error(`could not download the speech model (${response.status})`);
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (at + value.length > whole.length) throw new Error("a speech model file is larger than expected");
        whole.set(value, at);
        at += value.length;
        loaded += value.length;
        report();
      }
    }
    if (at !== file.size || (await sha256(whole)) !== file.sha256) throw new Error("a speech model file did not download completely");
    await cache.put(url, new Response(whole, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(file.size) } }));
  }
  return cache;
}

async function load() {
  const response = await fetch(here("manifest.json"), { cache: "no-store" });
  if (!response.ok) throw new Error(`could not download the speech model (${response.status})`);
  const manifest = await response.json();
  const cache = await fillCache(manifest);
  // The processor-only engine: given to the model library before it loads, so the library uses it.
  const ort = await import("./vendor/ort.wasm.min.mjs");
  ort.env.wasm.wasmPaths = { mjs: here("vendor/ort-wasm-simd-threaded.mjs") };
  ort.env.wasm.wasmBinary = await (await cache.match(here("vendor/ort-wasm-simd-threaded.wasm"))).arrayBuffer();
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) >> 1)) : 1;
  ort.env.wasm.proxy = false;
  globalThis[Symbol.for("onnxruntime")] = ort;
  const { env, pipeline } = await import("./vendor/transformers.min.js");
  // Files come only from the cache filled above: the library's own download answers every miss with a 404, so it
  // never fetches anything, from this site or elsewhere.
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.remoteHost = here("/");
  env.remotePathTemplate = "{model}/";
  env.useBrowserCache = false;
  env.useWasmCache = false;
  env.useCustomCache = true;
  env.customCache = { match: (key) => cache.match(String(key)), put: async () => {} };
  env.fetch = async () => new Response(null, { status: 404 });
  // The engine above runs on the processor only. Handed an engine, the library keeps no list of devices of its own,
  // so it is asked for "auto" (no check against that empty list) and told the processor in the session options.
  asr = await pipeline("automatic-speech-recognition", MODEL_ID, { device: "auto", dtype: "q8", session_options: { executionProviders: ["wasm"] } });
  // One short warm-up, so the first real piece is not slow.
  await asr(new Float32Array(16000), { max_new_tokens: 4 });
}

async function transcribe(job) {
  const seconds = job.audio.length / 16000;
  const result = await asr(job.audio, { max_new_tokens: Math.max(8, Math.ceil(seconds * 6.5)) });
  return guardRepeats(result.text);
}

/** One piece at a time: every final in order; a draft only when no final waits (see createJobs). */
async function pump() {
  if (busy || !asr) return;
  busy = true;
  try {
    for (;;) {
      const job = jobs.next();
      if (!job) break;
      const text = await transcribe(job);
      if (text) post({ type: "text", source: job.source, piece: job.piece, final: job.type === "final", text, start: job.start, end: job.end });
    }
  } finally {
    busy = false;
  }
}

function take(events) {
  for (const e of events) {
    if (e.type === "pause") post({ type: "pause", source: e.source, at: e.at });
    else jobs.add(e);
  }
  pump().catch((error) => post({ type: "error", reason: String(error?.message || error) }));
}

self.onmessage = ({ data }) => {
  if (data.type === "load") {
    loading ??= load().then(
      () => post({ type: "ready" }),
      (error) => { loading = null; post({ type: "error", reason: String(error?.message || error) }); },
    );
  } else if (data.type === "audio") {
    if (!asr) return;
    take(lanes.push(data.source, data.samples, data.rate));
  } else if (data.type === "stop") {
    take(lanes.stop(data.source));
    jobs.dropDrafts(data.source);
  }
};
