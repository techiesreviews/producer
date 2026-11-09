import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import vm from "node:vm";
import { join, resolve } from "node:path";
import { build, LIVE_HOST, PREVIEW_HOST, SPEECH_WORKER } from "../scripts/build.mjs";
import { SPEECH_BYTES } from "../scripts/speech-files.mjs";

const scratch = (name) => resolve(import.meta.dirname, "../.scratch", name);
const dist = build(scratch("test-dist")).dir;
const html = readFileSync(join(dist, "index.html"), "utf8");
const headers = readFileSync(join(dist, "_headers"), "utf8");
const between = (open, close) => html.slice(html.indexOf(open) + open.length, html.indexOf(close));
const script = between("<script>", "</script>");
const style = between("<style>", "</style>");
const hash = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
const directives = (text) => new Map(text.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([name, ...values]) => [name, values]));
// The _headers file as rules: path -> { header: value }. A header set twice for one path would be two values.
const rules = new Map(headers.split(/^(?=\/)/m).filter(Boolean).map((block) => {
  const [path, ...lines] = block.split("\n");
  const pairs = lines.map((l) => l.match(/^ {2}([\w-]+): (.*)$/)).filter(Boolean).map(([, name, value]) => [name, value]);
  return [path.trim(), Object.fromEntries(pairs)];
}));
const header = (name) => [...rules.values()].find((r) => r[name])?.[name];

test("the build is the page, its headers, robots.txt and the speech folder", () => {
  assert.deepEqual(readdirSync(dist).sort(), ["_headers", "index.html", "robots.txt", "speech"]);
  assert.deepEqual(readdirSync(join(dist, "speech")).sort(), ["manifest.json", ...SPEECH_WORKER.map((f) => f.split("/").pop())].sort());
});

test("the speech worker is served as written, with a manifest; without the model files it lists no parts", () => {
  for (const file of SPEECH_WORKER) assert.equal(readFileSync(join(dist, "speech", file.split("/").pop()), "utf8"), readFileSync(resolve(import.meta.dirname, "..", file), "utf8"), file);
  const manifest = JSON.parse(readFileSync(join(dist, "speech/manifest.json"), "utf8"));
  assert.equal(manifest.bytes, SPEECH_BYTES);
  assert.ok(manifest.files.length > 0 && manifest.files.every((f) => f.parts.length === 0));
  assert.match(html, new RegExp(`Load speech model · ${Math.round(SPEECH_BYTES / 1e6)} MB<`), "the speech button names the download size");
});

