// Scores speech-to-text against a known clip, for test/browser/speech.mjs (and its own unit test): word errors
// (substitutions, deletions and insertions over the reference's words) and the delay from each word's end to the
// moment its text first reached the page. Word end times inside a sentence are estimated by their place in it
// (as the TOOLS-150 test did, good to about 0.3 s).

const NUMBER_WORDS = { 0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten" };

/** Lower case words without punctuation; "mr" is "mister" and a lone digit is its word, as the reference writes them. */
export function words(text) {
  return String(text).toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9' ]+/g, " ").split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean)
    .map((w) => (w === "mr" ? "mister" : w === "mrs" ? "missus" : NUMBER_WORDS[w] ?? w));
}

/** Levenshtein alignment of two word lists: the error count and, per reference word, the index it matched (or -1). */
export function align(ref, hyp) {
  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const cost = Array.from({ length: rows }, (_, i) => Int32Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      cost[i][j] = Math.min(cost[i - 1][j] + 1, cost[i][j - 1] + 1, cost[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
  }
  const matched = new Array(ref.length).fill(-1);
  for (let i = ref.length, j = hyp.length; i > 0 && j > 0;) {
    if (ref[i - 1] === hyp[j - 1] && cost[i][j] === cost[i - 1][j - 1]) { matched[i - 1] = j - 1; i--; j--; }
    else if (cost[i][j] === cost[i - 1][j - 1] + 1) { i--; j--; }
    else if (cost[i][j] === cost[i - 1][j] + 1) i--;
    else j--;
  }
  return { errors: cost[ref.length][hyp.length], matched };
}

/** Word error rate of the final text against the clip's sentences. */
export function wordErrors(utterances, finals) {
  const ref = utterances.flatMap((u) => words(u.text));
  const hyp = finals.flatMap((f) => words(f.text));
  const { errors } = align(ref, hyp);
  return { rate: errors / ref.length, errors, words: ref.length };
}

const median = (list) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const percentile = (list, p) => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : NaN;
};

/**
 * Delay per recognised word: messages are { piece, final, text, at } (at: seconds after the clip began, when the page
 * got them). Each reference word that the final text matched counts from its estimated end to the first message of the
 * same piece (draft or final) that already held it at about the same place (within two words). Returns the middle
 * and the slowest 1 in 10, in seconds.
 */
export function delays(utterances, messages) {
  const ref = [];
  for (const u of utterances) {
    const list = words(u.text);
    const letters = list.reduce((n, w) => n + w.length, 0);
    let seen = 0;
    for (const w of list) { seen += w.length; ref.push({ word: w, end: u.start + (u.end - u.start) * (seen / letters) }); }
  }
  const finals = messages.filter((m) => m.final);
  const hyp = [];
  for (const f of finals) words(f.text).forEach((w, k) => hyp.push({ word: w, k, piece: f.piece, final: f }));
  const { matched } = align(ref.map((r) => r.word), hyp.map((h) => h.word));
  const list = [];
  matched.forEach((j, i) => {
    if (j < 0) return;
    const { word, k, piece, final } = hyp[j];
    const held = (m) => words(m.text).slice(Math.max(0, k - 2), k + 3).includes(word);
    const first = messages.find((m) => m.piece === piece && m.at <= final.at && held(m)) || final;
    list.push(Math.max(0, first.at - ref[i].end));
  });
  return { middle: median(list), slowest: percentile(list, 0.9), counted: list.length };
}
