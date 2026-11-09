#!/usr/bin/env node
// This project's own kit commands, run through scripts/agents/project.d/: specs (browser checks) and size.
// Unit tests run through the shared `kit unit`. Evidence: .scratch/producer/<command>-<time>/. No installs, no deploys.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";
import { gzipSync } from "node:zlib";

const [command, ...args] = process.argv.slice(2);
const root = process.env.KIT_ROOT || resolve(import.meta.dirname, "../..");
const settings = JSON.parse(readFileSync(join(root, "scripts/agents/kit.json"), "utf8"));
const landBase = `origin/${settings.branches?.land || "main"}`;
const oneLine = (text) => String(text).replace(/\s+/g, " ").trim();
const kitResult = (status, text) => console.log(`RESULT: ${status} ${oneLine(text)}`);
const usage = {
  specs: `Usage: kit specs [suite] [--affected [--base REF]]\nRuns the browser suites in test/browser/ with screenshots (each file one suite; a name runs only the suites whose file name holds it: kit specs page).\n--affected (kit pr uses it) runs the suites the changes since --base (default ${landBase}, from branches.land in scripts/agents/kit.json; committed or not, new files too) can reach, as scripts/agents/specs-affected.mjs says: the page suite for anything under src/, the build, wrangler.jsonc and the suite itself; none for docs (.md) only.\nThe page suite serves the build through the real Worker (src/worker.mjs) on a local port, with the page's own headers as Cloudflare sends them.\nWhat each suite checks: the comments and assertion messages in its file. A failure names error.txt (the full error with the values) in the evidence folder.\nPlaywright: KIT_PLAYWRIGHT_MODULE (the path of its index.mjs), else the one in ~/Projects/native-site-editor-dev/node_modules.`,
  size: "Usage: kit size\nReports raw and gzip bytes of the built page, the Worker source and the speech worker, and the speech files (count, bytes, largest part). Report only; fails only if a served file is over Cloudflare's 25 MiB per static asset.",
};
if (args.includes("--help") || args.includes("-h")) { console.log(usage[command] || "Unknown command"); process.exit(0); }

// Playwright stays outside the repo (the repo guard forbids a home-folder path in a file): the environment names it,
// else the Native Site Editor's checkout in ~/Projects/native-site-editor-dev.
const playwrightModule = () => [process.env.KIT_PLAYWRIGHT_MODULE, join(homedir(), "Projects/native-site-editor-dev/node_modules/playwright/index.mjs")].find((p) => p && existsSync(p));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(root, ".scratch/producer", `${command}-${stamp}`);
mkdirSync(out, { recursive: true });
const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The build with the speech model, as a deploy builds it: the pinned files are fetched once into their cache
// outside the repo (scripts/speech-files.mjs), then copied in.
async function buildInto(dir) {
  const { build } = await import(pathToFileURL(join(root, "scripts/build.mjs")));
  const { cacheDir, fetchSpeechFiles } = await import(pathToFileURL(join(root, "scripts/speech-files.mjs")));
  return build(dir, { speechDir: await fetchSpeechFiles(cacheDir(), { log: (line) => console.log(line) }) });
}

