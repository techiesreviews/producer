// The question card's rules (src/questions.mjs): the prepared question shows from the start and whenever the agent
// is quiet, the agent's answer replaces it once, Asked and Skip move on, an alternative swaps in, and the state shown
// on Suggest now, the thinking light and the turn count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuestions, suggestButton, thinkLight, turnsText, isThinking, THINK_MS } from "../src/questions.mjs";

const PLAN = ["How did it start?", "Who paid first?", "What went wrong?", "What is next?"];
const texts = (v) => [v.main?.text ?? null, ...v.alts.map((a) => a.text)];

test("at the start the card shows the first prepared question, with the next two to swap in", () => {
  const q = createQuestions();
  assert.equal(q.view().main, null, "no plan, no question");
  q.setPlan(PLAN);
  const v = q.view();
  assert.deepEqual(v.main, { n: 1, text: "How did it start?", from: "list" });
  assert.deepEqual(v.alts.map((a) => a.n), [2, 3]);
  assert.deepEqual(v.counts, { asked: 0, skipped: 0, left: 4 });
});

test("the agent's answer takes the card: its first suggestion, the others and the old question to swap in", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  const shown = q.suggest({ seq: 1, suggestions: [{ question: 3, why: "she hinted at it" }, { text: "What surprised you?", why: "ties to the van" }] });
  assert.equal(shown, true);
  const v = q.view();
  assert.deepEqual(v.main, { n: 3, text: "What went wrong?", why: "she hinted at it", from: "agent" }, "a prepared question by its number");
  assert.deepEqual(v.alts, [{ text: "What surprised you?", why: "ties to the van", from: "agent" }, { n: 1, text: "How did it start?", from: "list" }], "the second suggestion, then the question it replaced");
});

test("three suggestions: the first on the card, the second and the replaced question to swap in", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.suggest({ seq: 1, suggestions: [{ text: "New one?" }] });
  q.suggest({ seq: 2, suggestions: [{ question: 2 }, { question: 3 }, { question: 4 }] });
  assert.deepEqual(texts(q.view()), ["Who paid first?", "What went wrong?", "New one?"], "the replaced new question is kept, the third suggestion gives way");
});

test("the agent picking the question already on the card shows it once", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.suggest({ seq: 1, suggestions: [{ question: 1, why: "a good opener" }, { text: "New?" }] });
  assert.deepEqual(texts(q.view()), ["How did it start?", "New?", "Who paid first?"]);
  assert.equal(q.view().main.why, "a good opener");
});

test("first: the first prepared question still open", () => {
  const q = createQuestions();
  assert.equal(q.view().first, null);
  q.setPlan(PLAN);
  assert.equal(q.view().first, 1);
  q.swap(1); // Q3 on the card, Q2 and Q1 below
  q.skip(); // Q3 skipped: Q2 on the card
  assert.deepEqual([q.view().main.n, q.view().first], [2, 1], "Q1 is still open, so Q2 is not the next on the list");
  q.asked(); // Q2
  q.asked(); // Q1
  assert.deepEqual([q.view().main.n, q.view().first], [4, 4]);
});

test("an answer is shown once: the same or an older seq changes nothing", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  assert.equal(q.suggest({ seq: 2, suggestions: [{ text: "First?" }] }), true);
  q.asked();
  assert.equal(q.suggest({ seq: 2, suggestions: [{ text: "First?" }] }), false, "the same answer again");
  assert.equal(q.suggest({ seq: 1, suggestions: [{ text: "Older?" }] }), false, "an older answer");
  assert.notEqual(q.view().main.text, "First?", "the asked suggestion does not come back");
});

test("suggestions that point at an asked, skipped or missing question are left out; none left keeps the card", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.asked(); // Q1
  q.skip(); // Q2
  assert.equal(q.view().main.n, 3);
  assert.equal(q.suggest({ seq: 1, suggestions: [{ question: 1 }, { question: 2 }, { question: 9 }] }), false);
  assert.equal(q.view().main.n, 3, "the card keeps its question");
  q.suggest({ seq: 2, suggestions: [{ question: 2 }, { question: 4, why: "next part" }] });
  assert.deepEqual(q.view().main, { n: 4, text: "What is next?", why: "next part", from: "agent" });
});

