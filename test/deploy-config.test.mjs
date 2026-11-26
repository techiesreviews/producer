import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const text = (file) => readFileSync(resolve(root, file), "utf8");
const config = JSON.parse(text("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, ""));
const preview = config.env?.preview;
const STORAGE = ["kv_namespaces", "d1_databases", "r2_buckets", "queues", "services", "ai", "vectorize", "hyperdrive", "analytics_engine_datasets", "tail_consumers", "vars", "unsafe", "browser", "send_email", "mtls_certificates", "pipelines", "version_metadata"];

test("two Workers: producer (live) and producer-preview, each with its planned address", () => {
  assert.equal(config.name, "producer");
  assert.deepEqual(config.routes, [{ pattern: "producer.techies.tools", custom_domain: true }]);
  assert.equal(preview.name, "producer-preview");
  assert.deepEqual(preview.routes, [{ pattern: "preview-producer.techies.tools", custom_domain: true }]);
  assert.deepEqual(Object.keys(config.env), ["preview"]);
});

test("the preview builds for its own address; the live one builds with the defaults", () => {
  assert.equal(config.build.command, "node scripts/build.mjs");
  assert.equal(preview.build.command, "node scripts/build.mjs --host preview-producer.techies.tools");
});

test("no request log in either Worker", () => {
  assert.deepEqual(config.observability, { enabled: false });
  assert.deepEqual(preview.observability, { enabled: false });
  assert.doesNotMatch(text("wrangler.jsonc"), /"(logpush|tail_consumers|head_sampling_rate)"/);
});

test("no KV, D1, R2 or any other place to keep text, in either Worker", () => {
  for (const [where, c] of [["live", config], ["preview", preview]]) {
    for (const key of STORAGE) assert.equal(c[key], undefined, `${where} sets ${key}`);
  }
});

test("two Durable Object classes only (the request limit and the relay), SQLite-backed so the free plan allows them", () => {
  const bindings = [{ name: "MCP_LIMITER", class_name: "McpLimiter" }, { name: "RELAY", class_name: "Relay" }];
  for (const [where, c] of [["live", config], ["preview", preview]]) {
    assert.deepEqual(c.durable_objects, { bindings }, `${where}: the preview names them again, they are not inherited`);
  }
  const migrations = [{ tag: "v1", new_sqlite_classes: ["McpLimiter"] }, { tag: "v2", new_sqlite_classes: ["Relay"] }];
  assert.deepEqual(config.migrations, migrations);
  assert.deepEqual(preview.migrations, migrations, "written again for the preview, so its own objects exist whatever Wrangler inherits");
});

test("no address of its own on workers.dev and no preview links", () => {
  for (const c of [config, preview]) {
    assert.equal(c.workers_dev, false);
    assert.equal(c.preview_urls, false);
  }
});

test("one static page from ./dist, served first; the Worker only answers what the page cannot", () => {
  assert.equal(config.main, "src/worker.mjs");
  for (const c of [config, preview]) {
    assert.deepEqual(c.assets, { directory: "./dist", binding: "ASSETS", not_found_handling: "none", html_handling: "auto-trailing-slash" });
  }
});

test("the preview deploy: only on dev (or by hand), only the preview Worker, only when both secrets exist", () => {
  const flow = text(".github/workflows/deploy-preview.yml");
  assert.match(flow, /^on:\n  push:\n    branches: \[dev\]\n  workflow_dispatch:\n/m, "dev pushes and a manual run, nothing else");
  assert.doesNotMatch(flow, /pull_request|pull_request_target|\bmain\b/);
  assert.match(flow, /^permissions:\n  contents: read$/m);
  assert.match(flow, /TOOLS-144/, "says it waits for the Cloudflare token");
  assert.match(flow, /ref: dev/, "built from dev");
  const deploys = flow.split("\n").filter((l) => /\bwrangler\b.*\bdeploy\b/.test(l));
  assert.equal(deploys.length, 1);
  assert.match(deploys[0], /wrangler@\d+\.\d+\.\d+ deploy --env preview$/, "a pinned Wrangler, the preview Worker only");
  // Both secrets are read only inside the guard step; the deploy step runs only when it said yes.
  const guard = flow.match(/- id: guard[\s\S]*?(?=\n {6}- )/)[0];
  assert.match(guard, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(guard, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(flow, /- if: steps\.guard\.outputs\.ready == 'true'\n {8}name: Deploy the preview Worker/);
  assert.equal(flow.match(/secrets\./g).length, 4, "two secrets in the guard, the same two for the deploy step");
  assert.doesNotMatch(flow, /echo[^\n]*\$\{\{\s*secrets/, "no secret is ever printed");
});

test("the checks workflow stays: unit tests on every pull request and push", () => {
  const flow = text(".github/workflows/checks.yml");
  assert.match(flow, /pull_request:/);
  assert.match(flow, /node --test test\/\*\.test\.mjs/);
});

test("a deploy by hand uses the same Wrangler version as the workflow", () => {
  const pinned = text(".github/workflows/deploy-preview.yml").match(/wrangler@(\d+\.\d+\.\d+) deploy --env preview$/m)[1];
  const { scripts } = JSON.parse(text("package.json"));
  assert.equal(scripts["deploy:preview"], `npx --yes wrangler@${pinned} deploy --env preview`);
});
