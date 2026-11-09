// The browser's own speech service (the Web Speech API) as a second way to turn the microphone into text. It is
// opt-in and clearly warned: the browser sends the sound to its maker's service to do it (Google, Microsoft or Apple;
// src/browser.mjs says which), so it is never on unless the host picks it. It is given the track of the microphone the
// page already holds (a browser that ignores the track opens its own microphone instead), and hands text on in the same shape the speech model's worker posts ({ piece, final, text,
// start, end }, times in seconds since listening began; start is when the first words of the piece arrived, so it
// runs late by the service's own delay), so the page treats both alike. The service may split one unfinished
// sentence over several results; they are joined into one draft, as the model's worker has one draft at a time.
// Nothing is kept here: a draft lives only until it is final, and the page keeps no sound.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** A session that ends sooner than this counts as a quick ending; this many in a row is a service that keeps stopping. */
const QUICK_MS = 1000;
const QUICK_LIMIT = 6;

/** Why a session failed, in plain words for the choice's tooltip. Silence and an abort are no failures. */
const FAILURES = {
  "not-allowed": "the browser blocked its speech service",
  "service-not-allowed": "the browser blocked its speech service",
  network: "the browser's speech service could not be reached",
  "audio-capture": "the microphone could not be used",
  "language-not-supported": "the browser's speech service does not do English here",
};
const QUIET = new Set(["no-speech", "aborted"]);
const FALLBACK = "the browser's speech service stopped";

/**
 * @param {object} options
 * @param {Function} options.Recognition the browser's SpeechRecognition (or webkitSpeechRecognition) class
 * @param {() => number} [options.now] milliseconds, as performance.now
 * @param {(piece: {piece: number, final: boolean, text: string, start: number, end: number}) => void} options.onText
 * @param {(reason: string) => void} options.onFail a failure the service will not recover from; listening has stopped
 * @param {(at: number) => void} [options.onPause] about 1.5 s after the last words (seconds since Listen), as the speech
 *   model's worker reports a pause: the page's cues go at pauses
 * @param {number} [options.pauseMs]
 * @param {Function} [options.setTimer] setTimeout, replaceable for checks
 * @param {Function} [options.clearTimer] clearTimeout
 */
