// Both the Worker and page validate load_show with readLoad; the tool never changes consent or audio settings.
import { readScript } from "./script-reader.mjs";

/** The agent has this long to answer the button (it may ask the host in the chat first); then the button says so. A show that comes later still lands. */
export const LOAD_WAIT_MS = 180_000; // keep it in whole minutes: the button's reason counts them
/** The most a plan may weigh as JSON, like the Prompter's: 200 KB. */
export const LOAD_MAX_BYTES = 200 * 1024;
export const LOAD_LIMITS = { show: 200, guest: 80, questions: 100, question: 300, parts: 50, part: 120, minutes: 999, notes: 4000, script: 50_000 };
/** The most a script may weigh written as JSON with each apostrophe as \u0027, as the connect message's B holds it: one
 * shell argument takes 128 KB, and the show's other fields need the rest. */
export const LOAD_SCRIPT_BYTES = 96 * 1024;

const LOAD_FIELDS = ["show", "guest", "questions", "parts", "notes", "script"];
const loadPlural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** One line of plain text: control characters and runs of space become one space. */
const loadLine = (v) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The show the agent sent, checked and cleaned: { ok: true, plan: { show, guest, questions, parts: [{ name, minutes }],
 * questionParts, notes } } (show, guest and notes are "" when left out; questionParts: per question, the index of its
 * part, or null for every question when none was given one), or { ok: false, reason } in plain words. Nothing is cut: a plan that is too big or not clear is refused whole.
 */
export function readLoad(args) {
  const no = (reason) => ({ ok: false, reason });
  if (!args || typeof args !== "object" || Array.isArray(args)) return no("Send the show as an object with show, guest, questions, parts and notes (or the show's prompter script).");
  // The Worker's own 200 KB request limit refuses first, so here this guards the page; a plan this big never gets past the Worker.
  if (new TextEncoder().encode(JSON.stringify(args)).length > LOAD_MAX_BYTES) return no(`The plan is too big. Limit: ${LOAD_MAX_BYTES / 1024} KB.`);
  const extra = Object.keys(args).find((k) => !LOAD_FIELDS.includes(k));
  if (extra !== undefined) return no(`Unknown field "${extra.slice(0, 40)}". This tool loads the show only: show, guest, questions, parts, notes and script. Guest consent, the microphone and tab sharing are the host's own clicks.`);

  const text = (name, max) => {
    const v = args[name];
    if (v === undefined || v === null || v === "") return { value: "" };
    if (typeof v !== "string") return no(`"${name}" must be text.`);
    const clean = name === "notes" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : loadLine(v);
    if (clean.length > max) return no(`"${name}" is too long. Limit: ${max} characters.`);
    return { value: clean };
  };
  const show = text("show", LOAD_LIMITS.show);
  if (show.ok === false) return show;
  const guest = text("guest", LOAD_LIMITS.guest);
  if (guest.ok === false) return guest;
  const notes = text("notes", LOAD_LIMITS.notes);
  if (notes.ok === false) return notes;

  // The show's prompter script (src/script-reader.mjs) gives the run order and the questions, each with its part.
  let given = { questions: args.questions, parts: args.parts };
  if (args.script !== undefined) {
    if (args.questions !== undefined || args.parts !== undefined) return no("Send the script, or the questions and parts, not both.");
    if (typeof args.script !== "string" || !args.script.trim()) return no("\"script\" must be the show's prompter script as text.");
    if (args.script.length > LOAD_LIMITS.script) return no(`"script" is too long. Limit: ${LOAD_LIMITS.script} characters.`);
    if (new TextEncoder().encode(JSON.stringify(args.script).replaceAll("'", "\\u0027")).length > LOAD_SCRIPT_BYTES) return no(`"script" is too long. Limit: ${LOAD_SCRIPT_BYTES / 1024} KB written as JSON.`);
    const read = readScript(args.script);
    if (!read.ok) return no(read.reason);
    given = { questions: read.questions.map((q) => ({ text: q.text, part: q.part + 1 })), parts: read.parts, joined: read.questions.map((q) => q.joined === true) };
  }

  const questions = [];
  const partOf = []; // per question, its part's number (from 1) as sent, or undefined
  if (given.questions !== undefined) {
    if (!Array.isArray(given.questions)) return no("\"questions\" must be a list of questions.");
    if (given.questions.length > LOAD_LIMITS.questions) return no(`Too many questions. Limit: ${LOAD_LIMITS.questions}.`);
    for (const [i, q] of given.questions.entries()) {
      const item = typeof q === "string" ? { text: q } : q;
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).some((k) => k !== "text" && k !== "part")) return no(`Question ${i + 1} must be some text, or { "text": ..., "part": ... }.`);
      const line = typeof item.text === "string" ? loadLine(item.text) : "";
      if (!line) return no(`Question ${i + 1} must be some text.`);
      if (line.length > LOAD_LIMITS.question) return no(`Question ${i + 1} ("${line.slice(0, 40)}…") is too long. Limit: ${LOAD_LIMITS.question} characters.${given.joined?.[i] ? " It runs over several lines of the script: end each sentence there with . ! or ? so lines do not run together." : ""}`);
      questions.push(line);
      partOf.push(item.part);
    }
  }

  if (!Array.isArray(given.parts) || !given.parts.length) return no("\"parts\" is needed: the run order, one part for each stretch of the show, with its name and planned minutes.");
  if (given.parts.length > LOAD_LIMITS.parts) return no(`Too many parts. Limit: ${LOAD_LIMITS.parts}.`);
  const parts = [];
  for (const [i, p] of given.parts.entries()) {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => k !== "name" && k !== "minutes")) return no(`Part ${i + 1} must be { "name": ..., "minutes": ... }.`);
    const name = typeof p.name === "string" ? loadLine(p.name) : "";
    if (!name) return no(`Part ${i + 1} needs a name.`);
    if (name.length > LOAD_LIMITS.part) return no(`Part ${i + 1}'s name is too long. Limit: ${LOAD_LIMITS.part} characters.`);
    if (!Number.isSafeInteger(p.minutes) || p.minutes < 1 || p.minutes > LOAD_LIMITS.minutes) return no(`Part ${i + 1} ("${name.slice(0, 40)}") needs whole minutes from 1 to ${LOAD_LIMITS.minutes}.`);
    parts.push({ name, minutes: p.minutes });
  }

  // A part per question: every question has one, or none does, in show order.
  const withPart = partOf.filter((p) => p !== undefined).length;
  if (withPart && withPart < questions.length) return no("Give every question its part, or none of them.");
  for (const [i, p] of withPart ? partOf.entries() : []) {
    if (!Number.isSafeInteger(p) || p < 1 || p > parts.length) return no(`Question ${i + 1}'s part must be a part's number, from 1 to ${parts.length}.`);
    if (i && p < partOf[i - 1]) return no(`Question ${i + 1} is in an earlier part than question ${i}. List the questions in show order.`);
  }
  const questionParts = partOf.map((p) => (withPart ? p - 1 : null));
  return { ok: true, plan: { show: show.value, guest: guest.value, questions, parts, questionParts, notes: notes.value } };
}

