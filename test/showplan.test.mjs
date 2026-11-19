// The show plan (src/showplan.mjs): one owner for step 3's plan box. There is one way in for each of the three ways a
// show arrives (the host's own text, the demo show, the agent's load_show), and every way leaves the plan, its notes,
// who wrote it and the agent-load exchange in the same clear state. The views only describe that state: they never
// change it.
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { createShowPlan, DEMO_CONFIRM_MS } from "../src/showplan.mjs";
import { DEMO_SHOW } from "../src/demo.mjs";
import { LOAD_WAIT_MS, loadArgs, planText, readLoad } from "../src/agent-load.mjs";
import { readPlan } from "../src/runorder.mjs";
import { findQuestions } from "../src/find.mjs";

const GOOD = {
  show: "Sample Show",
  guest: "Sample Guest",
  questions: ["How did it start?", "What went wrong first?"],
  parts: [{ name: "Intro", minutes: 5 }, { name: "Main talk", minutes: 30 }],
  notes: "Ask about the early days.",
};
const HOST = "Show: My Show\nGuest: My Guest\n10 Intro\n20 Story\n1. Why?";

function make(over = {}) {
  const changes = [];
  const show = createShowPlan({ onChange: () => changes.push(true), ...over });
  return { show, changes };
}

test("pasted by hand: the text is read at once, a clear plan gets a run order, an unclear one gets none", () => {
  const { show } = make();
  assert.equal(show.plan, null);
  assert.equal(show.run, null);
  show.edit(HOST);
  assert.equal(show.text, HOST);
  assert.deepEqual({ show: show.plan.show, guest: show.plan.guest, parts: show.plan.parts, questions: show.plan.questions }, { show: "My Show", guest: "My Guest", parts: [{ name: "Intro", minutes: 10 }, { name: "Story", minutes: 20 }], questions: ["Why?"] });
  assert.ok(show.run, "a run order for the parts");
  assert.equal(show.read.ok, true, "the last read, for the plan button");
  show.edit("10 Intro\nnot a line");
  assert.equal(show.plan, null);
  assert.equal(show.run, null);
  assert.deepEqual(show.read, { ok: false, line: 2, text: "not a line" });
});

test("pasted by hand: the run order is made again only when the parts change", () => {
  const { show } = make();
  show.edit(HOST);
  const first = show.run;
  show.edit(`${HOST}\n2. And then?`);
  assert.equal(show.run, first, "a new question keeps the run order");
  show.edit(HOST.replace("20 Story", "25 Story"));
  assert.notEqual(show.run, first, "new minutes make a new run order");
});

test("load_show: the agent's show lands in the box as the host's own text, with its notes, and the button says who loaded it", () => {
  const { show } = make();
  assert.deepEqual(show.agentLoad(GOOD, "Claude Code"), { result: { loaded: true, questions: 2, parts: 2 } });
  assert.equal(show.text, planText(GOOD));
  assert.equal(show.plan.show, "Sample Show");
  assert.equal(show.notes, "Ask about the early days.");
  assert.ok(show.run);
  const said = show.loadView("on", "Codex");
  assert.equal(said.state, "ok");
  assert.equal(said.text, "Questions loaded by your agent · 2 questions · 2 parts ✓");
  assert.equal(show.byAgent, true, "the box holds the agent's show");
  assert.equal(show.demoView().text, "Load demo show");
});

test("load_show after the button: the agent named on the button loads over the host's plan, and the wait ends", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { show, changes } = make();
    show.edit(HOST);
    assert.equal(show.askAgent("Claude Code", () => true), true);
    assert.equal(show.loadView("on", "Codex").text, "Agent is loading…");
    assert.equal(show.agentLoad(GOOD, "Codex").result.loaded, true);
    assert.equal(show.loadView("on", "Codex").text, "Questions loaded by your agent · 2 questions · 2 parts ✓");
    mock.timers.tick(LOAD_WAIT_MS);
    assert.equal(show.loadView("on", "Codex").state, "ok", "the old wait no longer fires");
    assert.equal(changes.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("the load button: a cue that cannot go changes nothing; a slow agent fails the wait with the same words as before", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { show, changes } = make();
    assert.equal(show.askAgent("Claude Code", () => false), false);
    assert.equal(show.loadView("on", "Claude Code").text, "Let my agent load it");
    assert.equal(show.askAgent("Claude Code", () => true), true);
    mock.timers.tick(LOAD_WAIT_MS - 1);
    assert.equal(show.loadView("on", "Claude Code").state, "busy");
    mock.timers.tick(1);
    assert.equal(changes.length, 1, "the page hears the change");
    assert.deepEqual(show.loadView("on", "Claude Code"), { state: "error", text: "Not loaded · try again", tip: "No show came back from Claude Code in 3 minutes. Check Claude Code, then press again.", off: "", primary: false });
    // A show that comes later still lands, also over a plan the host typed: the host's go-ahead still counts.
    assert.equal(show.agentLoad(GOOD, "Claude Code").result.loaded, true);
  } finally {
    mock.timers.reset();
  }
});

