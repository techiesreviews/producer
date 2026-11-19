// The show's prompter script (TOOLS-345): the agent hands load_show the script as it is (src/agent-load.mjs), and this
// reads the run order and the prepared questions out of it, each question with its part, so the search groups by part.
// The script's format, one thing per line:
//   ### **1 · INTRO · 00:00**     a part: its heading ends with the time it starts (mm:ss or h:mm:ss) and the piece
//                                  before the time is its name (a name in capitals reads as Title Case)
//   ### **PREP**                  a heading with no time is not on air: its lines are left out
//   [Wait ten seconds.]            a reminder, a whole line in square brackets (a link too): left out
//   Robert, what is the one        a spoken line. A sentence may run over several short lines, so the lines are
//   thing none of that covers?     joined and split again into sentences; a question is a sentence ending in "?"
// A one-word question ("Right?") is a tag on the sentence before it, not a question to ask, so it is left out. A blank
// line or a new heading ends a sentence that never finished. A part lasts until the next one starts; the last part gets
// SCRIPT_LAST_MINUTES. Plain facts in, words out: no page, no storage, no network.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** The last part has no next part to end it: it is planned at this many minutes. */
export const SCRIPT_LAST_MINUTES = 5;

const SCRIPT_HEADING = /^###\s+(.+)$/;
const SCRIPT_TIME = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/;
const SCRIPT_REMINDER = /^\[[^\]]*\](?:\([^)]*\))?$/;
/** The first whole sentence of a running text: up to its end mark (and a closing quote or bracket), then a space or the end. */
const SCRIPT_SENTENCE = /^(.*?[.!?…]+["'”’)\]]*)(?:\s+|$)/;
const SCRIPT_QUESTION = /\?["'”’)\]]*$/;

const scriptSeconds = (time) => {
  const m = time.match(SCRIPT_TIME);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};
/** A name in capitals as Title Case ("ROBERT'S STORY" → "Robert's Story"); a word with a digit (2FA) stays as it is. */
const scriptName = (name) => (/\p{Ll}/u.test(name) ? name : name.split(" ").map((w) => (/\d/.test(w) ? w : w.toLowerCase().replace(/\p{L}/u, (c) => c.toUpperCase()))).join(" "));

/**
 * readScript(text): { ok: true, parts: [{ name, minutes }], questions: [{ text, part }] } (part: the index of the
 * question's part, from 0), or { ok: false, reason } in plain words when the script gives no run order.
 */
export function readScript(text) {
  const parts = []; // { name, start (seconds), at (the time as written) }
  const questions = [];
  let open = ""; // a sentence still running on to the next line
  let onAir = false;
  for (const raw of String(text).split(/\r\n?|\n/)) {
    const line = raw.trim();
    const heading = line.match(SCRIPT_HEADING);
    if (heading) {
      open = "";
      const pieces = heading[1].replace(/\*\*/g, "").split("·").map((p) => p.trim()).filter(Boolean);
      const start = pieces.length ? scriptSeconds(pieces.at(-1)) : null;
      onAir = start !== null;
      if (onAir) parts.push({ name: scriptName(pieces.length > 1 ? pieces.at(-2) : ""), start, at: pieces.at(-1) });
      continue;
    }
    if (!line) { open = ""; continue; }
    if (!onAir || line.startsWith("#") || SCRIPT_REMINDER.test(line)) continue;
    open = `${open} ${line.replace(/\*\*/g, "")}`.replace(/\s+/g, " ").trim();
    for (let m = open.match(SCRIPT_SENTENCE); m; m = open.match(SCRIPT_SENTENCE)) {
      const sentence = m[1].trim();
      if (SCRIPT_QUESTION.test(sentence) && sentence.split(" ").length >= 2) questions.push({ text: sentence, part: parts.length - 1 });
      open = open.slice(m[0].length);
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
