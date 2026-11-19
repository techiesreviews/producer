// The show's prompter script (src/script-reader.mjs, TOOLS-345): the run order and the prepared questions read out of
// the script the agent hands load_show, each question with its part, and the same plan as one written by hand.
// The committed fixture is a made-up stand-in in the script's format. A real show's script stays out of this public
// repo; to check one, point PRODUCER_REAL_SCRIPT_DIR at its folder (prompter.md and the hand-made producer-plan.txt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPT_LAST_MINUTES, readScript } from "../src/script-reader.mjs";
import { LOAD_LIMITS, LOAD_SCRIPT_BYTES, planText, readLoad } from "../src/agent-load.mjs";
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
  assert.deepEqual(r.questions, [{ text: "So if it breaks, what do you do first?", part: 0, joined: true }, { text: "Does it show the log?", part: 0 }]);
});

test("reminders, links, headings without a time and one-word tags are left out; a one-word question on its own line stays", () => {
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
    "",
    "Why?",
  ].join("\n"));
  assert.deepEqual(r.questions.map((q) => q.text), ["Really?", "Is this one asked?", "Why?"]);
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

test("a pause or a title does not end a sentence: the question loads whole", () => {
  const r = readScript("### **1 · A · 00:00**\nSo… what would you change now?\nSo... is that enough?\nDr. Lee, what happened first?\nI said so... What now?\nIs it done?! Yes.");
  assert.deepEqual(r.questions.map((q) => q.text), ["So… what would you change now?", "So... is that enough?", "Dr. Lee, what happened first?", "I said so... What now?"], "\"Is it done?!\" ends in !, so it is no question");
});

test("a question is never shortened: too long on one line or over several, it is refused with its first words", () => {
  const long = `So ${"word ".repeat(70)}what now?`;
  const oneLine = `### **1 · A · 00:00**\n${long}`;
  const lines = `### **1 · A · 00:00**\n${long.match(/.{1,40}(\s|$)/g).map((l) => l.trim()).join("\n")}`;
  for (const script of [oneLine, lines]) {
    const [q] = readScript(script).questions;
    assert.equal(q.text, long, "read whole");
    assert.match(readLoad({ script }).reason, /^Question 1 \("So word word word word word word word wo…"\) is too long\. Limit: 300 characters\.$|It runs over several lines of the script/);
  }
  assert.doesNotMatch(readLoad({ script: oneLine }).reason, /several lines/, "one line ran into nothing: no hint");
  assert.match(readLoad({ script: lines }).reason, /It runs over several lines of the script: end each sentence there with \. ! or \?/);
});

