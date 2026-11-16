// The show phase (src/showphase.mjs): which screen the show is on (setup, live or ended) is data the page reads, not
// which element happens to be hidden. The show clock's ticker runs only while the producer screen is on and the clock
// has started: never on the setup screen, never after End & report. What End & report says about the agent is decided
// here too, so it is tested without a browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeTimers } from "./fakes.mjs";
import { createShowPhase, endingAgent, TICK_MS } from "../src/showphase.mjs";

function make() {
  const now = { t: 0 };
  const timers = fakeTimers(now);
  const ticks = [];
  const changes = [];
  const phase = createShowPhase({ timers, onTick: () => ticks.push(now.t), onChange: (p) => changes.push(p) });
  return { now, timers, ticks, changes, phase };
}

test("the show starts on the setup screen; Open producer screen, back to setup and End & report move it on", () => {
  const { phase, changes } = make();
  assert.equal(phase.view(), "setup");
  assert.equal(phase.live(), false);
  assert.equal(phase.open(), true);
  assert.deepEqual([phase.view(), phase.live()], ["live", true]);
  assert.equal(phase.back(), true, "an engine failed: the setup comes back");
  assert.equal(phase.view(), "setup");
  assert.equal(phase.open(), true);
  assert.equal(phase.end(), true);
  assert.deepEqual([phase.view(), phase.live()], ["ended", false]);
  assert.deepEqual(changes, ["live", "setup", "live", "ended"], "each move is told once");
});

test("a move that does not fit the phase is refused and changes nothing", () => {
  const { phase, changes } = make();
  assert.equal(phase.back(), false, "already on the setup screen");
  assert.equal(phase.end(), false, "End & report is on the producer screen only");
  phase.open();
  assert.equal(phase.open(), false, "already live");
  phase.end();
  assert.equal(phase.end(), false, "the show ended once");
  assert.equal(phase.open(), false, "an ended show does not open again");
  assert.equal(phase.back(), false, "nor go back to the setup");
  assert.equal(phase.view(), "ended");
  assert.deepEqual(changes, ["live", "ended"]);
});

test("the ticker never runs on the setup screen, even once the clock has started", async () => {
  const { phase, timers, ticks } = make();
  phase.clockStarted();
  await timers.tick(TICK_MS * 8);
  assert.deepEqual(ticks, [], "Start pressed, but no producer screen: no ticks");
  assert.equal(phase.ticking(), false);
  assert.equal(timers.pending(), 0, "no timer held either");
});

test("the ticker runs every 250 ms on the producer screen once the clock has started, and not before", async () => {
  const { phase, timers, ticks } = make();
  phase.open();
  await timers.tick(TICK_MS * 4);
  assert.deepEqual(ticks, [], "the clock waits at 0:00 until Start: nothing to redraw");
  phase.clockStarted();
  assert.equal(phase.ticking(), true);
  await timers.tick(TICK_MS * 4);
  assert.equal(ticks.length, 4, "four ticks a second");
  phase.clockStarted();
  await timers.tick(TICK_MS * 4);
  assert.equal(ticks.length, 8, "a second Start (Next part) does not add a second ticker");
});

test("back to the setup screen stops the ticker; the producer screen again starts it again", async () => {
  const { phase, timers, ticks } = make();
  phase.open();
  phase.clockStarted();
  await timers.tick(TICK_MS * 2);
  phase.back();
  const before = ticks.length;
  await timers.tick(TICK_MS * 20);
  assert.equal(ticks.length, before, "no ticks while the setup shows");
  assert.equal(timers.pending(), 0);
  phase.open();
  await timers.tick(TICK_MS * 2);
  assert.equal(ticks.length, before + 2, "the clock is redrawn again on the producer screen");
});

test("End & report stops the ticker for good", async () => {
  const { phase, timers, ticks } = make();
  phase.open();
  phase.clockStarted();
  await timers.tick(TICK_MS);
  phase.end();
  phase.clockStarted();
  await timers.tick(TICK_MS * 20);
  assert.equal(ticks.length, 1);
  assert.equal(timers.pending(), 0);
});

test("End & report: the agent that took the end cue is waited for; else the reason says why it was not asked", () => {
  assert.deepEqual(endingAgent({ asked: true, link: "waiting", name: "Claude Code" }), { phase: "waiting", name: "Claude Code" }, "a quiet loop that took the cue is waited for like any other");
  assert.deepEqual(endingAgent({ asked: true, link: "on", name: "Codex" }), { phase: "waiting", name: "Codex" });
  assert.deepEqual(endingAgent({ asked: false, link: "off", name: "Codex" }), { phase: "off", name: "Codex", reason: "No agent was connected when the show ended." });
  assert.deepEqual(endingAgent({ asked: false, link: "waiting", name: "Codex" }), { phase: "off", name: "Codex", reason: "No agent was connected when the show ended." }, "a message copied but never pasted is no agent");
  assert.deepEqual(endingAgent({ asked: false, link: "elsewhere", name: "Codex" }), { phase: "off", name: "Codex", reason: "Your agent is connected in another tab." });
});
