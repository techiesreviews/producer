// The audio tap: one source of sound (the host's microphone or the guest's shared tab) handed to the page in chunks,
// gathered off the page's main thread. An AudioWorklet (src/speech/tap-worklet.mjs, served from this site) collects
// the sound on the browser's audio thread and posts each whole chunk, so a busy page delays a chunk instead of
// dropping sound (the old ScriptProcessorNode ran on the main thread and lost sound when the page was busy). The page
// never plays a sound: the tap runs into a silent end (a stream destination, not the speakers) only so the browser
// keeps handing the sound over. Nothing leaves the computer.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** Where the worklet module is served (the build copies src/speech/tap-worklet.mjs there) and the name it registers. */
export const TAP_URL = "/speech/tap-worklet.mjs";
export const TAP_NAME = "producer-tap";
/** Frames in each chunk the worklet posts: about 85 ms at 48 kHz, as the page's tap always used. */
export const TAP_FRAMES = 4096;

/**
 * createTapOpener({ AudioContext, AudioWorkletNode, url }) gives openTap(getStream, onChunk): getStream() asks the
 * browser for the sound (the microphone, or the tab picker) and resolves to its stream; while the browser asks, the
 * audio context starts (still inside the host's press, so the browser lets it run) and the worklet module loads, so the
 * sound flows the moment it is granted. openTap resolves to { stream, close() }. onChunk(samples, rate) gets each chunk
 * (a Float32Array the page may move on to the speech worker) with the sound's sample rate. close() lets the sound go at
 * once: no chunk on its way reaches onChunk any more, the stream's tracks stop (the browser's microphone or sharing
 * light goes out) and the audio context closes. A refused ask closes the context and rejects with the browser's error;
 * a tap that cannot be set up lets the stream go the same way and rejects.
 */
export function createTapOpener({ AudioContext, AudioWorkletNode, url = TAP_URL }) {
  return async function openTap(getStream, onChunk) {
    let context;
    let module;
    try {
      context = new AudioContext();
      // A browser may start the sound paused; asking it to resume (not waiting on it) keeps the meter and the speech
      // fed. A refusal is left alone on purpose: the sound then stays paused, which the still meter shows.
      context.resume().catch(() => {});
      module = context.audioWorklet.addModule(url);
      module.catch(() => {}); // awaited below, once the sound is granted
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
