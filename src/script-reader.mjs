// The show's prompter script (TOOLS-345): the agent hands load_show the script as it is (src/agent-load.mjs), and this
// reads the run order and the prepared questions out of it, each question with its part, so the search groups by part.
// The script's format, one thing per line:
//   ### **1 · INTRO · 00:00**     a part: its heading ends with the time it starts (mm:ss or h:mm:ss) and the piece
//                                  before the time is its name (a name in capitals reads as Title Case)
//   ### **PREP**                  a heading with no time is not on air: its lines are left out
//   [Wait ten seconds.]            a reminder, a whole line in square brackets (a link too): left out
//   Robert, what is the one        a spoken line. A sentence may run over several short lines, so the lines are
//   thing none of that covers?     joined and split again into sentences; a question is a sentence ending in "?"
// A pause in a line ("So… what now?", "So... what now?") and a title (Dr. Lee) do not end a sentence; a pause at the
// end of a line ends it unless the next line goes on in lower case ("So…" then "what now?"). A one-word question
// ("Right?") is a tag on the sentence before it, not a question to ask, so it is left out. A blank line or a new
// heading ends a sentence that never finished, and lines with no end mark never pile up past SCRIPT_RUN characters:
// the oldest lines go first. Emphasis marks (* and _) are dropped. The end marks are the Latin ones (. ! ? …): a
// script in a language with its own (？ 。 ؟) finds no questions. A part lasts until the next one starts; the last part
// gets SCRIPT_LAST_MINUTES. Plain facts in, words out: no page, no storage, no network.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** The last part has no next part to end it: it is planned at this many minutes. */
export const SCRIPT_LAST_MINUTES = 5;
/** The longest run of lines still waiting for its end mark: a question's own limit (LOAD_LIMITS.question). */
const SCRIPT_RUN = 300;

const SCRIPT_HEADING = /^###\s+(.+)$/;
const SCRIPT_TIME = /^(?:(\d{1,2}):([0-5]\d)|(\d{1,3})):([0-5]\d)$/;
const SCRIPT_REMINDER = /^\[[^\]]*\](?:\([^)]*\))?$/;
/** Each end mark in a running text (with a closing quote or bracket), then a space or the end. */
const SCRIPT_END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
const SCRIPT_QUESTION = /\?["'”’)\]]*$/;
/** A run that ends in a pause (… or ..), with a closing quote or bracket. */
const SCRIPT_PAUSE = /(?:…|\.{2,})["'”’)\]]*$/;
/** Words a full stop follows without ending the sentence. */
const SCRIPT_TITLES = new Set(["mr", "mrs", "ms", "dr", "st", "vs", "prof", "e.g", "i.e"]);

const scriptSeconds = (time) => {
  const m = time.match(SCRIPT_TIME);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? m[3]) * 60 + Number(m[4]) : null;
};
const scriptPlain = (line) => line.replace(/\*+/g, "").replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "");
/** Where the first sentence of a running text ends (after its end mark), or -1: a pause (… or ..) or a title's full stop does not end it. */
function scriptEnd(text) {
  for (const m of text.matchAll(SCRIPT_END)) {
    const mark = m[0].replace(/["'”’)\]]+$/, "");
    if (!/[?!]/.test(mark) && (mark.includes("…") || mark.length > 1)) continue;
    if (mark === "." && SCRIPT_TITLES.has(text.slice(0, m.index).split(" ").at(-1).replace(/^[^\p{L}]+/u, "").toLowerCase())) continue;
    return m.index + m[0].length;
  }
  return -1;
}
/** A name in capitals as Title Case ("ROBERT'S STORY" → "Robert's Story"); a word with a digit (2FA) stays as it is. */
const scriptName = (name) => (/\p{Ll}/u.test(name) ? name : name.split(" ").map((w) => (/\d/.test(w) ? w : w.toLowerCase().replace(/\p{L}/u, (c) => c.toUpperCase()))).join(" "));

/**
 * readScript(text): { ok: true, parts: [{ name, minutes }], questions: [{ text, part }] } (part: the index of the
 * question's part, from 0), or { ok: false, reason } in plain words when the script gives no run order.
 */
export function readScript(text) {
  const parts = []; // { name, start (seconds), at (the time as written) }
  const questions = [];
  let open = []; // the lines of a sentence still running on to the next line
  let onAir = false;
  for (const raw of String(text).split(/\r\n?|\n/)) {
    const line = raw.trim();
    const heading = line.match(SCRIPT_HEADING);
    if (heading) {
      open = [];
      const pieces = scriptPlain(heading[1]).split("·").map((p) => p.trim()).filter(Boolean);
      const start = pieces.length ? scriptSeconds(pieces.at(-1)) : null;
      onAir = start !== null;
      if (onAir) parts.push({ name: scriptName(pieces.length > 1 ? pieces.at(-2) : ""), start, at: pieces.at(-1) });
      continue;
    }
    if (!line) { open = []; continue; }
    if (!onAir || line.startsWith("#") || SCRIPT_REMINDER.test(line)) continue;
    const said = scriptPlain(line).replace(/\s+/g, " ").trim();
    // A pause at the end of the line before ends its sentence, unless this line goes on in lower case.
    if (open.length && SCRIPT_PAUSE.test(open.at(-1)) && !/^[^\p{L}]*\p{Ll}/u.test(said)) open = [];
    open.push(said);
    while (open.length > 1 && open.join(" ").length > SCRIPT_RUN) open.shift();
    let run = open.join(" ").trim();
    for (let end = scriptEnd(run); end > 0; end = scriptEnd(run)) {
      const sentence = run.slice(0, end).trim();
      if (SCRIPT_QUESTION.test(sentence) && sentence.split(" ").length >= 2) questions.push({ text: sentence, part: parts.length - 1 });
      run = run.slice(end).trim();
      open = run ? [run] : [];
    }
  }
  if (!parts.length) return { ok: false, reason: "The script has no parts with a start time. A part's heading ends with the time it starts, like ### **1 · INTRO · 00:00**." };
  const out = [];
  for (const [i, p] of parts.entries()) {
    const next = parts[i + 1];
    if (next && next.start <= p.start) return { ok: false, reason: `Part ${i + 2} ("${next.name.slice(0, 40)}") starts at ${next.at}, not after part ${i + 1} at ${p.at}.` };
    out.push({ name: p.name, minutes: next ? Math.max(1, Math.round((next.start - p.start) / 60)) : SCRIPT_LAST_MINUTES });
  }
  return { ok: true, parts: out, questions };
}
