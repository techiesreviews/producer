// What the guest step, the open button and the listening sign say (src/listen.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GUEST, listeningSign, loudness, meterFill, openBlocked } from "../src/listen.mjs";

test("the sign reads Listening · mic only with the guest's answer, or Not listening with Listen", () => {
  assert.deepEqual(listeningSign({ listening: true, guest: "yes" }), {
    on: true, source: "mic only", tip: GUEST.yes.signTip, button: "Stop",
    chip: { text: "Guest ✓", ok: true, tip: "Your guest said yes to being listened to." },
  });
  const no = listeningSign({ listening: true, guest: "no" });
  assert.deepEqual([no.source, no.chip.text, no.chip.ok, no.tip], ["mic only", "Guest: no", false, "Mic only: your guest said no."]);
  const solo = listeningSign({ listening: true, guest: "solo" });
  assert.deepEqual([solo.source, solo.chip, solo.tip], ["mic only", null, "Mic only: solo show, no guest."]);
  const off = listeningSign({ listening: false, guest: "yes" });
  assert.deepEqual([off.on, off.button, off.tip], [false, "Listen", "Not listening. The microphone is off."]);
});

test("Open producer screen waits for the guest's answer, then the microphone, then the speech model", () => {
  assert.equal(openBlocked({ guest: null, mic: false, speech: false }), "Answer Guest agreed first.");
  assert.equal(openBlocked({ guest: "solo", mic: false, speech: true }), "Turn on the microphone first.");
  assert.equal(openBlocked({ guest: "no", mic: true, speech: false }), "Load the speech model first.");
  assert.equal(openBlocked({ guest: "yes", mic: true, speech: true }), "");
  assert.equal(openBlocked({ guest: "maybe", mic: true, speech: true }), "Answer Guest agreed first.", "only the three answers count");
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
