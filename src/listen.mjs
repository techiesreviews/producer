// What the setup's last steps and the live screen's listening sign say, from plain facts: the host's guest answer,
// whether the microphone and the speech model are ready, and whether the page is listening. No sound or text here.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** The guest step's answers ("Guest agreed"). Only the host picks one; nothing else ever sets it. */
export const GUEST = {
  yes: { chip: "Guest ✓", ok: true, chipTip: "Your guest said yes to being listened to.", signTip: "Turns speech into text on this computer. Nothing is recorded or sent as sound." },
  no: { chip: "Guest: no", ok: false, chipTip: "Your guest said no. Only your microphone is listened to.", signTip: "Mic only: your guest said no." },
  solo: { chip: "", ok: false, chipTip: "", signTip: "Mic only: solo show, no guest." },
};

/**
 * The listening sign in the top bar. Only the microphone is heard until a guest's tab sound exists, so the source
 * reads "mic only" in every case; the guest chip shows the host's answer (none on a solo show).
 */
export function listeningSign({ listening, guest }) {
  const answer = GUEST[guest] || GUEST.solo;
  return {
    on: listening,
    source: "mic only",
    tip: listening ? answer.signTip : "Not listening. The microphone is off.",
    chip: answer.chip ? { text: answer.chip, ok: answer.ok, tip: answer.chipTip } : null,
    button: listening ? "Stop" : "Listen",
  };
}

/** Why "Open producer screen" cannot open yet, or "" when it can: the first missing step, in the order shown. */
export function openBlocked({ guest, mic, speech }) {
  if (!GUEST[guest]) return "Answer Guest agreed first.";
  if (!mic) return "Turn on the microphone first.";
  if (!speech) return "Load the speech model first.";
  return "";
}

/** Loudness of a stretch of sound (root mean square). */
export function loudness(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** How full the level meter is, 0 to 1: -60 dB (quiet room) is empty, -10 dB (loud voice) is full. */
export function meterFill(rms) {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db + 60) / 50));
}
