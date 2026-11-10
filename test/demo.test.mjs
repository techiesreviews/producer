// The built-in demo show (src/demo.mjs): a made-up example the host loads with one click to try the whole screen. It must
// pass the same checks as a show the agent loads, read back clearly as the host's own plan text, say plainly that it is a
// demo, name nobody real, and the button for it says its state in each case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_SHOW, demoButton } from "../src/demo.mjs";
import { planText, readLoad } from "../src/agent-load.mjs";
import { readPlan } from "../src/runorder.mjs";

test("the demo is about 8 questions, 3 parts, a guest and notes, and passes the agent-load checks", () => {
  const r = readLoad(DEMO_SHOW);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.plan.questions.length, 8);
  assert.equal(r.plan.parts.length, 3);
  assert.ok(r.plan.guest && r.plan.notes, "a guest and notes");
  assert.deepEqual(r.plan, DEMO_SHOW, "nothing in it needed tidying");
});

test("the demo reads back from the plan box's text exactly (the host edits that text)", () => {
  const back = readPlan(planText(DEMO_SHOW));
  assert.equal(back.ok, true);
  assert.deepEqual({ show: back.show, guest: back.guest, parts: back.parts, questions: back.questions }, { show: DEMO_SHOW.show, guest: DEMO_SHOW.guest, parts: DEMO_SHOW.parts, questions: DEMO_SHOW.questions });
});

test("the demo says plainly that it is a demo and names nobody real", () => {
  assert.match(DEMO_SHOW.show, /demo/i);
  assert.match(DEMO_SHOW.guest, /demo/i);
  assert.match(DEMO_SHOW.notes, /demo/i);
  // No address, link or number a person could be reached by.
  assert.doesNotMatch(JSON.stringify(DEMO_SHOW), /@|https?:|www\.|\d{5,}/i);
});

test("the demo button: ready, asking before it replaces a plan, loaded, off while the show clock runs", () => {
  assert.deepEqual(demoButton({ loaded: false, locked: false }), { state: null, text: "Load demo show", tip: "Fills in a sample show to try the whole screen. Nothing is stored. You can still change it.", off: "" });
  assert.deepEqual(demoButton({ loaded: true, locked: false }), { state: "ok", text: "Demo loaded ✓", tip: "A sample show, not a real one. Change it in the box, or load your own.", off: "" });
  assert.deepEqual(demoButton({ loaded: false, locked: false, confirm: true }), { state: "error", text: "Replace your plan? · press again", tip: "The plan in the box is replaced by the demo. Press again to do it, or leave it as it is.", off: "" });
  assert.equal(demoButton({ loaded: false, locked: true, confirm: true }).text, "Load demo show", "a fixed plan is never asked about: the button is simply off");
  assert.equal(demoButton({ loaded: false, locked: true }).off, "The show has started, so the plan stays as it is.");
  assert.equal(demoButton({ loaded: true, locked: true }).state, "ok", "a loaded demo still says so once the show runs");
});
