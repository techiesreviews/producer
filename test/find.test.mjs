// The search box over the whole question list (src/find.mjs, TOOLS-344): every word typed must be in the question,
// matches stay in show order and are grouped by the part the plan puts them under; plain text in, plain facts out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findQuestions, findWords, markWords } from "../src/find.mjs";
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
