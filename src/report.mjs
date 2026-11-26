// The screen and Markdown file share one report model. readReport (protocol.mjs) validates the agent's report
// before it reaches buildReport.
import { clockText } from "./runorder.mjs";

/** A slow agent gets this long for its report; then its parts switch off with the reason (a later report still fills them). */
export const REPORT_WAIT_MS = 120_000;

const pad = (n) => String(n).padStart(2, "0");
/** producer-report-2026-11-09.md, from the host's own date. */
export const reportFileName = (date) => `producer-report-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
/** 9 Nov 2026. */
export const reportDate = (date) => `${date.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()]} ${date.getFullYear()}`;

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
 * date: when the show ended; solo: a solo show (TOOLS-336); chat: the viewer chat's view (src/chat.mjs createChat, with
 * asked: the host pressed Connect Restream chat) or nothing. Gives { chip, chipParts, stats, clips, runs, topics,
 * notAsked, noQuestions, heard }, and on a solo show { solo, answered, notAnswered, notSaid } in place of the agent's
 * clip moments and topics and the questions not asked.
 */
export function buildReport({ plan, run, marks, agent, heard, date, solo = false, chat = null }) {
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
    time = { value: clockText(run.clock), label: "show time", note: d === 0 ? "on plan" : `${clockText(d, true)} ${d > 0 ? "over" : "under"}`, tone: d > 0 ? "late" : d < 0 ? "early" : "" };
  }
  // The viewer questions from the chat: answered in the order the host pressed Answered, the rest in the chat's order.
  const viewerQuestions = (chat?.messages ?? []).filter((m) => m.q);
  const answered = viewerQuestions.filter((m) => m.s === "answered").sort((a, b) => a.done - b.done);
  const unanswered = viewerQuestions.filter((m) => m.s !== "answered");
  const viewer = (m) => [m.who, m.where].filter(Boolean).join(" · ");

  const runs = (run?.rows ?? []).map((row) => {
    const out = { planned: clockText(row.minutes * 60), name: row.name, real: "not reached", tone: "" };
    if (!run.started) out.real = "not run";
    else if (row.state === "done") Object.assign(out, { real: row.text, tone: row.tone });
    else if (row.state === "now") {
      const d = Math.trunc(-row.left);
      Object.assign(out, { real: clockText(d, true), tone: d > 0 ? "late" : d < 0 ? "early" : "" });
    }
    return out;
  });

  const notAsked = [];
  for (let n = 1; n <= total; n++) if (!asked.has(n)) notAsked.push({ n: `${solo ? "Point " : "Q"}${n}`, text: plan.questions[n - 1], why: skipped.has(n) ? "skipped" : "no time" });
  const heardRows = heard.map((l) => ({ at: l.at || "", who: l.source === "guest" ? plan?.guest || "Guest" : "Host", text: oneLine(l.text) }));

  if (solo) {
    const skippedViewers = unanswered.filter((m) => m.s === "skipped").length;
    const chipParts = [plan?.show, "solo", reportDate(date)].filter(Boolean);
    return {
      solo: true,
      chip: chipParts.join(" · "),
      chipParts,
      stats: [
        time,
        { value: total ? `${[...asked].filter(inPlan).length} of ${total}` : "—", label: "points said" },
        { value: String(answered.length), label: "viewer questions answered" },
        { value: String(unanswered.length), label: "viewer questions not answered", ...(unanswered.length ? { note: `${skippedViewers} skipped` } : {}) },
      ],
      answered: answered.map((m) => ({ at: m.doneAt, text: oneLine(m.text), who: viewer(m) })),
      notAnswered: unanswered.map((m) => ({ at: m.at, text: oneLine(m.text), who: viewer(m), why: m.s === "skipped" ? "skipped" : "no time" })),
      runs,
      notSaid: notAsked,
      noQuestions: !total,
      heard: heardRows,
    };
  }

  const stats = [
    time,
    { value: total ? `${[...asked].filter(inPlan).length} / ${total}` : "—", label: "list questions asked" },
    { value: String(marks.newAsked), label: "new from the agent" },
    chat?.asked ? { value: String(answered.length), label: "viewer questions used" } : { value: "—", label: "viewer questions used", note: "no viewer chat yet" },
  ];
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
    heard: heardRows,
  };
}

/** What an empty part says, on the screen and in the file. */
export const REPORT_EMPTY = { clips: "None.", runs: "No run order.", topics: "None.", notAsked: "None.", noQuestions: "No question list.", noPoints: "No list of points.", viewers: "None.", heard: "Nothing was heard." };

/** The Markdown file: the screen's parts in the screen's order, each line as the screen shows it. */
export function reportMarkdown(model) {
  // A part in a right-to-left script keeps its own direction (Unicode isolates), as the screen's chip does with bdi.
  const isolate = (p) => (/[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff]/.test(p) ? `\u2068${p}\u2069` : p);
  const out = [`# End report · ${model.chipParts.map((p) => isolate(mdText(p))).join(" · ")}`, ""];
  for (const s of model.stats) out.push(`- ${s.label[0].toUpperCase()}${s.label.slice(1)}: ${s.value}${s.note ? ` (${s.note})` : ""}`);
  const part = (title, lines, empty) => out.push("", `## ${title}`, "", ...(lines.length ? lines : [empty]));
  const agentLines = (p, rows) => (p.state === "off" ? [`Off: ${mdText(p.reason)}`] : p.state === "waiting" ? [mdText(p.reason)] : rows);
  const heardLines = model.heard.map((l) => `- ${l.at ? `${l.at} · ` : ""}${mdText(l.who)}: ${mdText(l.text)}`);
  if (model.solo) {
    part("Viewer questions answered", model.answered.map((q) => `- ${q.at} · ${mdText(q.text)} · ${mdText(q.who)} · answered`), REPORT_EMPTY.viewers);
    part("Viewer questions not answered", model.notAnswered.map((q) => `- ${q.at} · ${mdText(q.text)} · ${mdText(q.who)} · ${q.why}`), REPORT_EMPTY.viewers);
    part("Run order · plan vs real", model.runs.map((r) => `- ${r.planned} · ${mdText(r.name)} · ${r.real}`), REPORT_EMPTY.runs);
    part("Points not said", model.notSaid.map((q) => `- ${q.n} · ${mdText(q.text)} · ${q.why}`), model.noQuestions ? REPORT_EMPTY.noPoints : REPORT_EMPTY.notAsked);
    part("What was heard", heardLines, REPORT_EMPTY.heard);
    out.push("");
    return out.join("\n");
  }
  part("Clip moments", agentLines(model.clips, model.clips.rows.map((c) => `- ${mdText(c.at)} · ${mdText(c.text)}`)), REPORT_EMPTY.clips);
  part("Run order · plan vs real", model.runs.map((r) => `- ${r.planned} · ${mdText(r.name)} · ${r.real}`), REPORT_EMPTY.runs);
  part("Topics covered", agentLines(model.topics, model.topics.rows.map((t) => `- ${mdText(t)}`)), REPORT_EMPTY.topics);
  part("Questions not asked", model.notAsked.map((q) => `- ${q.n} · ${mdText(q.text)} · ${q.why}`), model.noQuestions ? REPORT_EMPTY.noQuestions : REPORT_EMPTY.notAsked);
  part("What was heard", heardLines, REPORT_EMPTY.heard);
  out.push("");
  return out.join("\n");
}