test("a long line in the middle of a run is never dropped: the question it ends in stays too long and is refused", () => {
  const script = ["### **1 · A · 00:00**", "So here", `${"word ".repeat(500)}`, "what now?"].join("\n");
  assert.equal(readScript(script).questions.length, 1);
  assert.ok(readScript(script).questions[0].text.length > 300);
  assert.match(readLoad({ script }).reason, /Question 1 \("So here word/);
});

test("a statement ending in one letter still ends; letters with full stops (U.S.) never end, so no question loses words", () => {
  const q = (line) => readScript(`### **1 · A · 00:00**\n${line}`).questions.map((x) => x.text);
  assert.deepEqual(q("So did I. What did you do next?"), ["What did you do next?"]);
  assert.deepEqual(q("We tried plan B. What did that cost?"), ["What did that cost?"]);
  assert.deepEqual(q("I moved to the U.S. Why did you stay?"), ["I moved to the U.S. Why did you stay?"], "the safe side: a sentence in front, never words lost");
  assert.deepEqual(q("What did the U.S. Supreme Court decide?"), ["What did the U.S. Supreme Court decide?"]);
  assert.deepEqual(q("What did the\nU.S.\nSupreme Court decide?"), ["What did the U.S. Supreme Court decide?"]);
  assert.deepEqual(q("Did J. R. R. Tolkien\nwrite it?"), ["Did J. R. R. Tolkien write it?"]);
  assert.deepEqual(q("How did Acme Inc. survive?"), ["How did Acme Inc. survive?"], "a full stop before a lower-case word");
  assert.deepEqual(q("How did Acme Ltd.\nget through it?"), ["How did Acme Ltd. get through it?"]);
  assert.deepEqual(q("It shows my login. Does it show the copy?"), ["Does it show the copy?"]);
  // A full stop at a line's end waits for the next line: a capital there starts a new sentence, at the line's start.
  assert.deepEqual(readScript("### **1 · A · 00:00**\nIt works.\nDoes it restore?\nNice and safe.\nWhy?").questions, [{ text: "Does it restore?", part: 0 }, { text: "Why?", part: 0 }]);
  assert.deepEqual(q("Was John F. Kennedy there?"), ["Was John F. Kennedy there?"]);
});

test("lines with no end mark run together into the question after them, and the refusal names its first words", () => {
  const lines = Array.from({ length: 400 }, (_, i) => `statement ${String(i + 1).padStart(3, "0")} ${"x".repeat(36)}`);
  const script = ["### **1 · A · 00:00**", ...lines, "Sam, what is a backup?"].join("\n");
  const [q] = readScript(script).questions;
  assert.match(q.text, /^statement 001 x{36} .* Sam, what is a backup\?$/, "its first line and its end are kept");
  assert.ok(q.text.length < 2200, `held to about 2000 characters (${q.text.length}), so a long script costs little`);
  assert.match(readLoad({ script }).reason, /Question 1 \("statement 001 x{26}…"\) is too long/);
});

test("a long question over several lines stays whole when another sentence follows on its last line", () => {
  const lines = [`So ${"a".repeat(95)},`, `and ${"b".repeat(95)},`, `what ${"c".repeat(60)}? Thanks.`];
  const [q] = readScript(["### **1 · A · 00:00**", ...lines].join("\n")).questions;
  assert.equal(q.text, `${lines.join(" ").replace(" Thanks.", "")}`);
  assert.ok(q.text.length > 200 && q.text.length <= 300, `${q.text.length} characters`);
});

test("a pause at the end of a line ends its sentence, unless the next line goes on in lower case", () => {
  assert.deepEqual(readScript("### **1 · A · 00:00**\nAnd then the backup failed…\nRobert, what did you do next?").questions.map((q) => q.text), ["Robert, what did you do next?"]);
  assert.deepEqual(readScript("### **1 · A · 00:00**\nSo...\n\"Who called first?\"").questions.map((q) => q.text), ["\"Who called first?\""]);
  assert.deepEqual(readScript("### **1 · A · 00:00**\nSo…\nwhat now?").questions.map((q) => q.text), ["So… what now?"]);
  assert.deepEqual(readScript("### **1 · A · 00:00**\nAnd (Dr. Lee) what did you see?").questions.map((q) => q.text), ["And (Dr. Lee) what did you see?"], "a title after a bracket");
});

test("the script fits one shell argument once written as JSON: at most 50,000 characters and 96 KB", () => {
  assert.match(readLoad({ script: `### **1 · A · 00:00**\n${"a".repeat(LOAD_LIMITS.script)}` }).reason, /"script" is too long\. Limit: 50000 characters/);
  // Each apostrophe is six bytes as \u0027, each "·" two: 20,000 of them are under 50,000 characters, but not under 96 KB.
  assert.match(readLoad({ script: `### **1 · A · 00:00**\n${"'·".repeat(20_000)}` }).reason, /"script" is too long\. Limit: 96 KB written as JSON/);
  // The biggest script that loads, with the biggest other fields, as the connect message's B: under one shell argument (128 KB).
  const ok = `### **1 · A · 00:00**\n${"'".repeat(Math.floor((LOAD_SCRIPT_BYTES - 40) / 6))}`;
  assert.equal(readLoad({ script: ok }).ok, true);
  const b = JSON.stringify({ show: "€".repeat(LOAD_LIMITS.show), guest: "€".repeat(LOAD_LIMITS.guest), notes: "'".repeat(LOAD_LIMITS.notes), script: ok }).replaceAll("'", "\\u0027");
  assert.ok(new TextEncoder().encode(b).length < 128 * 1024, `${new TextEncoder().encode(b).length} bytes`);
});

test("initials and letters with full stops keep a question whole, on one line and over several", () => {
  const r = readScript("### **1 · A · 00:00**\nWhat changed in the U.S. after the launch?\nDid J. K. Rowling\nsee it? Yes.\nAnd in the\nU.S.\nafter that?");
  assert.deepEqual(r.questions.map((q) => q.text), ["What changed in the U.S. after the launch?", "Did J. K. Rowling see it?", "And in the U.S. after that?"]);
});

test("emphasis marks are dropped; a minute past 59 after an hour is no time", () => {
  const r = readScript("### *1 · INTRO · 00:00*\n*Why does it fail?*\n_Is it the host?_ And snake_case stays?\n### **2 · B · 1:75:00**\nNot on air?");
  assert.deepEqual(r.parts, [{ name: "Intro", minutes: SCRIPT_LAST_MINUTES }]);
  assert.deepEqual(r.questions.map((q) => q.text), ["Why does it fail?", "Is it the host?", "And snake_case stays?"]);
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
