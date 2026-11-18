// The search box over the whole question list (src/find.mjs, TOOLS-344): every word typed must be in the question,
// matches stay in show order and are grouped by the part the plan puts them under; plain text in, plain facts out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuestions, findWords, markWords } from "../src/find.mjs";
import { readFileSync } from "node:fs";
import { readPlan } from "../src/runorder.mjs";

const PLAN = readPlan([
  "3 Intro",
  "1. How did the cookie trick start?",
  "2. Who found it first?",
  "8 Her story",
  "3. What did the fake cookie banner say?",
  "4. Was the login page real?",
  "5. What would you change now?",
].join("\n"));

const ns = (r) => r.groups.map((g) => [g.part, g.items]);

test("words: lower case, split on spaces, empty ones dropped", () => {
  assert.deepEqual(findWords("  Cookie   BANNER "), ["cookie", "banner"]);
  assert.deepEqual(findWords("   "), []);
});

test("one word finds every question that holds it, grouped by the part above it in the plan", () => {
  const r = findQuestions({ plan: PLAN, query: "cookie" });
  assert.equal(r.count, 2);
  assert.deepEqual(ns(r), [[0, [1]], [1, [3]]]);
  assert.deepEqual(r.groups.map((g) => g.name), ["Intro", "Her story"]);
});

test("every word must be in the question, in any order and any case", () => {
  assert.deepEqual(ns(findQuestions({ plan: PLAN, query: "BANNER cookie" })), [[1, [3]]]);
  assert.equal(findQuestions({ plan: PLAN, query: "cookie login" }).count, 0);
});

test("a part of a word matches too (the host is still typing)", () => {
  assert.deepEqual(ns(findQuestions({ plan: PLAN, query: "coo" })), [[0, [1]], [1, [3]]]);
});

test("an empty search finds nothing and gives no groups", () => {
  assert.deepEqual(findQuestions({ plan: PLAN, query: "  " }), { words: [], count: 0, groups: [] });
  assert.deepEqual(findQuestions({ plan: null, query: "cookie" }).groups, [], "no plan, nothing to search");
});

test("a plan with every part first and the questions after says no part: one group without a name, in show order", () => {
  const plan = readPlan("3 Intro\n8 Her story\n1. Why the cookie?\n2. What now?\n3. Cookie again?");
  assert.deepEqual(plan.questionParts, [null, null, null]);
  const r = findQuestions({ plan, query: "cookie" });
  assert.deepEqual(ns(r), [[null, [1, 3]]]);
  assert.equal(r.groups[0].name, "");
});

test("the plan reader: a question belongs to the part written above it, only when the plan puts questions under parts", () => {
  assert.deepEqual(PLAN.questionParts, [0, 0, 1, 1, 1]);
  assert.deepEqual(readPlan("1. Before any part?\n3 Intro\n2. In the intro?\n8 Story\n3. In the story?").questionParts, [null, 0, 1], "above the first part: no part");
  assert.deepEqual(readPlan("3 Intro\n1. Why?").questionParts, [null], "one part with its questions after it says nothing new");
});

test("a plan that puts no question under two different parts says no part (an opening question, or one part added after the questions)", () => {
  assert.deepEqual(readPlan("1. An opening question?\n3 Intro\n8 Story\n2. Why?\n3. How?").questionParts, [null, null, null], "an opening question above the parts");
  assert.deepEqual(readPlan("3 Intro\n8 Story\n1. Why?\n2. How?\n5 Only if time").questionParts, [null, null], "one more part after the questions");
  assert.deepEqual(readPlan("3 Intro\n1. Why?\n8 Story").questionParts, [null], "questions under one part only");
});

test("any plan with questions under two parts or more groups them under the part above each, empty parts in front or not", () => {
  assert.deepEqual(readPlan("3 Welcome\n4 Housekeeping\n5 Story\n1. X?\n6 Demo\n2. Y?").questionParts, [2, 3], "two empty parts in front");
  // Known limit until plans carry a part per question (TOOLS-345): every part first, the questions, then a bonus part
  // with a question of its own reads as questions under the last main part and the bonus part.
  assert.deepEqual(readPlan("3 A\n4 B\n5 C\n1. X?\n2. Y?\n6 Bonus\n3. Z?").questionParts, [2, 2, 3]);
  assert.deepEqual(readPlan("3 Intro\n8 Story\n1. Why?\n4 Demo\n2. How?\n5 Close\n3. Next?").questionParts, [1, 2, 3], "a part with no questions (Intro) still groups the rest");
  assert.deepEqual(readPlan("10 Intro\n20 Story\n1. Q?\n5 Break\n20 Demo\n2. R?\n10 Close").questionParts, [1, 3], "an intro, a break and a close with no questions");
  assert.deepEqual(readPlan("10 Intro\n20 Story\n1. Q?\n20 Demo\n2. R?").questionParts, [1, 2], "a small plan with one empty part in front (the paste box's example shape)");
});