test("Asked and Skip move to the first alternative and count the prepared question", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.asked();
  assert.deepEqual(texts(q.view()), ["Who paid first?", "What went wrong?", "What is next?"]);
  q.skip();
  assert.deepEqual(texts(q.view()), ["What went wrong?", "What is next?"]);
  assert.deepEqual(q.view().counts, { asked: 1, skipped: 1, left: 2 });
  q.asked();
  q.asked();
  assert.equal(q.view().main, null, "every prepared question done");
  assert.equal(q.view().counts.left, 0);
  assert.equal(q.asked(), false, "Asked with no question does nothing");
});

test("Asked on a new suggestion moves on without counting a prepared question", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.suggest({ seq: 1, suggestions: [{ text: "What surprised you?" }] });
  q.asked();
  assert.deepEqual(q.view().counts, { asked: 0, skipped: 0, left: 4 });
  assert.equal(q.view().main.n, 1, "back to the prepared question");
});

test("an alternative swaps with the question on the card", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  assert.equal(q.swap(1), true);
  assert.deepEqual(texts(q.view()), ["What went wrong?", "Who paid first?", "How did it start?"]);
  assert.equal(q.swap(5), false, "no such alternative");
});

test("a new plan keeps what was asked and reads the prepared questions again", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.asked();
  q.setPlan(["How did it start?", "Who paid first, really?", "What went wrong?"]);
  assert.deepEqual(texts(q.view()), ["Who paid first, really?", "What went wrong?"]);
  q.setPlan([]);
  assert.equal(q.view().main, null);
});

test("with no agent connected, Suggest now says so on itself and the light is grey", () => {
  assert.deepEqual(suggestButton({ agent: "off", thinking: false, waitMs: 0 }), { text: "Suggest now · no agent", state: null, off: "No agent connected. The next question comes from your list." });
  assert.deepEqual(suggestButton({ agent: "waiting", thinking: false, waitMs: 0 }).text, "Suggest now · no agent", "a loop that went quiet counts as no agent");
  assert.deepEqual(suggestButton({ agent: "elsewhere", thinking: false, waitMs: 0 }), { text: "Suggest now · other tab", state: null, off: "Your agent is connected in another tab." }, "connected in another tab is not no agent");
  assert.deepEqual(thinkLight({ agent: "elsewhere", thinking: false }), { kind: "", label: "Agent in another tab", tip: "Your agent is connected in another tab." });
  assert.deepEqual(thinkLight({ agent: "off", thinking: false }), { kind: "", label: "No agent", tip: "No agent: the next question comes from your list." });
});

test("while the agent works, the button and the light say so; then the 10 s spacing shows on the button", () => {
  assert.deepEqual(suggestButton({ agent: "on", thinking: true, waitMs: 8_000 }), { text: "Thinking…", state: "busy", off: "Your agent is thinking." }, "busy, and a press says why nothing happens");
  assert.deepEqual(thinkLight({ agent: "on", thinking: true }), { kind: "think", label: "Agent is thinking", tip: "Agent is thinking. The card stays until it is ready." });
  assert.deepEqual(suggestButton({ agent: "on", thinking: false, waitMs: 6_200 }), { text: "Suggest now · 7 s", state: null, off: "One every 10 s." });
  assert.deepEqual(suggestButton({ agent: "on", thinking: false, waitMs: 1, slow: true }).off, "One every 20 s with Slow down.");
  assert.deepEqual(suggestButton({ agent: "on", thinking: false, waitMs: 0 }), { text: "Suggest now", state: null, off: "" });
  assert.deepEqual(thinkLight({ agent: "on", thinking: false }), { kind: "ok", label: "Agent ready", tip: "Agent ready." });
});

test("the thinking light stays until an answer, at most a minute", () => {
  assert.equal(isThinking(0, 5_000), false, "no cue out");
  assert.equal(isThinking(1_000, 1_000 + THINK_MS - 1), true);
  assert.equal(isThinking(1_000, 1_000 + THINK_MS), false, "no answer in a minute: the light goes back to ready");
});

test("the turn count", () => {
  assert.equal(turnsText(0), "0 turns");
  assert.equal(turnsText(1), "1 turn");
  assert.equal(turnsText(14), "14 turns");
});
