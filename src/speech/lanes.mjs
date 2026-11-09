// One lane per source of sound: "host" (the microphone) and "guest" (the shared tab). Each lane has its own cutting
// into pieces (segmenter.mjs), its own resampler (a microphone and a tab can run at different rates) and its own piece
// numbers, so the two voices are never mixed: a piece is always one source's sound, and it comes back labelled with
// that source. All in memory. Imported by src/speech/worker.mjs (served as is) and by the unit tests.
// createJobs is the queue of pieces waiting to be read, across the sources.
import { createResampler } from "./resample.mjs";
import { createSegmenter } from "./segmenter.mjs";

/** The sources the page may name. Anything else is ignored. */
export const SOURCES = ["host", "guest"];

export function createLanes() {
  const lanes = new Map();
  const lane = (source) => {
    if (!lanes.has(source)) lanes.set(source, { segmenter: null, resample: null, rate: 0, nextPiece: 1 });
    return lanes.get(source);
  };
  const label = (source, events) => events.map((e) => ({ ...e, source }));

  return {
    /** Sound from one source (any length, at its own sample rate): what the lane decided, each event labelled. */
    push(source, samples, rate) {
      if (!SOURCES.includes(source)) return [];
      const l = lane(source);
      // Piece numbers go on across Stop, so a late piece from before a Stop never shares a number with a new one.
      if (!l.segmenter) l.segmenter = createSegmenter({ firstPiece: l.nextPiece });
      if (rate !== l.rate) { l.resample = createResampler(rate); l.rate = rate; }
      return label(source, l.segmenter.push(l.resample(samples)));
    },
    /** Stop one source (its open piece ends), or every source when none is named. */
    stop(source) {
      const events = [];
      for (const name of source === undefined ? [...lanes.keys()] : SOURCES.includes(source) ? [source] : []) {
        const l = lanes.get(name);
        if (!l?.segmenter) continue;
        events.push(...label(name, l.segmenter.flush()));
        l.nextPiece = l.segmenter.nextPiece;
        l.segmenter = null;
        l.rate = 0;
      }
      return events;
    },
  };
}

/**
 * The pieces waiting for the model, whatever their source: every final comes out in the order it came; a draft is only
 * an offer, so each source keeps just its newest one, and the oldest waiting draft comes out when no final waits.
 * A pause waits in the same line as the finals, so it comes out after the text heard before it.
 */
export function createJobs() {
  const finals = [];
  const drafts = new Map();
  return {
    add(event) {
      if (event.type === "pause") finals.push(event);
      else if (event.type === "final") {
        if (drafts.get(event.source)?.piece === event.piece) drafts.delete(event.source);
        finals.push(event);
      } else {
        // A newer draft of the same source replaces the old one and goes to the back of the line.
        drafts.delete(event.source);
        drafts.set(event.source, event);
      }
    },
    next() {
      if (finals.length) return finals.shift();
      for (const [source, job] of drafts) { drafts.delete(source); return job; }
      return null;
    },
    /** Drop the waiting drafts of one source, or of every source; finals stay (a Stop turns an open piece into one). */
    dropDrafts(source) {
      if (source === undefined) drafts.clear(); else drafts.delete(source);
    },
  };
}
