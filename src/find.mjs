export const findWords = (query) => String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);

/**
 * findQuestions({ plan, query }): plan is a clear plan of src/runorder.mjs (or null). Every word must be in the
 * question, in any order, a part of a word counts. Gives { words, count, groups: [{ part, name, items }] }: items are
 * question numbers (from 1) in show order; part is the index of the plan's part (null when the plan does not say,
 * with "" as its name).
 */
export function findQuestions({ plan, query }) {
  const words = findWords(query);
  const found = { words, count: 0, groups: [] };
  if (!words.length || !plan) return found;
  plan.questions.forEach((text, i) => {
    const lower = text.toLowerCase();
    if (!words.every((w) => lower.includes(w))) return;
    const part = plan.questionParts?.[i] ?? null;
    const last = found.groups.at(-1);
    if (last && last.part === part) last.items.push(i + 1);
    else found.groups.push({ part, name: part === null ? "" : plan.parts[part].name, items: [i + 1] });
    found.count += 1;
  });
  return found;
}

/**
 * The question's own text in pieces, the searched words marked: [{ text, hit }]. Every hit is marked, overlapping ones
 * too. It searches the text lower-cased as findQuestions does, with where each character of it came from, so a letter
 * that grows when lower-cased (İ) shifts nothing.
 */
export function markWords(text, words) {
  let lower = "";
  const from = []; // per character of the copy, its index in the text
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i));
    const low = ch.toLowerCase();
    lower += low;
    for (let k = 0; k < low.length; k++) from.push(i);
    i += ch.length;
  }
  from.push(text.length);
  // The whole text lower-cased at once, as findQuestions does (a final Σ becomes ς); it lines up with the copy letter by letter.
  const whole = text.toLowerCase();
  if (whole.length === lower.length) lower = whole;
  const hit = new Array(text.length).fill(false);
  for (const w of words) {
    for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) {
      const end = from[at + w.length - 1];
      hit.fill(true, from[at], end + String.fromCodePoint(text.codePointAt(end)).length);
    }
  }
  const pieces = [];
  for (let i = 0; i < text.length; i++) {
    const last = pieces.at(-1);
    if (last && last.hit === hit[i]) last.text += text[i];
    else pieces.push({ text: text[i], hit: hit[i] });
  }
  return pieces.length ? pieces : [{ text, hit: false }];
}
