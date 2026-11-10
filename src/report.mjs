// The end report (card 12): what the report screen shows after End & report, and the Markdown file Save report
// writes, built from one model so the file holds exactly what the screen shows. The page fills the four numbers, the
// run order plan against real and the questions not asked itself; the agent's post_report adds the topics and the clip
// moments (and its word on questions the host did not press). With no agent those two parts are switched off with the
// reason; while a slow agent works they say so, and the rest is already there. Plain facts in, words out: no page, no
// storage, no network. The report lives in the page's memory until the tab closes, or in the file the host saves.
// The inlined page script keeps this file's code as it is (the build only drops `export`), and an inlined file
// imports nothing, so the show-time rule of src/runorder.mjs (clockText) is repeated here; a test keeps the two the same.

/** Whole seconds as minutes and seconds (62:05); with sign, a plus or a minus in front unless it is zero. */
export function reportClock(seconds, sign = false) {
  const whole = Math.trunc(seconds);
  const abs = Math.abs(whole);
  const text = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
  return !sign || whole === 0 ? text : `${whole > 0 ? "+" : "−"}${text}`;
}

/** A slow agent gets this long for its report; then its parts switch off with the reason (a later report still fills them). */
export const REPORT_WAIT_MS = 120_000;
const REPORT_TEXT = 200;
const REPORT_LIST = 20;

const pad = (n) => String(n).padStart(2, "0");
/** producer-report-2026-11-09.md, from the host's own date. */
export const reportFileName = (date) => `producer-report-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
/** 9 Nov 2026. */
export const reportDate = (date) => `${date.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]} ${date.getFullYear()}`;

/**
 * The agent's post_report, checked again by the page (the Worker checked it first): { ok: true, report: { topics,
 * asked, skipped, clips: [{ at, note }] } } or { ok: false, reason } (a plain line for the agent).
 */
export function readReport(args) {
  const no = (reason) => ({ ok: false, reason });
  if (!args || typeof args !== "object") return no("Send the report as { topics, asked, skipped, clips }.");
  const line = (v, max = REPORT_TEXT) => typeof v === "string" && v.trim() && v.trim().length <= max;
  const list = (v, ok, max = REPORT_LIST) => v === undefined || (Array.isArray(v) && v.length <= max && v.every(ok));
  if (!Array.isArray(args.topics) || !list(args.topics, (t) => line(t))) return no(`"topics" must be a list of at most ${REPORT_LIST} short lines.`);
  const number = (n) => Number.isSafeInteger(n) && n >= 1;
  if (!list(args.asked, number, 100) || !list(args.skipped, number, 100)) return no("\"asked\" and \"skipped\" are lists of prepared question numbers.");
  if (!list(args.clips, (c) => c && typeof c === "object" && line(c.at, 20) && line(c.note))) return no("\"clips\" is a list of { at, note }: the show time and a short note.");
  return {
    ok: true,
    report: {
      topics: args.topics.map((t) => t.trim()),
      asked: [...(args.asked ?? [])],
      skipped: [...(args.skipped ?? [])],
      clips: (args.clips ?? []).map((c) => ({ at: c.at.trim(), note: c.note.trim() })),
    },
  };
}

/** One line of text, as the screen and the file show it. */
const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();
/** The host's, the guest's and the agent's words in the file: one line, with the marks that would make a link, an image
 * or code in a Markdown viewer escaped (they read the same there; a viewer fetches nothing). */
const mdText = (text) => oneLine(text).replace(/[\\`[\]!<]/g, "\\$&");

/** The agent's part (topics or clip moments): waiting with its name, in with its rows, or off with the reason. */
function agentPart(agent, rows) {
  if (agent.phase === "in") return { state: "in", rows };
  if (agent.phase === "waiting") return { state: "waiting", reason: `Waiting for ${agent.name}…`, rows: [] };
  return { state: "off", reason: agent.reason, rows: [] };
}

/**
 * The report's model. plan: the show plan (src/runorder.mjs readPlan) or null; run: the run order's view at the end
 * (createRunOrder().view) or null; marks: the host's own presses ({ asked, skipped, newAsked }, src/questions.mjs);
 * agent: { phase: "waiting" | "in" | "off", name, reason?, report? }; heard: the final lines ({ source, text, at? });
 * date: when the show ended. Gives { chip, chipParts, stats, clips, runs, topics, notAsked, noQuestions, heard }.
 */
