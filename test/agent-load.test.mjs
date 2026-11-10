// Let the agent load the show (src/agent-load.mjs): what a good plan is, what is refused and why, the plan as pasted
// text the host can edit, and the words on step 3's button in each state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LOAD_LIMITS, LOAD_MAX_BYTES, loadButton, planText, readLoad } from "../src/agent-load.mjs";
import { planButton, readPlan } from "../src/runorder.mjs";

const GOOD = {
  show: "Sample Show",
  guest: "Sample Guest",
  questions: ["How did it start?", "What went wrong first?"],
  parts: [{ name: "Intro", minutes: 5 }, { name: "Main talk", minutes: 30 }],
  notes: "Ask about the early days.",
};

test("a good plan is read as it is", () => {
  const r = readLoad(GOOD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan, GOOD);
});

test("only the parts are needed: the rest may be left out", () => {
  const r = readLoad({ parts: [{ name: "Chat", minutes: 20 }] });
  assert.deepEqual(r, { ok: true, plan: { show: "", guest: "", questions: [], parts: [{ name: "Chat", minutes: 20 }], notes: "" } });
});

test("lines are tidied: spaces and line breaks in a name become one space, notes keep their lines", () => {
  const r = readLoad({ show: "  A \n\n show  ", guest: "G\tH", questions: ["  One\ntwo ?  "], parts: [{ name: " A\nB ", minutes: 3 }], notes: "line one\r\nline two\u0000 " });
  assert.equal(r.plan.show, "A show");
  assert.equal(r.plan.guest, "G H");
  assert.deepEqual(r.plan.questions, ["One two ?"]);
  assert.equal(r.plan.parts[0].name, "A B");
  assert.equal(r.plan.notes, "line one\nline two");
});

