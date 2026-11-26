// The question card's rules (src/questions.mjs): the prepared question shows from the start and whenever the agent
// is quiet, the agent's answer replaces it once, Asked and Skip move on, an alternative swaps in, and the state shown
// on Suggest now, the thinking light and the turn count.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createQuestions, suggestButton, thinkLight, turnsText, isThinking, THINK_MS } from "../src/questions.mjs";

const PLAN = ["How did it start?", "Who paid first?", "What went wrong?", "What is next?"];
const PLAN8 = ["A?", "B?", "C?", "D?", "E?", "F?", "G?", "H?"];
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

test("the agent's answer takes the card: its first suggestion; a new question waits below, the prepared ones go to Relevant now", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  assert.equal(q.view().relevant, null, "no list before the agent's first answer");
  const shown = q.suggest({ seq: 1, suggestions: [{ question: 3, why: "she hinted at it" }, { text: "What surprised you?", why: "ties to the van" }] });
  assert.equal(shown, true);
  const v = q.view();
  assert.deepEqual(v.main, { n: 3, text: "What went wrong?", why: "she hinted at it", from: "agent" }, "a prepared question by its number");
  assert.deepEqual(v.alts, [{ text: "What surprised you?", why: "ties to the van", from: "agent" }], "the new question to swap in; the prepared question it replaced goes back to the list");
  assert.deepEqual(v.relevant, [], "the only prepared match is on the card");
});

test("up to six matches: the first on the card, the other prepared ones in Relevant now, best first", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.suggest({ seq: 1, suggestions: [7, 2, 5, 3, 8, 6, 4].map((n) => ({ question: n })) });
  const v = q.view();
  assert.equal(v.main.n, 7);
  assert.deepEqual(v.relevant.map((r) => r.n), [2, 5, 3, 8, 6], "a seventh suggestion gives way");
  assert.deepEqual(v.alts, [], "no rows to swap in once the agent answered with prepared questions");
  const r = createQuestions();
  r.setPlan(PLAN);
  r.suggest({ seq: 1, suggestions: [{ text: "New one?" }] });
  r.suggest({ seq: 2, suggestions: [{ question: 2 }, { question: 3 }, { question: 4 }] });
  assert.deepEqual(texts(r.view()), ["Who paid first?", "New one?"], "the replaced new question is kept to swap back");
  assert.deepEqual(r.view().relevant.map((x) => x.n), [3, 4]);
});

test("the agent picking the question already on the card shows it once", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.suggest({ seq: 1, suggestions: [{ question: 1, why: "a good opener" }, { text: "New?" }, { question: 1 }] });
  assert.deepEqual(texts(q.view()), ["How did it start?", "New?"]);
  assert.deepEqual(q.view().relevant, []);
  assert.equal(q.view().main.why, "a good opener");
});

test("markAsked: a question used on the Prompter's strip counts as Asked; on the card it moves on like Asked", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.suggest({ seq: 1, suggestions: [{ question: 2 }, { question: 3 }] });
  assert.equal(q.view().main.n, 2);
  assert.equal(q.markAsked(2), true, "the card's question");
  assert.equal(q.view().main.n, 3, "the card moves on to the best match still open");
  assert.equal(q.markAsked(4), true, "a question not on the card");
  assert.deepEqual(q.marked().asked, [2, 4]);
  assert.deepEqual(q.view().counts, { asked: 2, skipped: 0, left: 2 });
  assert.equal(q.markAsked(2), false, "already asked: nothing changes");
  assert.equal(q.markAsked(9), false, "not on the plan");
  assert.equal(q.markAsked(0), false);
  assert.equal(q.view().main.n, 3);
});

test("one wait with an answer and asked: the answer takes the card first, then the used question leaves it", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.suggest({ seq: 4, suggestions: [{ question: 2 }, { question: 3 }, { question: 4 }] });
  q.markAsked(2);
  const v = q.view();
  assert.equal(v.main.n, 3);
  assert.deepEqual(v.relevant.map((r) => r.n), [4], "Q2 is not in Relevant now");
  assert.deepEqual(q.marked().asked, [2]);
});

