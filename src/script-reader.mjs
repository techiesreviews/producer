// The show's prompter script (TOOLS-345): the agent hands load_show the script as it is (src/agent-load.mjs), and this
// reads the run order and the prepared questions out of it, each question with its part, so the search groups by part.
// The script's format, one thing per line:
//   ### **1 · INTRO · 00:00**     a part: its heading ends with the time it starts (mm:ss or h:mm:ss) and the piece
//                                  before the time is its name (a name in capitals reads as Title Case)
//   ### **PREP**                  a heading with no time is not on air: its lines are left out
//   [Wait ten seconds.]            a reminder, a whole line in square brackets (a link too): left out
//   Robert, what is the one        a spoken line. A sentence may run over several short lines, so the lines are
//   thing none of that covers?     joined and split again into sentences; a question is a sentence ending in "?"
// A pause in a line ("So… what now?", "So... what now?"), a title (Dr. Lee), initials (J. K., U.S.: scriptInitial), a
// full stop before a word in lower case (Acme Inc. survived) and an abbreviation before a number (Nov. 5) do not end a
// sentence; a pause at the end of a line ends it unless the next line goes on in lower case ("So…" then "what now?"). A
// one-word question after a sentence on the same line ("…safe. Right?") is a tag on that sentence, not a question to
// ask, so it is left out; on a line of its own ("Why?") it is a question. A blank line or a new heading ends a sentence
// that never finished. A question is never shortened: one too long for load_show is refused there with its first words,
// so the host can find it (a script whose lines lack their end marks runs them together). Emphasis marks (* and _) are
// dropped. The end marks are the Latin ones (. ! ? …): a script in a language with its own (？ 。 ؟) finds no questions.
// A part lasts until the next one starts; the last part gets SCRIPT_LAST_MINUTES. Plain facts in, words out: no page,
// no storage, no network.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** The last part has no next part to end it: it is planned at this many minutes. */
export const SCRIPT_LAST_MINUTES = 5;
/** A run of lines still waiting for its end mark keeps at most this many characters: its first words. A question that
 * long is refused anyway (LOAD_LIMITS.question is 300), so only its first words still matter. */
const SCRIPT_RUN = 2000;

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
/** Abbreviations a full stop and a number follow without ending the sentence (Nov. 5, No. 2, Vol. 3). */
const SCRIPT_BEFORE_NUMBERS = new Set(["no", "nr", "vol", "fig", "ch", "p", "pp", "ep", "ca", "approx", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);

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
    const after = text.slice(m.index + m[0].length).trim();
    const word = text.slice(text.lastIndexOf(" ", m.index - 1) + 1, m.index).replace(/^[^\p{L}]+/u, ""); // the word before the mark
    // A full stop at the end of the run waits for the next line, one before a word in lower case never starts a
    // sentence there (Acme Inc. survived), and nor does one after an abbreviation from SCRIPT_BEFORE_NUMBERS before a number (Nov. 5).
    if (mark === "." && (!after || /^[^\p{L}]*\p{Ll}/u.test(after) || (/^\p{N}/u.test(after) && SCRIPT_BEFORE_NUMBERS.has(word.toLowerCase())))) continue;
    if (mark === "." && SCRIPT_TITLES.has(word.toLowerCase())) continue; // a title (Dr. Lee)
    if (mark === "." && /^(?:\p{L}\.)*\p{L}$/u.test(word) && scriptInitial(word)) continue;
    return m.index + m[0].length;
  }
  return -1;
}
/**
 * Letters with full stops (U.S.) and one capital letter other than I (J. K. Rowling, plan B.) keep the sentence going:
 * "the U.S. Supreme Court" and "the U.S. Why…" look alike, and a question must never lose its first words, so at worst
 * it keeps a sentence in front. One small letter (a.) keeps it going only before a word in lower case; "So did I. What"
 * ends its sentence.
 */
function scriptInitial(word) {
  return word.includes(".") || (/^\p{Lu}$/u.test(word) && word !== "I");
}
/** A name in capitals as Title Case ("ROBERT'S STORY" → "Robert's Story"); a word with a digit (2FA) stays as it is. */
const scriptName = (name) => (/\p{Ll}/u.test(name) ? name : name.split(" ").map((w) => (/\d/.test(w) ? w : w.toLowerCase().replace(/\p{L}/u, (c) => c.toUpperCase()))).join(" "));

/**
 * readScript(text): { ok: true, parts: [{ name, minutes }], questions: [{ text, part, joined? }] } (part: the index of
 * the question's part, from 0; joined: true for a question that ran over several lines), or { ok: false, reason } in plain words when the script gives no run order.
 */
export function readScript(text) {
  const parts = []; // { name, start (seconds), at (the time as written) }
  const questions = [];
  let open = ""; // a sentence still running on to the next line
  let head = true; // that sentence starts at the start of a line (not after another sentence on its line)
  let onAir = false;
  for (const raw of String(text).split(/\r\n?|\n/)) {
    const line = raw.trim();
    const heading = line.match(SCRIPT_HEADING);
    if (heading) {
      open = "";
      const pieces = scriptPlain(heading[1]).split("·").map((p) => p.trim()).filter(Boolean);
      const start = pieces.length ? scriptSeconds(pieces.at(-1)) : null;
      onAir = start !== null;
      if (onAir) parts.push({ name: scriptName(pieces.length > 1 ? pieces.at(-2) : ""), start, at: pieces.at(-1) });
      continue;
    }
    if (!line) { open = ""; continue; }
    if (!onAir || line.startsWith("#") || SCRIPT_REMINDER.test(line)) continue;
    const said = scriptPlain(line).replace(/\s+/g, " ").trim();
    if (!said) continue;
    // A pause at the end of the line before ends its sentence, unless this line goes on in lower case.
    if (open && SCRIPT_PAUSE.test(open) && !/^[^\p{L}]*\p{Ll}/u.test(said)) open = "";
    if (!open) head = true;
    const run = open ? `${open} ${said}` : said;
    const lineAt = run.length - said.length; // where this line starts in the run
    let at = 0; // where the next sentence starts in the run
    for (let end = scriptEnd(run.slice(at)); end > 0; end = scriptEnd(run.slice(at))) {
      const sentence = run.slice(at, at + end).trim();
      // A one-word question after another sentence on its line ("…safe. Right?") is a tag on that sentence.
      const fromLine = at === lineAt || (at === 0 && head);
      if (SCRIPT_QUESTION.test(sentence) && (fromLine || sentence.includes(" "))) questions.push({ text: sentence, part: parts.length - 1, ...(at < lineAt ? { joined: true } : {}) });
      at += end;
      while (run[at] === " ") at += 1;
    }
    if (at > 0) head = at === lineAt;
    open = run.slice(at);
    // An overlong run keeps its first SCRIPT_RUN characters: any question it ends in is still far over the limit, so it
    // is refused, never shortened into one that loads. (A full stop the cut leaves at its end waits, as at a line's end.)
    if (open.length > SCRIPT_RUN) open = open.slice(0, SCRIPT_RUN);
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
