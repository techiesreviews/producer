#!/usr/bin/env node
// Builds dist/: one self-contained index.html (styles and script inlined), the _headers file whose policy pins
// the hash of that inline script and style and allows microphone and screen capture for this site only,
// robots.txt, and speech/: the speech worker (src/speech/*.mjs as they are), manifest.json and the speech model
// with its engine (scripts/speech-files.mjs). The page asks for no outside file; the worker only for this site's.
// Usage: node scripts/build.mjs [outDir=dist] [--host <host> | --host=<host>] [--no-speech]
// --host names the address the page is served from (default the live producer.techies.tools): any other
// address (the preview) asks search engines to stay away. The command line fetches the pinned speech files once
// into a cache outside the repo (checked by size and SHA-256) and copies them in; build() alone, as the unit
// tests call it, leaves them out unless given speechDir, and the page then reports the model missing. --no-speech
// does the same from the command line, for checks without a network; a deploy never passes it.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cacheDir, copySpeechFiles, fetchSpeechFiles, SPEECH_BYTES, speechManifest } from "./speech-files.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(join(root, file), "utf8");

/** Stylesheets inlined into the page's one style block, in this order. */
export const STYLES = ["src/theme.css", "src/app.css"];

/** Shared modules inlined into the page script, in this order, without `export`; then src/app.js. */
export const INLINED = ["src/browser.mjs", "src/listen.mjs", "src/runorder.mjs", "src/ui/tooltip.mjs", "src/agent-ways.mjs", "src/agent-message.mjs", "src/agent-link.mjs"];

/** The speech worker and the modules it imports, served as they are under /speech/. */
export const SPEECH_WORKER = ["src/speech/worker.mjs", "src/speech/lanes.mjs", "src/speech/segmenter.mjs", "src/speech/resample.mjs", "src/speech/repeat.mjs"];

/** The live address, and the preview's (Worker producer-preview). */
export const LIVE_HOST = "producer.techies.tools";
export const PREVIEW_HOST = "preview-producer.techies.tools";

export function pageStyle() {
  return `\n${STYLES.map((file) => read(file).trim()).join("\n\n")}\n`;
}

/** Inline the page script: the shared modules, then the app, in one function scope. */
export function pageScript() {
  const modules = INLINED.map((file) => {
    const source = read(file);
    if (/^\s*import\s/m.test(source)) throw new Error(`${file} must not import anything`);
    const stripped = source.replace(/^export (?=(async )?function |const |let |class )/gm, "");
    if (/^export\b/m.test(stripped)) throw new Error(`${file} has an export form the build cannot strip`);
    return stripped;
  });
  return `\n(() => {\n${modules.join("\n")}\n${read("src/app.js")}\n})();\n`;
}

const sha256 = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;

/** The download size on the speech button, in whole megabytes (82 MB). */
export const speechMegabytes = () => `${Math.round(SPEECH_BYTES / 1e6)} MB`;

export function build(dir = join(root, "dist"), { host = LIVE_HOST, speechDir = null } = {}) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) throw new Error(`not a host name: ${host}`);
  const page = read("src/page.html");
  const marks = { style: "<style>/*@CSS@*/</style>", script: "<script>/*@APP@*/</script>", size: "<!--@SPEECH_SIZE@-->" };
  for (const mark of Object.values(marks)) if (!page.includes(mark)) throw new Error(`src/page.html is missing ${mark}`);
  const style = pageStyle();
  const script = pageScript();
  if (/<\/style/i.test(style)) throw new Error("page style must not contain </style");
  if (/<\/script/i.test(script)) throw new Error("page script must not contain </script");
  const html = page.replace(marks.style, () => `<style>${style}</style>`).replace(marks.script, () => `<script>${script}</script>`).replace(marks.size, speechMegabytes());
  const csp = [
    "default-src 'none'",
    `script-src ${sha256(script)}`,
    `style-src ${sha256(style)}`,
    "img-src data:",
    // Only this site: its relay (/api/relay, a WebSocket) and its token (/api/agent-token). Nothing outside.
    "connect-src 'self'",
    // The speech worker, from this site only (/speech/worker.mjs).
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  // The speech worker's own policy: scripts and files from this site only (its modules, the engine, the model),
  // and the engine's WebAssembly; no page, frame, image or style of any kind.
  const workerCsp = [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const live = host === LIVE_HOST;
  // The page's policy covers the page only, and the worker's covers /speech/ only: Cloudflare joins two values of one
  // header with a comma, which would make two policies, so the two paths never share a rule.
  const headers = `/*
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()${live ? "" : "\n  X-Robots-Tag: noindex"}
/
  Content-Security-Policy: ${csp}
/index.html
  Content-Security-Policy: ${csp}
/speech/*
  Content-Security-Policy: ${workerCsp}
`;
  rmSync(join(dir, "speech"), { recursive: true, force: true });
  mkdirSync(join(dir, "speech"), { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "_headers"), headers);
  writeFileSync(join(dir, "robots.txt"), live ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n");
  for (const file of SPEECH_WORKER) copyFileSync(join(root, file), join(dir, "speech", file.split("/").pop()));
  const manifest = speechDir ? copySpeechFiles(speechDir, join(dir, "speech")) : speechManifest();
  writeFileSync(join(dir, "speech", "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  return { html, headers, dir, manifest };
}

if (import.meta.main) {
  // A --host with no value, or any other flag, stops the build rather than quietly building for the live site.
  const args = process.argv.slice(2);
  let host = LIVE_HOST;
  let speech = true;
  const dirs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host" && args[i + 1] && !args[i + 1].startsWith("-")) host = args[++i];
    else if (args[i].startsWith("--host=")) host = args[i].slice("--host=".length);
    else if (args[i] === "--no-speech") speech = false;
    else if (args[i].startsWith("-") || dirs.length) { console.error(`Usage: node scripts/build.mjs [outDir=dist] [--host <host>] [--no-speech] (not: ${args.slice(i).join(" ")})`); process.exit(2); }
    else dirs.push(args[i]);
  }
  const speechDir = speech ? await fetchSpeechFiles(cacheDir(), { log: (line) => console.log(line) }) : null;
  const { dir, html, manifest } = build(resolve(root, dirs[0] || "dist"), { host, speechDir });
  console.log(`Wrote ${dir}/index.html (${html.length} bytes), _headers, robots.txt and speech/ (${manifest.files.length} files, ${(manifest.bytes / 1e6).toFixed(1)} MB) for ${host}`);
}
