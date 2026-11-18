// The search box over the whole question list (TOOLS-344): the host types a word and every prepared question that
// holds it shows at once, in show order, grouped by the part the plan puts it under. A plain text search in this
// page: no AI, nothing sent, nothing stored. Plain facts in, words out.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** The words typed: lower case, split on spaces. */
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

/** The question's own text in pieces, the searched words marked: [{ text, hit }]. Where two words overlap, both are marked as one. */
export function markWords(text, words) {
  const lower = text.toLowerCase();
  const hit = new Array(text.length).fill(false);
  for (const w of words) {
    for (let at = lower.indexOf(w); at >= 0; at = lower.indexOf(w, at + 1)) hit.fill(true, at, at + w.length);
  }
  const pieces = [];
  for (let i = 0; i < text.length; i++) {
    const last = pieces.at(-1);
    if (last && last.hit === hit[i]) last.text += text[i];
    else pieces.push({ text: text[i], hit: hit[i] });
  }
  return pieces.length ? pieces : [{ text, hit: false }];
}
