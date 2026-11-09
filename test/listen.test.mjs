// What the guest step, the tab-sound button, the open button and the listening sign say (src/listen.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUEST, listeningSign, loudness, meterFill, openBlocked, tabButton, tabProblem } from "../src/listen.mjs";
import { REASONS } from "../src/browser.mjs";

test("the sign names what is heard: the host's mic, plus the guest's tab when it is shared", () => {
  assert.deepEqual(listeningSign({ listening: true, guest: "yes", tab: true }), {
    on: true, source: "host mic + guest tab", tip: GUEST.yes.signTip, button: "Stop",
    chip: { text: "Guest ✓", ok: true, tip: "Your guest said yes to being listened to." },
  });
  const noTab = listeningSign({ listening: true, guest: "yes", tab: false });
  assert.deepEqual([noTab.source, noTab.tip], ["host mic", "Host mic only: the guest tab is not shared. Press Stop, then Listen to pick it again."], "a yes without the tab says so, with the way back");
  const cannot = listeningSign({ listening: true, guest: "yes", tab: false, noTab: "browser" });
  assert.deepEqual([cannot.source, cannot.tip], ["host mic", "Host mic only: this browser cannot share a tab's sound."], "in a browser that cannot, there is no way back to promise");
  const obs = listeningSign({ listening: true, guest: "yes", tab: false, noTab: "obs" });
  assert.deepEqual([obs.source, obs.tip], ["host mic", "Host mic only: OBS has no studio tab to share."], "with OBS there is no tab either");
  const waiting = listeningSign({ listening: true, guest: "yes", tab: false, tabBusy: true });
  assert.equal(waiting.tip, "Host mic for now: waiting for the tab to be picked.", "while the picker is open the sign says it waits");
  const no = listeningSign({ listening: true, guest: "no", tab: false });
  assert.deepEqual([no.source, no.chip.text, no.chip.ok, no.tip], ["host mic", "Guest: no", false, "Host mic only: your guest said no."]);
  assert.equal(GUEST.no.chipTip, "Your guest said no. Only your microphone is listened to.");
  const solo = listeningSign({ listening: true, guest: "solo", tab: false });
  assert.deepEqual([solo.source, solo.chip, solo.tip], ["host mic", null, "Host mic only: solo show, no guest."]);
  const off = listeningSign({ listening: false, guest: "yes", tab: false });
  assert.deepEqual([off.on, off.button, off.tip], [false, "Listen", "Not listening. The microphone is off."]);
});

test("the sign never names the guest tab for a guest who said no, even if a tab were shared", () => {
  for (const guest of ["no", "solo"]) assert.equal(listeningSign({ listening: true, guest, tab: true }).source, "host mic", guest);
});

const chrome = { on: true };
const firefox = { on: false, reason: REASONS.tabFirefox };

test("the tab button: idle in Chrome says how to share and asks the host to wear headphones", () => {
  const b = tabButton({ feature: chrome, guest: "yes", phase: "idle", stream: "restream" });
  assert.deepEqual([b.off, b.state, b.text], [false, null, "Share the studio tab with sound"]);
  assert.match(b.tip, /^Pick a browser tab and tick "Also share tab audio"\./);
  assert.match(b.tip, /Wear headphones/);
  assert.equal(tabButton({ feature: chrome, guest: null, phase: "idle", stream: "restream" }).off, false, "it can be shared before the guest answer is picked");
});

test("the tab button: switched off with the plain reason, the browser's first, then the guest's answer", () => {
  assert.deepEqual(tabButton({ feature: firefox, guest: "yes", phase: "idle", stream: "wave" }), { off: true, state: null, text: "Share the studio tab with sound", tip: REASONS.tabFirefox });
  assert.equal(tabButton({ feature: firefox, guest: "solo", phase: "idle", stream: "wave" }).tip, REASONS.tabFirefox, "the browser's reason wins");
  const no = tabButton({ feature: chrome, guest: "no", phase: "idle", stream: "wave" });
  assert.deepEqual([no.off, no.tip], [true, "Your guest said no: only your microphone is listened to."]);
  const solo = tabButton({ feature: chrome, guest: "solo", phase: "idle", stream: "wave" });
  assert.deepEqual([solo.off, solo.tip], [true, "Solo show: no guest to hear."]);
  assert.equal(tabButton({ feature: chrome, guest: "no", phase: "on", stream: "wave" }).off, true, "a share that is still on is off-limits once the guest said no");
});

