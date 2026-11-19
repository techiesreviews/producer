// The show's prompter script (src/script-reader.mjs, TOOLS-345): the run order and the prepared questions read out of
// the script the agent hands load_show, each question with its part, and the same plan as one written by hand.
// The committed fixture is a made-up stand-in in the script's format. A real show's script stays out of this public
// repo; to check one, point PRODUCER_REAL_SCRIPT_DIR at its folder (prompter.md and the hand-made producer-plan.txt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPT_LAST_MINUTES, readScript } from "../src/script-reader.mjs";
import { planText, readLoad } from "../src/agent-load.mjs";
import { readPlan } from "../src/runorder.mjs";
import { findQuestions } from "../src/find.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** The plan the page holds once load_show brought the script in: the plan box's text, read the way a pasted plan is. */
function loaded(args) {
  const r = readLoad(args);
  assert.equal(r.ok, true, r.reason);
  const back = readPlan(planText(r.plan));
  assert.equal(back.ok, true, JSON.stringify(back));
  return back;
}

/** Show, guest, run order and questions: what a plan written by hand says too. */
const same = (plan) => ({ show: plan.show, guest: plan.guest, parts: plan.parts, questions: plan.questions });

test("the stand-in script loads into the same plan as the one written by hand", () => {
  const plan = loaded({ show: "Sample Show", guest: "Sam Sample", script: fixture("stand-in-script.md") });
  assert.deepEqual(same(plan), same(readPlan(fixture("stand-in-plan.txt"))));
});

test("each question keeps its part, so the search groups by part", () => {
  const plan = loaded({ script: fixture("stand-in-script.md") });
  assert.deepEqual(plan.questionParts, [0, 0, 1, 1, 1, 2, 2, 3, 4]);
  const found = findQuestions({ plan, query: "backup" });
  assert.deepEqual(found.groups.map((g) => [g.name, g.items]), [["Intro", [2]], ["What A Backup Really Is", [3]], ["Only If Chat Wants More", [9]]]);
});

test("questions over several short lines are joined into one sentence ending in ?", () => {
  const r = readScript("### **1 · TALK · 00:00**\nSo if it breaks,\nwhat do you do\nfirst?\nIt shows the copy. Does it show the log?\n");
  assert.deepEqual(r.questions, [{ text: "So if it breaks, what do you do first?", part: 0 }, { text: "Does it show the log?", part: 0 }]);
});

test("reminders, links, headings without a time and one-word tags are left out", () => {
  const r = readScript([
    "# Title? · cues v1",
    "### **PREP**",
    "Is this on air?",
    "### **1 · INTRO · 00:00**",
    "[Wait. Is this a question?]",
    "[A link?](https://example.com/?a=1)",
    "Nice and safe. Right?",
    "Really?",
    "Is this one asked?",
  ].join("\n"));
  assert.deepEqual(r.questions.map((q) => q.text), ["Is this one asked?"]);
  assert.deepEqual(r.parts, [{ name: "Intro", minutes: SCRIPT_LAST_MINUTES }]);
});

test("a blank line or a new part ends a sentence that never finished", () => {
  const r = readScript("### **1 · A · 00:00**\nWhere should the\n\nnext one go?\n### **2 · B · 02:00**\nand who\n### **3 · C · 04:00**\nasks it?");
  assert.deepEqual(r.questions, [{ text: "next one go?", part: 0 }, { text: "asks it?", part: 2 }]);
});

test("the parts: names from the heading, minutes until the next part starts, the last one five minutes", () => {
  const r = readScript([
    "### **1 · THE START · 0:00**",
    "### **2 · Mixed Case Stays: as Written · 12:30**",
    "### **3 · ROBERT'S 2FA STORY: IS IT SAFE? · 1:02:00**",
    "### BONUS · ONLY IF TIME · 1:10:00",
  ].join("\n"));
  assert.equal(r.ok, true);
  assert.deepEqual(r.parts, [
    { name: "The Start", minutes: 13 },
    { name: "Mixed Case Stays: as Written", minutes: 50 },
    { name: "Robert's 2FA Story: Is It Safe?", minutes: 8 },
    { name: "Only If Time", minutes: SCRIPT_LAST_MINUTES },
  ]);
});

test("a script that gives no run order is refused with a plain reason", () => {
  assert.match(readScript("Just some lines.\nAny questions?").reason, /no parts with a start time.*### \*\*1 · INTRO · 00:00\*\*/);
  assert.match(readScript("### **1 · A · 05:00**\n### **2 · B · 05:00**").reason, /Part 2 \("B"\) starts at 05:00, not after part 1 at 05:00/);
});

test("load_show takes the script: refused with both ways at once, or with no script text", () => {
  const script = fixture("stand-in-script.md");
  assert.match(readLoad({ script, questions: ["Why?"] }).reason, /the script, or the questions and parts, not both/);
  assert.match(readLoad({ script, parts: [{ name: "A", minutes: 1 }] }).reason, /not both/);
  assert.match(readLoad({ script: 42 }).reason, /"script" must be the show's prompter script as text/);
  assert.match(readLoad({ script: "   " }).reason, /"script" must be/);
  assert.match(readLoad({ script: "no parts here?" }).reason, /no parts with a start time/);
});

const REAL = process.env.PRODUCER_REAL_SCRIPT_DIR;
test("a real show's script loads into the same plan as its hand-made plan (opt-in: PRODUCER_REAL_SCRIPT_DIR)", { skip: !REAL && "set PRODUCER_REAL_SCRIPT_DIR to a show's folder" }, () => {
  const plan = readPlan(readFileSync(join(REAL, "producer-plan.txt"), "utf8"));
  assert.equal(existsSync(join(REAL, "prompter.md")), true, "prompter.md is in the folder");
  const got = loaded({ show: plan.show, guest: plan.guest, script: readFileSync(join(REAL, "prompter.md"), "utf8") });
  assert.deepEqual(got.parts, plan.parts);
  for (const [i, q] of plan.questions.entries()) assert.equal(got.questions[i], q, `question ${i + 1}`);
  assert.equal(got.questions.length, plan.questions.length);
  assert.ok(got.questionParts.every((p) => p !== null), "every question has its part");
});