test("a plan that is too big or not clear is refused whole, with a plain reason", () => {
  const refused = (args, reason) => {
    const r = readLoad(args);
    assert.equal(r.ok, false, String(JSON.stringify(args)).slice(0, 80));
    assert.match(r.reason, reason);
    assert.doesNotMatch(r.reason, /undefined|\[object|at \w+\.mjs/, "plain words only");
  };
  refused(undefined, /object/);
  refused([], /object/);
  refused("a plan", /object/);
  refused({}, /"parts" is needed/);
  refused({ parts: [] }, /"parts" is needed/);
  refused({ parts: "10 Intro" }, /"parts" is needed/);
  refused({ parts: [{ name: "Intro" }] }, /Part 1 \("Intro"\) needs whole minutes/);
  refused({ parts: [{ name: "Intro", minutes: 0 }] }, /whole minutes from 1 to 999/);
  refused({ parts: [{ name: "Intro", minutes: 1.5 }] }, /whole minutes/);
  refused({ parts: [{ name: "Intro", minutes: 1000 }] }, /whole minutes/);
  refused({ parts: [{ name: "Intro", minutes: "10" }] }, /whole minutes/);
  refused({ parts: [{ name: "  ", minutes: 5 }] }, /Part 1 needs a name/);
  refused({ parts: [{ minutes: 5 }] }, /Part 1 needs a name/);
  refused({ parts: [{ name: "x".repeat(LOAD_LIMITS.part + 1), minutes: 5 }] }, /name is too long/);
  refused({ parts: [{ name: "Intro", minutes: 5, extra: 1 }] }, /must be \{ "name"/);
  refused({ parts: Array.from({ length: LOAD_LIMITS.parts + 1 }, () => ({ name: "P", minutes: 1 })) }, /Too many parts\. Limit: 50/);
  refused({ ...GOOD, questions: "How?" }, /list of questions/);
  refused({ ...GOOD, questions: [""] }, /Question 1 must be some text/);
  refused({ ...GOOD, questions: [42] }, /Question 1 must be some text/);
  refused({ ...GOOD, questions: ["x".repeat(LOAD_LIMITS.question + 1)] }, /Question 1 is too long\. Limit: 300/);
  refused({ ...GOOD, questions: Array.from({ length: LOAD_LIMITS.questions + 1 }, () => "Why?") }, /Too many questions\. Limit: 100/);
  refused({ ...GOOD, show: 7 }, /"show" must be text/);
  refused({ ...GOOD, show: "s".repeat(LOAD_LIMITS.show + 1) }, /"show" is too long/);
  refused({ ...GOOD, guest: "g".repeat(LOAD_LIMITS.guest + 1) }, /"guest" is too long/);
  refused({ ...GOOD, notes: "n".repeat(LOAD_LIMITS.notes + 1) }, /"notes" is too long/);
});

test("too big: more than 200 KB of plan is refused, whatever fields it fills", () => {
  const big = { ...GOOD, notes: "n".repeat(LOAD_MAX_BYTES) };
  const r = readLoad(big);
  assert.equal(r.ok, false);
  assert.match(r.reason, /too big\. Limit: 200 KB/);
  // Counted in bytes, not characters: 70,000 three-byte characters are 210,000 bytes.
  assert.match(readLoad({ ...GOOD, notes: "€".repeat(70_000) }).reason, /too big/);
  assert.equal(readLoad(GOOD).ok, true);
});

test("the tool cannot set consent: there is no field for it, and any other field is refused", () => {
  for (const field of ["guestAgreed", "guest_agreed", "consent", "guestConsent", "agreed", "microphone", "mic", "tab", "shareTab", "listening", "start", "engine"]) {
    const r = readLoad({ ...GOOD, [field]: true });
    assert.equal(r.ok, false, field);
    assert.match(r.reason, new RegExp(`Unknown field "${field}"`));
    assert.match(r.reason, /Guest consent, the microphone and tab sharing are the host's own clicks/);
  }
  assert.equal(readLoad({ ...GOOD, guest: "Sample Guest" }).ok, true, "the guest's NAME is allowed; their consent is not a field");
  // An odd key cannot smuggle text into the reason beyond a short cut.
  assert.ok(readLoad({ ...GOOD, ["k".repeat(500)]: 1 }).reason.length < 300);
});

test("the plan as pasted text: the host's own format, read back the same", () => {
  assert.equal(planText(GOOD), "Show: Sample Show\nGuest: Sample Guest\n5 min Intro\n30 min Main talk\n1. How did it start?\n2. What went wrong first?");
  const back = readPlan(planText(GOOD));
  assert.equal(back.ok, true);
  assert.deepEqual({ show: back.show, guest: back.guest, parts: back.parts, questions: back.questions }, { show: GOOD.show, guest: GOOD.guest, parts: GOOD.parts, questions: GOOD.questions });
  assert.equal(planButton(back).text, "2 questions · 2 parts ✓");
});

test("awkward names still read back whole: names that start like minutes, numbers or labels", () => {
  const odd = {
    show: "Show: the sequel: part 2",
    guest: "Dr. 3 Sample",
    questions: ["2024 was wild. Why?", "Q3: what? Really", "- not a bullet", "Show: or guest: first?", "5 min of fame?", "1) Odd"],
    parts: [{ name: "min of history", minutes: 10 }, { name: "5 more", minutes: 4 }, { name: "Guest: live?", minutes: 12 }, { name: "m", minutes: 1 }, { name: "utes", minutes: 2 }, { name: "• dot", minutes: 3 }],
    notes: "",
  };
  const r = readLoad(odd);
  assert.equal(r.ok, true);
  const back = readPlan(planText(r.plan));
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.equal(back.show, odd.show);
  assert.equal(back.guest, odd.guest);
  assert.deepEqual(back.parts, odd.parts);
  assert.deepEqual(back.questions, odd.questions);
});

test("a show with no name and no guest, and the biggest allowed plan, still read back whole", () => {
  const r = readLoad({ parts: [{ name: "Only part", minutes: 999 }], questions: Array.from({ length: LOAD_LIMITS.questions }, (_, i) => `Question ${i + 1} ${"x".repeat(280)}?`) });
  assert.equal(r.ok, true);
  const back = readPlan(planText(r.plan));
  assert.equal(back.ok, true);
  assert.equal(back.show, "");
  assert.equal(back.questions.length, 100);
  assert.deepEqual(back.questions, r.plan.questions);
});

test("the button: switched off with its reason until an agent is connected", () => {
  const load = { phase: "idle", name: "Claude Code" };
  for (const agent of ["off", "waiting"]) {
    const b = loadButton({ agent, load });
    assert.deepEqual(b, { state: null, text: "Let my agent load it", tip: "", off: "Connect your agent first (step 2).", primary: true });
  }
  assert.equal(loadButton({ agent: "elsewhere", load }).off, "Your agent is connected in another tab.");
  const on = loadButton({ agent: "on", load });
  assert.equal(on.off, "");
  assert.equal(on.text, "Let my agent load it");
  assert.equal(on.tip, "Claude Code sends the show name, guest, questions and run order. You can still change them.");
});

test("the button: asking, loaded (as in the mock-up), and failed", () => {
  const asking = loadButton({ agent: "on", load: { phase: "asking", name: "Claude Code" } });
  assert.equal(asking.state, "busy");
  assert.equal(asking.text, "Agent is loading…");
  assert.equal(asking.primary, false, "orange is for the button ready to press");
  const plan = readLoad({ ...GOOD, questions: Array.from({ length: 12 }, (_, i) => `Question ${i + 1}?`), parts: Array.from({ length: 5 }, (_, i) => ({ name: `Part ${i + 1}`, minutes: 5 })) }).plan;
  const loaded = loadButton({ agent: "on", load: { phase: "loaded", name: "Claude Code", plan } });
  assert.equal(loaded.state, "ok");
  assert.equal(loaded.text, "Loaded by Claude Code · 12 questions · 5 parts");
  assert.equal(loaded.tip, "Show: Sample Show. Guest: Sample Guest. 12 questions, 5 parts, guest notes.");
  assert.equal(loaded.primary, false);
  // The agent leaving does not undo what it loaded.
  assert.equal(loadButton({ agent: "off", load: { phase: "loaded", name: "Claude Code", plan } }).text, loaded.text);
  const one = loadButton({ agent: "on", load: { phase: "loaded", name: "Codex", plan: { show: "", guest: "", questions: [], parts: [{ name: "A", minutes: 1 }], notes: "" } } });
  assert.equal(one.text, "Loaded by Codex · 1 part");
  assert.equal(one.tip, "1 part.");
  const failed = loadButton({ agent: "on", load: { phase: "failed", name: "Claude Code", reason: "No show came back." } });
  assert.deepEqual([failed.state, failed.text, failed.tip, failed.primary], ["error", "Not loaded · try again", "No show came back.", false]);
  // Once the show clock runs the plan is fixed: the button says so, whatever the agent does.
  assert.equal(loadButton({ agent: "on", load: { phase: "idle", name: "Claude Code" }, locked: true }).off, "The show has started, so the plan stays as it is.");
  assert.equal(loadButton({ agent: "on", load: { phase: "loaded", name: "Claude Code", plan }, locked: true }).state, "ok", "what was loaded stays shown");
});
