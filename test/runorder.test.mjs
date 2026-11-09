// The show plan pasted by hand and the run order with its clock (src/runorder.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRunOrder, PLAN_EXAMPLE, planButton, readPlan, showLine, clockText } from "../src/runorder.mjs";

const MIN = 60_000;

test("a plan: Show and Guest lines, parts as minutes and a name, questions numbered or ending in ?", () => {
  const plan = readPlan(`
    Show: Techies Live
    guest:  Jane Doe

    3 Intro
    10 min Her story
    15m Pricing & growth
    1. How did it start?
    2) Tell me about the first hire.
    - What would you do differently?
    Who was your first customer?
    Q4. What comes next?
  `);
  assert.deepEqual(plan, {
    ok: true,
    show: "Techies Live",
    guest: "Jane Doe",
    parts: [{ name: "Intro", minutes: 3 }, { name: "Her story", minutes: 10 }, { name: "Pricing & growth", minutes: 15 }],
    questions: ["How did it start?", "Tell me about the first hire.", "What would you do differently?", "Who was your first customer?", "What comes next?"],
  });
});

test("a line that starts with minutes is a part, even when its name ends with a question mark", () => {
  assert.deepEqual(readPlan("10 Any questions?").parts, [{ name: "Any questions?", minutes: 10 }]);
  assert.deepEqual(readPlan("5 Intro\n1. Why?").questions, ["Why?"], "a numbered question stays a question");
  assert.deepEqual(readPlan("5 Intro\nWhy now?").questions, ["Why now?"], "so does any other line ending with ?");
});

test("the example under the paste box is a plan the page reads", () => {
  const plan = readPlan(PLAN_EXAMPLE.join("\n"));
  assert.equal(plan.ok, true);
  assert.ok(plan.parts.length >= 2 && plan.questions.length >= 1 && plan.show && plan.guest);
});

test("a line that is none of these is named by its number; a plan needs at least one part", () => {
  assert.deepEqual(readPlan("Show: X\n\n10 Intro\nIntro without minutes"), { ok: false, line: 4, text: "Intro without minutes" });
  assert.deepEqual(readPlan("0 Intro"), { ok: false, line: 1, text: "0 Intro" }, "a part lasts at least a minute");
  assert.deepEqual(readPlan("1. How did it start?"), { ok: false, noParts: true }, "questions alone make no run order");
  assert.deepEqual(readPlan("Show:\n5 Intro"), { ok: false, line: 1, text: "Show:" }, "a Show line needs a name");
  assert.equal(readPlan("  \n\t\n").empty, true, "only blank lines: nothing pasted");
  assert.equal(readPlan("").empty, true);
  assert.equal(readPlan("120 Long part").parts[0].minutes, 120);
  assert.equal(readPlan("1000 Too long").ok, false, "at most 999 minutes per part");
});

