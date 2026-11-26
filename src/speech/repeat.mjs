// The repeat guard. A speech model can get stuck and write one phrase over and over (the TOOLS-150 test saw "I need
// five hour" 88 times). A phrase of up to eight words said more than twice in a row is kept twice; a single word more
// than three times in a row is kept three times ("no, no, no" stays). Imported by src/speech/worker.mjs and the tests.

const MAX_PHRASE = 8;

const plain = (word) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

export function guardRepeats(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  for (let n = MAX_PHRASE; n >= 1; n--) {
    const keep = n === 1 ? 3 : 2;
    for (let i = 0; i + n * (keep + 1) <= words.length; i++) {
      const same = (a, b) => {
        for (let k = 0; k < n; k++) if (plain(words[a + k]) !== plain(words[b + k])) return false;
        return true;
      };
      if (!words.slice(i, i + n).some((w) => plain(w))) continue;
      let copies = 1;
      while (i + (copies + 1) * n <= words.length && same(i, i + copies * n)) copies++;
      if (copies > keep) words.splice(i + keep * n, (copies - keep) * n);
    }
  }
  return words.join(" ");
}
