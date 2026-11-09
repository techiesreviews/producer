// The scorer the speech browser check uses (test/speech-score.mjs): word errors and delay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { align, delays, wordErrors, words } from "./speech-score.mjs";

test("words: lower case, no punctuation, Mr. is mister and a lone digit its word", () => {
  assert.deepEqual(words("Mr. Hurstwood, he said: \"It's 3 o'clock!\""), ["mister", "hurstwood", "he", "said", "it's", "three", "o'clock"]);
});

test("word errors count substitutions, deletions and insertions", () => {
  assert.equal(align(["a", "b", "c"], ["a", "b", "c"]).errors, 0);
  assert.equal(align(["a", "b", "c"], ["a", "x", "c"]).errors, 1);
  assert.equal(align(["a", "b", "c"], ["a", "c"]).errors, 1);
  assert.equal(align(["a", "b", "c"], ["a", "b", "b", "c"]).errors, 1);
  assert.deepEqual(align(["a", "b", "c"], ["a", "c"]).matched, [0, -1, 1]);
  const score = wordErrors([{ text: "one two three four" }], [{ text: "One, two" }, { text: "three for." }]);
  assert.deepEqual(score, { rate: 0.25, errors: 1, words: 4 });
});

test("delay: from each word's estimated end to the first message of its piece that held it", () => {
  const utterances = [{ start: 0, end: 2, text: "aaaa bbbb" }];
  const messages = [
    { piece: 1, final: false, text: "aaaa", at: 1.3 },
    { piece: 1, final: true, text: "aaaa bbbb", at: 2.5 },
  ];
  const d = delays(utterances, messages);
  assert.equal(d.counted, 2);
  assert.ok(Math.abs(d.middle - 0.4) < 1e-9, `the middle of 0.3 s and 0.5 s (${d.middle})`);
  assert.ok(Math.abs(d.slowest - 0.5) < 1e-9);
});