test("the view never changes state: only the agent going away ends a wait", () => {
  const { show } = make();
  show.edit(HOST);
  show.askAgent("Claude Code", () => true);
  assert.equal(show.loadView("off", "Claude Code").text, "Let my agent load it", "drawn as off");
  assert.equal(show.loadView("on", "Claude Code").state, "busy", "drawing it did not end the wait");
  show.agentLink("waiting");
  assert.equal(show.loadView("waiting", "Claude Code").state, "busy", "a quiet agent is busy, the wait goes on");
  show.agentLink("off");
  assert.equal(show.loadView("on", "Claude Code").text, "Let my agent load it", "gone: nothing is on its way any more");
  // The host's go-ahead went with it: the agent may not load over the host's plan now.
  assert.match(show.agentLoad(GOOD, "Claude Code").error, /already has a plan/);
});

test("the agent going away also ends a failed try", () => {
  const { show } = make();
  show.askAgent("Claude Code", () => true);
  show.agentLoad({ parts: [] }, "Claude Code");
  assert.equal(show.loadView("on", "Claude Code").state, "error");
  show.agentLink("elsewhere");
  assert.equal(show.loadView("on", "Claude Code").text, "Let my agent load it");
});

test("a bad show is refused with the same words as today, and the box stays as it was", () => {
  const { show } = make();
  show.edit(HOST);
  const before = { text: show.text, plan: show.plan, run: show.run };
  const keep = () => assert.deepEqual({ text: show.text, plan: show.plan, run: show.run }, before, "the box is untouched");

  assert.deepEqual(show.agentLoad({ parts: [] }, "Claude Code"), { error: readLoad({ parts: [] }).reason });
  assert.deepEqual(show.agentLoad({ ...GOOD, consent: true }, "Claude Code"), { error: readLoad({ ...GOOD, consent: true }).reason });
  keep();
  assert.deepEqual(show.agentLoad(GOOD, "Claude Code"), { error: "The host already has a plan in the page. Ask the host to press Let my agent load it, then call load_show again." });
  keep();

  // After the button, a refusal is on the button too, in the agent's name.
  show.askAgent("Claude Code", () => true);
  assert.deepEqual(show.agentLoad({ parts: [] }, "Claude Code"), { error: "\"parts\" is needed: the run order, one part for each stretch of the show, with its name and planned minutes." });
  assert.equal(show.loadView("on", "Claude Code").tip, "Claude Code could not load the show: \"parts\" is needed: the run order, one part for each stretch of the show, with its name and planned minutes.");
  keep();
});

test("a show that does not read back the same is refused", () => {
  // The page's own reader drops the questions: what the box would hold is not what the agent sent.
  const { show } = make({ readBack: (text) => ({ ...readPlan(text), questions: [] }) });
  assert.deepEqual(show.agentLoad(GOOD, "Claude Code"), { error: "That show could not be read back clearly. Use plain names and questions." });
  assert.equal(show.text, "");
  assert.equal(show.plan, null);
});

test("once the show clock runs, the plan stays as it is: no edit, no demo, no agent load", () => {
  const { show } = make();
  show.edit(HOST);
  show.lock(1000);
  assert.equal(show.locked, true);
  assert.equal(show.run.view(1000).started, true, "Start started the clock");
  const plan = show.plan;
  show.edit("5 Other");
  assert.equal(show.plan, plan);
  assert.equal(show.pressDemo(), "off");
  assert.equal(show.plan, plan);
  assert.equal(show.demoView().off, "The show has started, so the plan stays as it is.");
  assert.equal(show.askAgent("Claude Code", () => assert.fail("no cue goes")), false);
  assert.deepEqual(show.agentLoad(GOOD, "Claude Code"), { error: "The show has started, so the plan stays as it is." });
  assert.equal(show.loadView("on", "Claude Code").off, "The show has started, so the plan stays as it is.");
});

