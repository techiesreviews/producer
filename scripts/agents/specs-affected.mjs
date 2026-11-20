// Which browser suites (test/browser/<name>.mjs) a change can reach, for `kit specs --affected` (kit pr runs it).
// Import-only: producer-kit.mjs, test/specs-affected.test.mjs and `kit unit --affected` (graphFile, importsOf) use it.
import { execFileSync } from "node:child_process";

/** For `kit unit --affected`: the files whose imports it reads (the project's JavaScript modules; docs, styles, the
 * page and fixtures hold none) and how it reads them: the module names a file loads by import, re-export or
 * dynamic import. Older kits fail without both ("Cannot read properties of undefined (reading 'test')"). */
export const graphFile = /^(src|scripts|test)\/.*\.m?js$/;
export const importsOf = (text) => [...text.matchAll(/\b(?:import|export)\s+(?:[^;"'`]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] ?? m[2]);

/** Per suite, the changed paths that reach it; "*" for a suite not named here. Docs (.md) reach none; the specs
 * runner itself (this file, producer-kit.mjs) reaches every suite. */
const RUNNER = /^scripts\/agents\/(producer-kit|specs-affected)\.mjs$/;
const either = (a, b) => new RegExp(`${a.source}|${b.source}`);
export const REACHES = {
  page: either(/^(src\/(?!.*\.md$)|scripts\/build\.mjs$|wrangler\.jsonc$|test\/browser\/page\.mjs$)/, RUNNER),
  speech: either(/^(src\/(?!.*\.md$)|scripts\/(build|speech-files)\.mjs$|wrangler\.jsonc$|test\/browser\/speech\.mjs$|test\/speech-score\.mjs$|test\/fixtures\/two-voices\.)/, RUNNER),
  "*": either(/^(src\/(?!.*\.md$)|test\/browser\/)/, RUNNER),
};

/** Committed, staged and unstaged changes since the branch left base, and new files not yet added (not ignored ones). */
export function changedSince(base, cwd) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const since = git("merge-base", base, "HEAD").trim();
  return [...new Set([...git("diff", "--name-only", since).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean))];
}

/** The suites, of names, that any changed path reaches. */
export const suitesFor = (names, changed) => names.filter((n) => changed.some((f) => (REACHES[n] || REACHES["*"]).test(f)));
