// What the setup's last steps and the live screen's listening sign say, from plain facts: the host's guest answer,
// whether the microphone, the shared tab's sound and the speech model are ready, and whether the page is listening.
// No sound or text here.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** The guest step's answers ("Guest agreed"). Only the host picks one; nothing else ever sets it. */
export const GUEST = {
  yes: { chip: "Guest ✓", ok: true, chipTip: "Your guest said yes to being listened to.", signTip: "Turns speech into text on this computer. Nothing is recorded or sent as sound." },
  no: { chip: "Guest: no", ok: false, chipTip: "Your guest said no. Only your microphone is listened to.", signTip: "Host mic only: your guest said no." },
  solo: { chip: "", ok: false, chipTip: "", signTip: "Host mic only: solo show, no guest." },
};

/**
 * The listening sign in the top bar. It names what is heard: "host mic", and "guest tab" beside it only while the
 * guest's tab sound is shared (never for a guest who said no or a solo show). The guest chip shows the host's answer
 * (none on a solo show). `canShare` is whether this browser can share a tab's sound at all.
 */
export function listeningSign({ listening, guest, tab, canShare = true }) {
  const answer = GUEST[guest] || GUEST.solo;
  const hearsGuest = Boolean(tab) && guest === "yes";
  return {
    on: listening,
    source: hearsGuest ? "host mic + guest tab" : "host mic",
    tip: !listening ? "Not listening. The microphone is off." : guest === "yes" && !hearsGuest ? (canShare ? "Host mic only: the guest tab is not shared. Press Stop, then Listen to pick it again." : "Host mic only: this browser cannot share a tab's sound.") : answer.signTip,
    chip: answer.chip ? { text: answer.chip, ok: answer.ok, tip: answer.chipTip } : null,
    button: listening ? "Stop" : "Listen",
  };
}

/** Why a tab share failed, in the words for the button and its tooltip. `name` is the error's name. */
export function tabProblem(name) {
  if (name === "NotAllowedError" || name === "AbortError") return { text: "Tab not shared · try again", tip: 'The browser did not share a tab. Press again, pick a browser tab and tick "Also share tab audio".' };
  if (name === "NoTabSound") return { text: "No tab sound · try again", tip: 'The tab came without sound. Press again and tick "Also share tab audio".' };
  if (name === "NotATab") return { text: "Share a browser tab · try again", tip: "A window or a whole screen was shared. Press again and pick a browser tab." };
  return { text: "Tab sharing failed · try again", tip: "The browser could not share a tab. Press again, or use Chrome or Edge on a computer." };
}

const TAB_LABEL = "Share the studio tab with sound";
const STUDIO = { restream: "Restream Studio", wave: "Wave.video" };

/**
 * The tab-sound button in the Sound step, from plain facts: `feature` (this browser's tab-sound feature, with its
 * reason when off), the host's `guest` answer, the share's `phase` ("idle", "busy" while the browser asks, "on",
 * "error" with its `problem`) and the `stream` picked in step 1. `off` means switched off: the reason is the tip.
 * The echo advice (headphones for the host) lives in the tips, not on the screen.
 */
export function tabButton({ feature, guest, phase, problem, stream }) {
  const off = (tip) => ({ off: true, state: null, text: TAB_LABEL, tip });
  if (!feature.on) return off(feature.reason);
  if (guest === "no") return off("Your guest said no: only your microphone is listened to.");
  if (guest === "solo") return off("Solo show: no guest to hear.");
  if (phase === "busy") return { off: false, state: "busy", text: "Pick the tab…", tip: null };
  if (phase === "on") return { off: false, state: "ok", text: `${STUDIO[stream] || "Studio"} tab`, tip: "Hearing this tab as your guest. Headphones keep the guest out of your microphone. Press to stop sharing." };
  if (phase === "error") return { off: false, state: "error", ...tabProblem(problem) };
  return { off: false, state: null, text: TAB_LABEL, tip: 'Pick a browser tab and tick "Also share tab audio". Wear headphones, or your microphone hears your guest too.' };
}

/** Why "Open producer screen" cannot open yet, or "" when it can: the first missing step, in the order shown. */
export function openBlocked({ guest, mic, tabReady, speech }) {
  if (!GUEST[guest]) return "Answer Guest agreed first.";
  if (!mic) return "Turn on the microphone first.";
  if (!tabReady) return "Share the studio tab with sound first.";
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