test("markAsked leaves the host's own pick on the card unless it is the pick itself", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.pick(4);
  assert.equal(q.markAsked(1), true);
  assert.deepEqual([q.view().main.n, q.view().main.from], [4, "picked"], "the pick stays");
  assert.equal(q.markAsked(4), true);
  assert.notEqual(q.view().main?.n, 4, "the used pick leaves the card");
  q.skip();
  assert.equal(q.markAsked(q.marked().skipped[0]), false, "a question the host skipped stays skipped");
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
  assert.equal(q.suggest({ seq: 1, suggestions: [{ question: 1 }, { question: 2 }, { question: 9 }] }), true, "the list shows, saying no other matches");
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

test("a new question the host asked or skipped never comes back", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.suggest({ seq: 1, suggestions: [{ text: "Van?" }] });
  q.skip();
  assert.equal(q.view().main.n, 1, "back to the list");
  q.suggest({ seq: 2, suggestions: [{ text: "van?" }, { question: 2 }] });
  assert.deepEqual(texts(q.view()), ["Who paid first?"], "the skipped new question is left out");
  assert.equal(q.suggest({ seq: 3, suggestions: [{ text: "Van?" }] }), false, "only it: the card stays");
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

test("marked(): the host's own presses for the end report: prepared questions asked and skipped by number, new questions asked", () => {
  const q = createQuestions();
  assert.deepEqual(q.marked(), { asked: [], skipped: [], newAsked: 0 });
  q.setPlan(PLAN);
  q.swap(1); // Q3 on the card
  q.asked(); // Q3; Q2 moves up
  q.skip(); // Q2; Q1 moves up
  q.suggest({ seq: 1, suggestions: [{ text: "Why a van?" }, { text: "Who drove?" }] });
  q.asked(); // a new one
  q.skip(); // a new one, skipped: not counted
  q.asked(); // Q1
  assert.deepEqual(q.marked(), { asked: [1, 3], skipped: [2], newAsked: 1 });
  q.setPlan(PLAN.slice(0, 2));
  assert.deepEqual(q.marked(), { asked: [1], skipped: [2], newAsked: 1 }, "only the questions of the plan as it is now");
});

test("pick(n): the host's pick from the search takes the card and stays there until Asked or Skip", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  assert.equal(q.pick(3), true);
  let v = q.view();
  assert.deepEqual(v.main, { n: 3, text: "What went wrong?", from: "picked" });
  assert.equal(v.alts[0].n, 1, "before the agent's first answer, the question it replaced comes first to swap back");
  assert.equal(q.pick(3), false, "already on the card");
  assert.equal(q.pick(9), false, "not in the plan");
  // The agent's answer does not take a picked card: its matches show in Relevant now.
  q.suggest({ seq: 1, suggestions: [{ question: 2, why: "fits" }] });
  v = q.view();
  assert.equal(v.main.n, 3);
  assert.deepEqual(v.relevant.map((r) => r.n), [2]);
  q.asked();
  assert.deepEqual(q.marked().asked, [3]);
  assert.deepEqual(q.view().main, { n: 2, text: "Who paid first?", why: "fits", from: "agent" }, "after Asked the best match takes the card");
});

test("pick(n) of an asked or skipped question takes it back onto the card and out of the count", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.asked();
  assert.deepEqual(q.marked().asked, [1]);
  q.pick(1);
  assert.equal(q.view().main.n, 1);
  assert.deepEqual(q.marked().asked, []);
  assert.equal(q.view().counts.left, 4);
});

test("a picked question swapped away is an ordinary alternative; a new plan keeps the pick", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.pick(4);
  q.setPlan(PLAN);
  assert.deepEqual(q.view().main, { n: 4, text: "What is next?", from: "picked" });
  q.swap(0);
  const v = q.view();
  assert.equal(v.main.n, 1);
  assert.equal(v.alts.find((a) => a.n === 4).from, "list");
  q.suggest({ seq: 1, suggestions: [{ question: 2 }] });
  assert.equal(q.view().main.n, 2, "with no pick on the card the agent's answer takes it again");
});

test("under a pick, the agent's answers change only the Relevant now list", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.suggest({ seq: 1, suggestions: [{ question: 3 }, { question: 5 }, { question: 7 }] });
  assert.equal(q.pick(5), true, "a click in Relevant now");
  let v = q.view();
  assert.deepEqual(v.main, { n: 5, text: "E?", from: "picked" });
  assert.deepEqual(v.relevant.map((r) => r.n), [3, 7], "the agent's best match goes back to the list; the pick leaves it");
  assert.deepEqual(v.alts, []);
  q.suggest({ seq: 2, suggestions: [{ question: 6 }, { question: 8 }] });
  v = q.view();
  assert.equal(v.main.n, 5, "the pick stays");
  assert.deepEqual(v.relevant.map((r) => r.n), [6, 8], "the list follows the newest answer");
  q.skip();
  assert.equal(q.view().main.n, 6, "Skip: the best match takes the card");
  assert.deepEqual(q.view().relevant.map((r) => r.n), [8]);
});

test("pick(n) of the question already under a viewer question marks it picked", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  assert.equal(q.pick(1), true, "the card's own question becomes the host's pick");
  assert.equal(q.view().main.from, "picked");
  assert.equal(q.pick(1), false, "already picked");
});

test("a new question a pick replaced stays below to swap back through later answers", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.suggest({ seq: 1, suggestions: [{ text: "New?" }] });
  q.pick(3);
  assert.deepEqual(q.view().alts.map((a) => a.text), ["New?"]);
  q.suggest({ seq: 2, suggestions: [{ question: 5 }, { question: 6 }] });
  q.suggest({ seq: 3, suggestions: [{ question: 7 }, { text: "Other?" }] });
  assert.deepEqual(q.view().alts.map((a) => a.text), ["Other?", "New?"]);
  assert.deepEqual(q.view().relevant.map((r) => r.n), [7]);
});