/** A plan read by readLoad as the tool's arguments again (each question with its part's number when it has one): what the Worker hands the page, which reads it once more. */
export function loadArgs(plan) {
  const questions = plan.questionParts.some((p) => p !== null) ? plan.questions.map((text, i) => ({ text, part: plan.questionParts[i] + 1 })) : plan.questions;
  return { show: plan.show, guest: plan.guest, questions, parts: plan.parts, notes: plan.notes };
}

/**
 * A plan as the text the host could have pasted (the format of src/runorder.mjs), so the agent's show lands in the
 * plan box and the host edits it there. Every part says "min" outright, so a name that starts with "min" stays whole.
 * Questions with their parts go under them; without, the questions follow the run order.
 */
export function planText(plan) {
  const part = (p) => `${p.minutes} min ${p.name}`;
  const ask = (q, i) => `${i + 1}. ${q}`;
  const under = plan.questionParts?.some((p) => p !== null);
  return [
    plan.show && `Show: ${plan.show}`,
    plan.guest && `Guest: ${plan.guest}`,
    ...(under
      ? plan.parts.flatMap((p, k) => [part(p), ...plan.questions.flatMap((q, i) => (plan.questionParts[i] === k ? [ask(q, i)] : []))])
      : [...plan.parts.map(part), ...plan.questions.map(ask)]),
  ].filter(Boolean).join("\n");
}

/**
 * The plan step's "Let my agent load it" for the state it is in. agent: the link's state (off, waiting, on, elsewhere);
 * load: { phase: "idle" | "asking" | "loaded" | "failed", name (the agent's name), plan (what was loaded), reason
 * (why it failed) }; locked: the show clock runs, so the plan stays as it is. Gives { state, text, tip, off, primary }:
 * off is the reason the button is switched off; primary is the orange look, only for the button ready to press.
 */
export function loadButton({ agent, load, locked = false, solo = false }) {
  const label = "Let my agent load it";
  if (load.phase === "loaded") {
    const { plan } = load;
    const counts = [plan.questions.length ? loadPlural(plan.questions.length, solo ? "point" : "question") : "", loadPlural(plan.parts.length, "part")].filter(Boolean);
    const what = !plan.questions.length ? "Show" : solo ? "Points" : "Questions";
    const tip = locked ? "The show has started, so the plan stays as it is." : "Your agent loads the show by itself when it connects. Press to load it again.";
    return { state: "ok", text: `${what} loaded by your agent · ${counts.join(" · ")} ✓`, tip, off: "", primary: false };
  }
  if (locked) return { state: null, text: label, tip: "", off: "The show has started, so the plan stays as it is.", primary: true };
  // A request on its way stays shown while the link is only quiet (the agent is busy with the host's outline), but not once the agent is gone.
  if (load.phase === "asking" && (agent === "on" || agent === "waiting")) return { state: "busy", text: "Agent is loading…", tip: `Waiting for ${load.name} to send the show.`, off: "", primary: false };
  if (agent !== "on") return { state: null, text: label, tip: "", off: agent === "elsewhere" ? "Your agent is connected in another tab." : "Connect your agent first (step 3).", primary: true };
  if (load.phase === "failed") return { state: "error", text: "Not loaded · try again", tip: load.reason, off: "", primary: false };
  return { state: null, text: label, tip: `${load.name} sends the show name, guest, questions and run order. You can still change them.`, off: "", primary: true };
}
