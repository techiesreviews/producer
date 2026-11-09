#!/usr/bin/env node
// Builds dist/: one self-contained index.html (styles and script inlined), the _headers file whose policy pins
// the hash of that inline script and style and allows microphone and screen capture for this site only,
// and robots.txt. Nothing is fetched at build time and the page asks for no outside file.
// Usage: node scripts/build.mjs [outDir=dist] [--host <host> | --host=<host>]
// --host names the address the page is served from (default the live producer.techies.tools): any other
// address (the preview) asks search engines to stay away.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(join(root, file), "utf8");

/** Stylesheets inlined into the page's one style block, in this order. */
export const STYLES = ["src/theme.css", "src/app.css"];

/** Shared modules inlined into the page script, in this order, without `export`; then src/app.js. */
export const INLINED = ["src/browser.mjs", "src/ui/tooltip.mjs", "src/agent-message.mjs", "src/agent-link.mjs"];

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

export function build(dir = join(root, "dist"), { host = LIVE_HOST } = {}) {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) throw new Error(`not a host name: ${host}`);
  const page = read("src/page.html");
  const marks = { style: "<style>/*@CSS@*/</style>", script: "<script>/*@APP@*/</script>" };
  for (const mark of Object.values(marks)) if (!page.includes(mark)) throw new Error(`src/page.html is missing ${mark}`);
  const style = pageStyle();
  const script = pageScript();
  if (/<\/style/i.test(style)) throw new Error("page style must not contain </style");
  if (/<\/script/i.test(script)) throw new Error("page script must not contain </script");
  const html = page.replace(marks.style, () => `<style>${style}</style>`).replace(marks.script, () => `<script>${script}</script>`);
  const csp = [
    "default-src 'none'",
    `script-src ${sha256(script)}`,
    `style-src ${sha256(style)}`,
    "img-src data:",
    // Only this site: its relay (/api/relay, a WebSocket) and its token (/api/agent-token). Nothing outside.
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  const live = host === LIVE_HOST;
  const headers = `/*
  Content-Security-Policy: ${csp}
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()${live ? "" : "\n  X-Robots-Tag: noindex"}
`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  writeFileSync(join(dir, "_headers"), headers);
  writeFileSync(join(dir, "robots.txt"), live ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n");
  return { html, headers, dir };
}

if (import.meta.main) {
  // A --host with no value, or any other flag, stops the build rather than quietly building for the live site.
  const args = process.argv.slice(2);
  let host = LIVE_HOST;
  const dirs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--host" && args[i + 1] && !args[i + 1].startsWith("-")) host = args[++i];
    else if (args[i].startsWith("--host=")) host = args[i].slice("--host=".length);
    else if (args[i].startsWith("-") || dirs.length) { console.error(`Usage: node scripts/build.mjs [outDir=dist] [--host <host>] (not: ${args.slice(i).join(" ")})`); process.exit(2); }
    else dirs.push(args[i]);
  }
  const { dir, html } = build(resolve(root, dirs[0] || "dist"), { host });
  console.log(`Wrote ${dir}/index.html (${html.length} bytes), _headers, robots.txt for ${host}`);
}