test("demo: one press fills an empty box with the demo show and its notes", () => {
  const { show } = make();
  assert.equal(show.pressDemo(), "loaded");
  assert.equal(show.text, planText(DEMO_SHOW));
  assert.equal(show.plan.show, DEMO_SHOW.show);
  assert.equal(show.notes, DEMO_SHOW.notes);
  assert.equal(show.demoView().text, "Demo loaded ✓");
  // Pressed again over the untouched demo: loads again, nothing to ask.
  assert.equal(show.pressDemo(), "loaded");
});

test("demo over the host's plan: the first press asks for 8 seconds, the second replaces it", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { show, changes } = make();
    show.edit(HOST);
    assert.equal(show.pressDemo(), "asked");
    assert.equal(show.demoView().text, "Replace your plan? · press again");
    assert.equal(show.text, HOST, "nothing replaced yet");
    mock.timers.tick(DEMO_CONFIRM_MS);
    assert.equal(changes.length, 1, "the page hears the question run out");
    assert.equal(show.demoView().text, "Load demo show");
    assert.equal(show.pressDemo(), "asked");
    mock.timers.tick(DEMO_CONFIRM_MS - 1);
    assert.equal(show.pressDemo(), "loaded");
    assert.equal(show.text, planText(DEMO_SHOW));
    mock.timers.tick(10_000);
    assert.equal(show.demoView().text, "Demo loaded ✓", "the old question no longer fires");
  } finally {
    mock.timers.reset();
  }
});

test("demo while the agent is asked: the wait is given up, and the agent's late answer is refused once", () => {
  const { show } = make();
  show.edit(HOST);
  show.askAgent("Claude Code", () => true);
  show.pressDemo();
  assert.equal(show.pressDemo(), "loaded");
  assert.equal(show.loadView("on", "Claude Code").text, "Let my agent load it");
  assert.deepEqual(show.agentLoad(GOOD, "Claude Code"), { error: "The host loaded the demo show instead. Nothing to do." });
  assert.match(show.agentLoad(GOOD, "Claude Code").error, /already has a plan/, "only once; then the demo is the host's plan");
  assert.equal(show.text, planText(DEMO_SHOW));
});

test("demo over the agent's show replaces it after asking, and takes the agent's notes away", () => {
  const { show } = make();
  show.agentLoad(GOOD, "Claude Code");
  assert.equal(show.pressDemo(), "asked");
  assert.equal(show.pressDemo(), "loaded");
  assert.equal(show.notes, DEMO_SHOW.notes);
  assert.equal(show.loadView("on", "Claude Code").text, "Let my agent load it");
  assert.match(show.agentLoad(GOOD, "Claude Code").error, /already has a plan/, "the demo is the host's own plan now");
});

test("the host's edit: what the agent loaded is the host's now; its notes stay for a small edit and go with another show", () => {
  const { show } = make();
  show.agentLoad(GOOD, "Claude Code");
  show.edit(`${show.text}\n3. One more?`);
  assert.equal(show.loadView("on", "Claude Code").text, "Let my agent load it");
  assert.equal(show.notes, GOOD.notes, "a small edit keeps the notes");
  assert.match(show.agentLoad(GOOD, "Claude Code").error, /already has a plan/, "the box is the host's now");
  show.edit(show.text.replace("Show: Sample Show", "Show: Another"));
  assert.equal(show.notes, "", "another show takes the notes away");
});

test("the host's edit while the agent is asked: the go-ahead is used up, and the agent's show is refused on the button", () => {
  const { show } = make();
  show.edit(HOST);
  show.askAgent("Claude Code", () => true);
  show.edit(`${HOST}\n2. More?`);
  assert.equal(show.loadView("on", "Claude Code").state, "busy", "the request is still on its way");
  assert.deepEqual(show.agentLoad(GOOD, "Claude Code"), { error: "The host already has a plan in the page. Ask the host to press Let my agent load it, then call load_show again." });
  assert.equal(show.loadView("on", "Claude Code").tip, "Claude Code could not load the show: the host already has a plan in the page. Ask the host to press Let my agent load it, then call load_show again.");
  assert.equal(show.text, `${HOST}\n2. More?`);
});

test("the host's edit: an emptied box takes the notes away, an unclear one keeps them", () => {
  const { show } = make();
  show.agentLoad(GOOD, "Claude Code");
  show.edit(`${show.text}\nnot clear`);
  assert.equal(show.notes, GOOD.notes);
  show.edit("  ");
  assert.equal(show.notes, "");
});

test("the host's edit ends the demo and its question", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { show, changes } = make();
    show.pressDemo();
    show.edit(`${show.text}\n9. Mine?`);
    assert.equal(show.demoView().text, "Load demo show");
    assert.equal(show.pressDemo(), "asked", "the edited demo is the host's plan");
    show.edit(HOST);
    assert.equal(show.demoView().text, "Load demo show", "an edit ends the question");
    mock.timers.tick(DEMO_CONFIRM_MS);
    assert.equal(changes.length, 0, "and its timer");
  } finally {
    mock.timers.reset();
  }
});

