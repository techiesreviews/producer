// Every text colour of the page against the background it sits on, light and dark (WCAG AA, 4.5:1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(import.meta.dirname, "../src/theme.css"), "utf8");

function oklchToRgb(value) {
  const [, l, c, h] = value.match(/^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)\s*\)$/) || assert.fail(`not a plain oklch colour: ${value}`);
  const hue = h === "none" ? 0 : (Number(h) * Math.PI) / 180;
  const a = Number(c) * Math.cos(hue), b = Number(c) * Math.sin(hue), L = Number(l) / 100;
  const lms = [L + 0.3963377774 * a + 0.2158037573 * b, L - 0.1055613458 * a - 0.0638541728 * b, L - 0.0894841775 * a - 1.291485548 * b].map((x) => x ** 3);
  const linear = [4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2], -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2], -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2]];
  return linear.map((x) => Math.min(1, Math.max(0, x)));
}
const luminance = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// token -> { light, dark }, from `--name: light-dark(a, b);` or `--name: a;`.
const tokens = {};
for (const [, name, value] of css.matchAll(/^\s*--([\w-]+):\s*(.+?);\s*$/gm)) {
  const pair = value.match(/^light-dark\((oklch\([^)]*\)),\s*(oklch\([^)]*\))\)$/);
  if (pair) tokens[name] = { light: pair[1], dark: pair[2] };
  else if (/^oklch\(/.test(value)) tokens[name] = { light: value, dark: value };
}

// [text, background]: what the page puts text on. --faint is only for switched-off controls, which WCAG leaves out
// of the contrast rule (inactive controls).
const PAIRS = [["text", "bg"], ["text", "surface"], ["text", "raised"], ["muted", "bg"], ["muted", "surface"], ["muted", "raised"], ["on-ink", "ink"], ["on-accent", "accent"], ["agent-ink", "bg"], ["agent-ink", "surface"]];

test("every text colour meets 4.5:1 on its background, in light and dark", () => {
  for (const mode of ["light", "dark"]) {
    for (const [fg, bg] of PAIRS) {
      assert.ok(tokens[fg] && tokens[bg], `token --${fg} or --${bg} is missing`);
      const r = ratio(oklchToRgb(tokens[fg][mode]), oklchToRgb(tokens[bg][mode]));
      assert.ok(r >= 4.5, `${mode}: --${fg} on --${bg} is ${r.toFixed(2)}:1`);
    }
  }
});

test("the theme is a light and a dark one that follow the system", () => {
  assert.match(css, /color-scheme:\s*light dark/);
  assert.ok(Object.values(tokens).filter((t) => t.light !== t.dark).length >= 8, "most tokens differ between light and dark");
});

test("the keyboard focus ring meets 3:1 on every surface it can sit on, in light and dark", () => {
  const ring = css.match(/:focus-visible\s*\{[^}]*outline:\s*\S+\s+\S+\s+var\(--([\w-]+)\)/)?.[1];
  assert.ok(ring, "the focus ring takes its colour from a theme token");
  for (const mode of ["light", "dark"]) {
    for (const bg of ["bg", "surface", "raised"]) {
      const r = ratio(oklchToRgb(tokens[ring][mode]), oklchToRgb(tokens[bg][mode]));
      assert.ok(r >= 3, `${mode}: the ring (--${ring}) on --${bg} is ${r.toFixed(2)}:1`);
    }
  }
});
