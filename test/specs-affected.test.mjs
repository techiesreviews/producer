import { test } from "node:test";
import assert from "node:assert/strict";
import { REACHES, graphFile, importsOf, suitesFor } from "../scripts/agents/specs-affected.mjs";

const names = ["page"];

// TOOLS-187: `kit unit --affected` reads these two exports (its import scan); older kits failed when they were missing.
test("graphFile is a regular expression for the JavaScript files the import scan reads", () => {
  assert.ok(graphFile instanceof RegExp);
  for (const file of ["src/app.js", "src/ui/tooltip.mjs", "scripts/build.mjs", "scripts/agents/producer-kit.mjs", "test/build.test.mjs", "test/browser/page.mjs"]) {
    assert.ok(graphFile.test(file), file);
  }
  for (const file of ["README.md", "package.json", "src/page.html", "src/app.css", "wrangler.jsonc", "test/fixtures/two-voices.wav"]) {
    assert.ok(!graphFile.test(file), file);
  }
});

test("importsOf lists the module names a file loads, by import, re-export and dynamic import", () => {
  const text = [
    'import { CUE, TOOL } from "./protocol.mjs";',
    'import * as all from "../src/cues.mjs";',
    'import "./side-effect.mjs";',
    'export { thing } from "./things.mjs";',
    'export * from "./more.mjs";',
    'const late = await import("./late.mjs");',
    'import { readFileSync } from "node:fs";',
  ].join("\n");
  assert.deepEqual(importsOf(text), ["./protocol.mjs", "../src/cues.mjs", "./side-effect.mjs", "./things.mjs", "./more.mjs", "./late.mjs", "node:fs"]);
  assert.deepEqual(importsOf("export const a = 1; // import from the docs"), []);
});

test("the page suite is reached by the page, its styles and script, the build and the Worker config", () => {
  for (const file of ["src/page.html", "src/app.css", "src/theme.css", "src/app.js", "src/ui/tooltip.mjs", "src/worker.mjs", "scripts/build.mjs", "wrangler.jsonc", "test/browser/page.mjs", "scripts/agents/producer-kit.mjs", "scripts/agents/specs-affected.mjs"]) {
    assert.deepEqual(suitesFor(names, [file]), ["page"], file);
  }
});

test("docs, workflows, unit tests and settings reach no browser suite", () => {
  for (const file of ["README.md", "AGENTS.md", "docs/agents/kitchen-extras.md", "src/README.md", ".github/workflows/deploy-preview.yml", "test/build.test.mjs", "scripts/agents/kit.json", "package.json"]) {
    assert.deepEqual(suitesFor(names, [file]), [], file);
  }
});

test("a suite that is not named gets the catch-all", () => {
  assert.ok(REACHES["*"].test("test/browser/other.mjs"));
  assert.deepEqual(suitesFor(["other"], ["src/app.js"]), ["other"]);
});

test("the speech suite is reached by the page, the speech worker, the pinned speech files, its clip and its scorer", () => {
  for (const file of ["src/app.js", "src/listen.mjs", "src/speech/worker.mjs", "src/speech/segmenter.mjs", "scripts/build.mjs", "scripts/speech-files.mjs", "test/browser/speech.mjs", "test/speech-score.mjs", "test/fixtures/two-voices.wav", "test/fixtures/two-voices.json", "scripts/agents/producer-kit.mjs"]) {
    assert.ok(suitesFor(["page", "speech"], [file]).includes("speech"), file);
  }
  for (const file of ["README.md", "test/speech.test.mjs", "test/browser/page.mjs", "docs/agents/features.md"]) {
    assert.ok(!suitesFor(["page", "speech"], [file]).includes("speech"), file);
  }
});