const cleanups = [];
try {
  if (command === "specs") {
    // One suite per file in test/browser/; a name runs only the suites whose file name holds it.
    const at = args.indexOf("--base");
    const base = at < 0 ? landBase : args[at + 1];
    if (at >= 0 && (!base || base.startsWith("-") || !args.includes("--affected"))) throw Error(`--base needs a branch or commit after it, and --affected beside it (${usage.specs.split("\n")[0]})`);
    const pick = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "--base");
    let names = readdirSync(join(root, "test/browser")).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).filter((n) => !pick || n.includes(pick));
    if (args.includes("--affected")) {
      const { changedSince, suitesFor } = await import(pathToFileURL(join(root, "scripts/agents/specs-affected.mjs")));
      names = suitesFor(names, changedSince(base, root));
      console.log(`affected since ${base}: ${names.join(", ") || "no browser suite"}`);
      if (!names.length) { kitResult("ok", "specs no browser suite affected"); process.exit(0); }
    }
    if (!names.length) throw Error(`no browser suite matches ${pick}`);
    const modulePath = playwrightModule();
    if (!modulePath) throw Error("Playwright not found: set KIT_PLAYWRIGHT_MODULE to its index.mjs");
    const suites = await Promise.all(names.map(async (name) => [name, await import(pathToFileURL(join(root, "test/browser", `${name}.mjs`)))]));
    const dist = join(out, "dist");
    await buildInto(dist);
    const server = await startServer(dist);
    cleanups.push(server.stop);
    // Suites get the shared Chromium, and Playwright itself for a suite that also opens another browser.
    const playwright = await import(pathToFileURL(modulePath));
    const browser = await playwright.chromium.launch({ headless: true });
    cleanups.push(() => browser.close());
    const report = { suites: {} };
    for (const [name, suite] of suites) {
      report.suites[name] = await suite.run({ browser, playwright, base: server.base, dist, out });
      writeFileSync(join(out, "specs.json"), JSON.stringify(report, null, 2));
    }
    const all = Object.values(report.suites);
    console.log(`specs (${names.join(", ")}): ${all.flatMap((r) => r.checks).length} checks passed; ${all.flatMap((r) => r.screenshots).length} screenshots`);
    for (const shot of all.flatMap((r) => r.screenshots)) console.log(`  ${shot}`);
  } else if (command === "size") {
    const dist = join(out, "dist");
    await buildInto(dist);
    const files = [["dist/index.html", join(dist, "index.html")], ["dist/_headers", join(dist, "_headers")], ["src/worker.mjs", join(root, "src/worker.mjs")]];
    for (const f of readdirSync(join(dist, "speech")).filter((f) => f.endsWith(".mjs"))) files.push([`dist/speech/${f}`, join(dist, "speech", f)]);
    const report = files.map(([file, path]) => { const data = readFileSync(path); return { file, bytes: data.length, gzipBytes: gzipSync(data).length }; });
    // The speech files: downloaded once by the browser; each served part must stay under Cloudflare's 25 MiB per asset.
    const parts = readdirSync(join(dist, "speech"), { recursive: true }).map((f) => join(dist, "speech", f)).filter((p) => statSync(p).isFile());
    const largest = parts.reduce((a, p) => (statSync(p).size > a.bytes ? { file: p.slice(dist.length + 1), bytes: statSync(p).size } : a), { file: "", bytes: 0 });
    const speech = { files: parts.length, bytes: parts.reduce((n, p) => n + statSync(p).size, 0), largestPart: largest, assetLimit: 25 * 1024 * 1024 };
    if (largest.bytes > speech.assetLimit) throw Error(`${largest.file} is ${largest.bytes} bytes, over the 25 MiB a Worker static asset may be`);
    const summary = { files: report, speech, note: "Report only. Free plan Worker limit is 3 MB compressed; the page is one self-contained file; the speech files are static assets of at most 25 MiB each." };
    writeFileSync(join(out, "size.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } else {
    throw Error(`unknown adapter command ${command}`);
  }
  kitResult("ok", `${command} evidence ${out}`);
} catch (error) {
  // An assertion with its own message leaves the values out of the message: keep them, and
  // the whole error, in the evidence folder so a failure can be read without a rerun.
  const values = "actual" in Object(error) ? `actual:   ${inspect(error.actual, { depth: 6 })}\nexpected: ${inspect(error.expected, { depth: 6 })}\n` : "";
  writeFileSync(join(out, "error.txt"), `${error.details || ""}${values}${error.stack || error.message}\n`);
  console.error(error.stack || error.message);
  if (values) console.log(values.trimEnd());
  kitResult("fail", `${command} ${String(error.message).split("\n")[0]}; details ${join(out, "error.txt")}`);
  process.exitCode = 1;
} finally {
  for (const stop of cleanups.reverse()) { try { await stop(); } catch { /* best effort */ } }
}

// The built page behind the real Worker: src/worker.mjs answers, its ASSETS binding reads dist/ and adds the headers
// of every _headers rule that matches the path, as Cloudflare does ("/*" and "/speech/*" end in a wildcard; any other
// rule is one exact path). Local port, nothing leaves the machine.
async function startServer(dist) {
  // The Worker's relay extends a class from "cloudflare:workers", which Node cannot load: a stand-in (as in test/runtime.mjs).
  // There is no relay object here: the page checks replace the page's relay socket, and the one check that keeps the
  // real socket only needs the browser to try it (its upgrade fails with 502).
  register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, next) {
    if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
    return next(specifier, context);
  }`)}`);
  const { default: worker } = await import(pathToFileURL(join(root, "src/worker.mjs")));
  const rules = readFileSync(join(dist, "_headers"), "utf8").split(/^(?=\/)/m).filter(Boolean).map((block) => {
    const [path, ...lines] = block.split("\n");
    return { path: path.trim(), headers: lines.map((l) => l.match(/^ {2}([\w-]+): (.*)$/)).filter(Boolean).map(([, name, value]) => [name, value]) };
  });
  const matches = (rule, pathname) => (rule.path.endsWith("*") ? pathname.startsWith(rule.path.slice(0, -1)) : pathname === rule.path);
  const TYPES = { html: "text/html; charset=utf-8", txt: "text/plain; charset=utf-8", mjs: "text/javascript; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json", wasm: "application/wasm" };
  const assets = {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const file = pathname === "/" ? "index.html" : pathname.slice(1);
      const path = join(dist, file);
      if (file.split("/").includes("..") || file === "_headers" || !existsSync(path) || !statSync(path).isFile()) return new Response("Not found", { status: 404 });
      const headers = rules.filter((r) => matches(r, pathname)).flatMap((r) => r.headers);
      const type = TYPES[file.split(".").pop()] || "application/octet-stream";
      return new Response(request.method === "HEAD" ? null : readFileSync(path), { headers: [...headers, ["Content-Type", type]] });
    },
  };
  const server = createServer(async (req, res) => {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : req;
    let response;
    try {
      response = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body, duplex: "half" }), { ASSETS: assets });
    } catch (error) {
      if (!req.url.startsWith("/api/relay")) throw error;
      response = new Response("No relay in the page checks", { status: 502 });
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((ok) => { server.close(ok); server.closeAllConnections(); }) };
}
