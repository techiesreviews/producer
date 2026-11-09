// The show plan the host pastes by hand, and the run order with its show clock. Plain facts in, words out: no page,
// no storage, no network. The plan lives only in the page's memory and is gone when the tab closes.
// The inlined page script keeps this file's code as it is (the build only drops `export`).
//
// The plan's format, one thing per line (blank lines are fine):
//   Show: Techies Live        the show's name (optional)
//   Guest: Jane Doe           the guest's name (optional)
//   10 Intro                  a part of the run order: its planned minutes, then its name ("10 min Intro" too);
//                             a line that starts with minutes is a part even when it ends with ? ("10 Any questions?")
//   1. How did it start?      a question: numbered (1. or 1)), or any other line ending with a question mark

/** The short example under the paste box: one line of each kind. */
export const PLAN_EXAMPLE = ["Show: Techies Live", "Guest: Jane Doe", "10 Intro", "20 Her story", "1. How did it start?"];

const PLAN_NAMED = /^(show|guest)\s*:\s*(.*)$/i;
const PLAN_BULLET = /^[-*•]\s+/;
const PLAN_NUMBERED = /^(?:q?\d{1,3})\s*[.)]\s*(\S.*)$/i;
const PLAN_PART = /^([1-9]\d{0,2})\s*(?:minutes|minute|mins|min|m)?\.?\s+(\S.*)$/i;

/**
 * Reads a pasted plan. Gives { ok: true, show, guest, parts: [{ name, minutes }], questions } when every line is
 * clear and there is at least one part; { ok: false, line, text } naming the first unclear line (from 1);
 * { ok: false, noParts: true } when nothing gives a run order; { ok: false, empty: true } for nothing pasted.
 */
export function readPlan(text) {
  const plan = { ok: true, show: "", guest: "", parts: [], questions: [] };
  const lines = String(text).split(/\r?\n/);
  let any = false;
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim().replace(PLAN_BULLET, "");
    if (!line) continue;
    any = true;
    const named = line.match(PLAN_NAMED);
    const numbered = line.match(PLAN_NUMBERED);
    const part = line.match(PLAN_PART);
    if (named && named[2].trim()) plan[named[1].toLowerCase()] = named[2].trim();
    else if (numbered) plan.questions.push(numbered[1].trim());
    else if (part) plan.parts.push({ name: part[2].trim(), minutes: Number(part[1]) });
    else if (line.endsWith("?")) plan.questions.push(line);
    else return { ok: false, line: i + 1, text: raw.trim() };
  }
  if (!any) return { ok: false, empty: true };
  if (!plan.parts.length) return { ok: false, noParts: true };
  return plan;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cutLine = (text, max = 60) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const PLAN_HOW = "A part is minutes, then a name (10 Intro); a question is numbered (1.) or ends with ?.";

/** What the "Paste it myself" button says about the pasted plan: its state, its words and its tooltip. */
export function planButton(plan) {
  if (plan.ok) {
    const what = [plan.questions.length ? plural(plan.questions.length, "question") : "", plural(plan.parts.length, "part")].filter(Boolean);
    return { state: "ok", text: `${what.join(" · ")} ✓`, tip: "Click to change the plan." };
  }
  if (plan.noParts) return { state: "error", text: "No parts with minutes", tip: `Add the run order, one part per line. ${PLAN_HOW}` };
  if (plan.line) return { state: "error", text: `Line ${plan.line} not clear`, tip: `Line ${plan.line}: "${cutLine(plan.text)}". ${PLAN_HOW}` };
  return { state: null, text: "Paste it myself", tip: "Paste your show name, guest, questions and run order." };
}

/** The top bar's show line: the show and the guest when the plan names them. */
export function showLine(plan) {
  if (!plan?.ok) return "· no show loaded yet";
  const parts = [plan.show, plan.guest && `guest ${plan.guest}`].filter(Boolean);
  return `· ${parts.length ? parts.join(" · ") : plural(plan.parts.length, "part")}`;
}

/** Whole seconds as minutes and seconds (62:05); with sign, a plus or a minus in front unless it is zero. */
export function clockText(seconds, sign = false) {
  const whole = Math.trunc(seconds);
  const abs = Math.abs(whole);
  const text = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
  if (!sign || whole === 0) return text;
  return `${whole > 0 ? "+" : "−"}${text}`;
}

/** Where the show is, for a cue to the agent: the part on now (from 1), its name and whole minutes left (0 once over). */
export function runPosition(view) {
  const i = view.rows.findIndex((row) => row.state === "now");
  if (i < 0) return undefined;
  return { segment: i + 1, title: view.rows[i].name, minutesLeft: Math.max(0, Math.ceil(view.rows[i].left / 60)) };
}

/**
 * The run order of a plan's parts, timed from the moment Start is pressed. Next part ends the current part at that
 * moment (its real time is kept) and starts the next; on the last part it ends the plan, and the clock goes on.
 * Times are milliseconds from one clock (Date.now()); view(now) gives what the screen shows at that moment.
 */
export function createRunOrder(parts) {
  let startedAt = null;
  const ends = [];
  const planned = (i) => parts[i].minutes * 60;

  return {
    start(now) {
      if (startedAt === null) startedAt = now;
    },
    next(now) {
      if (startedAt === null) { startedAt = now; return; }
      if (ends.length < parts.length) ends.push(now);
    },
    view(now) {
      const started = startedAt !== null;
      const finished = ends.length === parts.length;
      const current = started && !finished ? ends.length : -1;
      const at = (i) => (i === 0 ? startedAt : ends[i - 1]);
      const real = (i) => (ends[i] - at(i)) / 1000;
      let delta = null;
      if (started) {
        const done = ends.map((_, i) => real(i) - planned(i)).reduce((a, b) => a + b, 0);
        const over = current >= 0 ? Math.max(0, (now - at(current)) / 1000 - planned(current)) : 0;
        const after = finished ? (now - ends[ends.length - 1]) / 1000 : 0;
        delta = Math.trunc(done + over + after);
      }
      const rows = parts.map((part, i) => {
        const row = { name: part.name, minutes: part.minutes, state: "later", text: clockText(planned(i)), tone: "", fill: 0 };
        if (i < ends.length) {
          const d = real(i) - planned(i);
          Object.assign(row, { state: "done", text: clockText(d, true), tone: Math.trunc(d) > 0 ? "late" : Math.trunc(d) < 0 ? "early" : "" });
        } else if (i === current) {
          const inPart = (now - at(i)) / 1000;
          const left = planned(i) - inPart;
          Object.assign(row, { state: "now", fill: Math.min(1, inPart / planned(i)), left });
          Object.assign(row, left >= 0 ? { text: `${clockText(Math.ceil(left))} left` } : { text: `${clockText(-left)} over`, tone: "late" });
        } else if (i === (started ? current + 1 : 0)) {
          row.state = "next";
        }
        return row;
      });
      return {
        started,
        finished,
        clock: started ? Math.trunc((now - startedAt) / 1000) : 0,
        delta,
        rows,
        button: !started ? "Start" : finished ? null : "Next part",
      };
    },
  };
}
