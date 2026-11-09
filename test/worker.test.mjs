import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import worker from "../src/worker.mjs";

// The code without its comments.
const source = readFileSync(resolve(import.meta.dirname, "../src/worker.mjs"), "utf8").replace(/^\s*\/\/.*$/gm, "");
const env = () => {
  const seen = [];
  return { seen, ASSETS: { fetch: async (request) => { seen.push(request); return new Response("page", { status: 200 }); } } };
};

test("a GET or HEAD goes to the static page and comes back as it is", async () => {
  for (const method of ["GET", "HEAD"]) {
    const e = env();
    const request = new Request("https://producer.techies.tools/", { method });
    const response = await worker.fetch(request, e);
    assert.equal(response.status, 200);
    assert.deepEqual(e.seen, [request]);
  }
});

test("anything else is refused with 405 and never reaches the page or its body", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const e = env();
    const body = ["POST", "PUT", "PATCH"].includes(method) ? "private talk" : undefined;
    const request = new Request("https://producer.techies.tools/", { method, body });
    const response = await worker.fetch(request, e);
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("Allow"), "GET, HEAD");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(e.seen.length, 0, `${method} did not reach the page`);
    assert.equal(request.bodyUsed, false, `${method}: the body was never read`);
  }
});

test("the Worker source logs nothing, stores nothing and reads no request body", () => {
  assert.doesNotMatch(source, /\bconsole\b|\bcaches\b|(?<!async )(?<![.\w])fetch\(|\.(text|json|formData|arrayBuffer|blob)\(|\.body\b|\.headers\.get\(/);
  assert.doesNotMatch(source, /env\.(?!ASSETS\b)/, "the only binding it touches is ASSETS");
  assert.doesNotMatch(source, /\bimport\b/, "no import: it needs nothing else");
});