test("TOOLS-345: the agent's show from a prompter script lands with each question under its part; the host's edit makes it theirs", () => {
  const { show } = make();
  const script = "### **1 · INTRO · 00:00**\nSo how did it\nall start?\n### **2 · THE STORY · 04:00**\nWhat went wrong first?\nAnd then?";
  // What the Worker hands the page: the plan read from the script, as the tool's arguments again.
  const args = loadArgs(readLoad({ show: "Sample Show", script }).plan);
  assert.deepEqual(show.agentLoad(args, "Claude Code"), { result: { loaded: true, questions: 3, parts: 2 } });
  assert.equal(show.text, "Show: Sample Show\n4 min Intro\n1. So how did it all start?\n5 min The Story\n2. What went wrong first?\n3. And then?");
  assert.deepEqual(show.plan.questionParts, [0, 1, 1], "the search groups by part");
  assert.equal(show.byAgent, true);
  assert.equal(show.loadView("on", "Claude Code").text, "Questions loaded by your agent · 3 questions · 2 parts ✓");
  show.edit(`${show.text}\n4. One more?`);
  assert.equal(show.byAgent, false, "the host's edit: the plan button counts it again");
  assert.equal(show.loadView("on", "Claude Code").text, "Let my agent load it");
});

test("TOOLS-345: a plan whose parts per question do not read back the same is refused", () => {
  const { show } = make({ readBack: (text) => ({ ...readPlan(text), questionParts: [null, null] }) });
  const args = loadArgs(readLoad({ script: "### **1 · A · 00:00**\nIs it one?\n### **2 · B · 01:00**\nIs it two?" }).plan);
  assert.match(show.agentLoad(args, "Claude Code").error, /could not be read back clearly/);
  assert.equal(show.text, "");
});

test("TOOLS-345: questions only in the middle part keep it, also through the host's edits of the agent's show", () => {
  const { show } = make();
  const args = loadArgs(readLoad({ script: "### **1 · A · 00:00**\nHello there.\n### **2 · B · 02:00**\nWho is it?\nWhy now?\n### **3 · C · 05:00**\nBye." }).plan);
  assert.deepEqual(args.questions, [{ text: "Who is it?", part: 2 }, { text: "Why now?", part: 2 }]);
  assert.equal(show.agentLoad(args, "Claude Code").result.loaded, true);
  assert.equal(show.text, "2 min A\n3 min B\n1. Who is it?\n2. Why now?\n5 min C");
  assert.deepEqual(show.plan.questionParts, [1, 1]);
  assert.deepEqual(findQuestions({ plan: show.plan, query: "w" }).groups.map((g) => g.name), ["B"], "the search names the part");
  show.edit(show.text.replace("Why now?", "Why now, then?"));
  assert.deepEqual(show.plan.questionParts, [1, 1], "a typo fixed: still under B");
  show.edit(`${show.text}\n3. Who else?`);
  assert.deepEqual(show.plan.questionParts, [1, 1, 2], "a question added under C: the plan now groups by itself");
  show.edit("Show: Mine\n3 Intro\n8 Story\n1. Why?\n2. How?");
  assert.deepEqual(show.plan.questionParts, [null, null], "a plan of the host's own (a new run order) with every part first: no parts, as pasted (TOOLS-344)");
  show.pressDemo();
  show.pressDemo();
  show.edit("3 Intro\n1. Why?\n8 Story");
  assert.deepEqual(show.plan.questionParts, [null], "after the demo the host's text is read as pasted");
});

test("TOOLS-345: questions all in the last part, or in a one-part show, keep their part through the host's edits", () => {
  for (const script of ["### **1 · A · 00:00**\nHello.\n### **2 · B · 02:00**\nWho is it?\nWhy now?", "### **1 · ONLY · 00:00**\nWho is it?\nWhy now?"]) {
    const { show } = make();
    show.agentLoad(loadArgs(readLoad({ script }).plan), "Claude Code");
    const last = show.plan.parts.length - 1;
    assert.deepEqual(show.plan.questionParts, [last, last]);
    show.edit(show.text.replace("Why now?", "Why now, then?"));
    assert.deepEqual(show.plan.questionParts, [last, last], "a typo fixed: the part stays");
    assert.deepEqual(findQuestions({ plan: show.plan, query: "w" }).groups.map((g) => g.name), [show.plan.parts[last].name]);
  }
});
