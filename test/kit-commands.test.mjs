// The project's own kit commands (scripts/agents/project.d): present, runnable, and they answer --help.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

for (const name of ["specs", "size"]) {
  test(`kit ${name}: an executable launcher that answers --help`, () => {
    const file = resolve(root, "scripts/agents/project.d", name);
    accessSync(file, constants.X_OK);
    const run = spawnSync(file, ["--help"], { encoding: "utf8", env: { ...process.env, KIT_ROOT: root } });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, new RegExp(`^Usage: kit ${name}\\b`));
  });
}

test("kit.json names no machine path: Playwright is found by the adapter, not by a home folder in the repo", () => {
  const settings = JSON.parse(readFileSync(resolve(root, "scripts/agents/kit.json"), "utf8"));
  assert.equal(settings.playwright, undefined);
  assert.ok(settings.paths.visible.some((p) => new RegExp(p).test("src/page.html")), "the page counts as a visible change");
});