test("the tab button: OBS has no studio tab, so it is switched off for a guest who said yes, and the open button does not wait for it", () => {
  const b = tabButton({ feature: chrome, guest: "yes", phase: "idle", stream: "obs" });
  assert.deepEqual([b.off, b.tip], [true, "No tab sound with OBS: it has no studio tab to share. Only your microphone is listened to."]);
  assert.equal(tabButton({ feature: chrome, guest: "yes", phase: "on", stream: "obs" }).off, true, "a share still running when OBS is picked is off-limits");
  assert.equal(tabButton({ feature: firefox, guest: "yes", phase: "idle", stream: "obs" }).tip, REASONS.tabFirefox, "the browser's own reason comes first");
  assert.equal(tabButton({ feature: chrome, guest: "yes", phase: "idle", stream: "other" }).off, false, "any other studio can be shared");
  // The app passes tabReady once the tab is shared or switched off: for OBS that is at once.
  assert.equal(openBlocked({ guest: "yes", mic: true, tabReady: b.off, speech: true }), "");
});

test("the tab button: waiting for the pick, then shared under the studio's name, then a failure on the button itself", () => {
  assert.deepEqual(tabButton({ feature: chrome, guest: "yes", phase: "busy", stream: "restream" }), { off: false, state: "busy", text: "Pick the tab…", tip: null });
  const on = (stream) => tabButton({ feature: chrome, guest: "yes", phase: "on", stream });
  assert.deepEqual([on("restream").state, on("restream").text], ["ok", "Restream Studio tab"]);
  assert.equal(on("wave").text, "Wave.video tab");
  assert.equal(on("other").text, "Studio tab");
  assert.match(on("restream").tip, /Press to stop sharing\.$/);
  assert.match(on("restream").tip, /Headphones/);
  const failed = tabButton({ feature: chrome, guest: "yes", phase: "error", problem: "NoTabSound", stream: "wave" });
  assert.deepEqual([failed.off, failed.state, failed.text], [false, "error", "No tab sound · try again"]);
});

test("a tab that could not be shared says why, with the way out", () => {
  assert.deepEqual(tabProblem("NotAllowedError"), { text: "Tab not shared · try again", tip: 'The browser did not share a tab. Press again, pick a browser tab and tick "Also share tab audio".' });
  assert.equal(tabProblem("AbortError").text, "Tab not shared · try again");
  assert.deepEqual(tabProblem("NoTabSound"), { text: "No tab sound · try again", tip: 'The tab came without sound. Press again and tick "Also share tab audio".' });
  assert.deepEqual(tabProblem("NotATab"), { text: "Share a browser tab · try again", tip: "A window or a whole screen was shared. Press again and pick a browser tab." });
  assert.deepEqual(tabProblem("SomethingElse"), { text: "Tab sharing failed · try again", tip: "The browser could not share a tab. Press again, or use Chrome or Edge on a computer." });
  assert.deepEqual(tabProblem(undefined), tabProblem("SomethingElse"));
});

test("the tab-sound words are plain, short and need no explainer (they fit a tooltip)", () => {
  const all = [];
  for (const phase of ["idle", "busy", "on"]) {
    const b = tabButton({ feature: chrome, guest: "yes", phase, stream: "restream" });
    all.push(b.text, b.tip);
  }
  for (const name of ["NotAllowedError", "NoTabSound", "NotATab", "x"]) all.push(...Object.values(tabProblem(name)));
  all.push(tabButton({ feature: chrome, guest: "no", phase: "idle", stream: "x" }).tip, tabButton({ feature: chrome, guest: "solo", phase: "idle", stream: "x" }).tip);
  for (const words of all.filter(Boolean)) assert.ok(words.length <= 200 && (words.match(/[.!?]/g) || []).length <= 3, words);
});

test("Open producer screen waits for the guest's answer, the microphone, the tab sound, then the speech model", () => {
  const ready = { guest: "yes", mic: true, tabReady: true, speech: true };
  assert.equal(openBlocked({ ...ready, guest: null }), "Answer Guest agreed first.");
  assert.equal(openBlocked({ ...ready, guest: "solo", mic: false }), "Turn on the microphone first.");
  assert.equal(openBlocked({ ...ready, tabReady: false }), "Share the studio tab with sound first.");
  assert.equal(openBlocked({ ...ready, tabReady: false, speech: false }), "Share the studio tab with sound first.", "the tab comes before the model");
  assert.equal(openBlocked({ ...ready, speech: false }), "Load the speech model first.");
  assert.equal(openBlocked(ready), "");
  assert.equal(openBlocked({ ...ready, guest: "maybe" }), "Answer Guest agreed first.", "only the three answers count");
});

test("the meter: silence is empty, a loud voice full, in between by loudness in decibels", () => {
  assert.equal(meterFill(0), 0);
  assert.equal(meterFill(NaN), 0);
  assert.equal(meterFill(0.0005), 0, "-66 dB is a quiet room");
  assert.equal(meterFill(0.5), 1, "-6 dB is loud");
  assert.ok(Math.abs(meterFill(0.01) - 0.4) < 1e-9, "-40 dB is 40 %");
  assert.equal(loudness(new Float32Array(0)), 0);
  assert.ok(Math.abs(loudness(Float32Array.of(0.5, -0.5, 0.5, -0.5)) - 0.5) < 1e-9);
});
