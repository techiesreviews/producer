import { test } from "node:test";
import assert from "node:assert/strict";
import { REACHES, suitesFor } from "../scripts/agents/specs-affected.mjs";

const names = ["page"];

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
