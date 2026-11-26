// Cuts 16 kHz speech into pieces for the model, by loudness. A piece starts when someone speaks (with a short
// lead-in, so the first word is whole) and ends after a short silence or at a length cap. While a piece grows, a
// draft is offered about once a second, so text shows before the speaker stops. A longer silence (about 1.5 s) is a
// pause: the moment a later card sends a cue to the host's agent. All in memory; the audio is dropped once used.
// Imported by src/speech/worker.mjs (served as is) and by the unit tests.

export const SEGMENT = {
  rate: 16000,
  frameMs: 30,
  endSilenceMs: 600,
  pauseMs: 1500,
  maxPieceMs: 12000,
  minSpeechMs: 250,
  leadMs: 240,
  tailMs: 200,
  draftEveryMs: 1000,
  minLevel: 0.008,
  overFloor: 3,
};

/** Loudness of one frame: root mean square of its samples. */
export function level(samples, from = 0, to = samples.length) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return to > from ? Math.sqrt(sum / (to - from)) : 0;
}

/**
 * push(samples) takes 16 kHz mono audio of any length and returns what it decided, in order:
 * { type: "draft" | "final", piece, audio, start, end } (start and end in seconds of the audio heard so far) and
 * { type: "pause", at }. flush() ends an open piece (Stop). Drafts are offers: the worker skips one while busy.
 * Pieces are numbered from firstPiece.
 */
export function createSegmenter({ firstPiece = 1, ...options } = {}) {
  const o = { ...SEGMENT, ...options };
  const frame = Math.round((o.rate * o.frameMs) / 1000);
  const samplesOf = (ms) => Math.round((o.rate * ms) / 1000);
  const lead = Math.ceil(samplesOf(o.leadMs) / frame);
  let carry = new Float32Array(0);
  let heard = 0;
  let floor = o.minLevel / o.overFloor;
  let recent = [];
  let piece = null;
  let lastVoice = -Infinity;
  let spokeSincePause = false;
  let nextPiece = firstPiece;

  const seconds = (n) => n / o.rate;
  const join = (chunks, length) => {
    const out = new Float32Array(length);
    let at = 0;
    for (const c of chunks) { out.set(c.subarray(0, Math.min(c.length, length - at)), at); at += c.length; if (at >= length) break; }
    return out;
  };
  const open = (start, frames) => {
    piece = { id: nextPiece++, start, chunks: frames, length: frames.reduce((n, f) => n + f.length, 0), voiced: 0, drafted: 0 };
  };
  const close = (events, keepTo) => {
    const p = piece;
    piece = null;
    if (p.voiced < samplesOf(o.minSpeechMs)) return;
    const length = Math.max(0, Math.min(p.length, keepTo - p.start));
    events.push({ type: "final", piece: p.id, audio: join(p.chunks, length), start: seconds(p.start), end: seconds(p.start + length) });
  };

  function step(f, events) {
    const loud = level(f);
    const voice = loud > Math.max(o.minLevel, floor * o.overFloor);
    // The noise floor drops quickly to a quieter frame and rises slowly (about 30 s), so steady noise is not speech.
    floor = loud < floor ? floor * 0.7 + loud * 0.3 : floor * 0.999 + loud * 0.001;
    const at = heard;
    heard += f.length;
    if (voice) {
      lastVoice = heard;
      spokeSincePause = true;
      if (!piece) {
        open(at - recent.reduce((n, r) => n + r.length, 0), [...recent, f]);
        recent = [];
      } else {
        piece.chunks.push(f);
        piece.length += f.length;
      }
      piece.voiced += f.length;
    } else if (piece) {
      piece.chunks.push(f);
      piece.length += f.length;
    } else {
      recent.push(f);
      if (recent.length > lead) recent.shift();
    }
    const silent = heard - lastVoice;
    if (piece && silent >= samplesOf(o.endSilenceMs)) close(events, lastVoice + samplesOf(o.tailMs));
    else if (piece && piece.length >= samplesOf(o.maxPieceMs)) close(events, piece.start + piece.length);
    else if (piece && voice && piece.length - piece.drafted >= samplesOf(o.draftEveryMs)) {
      piece.drafted = piece.length;
      events.push({ type: "draft", piece: piece.id, audio: join(piece.chunks, piece.length), start: seconds(piece.start), end: seconds(piece.start + piece.length) });
    }
    if (spokeSincePause && silent >= samplesOf(o.pauseMs)) {
      spokeSincePause = false;
      events.push({ type: "pause", at: seconds(lastVoice) });
    }
  }

  return {
    push(samples) {
      const events = [];
      const all = new Float32Array(carry.length + samples.length);
      all.set(carry);
      all.set(samples, carry.length);
      let at = 0;
      for (; at + frame <= all.length; at += frame) step(all.slice(at, at + frame), events);
      carry = all.slice(at);
      return events;
    },
    flush() {
      const events = [];
      if (piece) close(events, piece.start + piece.length);
      recent = [];
      carry = new Float32Array(0);
      return events;
    },
    /** Seconds of audio heard so far. */
    get heard() { return seconds(heard); },
    /** The number the next piece will get (a new segmenter after Stop starts from it). */
    get nextPiece() { return nextPiece; },
  };
}
