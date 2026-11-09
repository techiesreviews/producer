import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { build, LIVE_HOST, PREVIEW_HOST } from "../scripts/build.mjs";

const scratch = (name) => resolve(import.meta.dirname, "../.scratch", name);
const dist = build(scratch("test-dist")).dir;
const html = readFileSync(join(dist, "index.html"), "utf8");
const headers = readFileSync(join(dist, "_headers"), "utf8");
const between = (open, close) => html.slice(html.indexOf(open) + open.length, html.indexOf(close));
const script = between("<script>", "</script>");
const style = between("<style>", "</style>");
const hash = (text) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
const directives = (text) => new Map(text.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([name, ...values]) => [name, values]));
const header = (name) => headers.match(new RegExp(`^  ${name}: (.*)$`, "m"))?.[1];

test("the build is three files: the page, its headers and robots.txt", () => {
  assert.deepEqual(readdirSync(dist).sort(), ["_headers", "index.html", "robots.txt"]);
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

test("the page keeps nothing, sends nothing and logs nothing", () => {
  const banned = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|caches|serviceWorker|importScripts|cookie|console)\b|\bimport\s*\(/;
  assert.doesNotMatch(script, banned);
  assert.doesNotMatch(script, /^\s*(import|export)\s/m, "the inlined script is plain code");
});

test("the policy pins the page's own script and style by hash and allows nothing from outside", () => {
  const csp = directives(header("Content-Security-Policy"));
  assert.deepEqual(csp.get("default-src"), ["'none'"]);
  assert.deepEqual(csp.get("script-src"), [hash(script)]);
  assert.deepEqual(csp.get("style-src"), [hash(style)]);
  assert.deepEqual(csp.get("connect-src"), ["'self'"], "the page may call only its own site (the relay and the token), nothing outside");
  assert.deepEqual(csp.get("img-src"), ["data:"]);
  for (const name of ["base-uri", "form-action", "frame-ancestors"]) assert.deepEqual(csp.get(name), ["'none'"], name);
  assert.doesNotMatch(header("Content-Security-Policy"), /\*|unsafe-|https?:/);
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
  for (const args of [[out, "--host", PREVIEW_HOST], [`--host=${PREVIEW_HOST}`, out]]) {
    rmSync(out, { recursive: true, force: true });
    assert.equal(run(...args).status, 0, args.join(" "));
    assert.equal(readFileSync(join(out, "robots.txt"), "utf8"), "User-agent: *\nDisallow: /\n", args.join(" "));
  }
  for (const args of [[out, "--host"], [out, "--hsot", PREVIEW_HOST], [out, "extra-folder"]]) {
    rmSync(out, { recursive: true, force: true });
    assert.equal(run(...args).status, 2, args.join(" "));
    assert.throws(() => readdirSync(out), "nothing is written");
  }
});
