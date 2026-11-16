// The audio tap's worklet: runs on the browser's audio thread, never on the page's main thread. It gathers one
// source's sound (128 frames at a time, as the browser hands it over) into whole chunks and moves each chunk to the
// page (src/audio-tap.mjs), which passes it to the speech worker and the level meter. It keeps nothing and plays
// nothing: its output stays silent. Served as is from /speech/tap-worklet.mjs (scripts/build.mjs).
// A quantum that arrives with no sound at all (no channel) counts as silence, so the speech worker still hears pauses.

/** Frames per chunk unless the page says otherwise: TAP_FRAMES of src/audio-tap.mjs. */
const FRAMES = 4096;

class Tap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.frames = options?.processorOptions?.frames || FRAMES;
    this.chunk = new Float32Array(this.frames);
    this.filled = 0;
  }

  process(inputs, outputs) {
    const sound = inputs[0]?.[0];
    const length = sound?.length ?? outputs[0]?.[0]?.length ?? 128;
    let at = 0;
    while (at < length) {
      const n = Math.min(length - at, this.frames - this.filled);
      if (sound) this.chunk.set(sound.subarray(at, at + n), this.filled);
      else this.chunk.fill(0, this.filled, this.filled + n);
      this.filled += n;
      at += n;
      if (this.filled === this.frames) {
        this.port.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Float32Array(this.frames);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("producer-tap", Tap);