export function createBrowserSpeech({ Recognition, now = () => performance.now(), onText, onFail, onPause = () => {}, pauseMs = 1500, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let track = null;
  let session = null;
  let listening = false;
  let epoch = null;
  let lastAt = null; // when the previous result event with text arrived (seconds since Listen)
  let quick = 0;
  // Piece numbers go on across sessions, so a piece never shares a number with an older one.
  let nextPiece = 1;
  const seconds = () => (now() - epoch) / 1000;
  // The pause: words stopped for pauseMs. It is armed by every piece of text and does not depend on a session, so a
  // session the browser restarts does not lose it.
  let pauseTimer = null;
  const dropPause = () => { clearTimer(pauseTimer); pauseTimer = null; };
  const armPause = () => {
    clearTimer(pauseTimer);
    pauseTimer = setTimer(() => { pauseTimer = null; if (listening) onPause(seconds()); }, pauseMs);
  };
  /** Text goes on to the page, and the pause starts counting from it. */
  let handedOn = 0;
  const say = (piece) => { handedOn++; onText(piece); armPause(); };

  /** Let a session go: no more of its events reach us, and the service is told to drop what it has. */
  function release(s) {
    s.service.onresult = s.service.onerror = s.service.onend = null;
    try { s.service.abort(); } catch { /* already over */ }
  }

  function fail(reason) {
    listening = false;
    const s = session;
    session = null;
    if (s) { flush(s); release(s); }
    dropPause(); // a failure reports no pause
    onFail(reason);
  }

  /** What an ended session still holds as a draft becomes a final piece, so no words are lost to a restart. */
  function flush(s) {
    const draft = s.draft;
    s.draft = null;
    // It ends where the draft last grew (the quiet since then is not speech), and it arms no pause: the draft's own
    // pause is already on its way, or has come.
    if (draft) onText({ piece: draft.piece, final: true, text: draft.text, start: draft.start, end: draft.end });
  }

  /**
   * Hand on the finished lines of one event. The first takes the draft's piece number and start, if there is a draft. A
   * line with no draft before it gets the time it took to say (about 2.5 words a second); the lines of one event share
   * the time since the last words arrived end to end, scaled down to fit, so they never overlap and never count more
   * speech than the time that passed (the cues add up speech time from each line's start to its end).
   */
  function handOn(s, texts) {
    const at = seconds();
    const spoken = (text) => (text ? text.split(" ").length / 2.5 : 0);
    const draft = s.draft;
    s.draft = null;
    const lines = [];
    let rest = texts;
    let cursor = null;
    if (draft) {
      const [first, ...others] = texts;
      const end = others.length ? Math.min(at, draft.start + spoken(first)) : at;
      if (first) lines.push({ piece: draft.piece, final: true, text: first, start: draft.start, end });
      cursor = first ? end : draft.start;
      rest = others;
    }
    const total = rest.reduce((sum, text) => sum + spoken(text), 0);
    if (total > 0) {
      const room = at - (cursor ?? lastAt ?? -Infinity);
      const take = Math.min(total, room);
      let from = at - take;
      for (const text of rest) {
        if (!text) continue;
        const length = (spoken(text) / total) * take;
        lines.push({ piece: nextPiece++, final: true, text, start: from, end: from + length });
        from += length;
      }
    }
    for (const line of lines) say(line);
  }

  function begin() {
    let service;
    try {
      service = new Recognition();
    } catch {
      fail("the browser's speech service could not start");
      return;
    }
    service.lang = "en-US";
    service.continuous = true;
    service.interimResults = true;
    service.maxAlternatives = 1;
    // finals: the words of each finished result of this session already handed on, by place in the list (finished ones
    // come first).
    const s = { service, draft: null, finals: [], startedAt: now() };
    session = s;
    service.onresult = (event) => {
      if (session !== s) return;
      const before = handedOn;
      const arrived = seconds();
      try {
        readResults(event);
      } finally {
        if (handedOn > before) lastAt = arrived;
      }
    };
    const readResults = (event) => {
      const { results } = event;
      const words = (i) => String(results[i][0]?.transcript ?? "").replace(/\s+/g, " ").trim();
      let done = 0;
      while (done < results.length && results[done].isFinal === true) done++;
      // Finished results not yet handed on. A finished result is new when its place has not been handed on yet or now
      // holds other words, which also catches a list that starts over at any length; a list that only repeats what was
      // handed on writes nothing twice.
      const fresh = [];
      for (let i = 0; i < done; i++) {
        const text = words(i);
        if (s.finals[i] === text) continue;
        s.finals[i] = text;
        fresh.push(text);
      }
      if (fresh.length) handOn(s, fresh);
      // Everything unfinished is one draft: its parts joined, one piece number, gone when it has no words left.
      const text = [...Array(Math.max(0, results.length - done)).keys()].map((k) => words(done + k)).filter(Boolean).join(" ");
      if (!text) { s.draft = null; return; }
      if (s.draft?.text === text) return;
      s.draft = { piece: s.draft?.piece ?? nextPiece++, start: s.draft?.start ?? seconds(), end: seconds(), text };
      say({ piece: s.draft.piece, final: false, text, start: s.draft.start, end: seconds() });
    };
    service.onerror = (event) => {
      if (session !== s || QUIET.has(event.error)) return;
      fail(FAILURES[event.error] ?? FALLBACK);
    };
    service.onend = () => {
      if (session !== s) return;
      flush(s);
      release(s);
      session = null;
      if (!listening) return;
      quick = now() - s.startedAt < QUICK_MS ? quick + 1 : 0;
      if (quick >= QUICK_LIMIT) { fail("the browser's speech service keeps stopping"); return; }
      begin();
    };
    try {
      service.start(track);
    } catch {
      fail("the browser's speech service could not start");
    }
  }

  return {
    get listening() { return listening; },
    /** Start listening to this microphone track; a start while listening does nothing. */
    start(audioTrack) {
      if (listening) return;
      listening = true;
      track = audioTrack;
      quick = 0;
      // Times run from this Listen, as the model's worker's do; a session the browser ends by itself does not reset them.
      epoch = now();
      lastAt = null;
      begin();
    },
    /** Stop at once: the session is aborted, so no more sound goes out and no late text comes back. */
    stop() {
      listening = false;
      const s = session;
      session = null;
      // The half-said sentence is kept as a final piece, as the model's worker does at a stop (this only reads what the
      // page already holds; nothing more is sent to the service).
      if (s) { flush(s); release(s); }
      dropPause();
    },
  };
}
