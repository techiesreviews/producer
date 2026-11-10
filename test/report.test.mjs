// The end report's rules (src/report.mjs): the four numbers, the run order plan against real, the questions not
// asked (the host's own presses first, then the agent's word), the agent's topics and clip moments (waiting, in, or
// switched off with a reason), what was heard, and the Markdown file that holds exactly what the screen shows.
// Made-up names only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clockText, createRunOrder } from "../src/runorder.mjs";
import { TOOLS } from "../src/mcp.mjs";
import { buildReport, readReport, reportClock, reportDate, reportFileName, reportMarkdown, REPORT_WAIT_MS } from "../src/report.mjs";

const PLAN = {
  ok: true, show: "Techies Live", guest: "Jane Doe",
  parts: [{ name: "Intro", minutes: 3 }, { name: "Her story", minutes: 8 }, { name: "Wrap-up", minutes: 4 }],
  questions: ["How did it start?", "Who paid first?", "What went wrong?", "What is next?"],
};
const DATE = new Date(2026, 10, 9, 21, 5);
const T0 = 1_000_000;

/** A run order started at T0: Intro took 2:40, Her story is 9:40 in when the show ends. */
function endedRun() {
  const run = createRunOrder(PLAN.parts);
  run.start(T0);
  run.next(T0 + 160_000);
  return run.view(T0 + 160_000 + 580_000);
}

const base = (over = {}) => ({
  plan: PLAN,
  run: endedRun(),
  marks: { asked: [1, 2], skipped: [3], newAsked: 2 },
  agent: { phase: "off", name: "Claude Code", reason: "No agent connected when the show ended." },
  heard: [{ source: "host", text: "So how did it start?", at: "0:12" }, { source: "guest", text: "With a van.", at: "0:15" }],
  date: DATE,
  ...over,
});

test("the file name and the date on the report", () => {
  assert.equal(reportFileName(DATE), "producer-report-2026-11-09.md");
  assert.equal(reportFileName(new Date(2027, 0, 3)), "producer-report-2027-01-03.md");
  assert.equal(reportDate(DATE), "9 Nov 2026");
  assert.equal(REPORT_WAIT_MS, 120_000, "a slow agent gets two minutes before its parts switch off");
});

test("the four numbers: show time against the plan, list questions asked, new from the agent, viewer questions", () => {
  const r = buildReport(base());
  assert.equal(r.chip, "Techies Live · guest Jane Doe · 9 Nov 2026");
  assert.deepEqual(r.stats, [
    { value: "12:20", label: "show time", note: "+1:20 over", tone: "late" },
    { value: "2 / 4", label: "list questions asked" },
    { value: "2", label: "new from the agent" },
    { value: "—", label: "viewer questions used", note: "no viewer chat yet" },
  ]);
});

test("show time ahead of plan, on plan, and a clock never started", () => {
  const run = createRunOrder(PLAN.parts);
  run.start(T0);
  assert.deepEqual(buildReport(base({ run: run.view(T0 + 100_000) })).stats[0], { value: "1:40", label: "show time", note: "on plan", tone: "" });
  run.next(T0 + 100_000);
  assert.deepEqual(buildReport(base({ run: run.view(T0 + 100_000) })).stats[0], { value: "1:40", label: "show time", note: "−1:20 under", tone: "early" });
  const fresh = createRunOrder(PLAN.parts).view(T0);
  assert.deepEqual(buildReport(base({ run: fresh })).stats[0], { value: "—", label: "show time", note: "clock not started" });
  assert.deepEqual(buildReport(base({ run: null, plan: null })).stats.slice(0, 2), [{ value: "—", label: "show time", note: "clock not started" }, { value: "—", label: "list questions asked" }]);
});

test("run order plan against real: done parts, the part on at the end, parts not reached", () => {
  assert.deepEqual(buildReport(base()).runs, [
    { planned: "3:00", name: "Intro", real: "−0:20", tone: "early" },
    { planned: "8:00", name: "Her story", real: "+1:40", tone: "late" },
    { planned: "4:00", name: "Wrap-up", real: "not reached", tone: "" },
  ]);
  const fresh = createRunOrder(PLAN.parts).view(T0);
  assert.deepEqual(buildReport(base({ run: fresh })).runs.map((r) => r.real), ["not run", "not run", "not run"]);
  assert.deepEqual(buildReport(base({ run: null, plan: null })).runs, []);
});

