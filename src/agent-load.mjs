// Let the agent load the show (card 14, TOOLS-174): the reverse of get_context. The agent's tool load_show pushes the
// show's name, the guest, the questions, the run order and the notes into the page; step 3's button "Let my agent load
// it" asks for it and shows the state. Plain facts in, words out: no page, no storage, no network. What the agent
// sends is checked here twice, by the Worker before the page hears it and by the page itself, with the same plain
// reasons. The tool carries the show and nothing else: it has no field for the guest's consent, the microphone or the
// studio tab, and any field it does not know is refused.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** The cue that asks the agent to call load_show (the host pressed the button). */
export const LOAD_CUE = "load_show";
/** The agent has this long to answer the button (it may ask the host in the chat first); then the button says so. A show that comes later still lands. */
export const LOAD_WAIT_MS = 180_000; // keep it in whole minutes: the button's reason counts them
/** The most a plan may weigh as JSON, like the Prompter's: 200 KB. */
export const LOAD_MAX_BYTES = 200 * 1024;
export const LOAD_LIMITS = { show: 200, guest: 80, questions: 100, question: 300, parts: 50, part: 120, minutes: 999, notes: 4000 };

const LOAD_FIELDS = ["show", "guest", "questions", "parts", "notes"];
const loadPlural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** One line of plain text: control characters and runs of space become one space. */
const loadLine = (v) => v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The show the agent sent, checked and cleaned: { ok: true, plan: { show, guest, questions, parts: [{ name, minutes }],
 * notes } } (show, guest and notes are "" when left out), or { ok: false, reason } in plain words. Nothing is cut: a
 * plan that is too big or not clear is refused whole.
 */
export function readLoad(args) {
  const no = (reason) => ({ ok: false, reason });
  if (!args || typeof args !== "object" || Array.isArray(args)) return no("Send the show as an object with show, guest, questions, parts and notes.");
  // The Worker's own 200 KB request limit refuses first, so here this guards the page; a plan this big never gets past the Worker.
  if (new TextEncoder().encode(JSON.stringify(args)).length > LOAD_MAX_BYTES) return no(`The plan is too big. Limit: ${LOAD_MAX_BYTES / 1024} KB.`);
  const extra = Object.keys(args).find((k) => !LOAD_FIELDS.includes(k));
  if (extra !== undefined) return no(`Unknown field "${extra.slice(0, 40)}". This tool loads the show only: show, guest, questions, parts and notes. Guest consent, the microphone and tab sharing are the host's own clicks.`);

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

  let questions = [];
  if (args.questions !== undefined) {
    if (!Array.isArray(args.questions)) return no("\"questions\" must be a list of questions.");
    if (args.questions.length > LOAD_LIMITS.questions) return no(`Too many questions. Limit: ${LOAD_LIMITS.questions}.`);
    for (const [i, q] of args.questions.entries()) {
      if (typeof q !== "string" || !loadLine(q)) return no(`Question ${i + 1} must be some text.`);
      if (loadLine(q).length > LOAD_LIMITS.question) return no(`Question ${i + 1} is too long. Limit: ${LOAD_LIMITS.question} characters.`);
    }
    questions = args.questions.map(loadLine);
  }

  if (!Array.isArray(args.parts) || !args.parts.length) return no("\"parts\" is needed: the run order, one part for each stretch of the show, with its name and planned minutes.");
  if (args.parts.length > LOAD_LIMITS.parts) return no(`Too many parts. Limit: ${LOAD_LIMITS.parts}.`);
  const parts = [];
  for (const [i, p] of args.parts.entries()) {
    if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => k !== "name" && k !== "minutes")) return no(`Part ${i + 1} must be { "name": ..., "minutes": ... }.`);
    const name = typeof p.name === "string" ? loadLine(p.name) : "";
    if (!name) return no(`Part ${i + 1} needs a name.`);
    if (name.length > LOAD_LIMITS.part) return no(`Part ${i + 1}'s name is too long. Limit: ${LOAD_LIMITS.part} characters.`);
    if (!Number.isSafeInteger(p.minutes) || p.minutes < 1 || p.minutes > LOAD_LIMITS.minutes) return no(`Part ${i + 1} ("${name.slice(0, 40)}") needs whole minutes from 1 to ${LOAD_LIMITS.minutes}.`);
    parts.push({ name, minutes: p.minutes });
  }
  return { ok: true, plan: { show: show.value, guest: guest.value, questions, parts, notes: notes.value } };
}

/**
 * A plan as the text the host could have pasted (the format of src/runorder.mjs), so the agent's show lands in the
 * plan box and the host edits it there. Every part says "min" outright, so a name that starts with "min" stays whole.
 */
export function planText(plan) {
  return [
    plan.show && `Show: ${plan.show}`,
    plan.guest && `Guest: ${plan.guest}`,
    ...plan.parts.map((p) => `${p.minutes} min ${p.name}`),
    ...plan.questions.map((q, i) => `${i + 1}. ${q}`),
  ].filter(Boolean).join("\n");
}

/**
 * Step 3's "Let my agent load it" for the state it is in. agent: the link's state (off, waiting, on, elsewhere);
 * load: { phase: "idle" | "asking" | "loaded" | "failed", name (the agent's name), plan (what was loaded), reason
 * (why it failed) }; locked: the show clock runs, so the plan stays as it is. Gives { state, text, tip, off, primary }:
 * off is the reason the button is switched off; primary is the orange look, only for the button ready to press.
 */
export function loadButton({ agent, load, locked = false }) {
  const label = "Let my agent load it";
  if (load.phase === "loaded") {
    const { plan } = load;
    const counts = [plan.questions.length ? loadPlural(plan.questions.length, "question") : "", loadPlural(plan.parts.length, "part")].filter(Boolean);
    const tip = [plan.show && `Show: ${plan.show}.`, plan.guest && `Guest: ${plan.guest}.`, `${counts.join(", ")}${plan.notes ? ", guest notes" : ""}.`].filter(Boolean).join(" ");
    return { state: "ok", text: `Loaded by ${load.name} · ${counts.join(" · ")}`, tip, off: "", primary: false };
  }
  if (locked) return { state: null, text: label, tip: "", off: "The show has started, so the plan stays as it is.", primary: true };
  // A request on its way stays shown while the link is only quiet (the agent is busy with the host's outline), but not once the agent is gone.
  if (load.phase === "asking" && (agent === "on" || agent === "waiting")) return { state: "busy", text: "Agent is loading…", tip: `Waiting for ${load.name} to send the show.`, off: "", primary: false };
  if (agent !== "on") return { state: null, text: label, tip: "", off: agent === "elsewhere" ? "Your agent is connected in another tab." : "Connect your agent first (step 2).", primary: true };
  if (load.phase === "failed") return { state: "error", text: "Not loaded · try again", tip: load.reason, off: "", primary: false };
  return { state: null, text: label, tip: `${load.name} sends the show name, guest, questions and run order. You can still change them.`, off: "", primary: true };
}