test("the page is one self-contained file and asks for no outside file", () => {
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/i);
  assert.doesNotMatch(html, /@import|url\((?!["']?data:)/);
  // The only address in the page is the SVG namespace inside the icon's data address.
  assert.deepEqual([...html.matchAll(/https?:\/\/[^'"\s)]+/g)].map((m) => m[0]), ["http://www.w3.org/2000/svg"]);
  assert.doesNotMatch(html, /<(img|iframe|object|embed|video|audio|source)\b/i);
  assert.ok(!html.includes("/*@") && !html.includes("<!--@"), "every build marker is replaced");
});

test("the inlined script is one valid program that holds the browser's speech service, and names no outside host for it", () => {
  assert.doesNotThrow(() => new vm.Script(script), "no name is declared twice across the inlined files");
  assert.match(script, /function createBrowserSpeech\b/, "the browser's speech service is in the page");
  // The service is the browser's own: the page names no address for it and its policy gains none (connect-src stays this site).
  assert.doesNotMatch(script, /google\.com|googleapis|gstatic/i);
  assert.deepEqual(directives(header("Content-Security-Policy")).get("connect-src"), ["'self'"]);
});

test("the page keeps nothing, logs nothing and talks only to its own agent relay", () => {
  const banned = /\b(XMLHttpRequest|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|caches|serviceWorker|importScripts|cookie|console)\b|\bimport\s*\(/;
  assert.doesNotMatch(script, banned);
  assert.doesNotMatch(script, /^\s*(import|export)\s/m, "the inlined script is plain code");
  // Two calls, both to this site: the agent token and the relay's WebSocket (card 08). Nothing else is sent anywhere.
  assert.deepEqual([...script.matchAll(/\bfetch\b[^)]*\)/g)].map((m) => m[0]), ['fetch("/api/agent-token", { method: "POST", cache: "no-store" })'], "one fetch: the token");
  assert.deepEqual([...script.matchAll(/\bWebSocket\b[^,]*/g)].map((m) => m[0]), ['WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/relay`'], "one WebSocket: the relay on this host");
});

test("the policy pins the page's own script and style by hash and allows nothing from outside", () => {
  assert.equal(rules.get("/")["Content-Security-Policy"], rules.get("/index.html")["Content-Security-Policy"], "the page's policy, at both of its addresses");
  const csp = directives(rules.get("/")["Content-Security-Policy"]);
  assert.deepEqual(csp.get("default-src"), ["'none'"]);
  assert.deepEqual(csp.get("script-src"), [hash(script)]);
  assert.deepEqual(csp.get("style-src"), [hash(style)]);
  assert.deepEqual(csp.get("connect-src"), ["'self'"], "the page may call only its own site (the relay and the token), nothing outside");
  assert.deepEqual(csp.get("img-src"), ["data:"]);
  assert.deepEqual(csp.get("worker-src"), ["'self'"], "the speech worker, from this site only");
  for (const name of ["base-uri", "form-action", "frame-ancestors"]) assert.deepEqual(csp.get(name), ["'none'"], name);
  assert.doesNotMatch(rules.get("/")["Content-Security-Policy"], /\*|unsafe-|https?:/);
});

test("the speech worker's policy: scripts and files of this site and the engine's WebAssembly, nothing else", () => {
  const csp = directives(rules.get("/speech/*")["Content-Security-Policy"]);
  assert.deepEqual(csp.get("default-src"), ["'none'"]);
  assert.deepEqual(csp.get("script-src"), ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(csp.get("connect-src"), ["'self'"]);
  for (const name of ["base-uri", "form-action", "frame-ancestors"]) assert.deepEqual(csp.get(name), ["'none'"], name);
  assert.deepEqual([...csp.keys()].sort(), ["base-uri", "connect-src", "default-src", "form-action", "frame-ancestors", "script-src"]);
  assert.doesNotMatch(rules.get("/speech/*")["Content-Security-Policy"], /\*|unsafe-(?!eval')|https?:|blob:|data:/);
});

test("no path gets two policies: the page's rules and the worker's never overlap, and the wide rule sets none", () => {
  assert.deepEqual([...rules.keys()], ["/*", "/", "/index.html", "/speech/*"]);
  assert.equal(rules.get("/*")["Content-Security-Policy"], undefined);
  for (const [path, r] of rules) if (path !== "/*") assert.deepEqual(Object.keys(r), ["Content-Security-Policy"], path);
});

test("microphone and screen capture are allowed for this site only; the rest stays off", () => {
  const policy = new Map(header("Permissions-Policy").split(",").map((p) => {
    const [name, value] = p.trim().split("=");
    return [name, value.replace(/[()]/g, "").split(/\s+/).filter(Boolean)];
  }));
  assert.deepEqual(policy.get("microphone"), ["self"]);
  assert.deepEqual(policy.get("display-capture"), ["self"]);
  for (const off of ["camera", "geolocation", "payment", "usb"]) assert.deepEqual(policy.get(off), [], `${off} is off`);
  assert.doesNotMatch(header("Permissions-Policy"), /\*|https?:/);
  assert.equal(header("X-Content-Type-Options"), "nosniff");
  assert.equal(header("Referrer-Policy"), "no-referrer");
});

test("the live build lets search engines in; a preview build keeps them out", () => {
  assert.equal(LIVE_HOST, "producer.techies.tools");
  assert.equal(PREVIEW_HOST, "preview-producer.techies.tools");
  assert.equal(readFileSync(join(dist, "robots.txt"), "utf8"), "User-agent: *\nAllow: /\n");
  assert.equal(header("X-Robots-Tag"), undefined);
  const preview = build(scratch("test-dist-preview"), { host: PREVIEW_HOST });
  assert.equal(readFileSync(join(preview.dir, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n");
  assert.match(preview.headers, /^ {2}X-Robots-Tag: noindex$/m);
  assert.equal(preview.html, html, "the page itself is the same");
  assert.equal(preview.headers.replace(/^ {2}X-Robots-Tag: noindex\n/m, ""), headers, "and so is every other header");
  for (const host of ["", "evil.example; script-src *", "x\n  Y: z", "localhost"]) assert.throws(() => build(scratch("test-dist-bad"), { host }), /not a host name/);
});

test("the command line: --host and --host=, and a bad flag stops it instead of building for the live site", () => {
  const file = resolve(import.meta.dirname, "../scripts/build.mjs");
  const out = scratch("test-dist-cli");
  const run = (...args) => spawnSync(process.execPath, [file, ...args], { encoding: "utf8" });
  for (const args of [[out, "--host", PREVIEW_HOST, "--no-speech"], ["--no-speech", `--host=${PREVIEW_HOST}`, out]]) {
    rmSync(out, { recursive: true, force: true });
    assert.equal(run(...args).status, 0, args.join(" "));
    assert.equal(readFileSync(join(out, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n", args.join(" "));
  }
  for (const args of [[out, "--host"], [out, "--hsot", PREVIEW_HOST], [out, "extra-folder"], [out, "--no-speeches"]]) {
    rmSync(out, { recursive: true, force: true });
    assert.equal(run(...args).status, 2, args.join(" "));
    assert.throws(() => readdirSync(out), "nothing is written");
  }
});