test("questions not asked: skipped by the host, or no time; the agent's word fills in what the host did not press", () => {
  assert.deepEqual(buildReport(base()).notAsked, [
    { n: "Q3", text: "What went wrong?", why: "skipped" },
    { n: "Q4", text: "What is next?", why: "no time" },
  ]);
  // The agent says Q3 was asked (the host pressed Skip: the host wins) and Q4 asked, Q1 skipped (the host pressed Asked: the host wins).
  const agent = { phase: "in", name: "Claude Code", report: { topics: [], asked: [3, 4], skipped: [1], clips: [] } };
  const r = buildReport(base({ agent }));
  assert.deepEqual(r.notAsked, [{ n: "Q3", text: "What went wrong?", why: "skipped" }]);
  assert.equal(r.stats[1].value, "3 / 4", "the agent's asked count joins the number");
  const skippedByAgent = buildReport(base({ marks: { asked: [], skipped: [], newAsked: 0 }, agent: { ...agent, report: { topics: [], skipped: [2] } } }));
  assert.deepEqual(skippedByAgent.notAsked.map((q) => `${q.n} ${q.why}`), ["Q1 no time", "Q2 skipped", "Q3 no time", "Q4 no time"]);
  assert.equal(skippedByAgent.stats[1].value, "0 / 4");
});

test("no agent: topics and clip moments are switched off with the reason; the page's own parts are all there", () => {
  const r = buildReport(base());
  assert.deepEqual(r.topics, { state: "off", reason: "No agent connected when the show ended.", rows: [] });
  assert.deepEqual(r.clips, { state: "off", reason: "No agent connected when the show ended.", rows: [] });
  assert.equal(r.runs.length, 3);
  assert.equal(r.notAsked.length, 2);
});

test("a slow agent: its parts say they wait; the agent's report fills them in", () => {
  const waiting = buildReport(base({ agent: { phase: "waiting", name: "Claude Code" } }));
  assert.deepEqual(waiting.topics, { state: "waiting", reason: "Waiting for Claude Code…", rows: [] });
  assert.deepEqual(waiting.clips, { state: "waiting", reason: "Waiting for Claude Code…", rows: [] });
  const report = { topics: ["Leaving her job", "Pricing the first version"], clips: [{ at: "7:42", note: "\"We had 100 customers before a logo.\"" }] };
  const r = buildReport(base({ agent: { phase: "in", name: "Claude Code", report } }));
  assert.deepEqual(r.topics, { state: "in", rows: ["Leaving her job", "Pricing the first version"] });
  assert.deepEqual(r.clips, { state: "in", rows: [{ at: "7:42", text: "\"We had 100 customers before a logo.\"" }] });
  const empty = buildReport(base({ agent: { phase: "in", name: "Claude Code", report: { topics: [] } } }));
  assert.deepEqual([empty.topics.rows, empty.clips.rows], [[], []]);
});

test("what was heard: each line with its show time and who said it (the guest by name when the plan names them)", () => {
  assert.deepEqual(buildReport(base()).heard, [
    { at: "0:12", who: "Host", text: "So how did it start?" },
    { at: "0:15", who: "Jane Doe", text: "With a van." },
  ]);
  assert.deepEqual(buildReport(base({ plan: null, heard: [{ source: "guest", text: "Hi" }] })).heard, [{ at: "", who: "Guest", text: "Hi" }]);
});

test("the Markdown file holds exactly what the screen shows, in the same order", () => {
  const report = { topics: ["Leaving her job"], clips: [{ at: "7:42", note: "The van story" }] };
  const md = reportMarkdown(buildReport(base({ agent: { phase: "in", name: "Claude Code", report } })));
  assert.equal(md, [
    "# End report · \u2068Techies Live\u2069 · \u2068guest Jane Doe\u2069 · \u20689 Nov 2026\u2069",
    "",
    "- Show time: 12:20 (+1:20 over)",
    "- List questions asked: 2 / 4",
    "- New from the agent: 2",
    "- Viewer questions used: — (no viewer chat yet)",
    "",
    "## Clip moments",
    "",
    "- 7:42 · The van story",
    "",
    "## Run order · plan vs real",
    "",
    "- 3:00 · Intro · −0:20",
    "- 8:00 · Her story · +1:40",
    "- 4:00 · Wrap-up · not reached",
    "",
    "## Topics covered",
    "",
    "- Leaving her job",
    "",
    "## Questions not asked",
    "",
    "- Q3 · What went wrong? · skipped",
    "- Q4 · What is next? · no time",
    "",
    "## What was heard",
    "",
    "- 0:12 · Host: So how did it start?",
    "- 0:15 · Jane Doe: With a van.",
    "",
  ].join("\n"));
});