test("the Livestream 3 layout at full size (10 parts first, then 72 numbered questions): matches in show order, no headings, well under a second", () => {
  // A stand-in with the real plan's shape and quirks (blank lines, a part ending in ?, apostrophes, 2FA); the real plan
  // names a guest and stays out of this public repo (PRODUCER_PLAN_FIXTURE runs the next test on it).
  const lines = ["Show: Stand-in", "Guest: Sam Example", "", ...Array.from({ length: 10 }, (_, p) => (p === 2 ? "4 Is This A Risk For You?" : `${p + 3} Part ${p + 1}`)), ""];
  for (let n = 1; n <= 72; n++) lines.push(`${n}. Question ${n}: what's ${n === 6 || n === 8 ? "the cookie" : n === 2 ? "2FA worth" : "Sam's view"}?`);
  const plan = readPlan(lines.join("\n"));
  assert.deepEqual([plan.parts.length, plan.questions.length], [10, 72]);
  const t0 = performance.now();
  const r = findQuestions({ plan, query: "cookie" });
  const ms = performance.now() - t0;
  assert.deepEqual(ns(r), [[null, [6, 8]]]);
  assert.ok(ms < 50, `the search took ${ms.toFixed(2)} ms`);
  assert.deepEqual(ns(findQuestions({ plan, query: "2fa" })), [[null, [2]]], "2FA in any case");
  assert.equal(findQuestions({ plan, query: "sam's" }).count, 69, "an apostrophe is plain text");
  assert.equal(plan.parts[2].name, "Is This A Risk For You?", "a part ending in ? stays a part");
});

// The real show plan, kept outside this public repo: PRODUCER_PLAN_FIXTURE=<path to the Livestream 3 producer-plan.txt>.
const REAL = process.env.PRODUCER_PLAN_FIXTURE;
test("the Livestream 3 plan itself (PRODUCER_PLAN_FIXTURE): 72 questions, 10 parts, matches without headings", { skip: !REAL && "PRODUCER_PLAN_FIXTURE not set" }, () => {
  const plan = readPlan(readFileSync(REAL, "utf8"));
  assert.deepEqual([plan.ok, plan.parts.length, plan.questions.length], [true, 10, 72]);
  assert.ok(plan.questionParts.every((p) => p === null), "parts first, then the questions: no part per question");
  const t0 = performance.now();
  const cookie = findQuestions({ plan, query: "cookie" });
  assert.ok(performance.now() - t0 < 50);
  assert.deepEqual(ns(cookie), [[null, [6, 8]]]);
  assert.ok(findQuestions({ plan, query: "2fa" }).count >= 2);
  assert.ok(findQuestions({ plan, query: "login" }).count >= 3);
});

test("72 questions over 10 parts: a search takes well under a second", () => {
  const lines = [];
  for (let p = 1; p <= 10; p++) {
    lines.push(`${p + 2} Part number ${p}`);
    for (let q = 1; q <= (p <= 2 ? 8 : 7); q++) lines.push(`${lines.length}. Question ${q} of part ${p} about cookies and sessions?`);
  }
  const plan = readPlan(lines.join("\n"));
  assert.equal(plan.questions.length, 72);
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) findQuestions({ plan, query: "cookies sessions part 7" });
  const each = (performance.now() - t0) / 100;
  assert.ok(each < 50, `one search took ${each.toFixed(2)} ms`);
  assert.deepEqual(findQuestions({ plan, query: "of part 10" }).groups.map((g) => g.name), ["Part number 10"]);
});

test("markWords: the searched words marked in the question's own text, case kept", () => {
  assert.deepEqual(markWords("The Cookie and the cookie jar", ["cookie"]), [
    { text: "The ", hit: false }, { text: "Cookie", hit: true }, { text: " and the ", hit: false }, { text: "cookie", hit: true }, { text: " jar", hit: false },
  ]);
  assert.deepEqual(markWords("What (now)?", ["(now)"]), [{ text: "What ", hit: false }, { text: "(now)", hit: true }, { text: "?", hit: false }], "special characters are plain text");
  assert.deepEqual(markWords("Plain", []), [{ text: "Plain", hit: false }]);
  assert.deepEqual(markWords("cookies", ["cook", "cookies"]), [{ text: "cookies", hit: true }], "the longer word wins where two overlap");
});
