// The cue rules: when the page asks the host's agent for the next question, and what it hands over. A cue goes at a
// pause (the speech worker's "pause", about 1.5 s of silence) once at least 30 s of new speech was heard since the
// last cue, at most once a minute; Suggest now sends one at once, at least 10 s after the last cue; Slow down doubles
// both spacings. Each cue carries only the lines heard since the last cue that went (the cursor), labelled host or
// guest, with the run position and the guest's name when known. With two sources (the host's microphone and the
// guest's tab), a pause of one is no pause while the other is still talking.
// Plain rules: they know nothing about how the agent is reached. `send(cue)` hands the cue over and says whether
// someone took it (false: no agent; then nothing is used up). All in this page's memory; nothing is stored.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

export const CUE_RULES = {
  speechMs: 30_000,
  autoEveryMs: 60_000,
  manualEveryMs: 10_000,
  slowFactor: 2,
  maxChars: 20_000,
  // A source that sent text this recently and no pause since is still talking. A piece is at most 12 s long, so a
  // talking source sends a final about that often (a best guess: the text can lag when the computer reads slowly).
  talkingMs: 12_000,
};

/** Who a line of speech belongs to: the host's microphone is the host, the shared tab is the guest. */
export const speakerOf = (source) => (source === "guest" ? "guest" : "host");

/**
 * createCues({ send, context, now, ...rules }): context() gives { position?, guestName? } at the moment a cue goes.
 * heard(line) takes each final line ({ source, text, start, end }, seconds); talking(source) a draft (someone is
 * speaking); pause(source) is the speech worker's pause (of that source; of all when none is named) and sends a cue
 * when the rules allow it (true when one went); suggestNow() gives { ok: true }, { ok: false, waitMs } or
 * { ok: false, noAgent: true }; slowDown(on) switches Slow down; view() gives { slow, cues, suggestInMs }.
 */
export function createCues({ send, context = () => ({}), now = () => Date.now(), ...options }) {
  const o = { ...CUE_RULES, ...options };
  let lines = []; // { speaker, text } heard since the last cue that went
  let chars = 0;
  let speechMs = 0;
  let last = -Infinity; // when the last cue went
  let slow = false;
  let count = 0;
  const talking = new Map(); // speaker -> when that source last sent text, until its pause
  const busy = () => [...talking.values()].some((at) => now() - at < o.talkingMs);
  const spaced = (ms) => ms * (slow ? o.slowFactor : 1);
  const suggestInMs = () => Math.max(0, last + spaced(o.manualEveryMs) - now());

  function fire(cue) {
    const { position, guestName } = context() ?? {};
    const item = { cue, transcript: lines.map((l) => ({ ...l })) };
    if (position) item.position = position;
    if (guestName) item.guestName = guestName;
    if (!send(item)) return false;
    lines = [];
    chars = 0;
    speechMs = 0;
    last = now();
    count += 1;
    return true;
  }

  return {
    heard({ source, text, start, end }) {
      const said = typeof text === "string" ? text.trim() : "";
      if (!said) return;
      talking.set(speakerOf(source), now());
      lines.push({ speaker: speakerOf(source), text: said });
      chars += said.length;
      // The oldest lines go first once the held text is past the cap.
      while (chars > o.maxChars && lines.length > 1) chars -= lines.shift().text.length;
      const seconds = Number(end) - Number(start);
      if (seconds > 0) speechMs += seconds * 1000;
    },
    talking(source) {
      talking.set(speakerOf(source), now());
    },
    pause(source) {
      if (source === undefined) talking.clear(); else talking.delete(speakerOf(source));
      if (busy() || speechMs < o.speechMs || now() - last < spaced(o.autoEveryMs)) return false;
      return fire("pause");
    },
    suggestNow() {
      const waitMs = suggestInMs();
      if (waitMs > 0) return { ok: false, waitMs };
      return fire("suggest_now") ? { ok: true } : { ok: false, noAgent: true };
    },
    slowDown(on) {
      slow = Boolean(on);
    },
    view: () => ({ slow, cues: count, suggestInMs: suggestInMs() }),
  };
}
