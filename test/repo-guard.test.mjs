// The repo is public: no secret files, no obvious tokens, and the README and licence stay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const files = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => existsSync(join(root, f)));

const SECRET_NAME = /^(\.env(\..*)?|.*\.key|.*\.pem|\.dev\.vars(\..*)?)$/;
const TOKEN_PATTERNS = [
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ["Anthropic or OpenAI style key", /\bsk-(ant-)?[A-Za-z0-9_-]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/=-]{30,}/],
  // A quoted value after a secret-like name (also after an underscore, in quotes, or camelCase).
  ["secret assignment", /(?<![A-Za-z])(secret|token|password|api[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{20,}["']|[a-z](Secret|Token|Password|ApiKey)["']?\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{20,}["']/i],
  // An unquoted value, as in a dotenv line, only for an ALL_CAPS name, so ordinary code is not caught.
  ["secret assignment, unquoted", /^\s*(export\s+)?[A-Z][A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_?KEY)\s*=\s*[A-Za-z0-9._~+/=-]{20,}\s*$/m],
];

test("README and LICENSE exist and are not empty", () => {
  for (const name of ["README.md", "LICENSE"]) {
    assert.ok(existsSync(join(root, name)), `${name} is missing`);
    assert.ok(readFileSync(join(root, name), "utf8").trim().length > 0, `${name} is empty`);
  }
  assert.match(readFileSync(join(root, "LICENSE"), "utf8"), /^MIT License/);
});

test("no file is named .env, .env.*, *.key, *.pem or .dev.vars", () => {
  const bad = files.filter((f) => SECRET_NAME.test(basename(f)));
  assert.deepEqual(bad, []);
});

test("no file holds an obvious token or private key", () => {
  const found = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(join(root, f), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    for (const [label, re] of TOKEN_PATTERNS) {
      if (re.test(text)) found.push(`${f}: ${label}`);
    }
  }
  assert.deepEqual(found, []);
});

// One sample that must match and one near miss that must not, for every pattern, so a broken edit
// of a pattern fails here instead of passing quietly. The samples are built in pieces so this file
// does not hold a token-shaped string itself.
const SAMPLES = {
  "private key block": ["-----BEGIN " + "RSA PRIVATE KEY-----", "-----BEGIN PUBLIC KEY-----"],
  "GitHub token": ["ghp_" + "a".repeat(36), "ghp_" + "a".repeat(10)],
  "GitHub fine-grained token": ["github_pat_" + "A1b2".repeat(10), "github_pat_short"],
  "Anthropic or OpenAI style key": ["sk-ant-" + "a1B2".repeat(10), "sk-learn is a library"],
  "AWS access key": ["AKIA" + "ABCDEFGH12345678", "AKIA" + "SHORT"],
  "Slack token": ["xox" + "b-1234567890-abcdefghij", "xoxo hugs"],
  "Google API key": ["AIza" + "Sy" + "a".repeat(33), "AIza" + "short"],
  "bearer token": ["Authorization: Bearer " + "a1B2c3D4".repeat(4), "Authorization: Bearer <token>"],
  "secret assignment": ['api_key = "' + "x".repeat(24) + '"', 'token = "short"'],
  "secret assignment, name after an underscore": ["RESTREAM_CLIENT_" + 'SECRET = "' + "x".repeat(24) + '"', "RESTREAM_CLIENT_SECRET = process.env"],
  "secret assignment, camelCase": ["const clientSec" + 'ret = "' + "x".repeat(24) + '"', 'const clientSecret = config.restreamClientSecret'],
  "secret assignment, unquoted": ["RESTREAM_CLIENT_" + "SECRET=" + "x".repeat(24), 'const token = localStorage.getItem("restream_token")'],
  "secret assignment, quoted name": ['"client_' + 'secret": "' + "x".repeat(24) + '"', '"client_secret": "short"'],
};

test("the guard itself catches each token shape and lets a near miss through", () => {
  const secretRe = TOKEN_PATTERNS.find(([label]) => label === "secret assignment")[1];
  const labels = TOKEN_PATTERNS.map(([label]) => label);
  assert.deepEqual(Object.keys(SAMPLES).filter((l) => labels.includes(l)), labels);
  for (const [label, [hit, miss]] of Object.entries(SAMPLES)) {
    const re = labels.includes(label) ? TOKEN_PATTERNS.find(([l]) => l === label)[1] : secretRe;
    assert.match(hit, re, `${label}: should match`);
    assert.doesNotMatch(miss, re, `${label}: near miss should not match`);
  }
});

test("the guard itself catches a secret file name and not a normal one", () => {
  for (const name of [".env", ".env.local", "a.key", "cert.pem", ".dev.vars", ".dev.vars.production"]) assert.ok(SECRET_NAME.test(name), name);
  for (const name of ["README.md", "environment.md", "keyboard.mjs"]) assert.ok(!SECRET_NAME.test(name), name);
});