test("a pick that a shorter plan dropped leaves nothing behind to swap back", () => {
  const q = createQuestions();
  q.setPlan(PLAN);
  q.pick(4);
  q.setPlan(PLAN.slice(0, 3));
  q.suggest({ seq: 1, suggestions: [{ question: 3 }] }); // question 3 on the card from the agent
  q.pick(3);
  q.suggest({ seq: 2, suggestions: [{ question: 2 }, { text: "New?" }] });
  assert.deepEqual(q.view().alts.map((a) => a.n ?? a.text), ["New?"], "the new suggestion only: no leftover question");
  assert.deepEqual(q.view().relevant.map((r) => r.n), [2]);
});

test("Asked and Skip move to the best match still open, then back to the list", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.suggest({ seq: 1, suggestions: [{ question: 3 }, { question: 5, why: "his last point" }, { question: 7 }] });
  q.asked();
  assert.deepEqual(q.view().main, { n: 5, text: "E?", why: "his last point", from: "agent" });
  q.skip();
  assert.equal(q.view().main.n, 7);
  q.asked();
  assert.deepEqual(q.view().main, { n: 1, text: "A?", from: "list" }, "no match left: the next prepared question");
  assert.deepEqual(q.view().relevant, [], "the list says no other matches");
  assert.deepEqual(q.view().alts, [], "and no rows to swap in come back");
});

test("Relevant now leaves out what was asked or skipped; a new plan reads the matches again", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.pick(2);
  q.asked(); // Q2
  q.suggest({ seq: 1, suggestions: [{ question: 4 }, { question: 2 }, { question: 6 }] });
  assert.deepEqual(q.view().relevant.map((r) => r.n), [6], "Q2 was asked");
  q.setPlan(["A?", "B?", "C?", "D?", "E?", "F, again?"]);
  assert.deepEqual(q.view().relevant.map((r) => r.text), ["F, again?"]);
  q.setPlan(PLAN8.slice(0, 5));
  assert.deepEqual(q.view().relevant, [], "a match the plan no longer has is dropped");
});

test("a question the agent names twice counts once", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.suggest({ seq: 1, suggestions: [3, 5, 5, 6, 3, 7, 8, 1].map((n) => ({ question: n })) });
  assert.equal(q.view().main.n, 3);
  assert.deepEqual(q.view().relevant.map((r) => r.n), [5, 6, 7, 8, 1]);
  q.suggest({ seq: 2, suggestions: [{ text: "New?" }, { text: "new?" }, { question: 2 }] });
  assert.deepEqual(texts(q.view()), ["New?"], "a new question repeated in other letters counts once too");
});

test("a newer answer with nothing usable leaves the card and empties the list", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.suggest({ seq: 1, suggestions: [{ question: 2 }, { question: 3 }, { question: 4 }] });
  q.asked(); // Q2; Q3 takes the card
  assert.equal(q.suggest({ seq: 2, suggestions: [{ question: 2 }] }), true, "the list changed");
  assert.equal(q.view().main.n, 3, "the card stays");
  assert.deepEqual(q.view().relevant, [], "the old matches are gone");
  q.asked();
  assert.equal(q.view().main.n, 1, "Asked: the next on the list, not an old match");
  assert.equal(q.suggest({ seq: 3, suggestions: [{ question: 2 }] }), false, "an empty list stays empty: nothing changed");
});

test("a match swapped below never shows twice when it moves back up", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.suggest({ seq: 1, suggestions: [{ question: 3 }, { text: "New?" }] });
  q.swap(0); // the new question on the card, Q3 below
  assert.deepEqual(texts(q.view()), ["New?", "C?"]);
  q.asked();
  assert.deepEqual(texts(q.view()), ["C?"], "Q3 on the card, not also below it");
});

test("a first answer naming only questions already done: the card stays, the list says no other matches instead of the rows to swap in", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.asked(); // Q1; Q2 on the card, Q3 and Q4 below
  assert.equal(q.suggest({ seq: 1, suggestions: [{ question: 1 }] }), true, "the screen changes");
  const v = q.view();
  assert.equal(v.main.n, 2, "the card stays");
  assert.deepEqual([v.relevant, v.alts], [[], []], "the list (empty) in place of the rows to swap in");
});

test("a later answer with nothing usable keeps a prepared question swapped below", () => {
  const q = createQuestions();
  q.setPlan(PLAN8);
  q.asked(); // Q1 done; Q2 on the card
  q.suggest({ seq: 1, suggestions: [{ question: 3 }, { text: "New?" }] }); // Q3 on the card, New? below
  q.swap(0); // New? on the card, Q3 below
  assert.deepEqual(texts(q.view()), ["New?", "C?"]);
  assert.equal(q.suggest({ seq: 2, suggestions: [{ question: 1 }] }), false, "nothing shown changed");
  assert.deepEqual(texts(q.view()), ["New?", "C?"], "Q3 stays below to swap in");
});