test("the paste button says what was read, or what is wrong, on itself", () => {
  assert.deepEqual(planButton(readPlan("")), { state: null, text: "Paste it myself", tip: "Paste your show name, guest, questions and run order." });
  assert.deepEqual(planButton(readPlan("5 Intro\n1. Why?")), { state: "ok", text: "1 question · 1 part ✓", tip: "Click to change the plan." });
  assert.equal(planButton(readPlan("5 A\n5 B\n1. a?\n2. b?")).text, "2 questions · 2 parts ✓");
  assert.equal(planButton(readPlan("5 A\n5 B")).text, "2 parts ✓", "no questions: only the parts");
  const bad = planButton(readPlan("5 A\nhello there"));
  assert.deepEqual([bad.state, bad.text], ["error", "Line 2 not clear"]);
  assert.match(bad.tip, /^Line 2: "hello there"\. /);
  const none = planButton(readPlan("1. Why?"));
  assert.deepEqual([none.state, none.text], ["error", "No parts with minutes"]);
  assert.match(planButton(readPlan(`5 A\n${"x".repeat(200)}`)).tip, /x…"/, "a long line is cut short in the tip");
});

test("the show line in the top bar", () => {
  assert.equal(showLine(null), "· no show loaded yet");
  assert.equal(showLine(readPlan("Show: Techies Live\nGuest: Jane Doe\n5 Intro")), "· Techies Live · guest Jane Doe");
  assert.equal(showLine(readPlan("Show: Techies Live\n5 Intro")), "· Techies Live");
  assert.equal(showLine(readPlan("Guest: Jane Doe\n5 Intro")), "· guest Jane Doe");
  assert.equal(showLine(readPlan("5 Intro\n5 Outro")), "· 2 parts");
});

test("times read as minutes and seconds, with a sign when asked", () => {
  assert.equal(clockText(0), "0:00");
  assert.equal(clockText(65), "1:05");
  assert.equal(clockText(3725), "62:05", "past an hour the minutes go on, as the mock-up's clock");
  assert.equal(clockText(-20, true), "−0:20");
  assert.equal(clockText(80, true), "+1:20");
  assert.equal(clockText(0, true), "0:00");
  assert.equal(clockText(59.9), "0:59", "whole seconds, never rounded up");
});

const PARTS = [{ name: "Intro", minutes: 3 }, { name: "Her story", minutes: 8 }, { name: "Wrap-up", minutes: 4 }];

test("before Start: no clock running, the first part is up next, the rest later", () => {
  const run = createRunOrder(PARTS);
  const view = run.view(5 * MIN);
  assert.deepEqual([view.started, view.finished, view.clock, view.delta], [false, false, 0, null]);
  assert.deepEqual(view.rows.map((r) => [r.state, r.text]), [["next", "3:00"], ["later", "8:00"], ["later", "4:00"]]);
  assert.equal(view.button, "Start");
});

test("Start runs the clock and the first part counts down; over time shows how far over", () => {
  const run = createRunOrder(PARTS);
  const t0 = 1_000_000;
  run.start(t0);
  let view = run.view(t0 + 70_000);
  assert.deepEqual([view.started, view.clock, view.delta, view.button], [true, 70, 0, "Next part"]);
  assert.deepEqual(view.rows.map((r) => r.state), ["now", "next", "later"]);
  assert.deepEqual([view.rows[0].text, view.rows[0].tone, view.rows[0].fill.toFixed(3)], ["1:50 left", "", (70 / 180).toFixed(3)]);
  view = run.view(t0 + 200_000);
  assert.deepEqual([view.rows[0].text, view.rows[0].tone, view.rows[0].fill], ["0:20 over", "late", 1]);
  assert.equal(view.delta, 20, "running over the current part puts the show behind at once");
  run.start(t0 + 300_000);
  assert.equal(run.view(t0 + 300_000).clock, 300, "a second Start does not restart the clock");
});

test("Next part keeps each part's real time; the plan difference adds up done parts and the current overrun", () => {
  const run = createRunOrder(PARTS);
  run.start(0);
  run.next(160_000); // Intro took 2:40 of 3:00: 20 s ahead
  let view = run.view(160_000);
  assert.deepEqual(view.rows.map((r) => [r.state, r.text, r.tone]), [["done", "−0:20", "early"], ["now", "8:00 left", ""], ["next", "4:00", ""]]);
  assert.equal(view.delta, -20, "ahead of plan by 20 s");
  view = run.view(160_000 + 7 * MIN);
  assert.equal(view.delta, -20, "time left in the current part does not count yet");
  run.next(160_000 + 9 * MIN + 40_000); // Her story took 9:40 of 8:00: 1:40 behind
  view = run.view(160_000 + 9 * MIN + 40_000);
  assert.deepEqual(view.rows.map((r) => [r.state, r.text, r.tone]), [["done", "−0:20", "early"], ["done", "+1:40", "late"], ["now", "4:00 left", ""]]);
  assert.equal(view.delta, 80, "behind by 1:20 overall");
  assert.equal(view.button, "Next part");
});

test("Next part on the last part ends the plan; the clock goes on and every second past it is over plan", () => {
  const run = createRunOrder(PARTS);
  run.start(0);
  run.next(3 * MIN);
  run.next(11 * MIN);
  run.next(14 * MIN); // Wrap-up 3:00 of 4:00
  let view = run.view(14 * MIN);
  assert.deepEqual([view.finished, view.button, view.delta, view.clock], [true, null, -60, 14 * 60]);
  assert.deepEqual(view.rows.map((r) => r.state), ["done", "done", "done"]);
  view = run.view(16 * MIN);
  assert.deepEqual([view.clock, view.delta], [16 * 60, 60], "two minutes on, one minute over the 15 planned");
  run.next(17 * MIN);
  assert.equal(run.view(17 * MIN).rows.length, 3, "Next part after the end changes nothing");
});

test("Next part before Start starts the clock (the host forgot Start)", () => {
  const run = createRunOrder(PARTS);
  run.next(5_000);
  const view = run.view(5_000);
  assert.deepEqual([view.started, view.clock, view.rows[0].state], [true, 0, "now"]);
});

test("the plan lives in page memory only: the run order code stores and sends nothing", () => {
  const source = readFileSync(resolve(import.meta.dirname, "../src/runorder.mjs"), "utf8");
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|caches|cookie|postMessage|console)\b/);
});