export function buildReport({ plan, run, marks, agent, heard, date }) {
  const total = plan?.questions.length ?? 0;
  const said = agent.phase === "in" ? agent.report : {};
  // The host's own presses win; the agent's word fills in the questions the host did not press.
  const pressed = new Set([...marks.asked, ...marks.skipped]);
  const asked = new Set([...marks.asked, ...(said.asked ?? []).filter((n) => !pressed.has(n))]);
  const skipped = new Set([...marks.skipped, ...(said.skipped ?? []).filter((n) => !pressed.has(n) && !asked.has(n))]);
  const inPlan = (n) => n >= 1 && n <= total;

  let time = { value: "—", label: "show time", note: "clock not started" };
  if (run?.started) {
    const d = run.delta;
    time = { value: reportClock(run.clock), label: "show time", note: d === 0 ? "on plan" : `${reportClock(d, true)} ${d > 0 ? "over" : "under"}`, tone: d > 0 ? "late" : d < 0 ? "early" : "" };
  }
  const stats = [
    time,
    { value: total ? `${[...asked].filter(inPlan).length} / ${total}` : "—", label: "list questions asked" },
    { value: String(marks.newAsked), label: "new from the agent" },
    { value: "—", label: "viewer questions used", note: "no viewer chat yet" },
  ];

  const runs = (run?.rows ?? []).map((row) => {
    const out = { planned: reportClock(row.minutes * 60), name: row.name, real: "not reached", tone: "" };
    if (!run.started) out.real = "not run";
    else if (row.state === "done") Object.assign(out, { real: row.text, tone: row.tone });
    else if (row.state === "now") {
      const d = Math.trunc(-row.left);
      Object.assign(out, { real: reportClock(d, true), tone: d > 0 ? "late" : d < 0 ? "early" : "" });
    }
    return out;
  });

  const notAsked = [];
  for (let n = 1; n <= total; n++) if (!asked.has(n)) notAsked.push({ n: `Q${n}`, text: plan.questions[n - 1], why: skipped.has(n) ? "skipped" : "no time" });

  const chipParts = [plan?.show, plan?.guest && `guest ${plan.guest}`, reportDate(date)].filter(Boolean);
  return {
    chip: chipParts.join(" · "),
    chipParts,
    stats,
    clips: agentPart(agent, (agent.report?.clips ?? []).map((c) => ({ at: c.at, text: c.note }))),
    runs,
    topics: agentPart(agent, [...(agent.report?.topics ?? [])]),
    notAsked,
    noQuestions: !total,
    heard: heard.map((l) => ({ at: l.at || "", who: l.source === "guest" ? plan?.guest || "Guest" : "Host", text: oneLine(l.text) })),
  };
}

/** What an empty part says, on the screen and in the file. */
export const REPORT_EMPTY = { clips: "None.", runs: "No run order.", topics: "None.", notAsked: "None.", noQuestions: "No question list.", heard: "Nothing was heard." };

/** The Markdown file: the screen's parts in the screen's order, each line as the screen shows it. */
export function reportMarkdown(model) {
  const out = [`# End report · ${mdText(model.chip)}`, ""];
  for (const s of model.stats) out.push(`- ${s.label[0].toUpperCase()}${s.label.slice(1)}: ${s.value}${s.note ? ` (${s.note})` : ""}`);
  const part = (title, lines, empty) => out.push("", `## ${title}`, "", ...(lines.length ? lines : [empty]));
  const agentLines = (p, rows) => (p.state === "off" ? [`Off: ${mdText(p.reason)}`] : p.state === "waiting" ? [mdText(p.reason)] : rows);
  part("Clip moments", agentLines(model.clips, model.clips.rows.map((c) => `- ${mdText(c.at)} · ${mdText(c.text)}`)), REPORT_EMPTY.clips);
  part("Run order · plan vs real", model.runs.map((r) => `- ${r.planned} · ${mdText(r.name)} · ${r.real}`), REPORT_EMPTY.runs);
  part("Topics covered", agentLines(model.topics, model.topics.rows.map((t) => `- ${mdText(t)}`)), REPORT_EMPTY.topics);
  part("Questions not asked", model.notAsked.map((q) => `- ${q.n} · ${mdText(q.text)} · ${q.why}`), model.noQuestions ? REPORT_EMPTY.noQuestions : REPORT_EMPTY.notAsked);
  part("What was heard", model.heard.map((l) => `- ${l.at ? `${l.at} · ` : ""}${mdText(l.who)}: ${mdText(l.text)}`), REPORT_EMPTY.heard);
  out.push("");
  return out.join("\n");
}
