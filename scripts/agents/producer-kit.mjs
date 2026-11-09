#!/usr/bin/env node
// This project's own kit commands, run through scripts/agents/project.d/: specs (browser checks) and size.
// Unit tests run through the shared `kit unit`. Evidence: .scratch/producer/<command>-<time>/. No installs, no deploys.
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
  specs: `Usage: kit specs [suite] [--affected [--base REF]]\nRuns the browser suites in test/browser/ with screenshots (each file one suite; a name runs only the suites whose file name holds it: kit specs page).\n--affected (kit pr uses it) runs the suites the changes since --base (default ${landBase}, from branches.land in scripts/agents/kit.json; committed or not, new files too) can reach, as scripts/agents/specs-affected.mjs says: the page suite for anything under src/, the build, wrangler.jsonc and the suite itself; none for docs (.md) only.\nThe page suite serves the build through the real Worker (src/worker.mjs) on a local port, with the page's own headers as Cloudflare sends them.\nWhat each suite checks: the comments and assertion messages in its file. A failure names error.txt (the full error with the values) in the evidence folder.\nPlaywright: KIT_PLAYWRIGHT_MODULE, else the one in a sibling checkout's node_modules (see playwrightModule in this file).`,
  size: "Usage: kit size\nReports raw and gzip bytes of the built page and the Worker source. Report only; no budget.",
};
if (args.includes("--help") || args.includes("-h")) { console.log(usage[command] || "Unknown command"); process.exit(0); }

// Playwright stays outside the repo (the repo guard forbids a home-folder path in a file): the environment names it,
// else the Native Site Editor's checkout next to this one.
const playwrightModule = () => [process.env.KIT_PLAYWRIGHT_MODULE, join(homedir(), "Projects/native-site-editor-dev/node_modules/playwright/index.mjs")].find((p) => p && existsSync(p));

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(root, ".scratch/producer", `${command}-${stamp}`);
mkdirSync(out, { recursive: true });
const run = (cmd, argv) => execFileSync(cmd, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

async function buildInto(dir) {
  const { build } = await import(pathToFileURL(join(root, "scripts/build.mjs")));
  return build(dir);
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
    const { chromium } = await import(pathToFileURL(modulePath));
    const browser = await chromium.launch({ headless: true });
    cleanups.push(() => browser.close());
    const report = { suites: {} };
    for (const [name, suite] of suites) {
      report.suites[name] = await suite.run({ browser, base: server.base, dist, out });
      writeFileSync(join(out, "specs.json"), JSON.stringify(report, null, 2));
    }
    const all = Object.values(report.suites);
    console.log(`specs (${names.join(", ")}): ${all.flatMap((r) => r.checks).length} checks passed; ${all.flatMap((r) => r.screenshots).length} screenshots`);
    for (const shot of all.flatMap((r) => r.screenshots)) console.log(`  ${shot}`);
  } else if (command === "size") {
    const dist = join(out, "dist");
    await buildInto(dist);
    const files = [["dist/index.html", join(dist, "index.html")], ["dist/_headers", join(dist, "_headers")], ["src/worker.mjs", join(root, "src/worker.mjs")]];
    const report = files.map(([file, path]) => { const data = readFileSync(path); return { file, bytes: data.length, gzipBytes: gzipSync(data).length }; });
    const summary = { files: report, note: "Report only. Free plan Worker limit is 3 MB compressed; the page is one self-contained file." };
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

// The built page behind the real Worker: src/worker.mjs answers, its ASSETS binding reads dist/ and adds the
// "/*" block of _headers, as Cloudflare does. Local port, nothing leaves the machine.
async function startServer(dist) {
  const { default: worker } = await import(pathToFileURL(join(root, "src/worker.mjs")));
  const block = readFileSync(join(dist, "_headers"), "utf8").split(/^\/\S*\n/m)[1];
  const headers = [...block.matchAll(/^ {2}([\w-]+): (.*)$/gm)].map(([, name, value]) => [name, value]);
  const assets = {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const file = { "/": "index.html", "/index.html": "index.html", "/robots.txt": "robots.txt" }[pathname];
      if (!file) return new Response("Not found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : readFileSync(join(dist, file)), { headers: [...headers, ["Content-Type", file.endsWith(".html") ? "text/html; charset=utf-8" : "text/plain; charset=utf-8"]] });
    },
  };
  const server = createServer(async (req, res) => {
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : req;
    const response = await worker.fetch(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, body, duplex: "half" }), { ASSETS: assets });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((ok) => { server.close(ok); server.closeAllConnections(); }) };
}