test("the Markdown file: switched-off and waiting parts carry their reason; empty parts say so; text stays on one line", () => {
  const md = reportMarkdown(buildReport(base({ heard: [{ source: "host", text: "two\nlines  here" }] })));
  assert.match(md, /## Clip moments\n\nOff: No agent connected when the show ended\.\n/);
  assert.match(md, /## Topics covered\n\nOff: No agent connected when the show ended\.\n/);
  assert.match(md, /## What was heard\n\n- Host: two lines here\n/);
  const waiting = reportMarkdown(buildReport(base({ agent: { phase: "waiting", name: "Codex" } })));
  assert.match(waiting, /## Clip moments\n\nWaiting for Codex…\n/);
  const bare = reportMarkdown(buildReport(base({ plan: null, run: null, heard: [], agent: { phase: "in", name: "Codex", report: { topics: [] } } })));
  assert.match(bare, /^# End report · \u20689 Nov 2026\u2069\n/);
  for (const line of ["## Clip moments\n\nNone.", "## Run order · plan vs real\n\nNo run order.", "## Topics covered\n\nNone.", "## Questions not asked\n\nNo question list.", "## What was heard\n\nNothing was heard."]) assert.ok(bare.includes(line), line);
  const allAsked = reportMarkdown(buildReport(base({ marks: { asked: [1, 2, 3, 4], skipped: [], newAsked: 0 } })));
  assert.match(allAsked, /## Questions not asked\n\nNone\.\n/);
});

test("readReport: the page checks the agent's report again (the Worker checked it first)", () => {
  assert.deepEqual(readReport({ topics: [" Vans "], asked: [1], skipped: [2], clips: [{ at: " 7:42 ", note: " A story " }] }), { ok: true, report: { topics: ["Vans"], asked: [1], skipped: [2], clips: [{ at: "7:42", note: "A story" }] } });
  assert.deepEqual(readReport({ topics: [] }), { ok: true, report: { topics: [], asked: [], skipped: [], clips: [] } });
  for (const bad of [null, {}, { topics: "x" }, { topics: [5] }, { topics: ["x".repeat(201)] }, { topics: Array(21).fill("t") }, { topics: [], asked: ["1"] }, { topics: [], clips: [{ at: "1" }] }, { topics: [], clips: [{ at: "x".repeat(21), note: "n" }] }]) {
    assert.equal(readReport(bad).ok, false, JSON.stringify(bad));
  }
  assert.match(readReport({}).reason, /topics/);
});

test("the report's show times follow the run order's own rule", () => {
  for (const s of [0, 0.9, -0.9, 5, 59, 60, 61, -61, 3599, 3600, 7322, -7322]) {
    assert.equal(reportClock(s), clockText(s), String(s));
    assert.equal(reportClock(s, true), clockText(s, true), `${s} signed`);
  }
});

test("the file escapes the marks that would make a link, an image or code in a Markdown viewer", () => {
  const report = { topics: ["![x](https://example.com/a.png) and [link](https://example.com)"], clips: [{ at: "1:00", note: "<img src=x> `code`" }] };
  const md = reportMarkdown(buildReport(base({ agent: { phase: "in", name: "Codex", report }, heard: [{ source: "host", text: "a \\ b" }] })));
  assert.match(md, /^- \\!\\\[x\\\]\(https:\/\/example\.com\/a\.png\) and \\\[link\\\]\(https:\/\/example\.com\)$/m);
  assert.match(md, /^- 1:00 · \\<img src=x> \\`code\\`$/m);
  assert.match(md, /^- Host: a \\\\ b$/m);
});

test("readReport takes what the Worker takes: a report at every limit of post_report's schema in src/mcp.mjs", () => {
  const { properties: p } = TOOLS.find((t) => t.name === "post_report").inputSchema;
  const clip = p.clips.items.properties;
  const full = {
    topics: Array(p.topics.maxItems).fill("t".repeat(p.topics.items.maxLength)),
    asked: Array(p.asked.maxItems).fill(1),
    skipped: Array(p.skipped.maxItems).fill(2),
    clips: Array(p.clips.maxItems).fill({ at: "a".repeat(clip.at.maxLength), note: "n".repeat(clip.note.maxLength) }),
  };
  assert.equal(readReport(full).ok, true);
  for (const [key, over] of [["topics", [...full.topics, "t"]], ["asked", [...full.asked, 1]], ["clips", [...full.clips, full.clips[0]]]]) assert.equal(readReport({ ...full, [key]: over }).ok, false, `${key} past its limit`);
});
