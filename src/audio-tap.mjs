// The audio tap: one source of sound (the host's microphone or the guest's shared tab) handed to the page in chunks,
// gathered off the page's main thread. An AudioWorklet collects the sound on the browser's audio thread and posts each
// whole chunk, so a busy page delays a chunk instead of dropping sound (the old ScriptProcessorNode ran on the main
// thread and lost sound when the page was busy). The worklet's code is part of this file, so it is pinned by the
// page's own hash: the page hands it to the browser as a blob address it makes itself, and no file is fetched. The page
// never plays a sound: the tap runs into a silent end (a stream destination, not the speakers) only so the browser
// keeps handing the sound over. Nothing leaves the computer.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** The name the worklet registers, and the frames in each chunk it posts: about 85 ms at 48 kHz, as the tap always used. */
export const TAP_NAME = "producer-tap";
export const TAP_FRAMES = 4096;

/**
 * The worklet, run on the browser's audio thread (never called on the page): it gathers the sound (128 frames at a
 * time, as the browser hands it over) into whole chunks and moves each one to the page. It keeps nothing and plays
 * nothing. A quantum that arrives with no sound at all (no channel) counts as silence, so pauses are still heard.
 */
function tapWorklet(name, chunkFrames) {
  class Tap extends AudioWorkletProcessor {
    constructor(options) {
      super();
      this.frames = options?.processorOptions?.frames || chunkFrames;
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
  registerProcessor(name, Tap);
}

/** The worklet module's text, as the browser loads it. */
export const TAP_SOURCE = `(${tapWorklet})(${JSON.stringify(TAP_NAME)}, ${TAP_FRAMES});\n`;

/**
 * createTapOpener({ AudioContext, AudioWorkletNode }) gives openTap(getStream, onChunk): getStream() asks the
 * browser for the sound (the microphone, or the tab picker) and resolves to its stream; while the browser asks, the
 * audio context starts (still inside the host's press, so the browser lets it run) and the worklet module loads, so the
 * sound flows the moment it is granted. openTap resolves to { stream, close() }. onChunk(samples, rate) gets each chunk
 * (a Float32Array the page may move on to the speech worker) with the sound's sample rate. close() lets the sound go at
 * once: no chunk on its way reaches onChunk any more, the stream's tracks stop (the browser's microphone or sharing
 * light goes out) and the audio context closes. A refused ask closes the context and rejects with the browser's error;
 * a tap that cannot be set up lets the stream go the same way and rejects.
 */
export function createTapOpener({ AudioContext, AudioWorkletNode }) {
  return async function openTap(getStream, onChunk) {
    let context;
    let module;
    try {
      context = new AudioContext();
      // A browser may start the sound paused; asking it to resume (not waiting on it) keeps the meter and the speech
      // fed. A refusal is left alone on purpose: the sound then stays paused, which the still meter shows.
      context.resume().catch(() => {});
      const url = URL.createObjectURL(new Blob([TAP_SOURCE], { type: "text/javascript" }));
      module = context.audioWorklet.addModule(url);
      // The address is let go once the module has loaded (or failed); the outcome itself is awaited below.
      module.then(() => URL.revokeObjectURL(url), () => URL.revokeObjectURL(url));
    } catch (error) {
      context?.close();
      throw error;
    }
    let stream;
    try {
      stream = await getStream();
    } catch (error) {
      context.close();
      throw error;
    }
    try {
      await module;
      const input = context.createMediaStreamSource(stream);
      // One channel in: a stereo tab is mixed down to one, as the speech model hears one voice per source.
      const node = new AudioWorkletNode(context, TAP_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: "explicit", processorOptions: { frames: TAP_FRAMES } });
      const rate = context.sampleRate;
      node.port.onmessage = ({ data }) => onChunk(data, rate);
      input.connect(node);
      node.connect(context.createMediaStreamDestination());
      let closed = false;
      return {
        stream,
        close() {
          if (closed) return;
          closed = true;
          node.port.onmessage = null;
          node.port.close();
          input.disconnect();
          for (const track of stream.getTracks()) track.stop();
          context.close();
        },
      };
    } catch (error) {
      // The sound was granted but could not be set up: let it go, so the browser's microphone or sharing light goes out.
      for (const track of stream.getTracks()) track.stop();
      context.close();
      throw error;
    }
  };
}
