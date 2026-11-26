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
  // The producer's own agent token (src/token.mjs), anywhere: a real one pasted into a doc, a log or a test.
  ["producer agent token", /(?<![A-Za-z0-9_-])pr1-[0-9a-z]{8,10}-[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/],
  // A quoted value after a secret-like name (also after an underscore, in quotes, or camelCase).
  ["secret assignment", /(?<![A-Za-z])(secret|token|password|api[_-]?key)["']?\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{20,}["']|[a-z](Secret|Token|Password|ApiKey)["']?\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{20,}["']/i],
  // An unquoted value, as in a dotenv line, only for an ALL_CAPS name, so ordinary code is not caught.
  ["secret assignment, unquoted", /^\s*(export\s+)?[A-Z][A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_?KEY)\s*=\s*[A-Za-z0-9._~+/=-]{20,}\s*$/m],
  // Shapes with no fixed prefix are only caught in an assignment to a name that says what they are.
  ["Cloudflare API token", /(?<![A-Za-z])(cloudflare|cf)[_-]?(api[_-]?)?(token|key)["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])|[a-z]Cf(Api)?(Token|Key)["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/i],
  // An account id is not secret, but it is kept out of the repo on purpose: a Worker config reads it from CLOUDFLARE_ACCOUNT_ID.
  ["Cloudflare account id", /(?<![A-Za-z])account[_-]?id["']?\s*[:=]\s*["']?[0-9a-f]{32}(?![0-9a-zA-Z])|[a-z]AccountId["']?\s*[:=]\s*["']?[0-9a-f]{32}(?![0-9a-zA-Z])/i],
  ["Restream client secret", /(?<![A-Za-z])restream[_-]?(client[_-]?)?secret["']?\s*[:=]\s*["']?(?=[A-Za-z0-9_~+/=-]*[0-9])[A-Za-z0-9_~+/=-]{16,}(?![A-Za-z0-9_~+/=-])/i],
  // A long base64 or hex value, with a letter and a digit in it, after a name that ends in key, secret, token or password.
  ["long value after a key name", /(?<![A-Za-z])[A-Za-z0-9_-]*(secret|token|password|passwd|pass|key)["']?\s*[:=]\s*["']?(?=[A-Za-z0-9+/]*[0-9])(?=[A-Za-z0-9+/]*[A-Za-z])[A-Za-z0-9+/]{32,}={0,2}(?![A-Za-z0-9+/=])/i],
  // A path inside a person's home folder shows a local user name; write ~/Projects/... in docs instead.
  ["home folder path", /(?<![A-Za-z0-9_.-])\/(home|Users)\/[A-Za-z0-9_.-]+\//],
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
  "producer agent token": ["the agent printed pr1" + "-m0abcdef-" + "Ab3_".repeat(10) + "xyz", "pr1" + "-<time>-<random>"],
  "secret assignment": ['api_key = "' + "x".repeat(24) + '"', 'token = "short"'],
  "secret assignment | name after an underscore": ["RESTREAM_CLIENT_" + 'SECRET = "' + "x".repeat(24) + '"', "RESTREAM_CLIENT_SECRET = process.env"],
  "secret assignment | camelCase": ["const clientSec" + 'ret = "' + "x".repeat(24) + '"', 'const clientSecret = config.restreamClientSecret'],
  "secret assignment, unquoted": ["RESTREAM_CLIENT_" + "SECRET=" + "x".repeat(24), 'const token = localStorage.getItem("restream_token")'],
  "secret assignment | quoted name": ['"client_' + 'secret": "' + "x".repeat(24) + '"', '"client_secret": "short"'],
  // GitHub OAuth tokens and OpenAI project keys are other shapes of the patterns above.
  "GitHub token | OAuth": ["gho_" + "b".repeat(36), "gho_" + "b".repeat(8)],
  "Anthropic or OpenAI style key | project key": ["sk-proj-" + "a1_B2-".repeat(8), "sk-proj-short"],
  "Cloudflare API token": ["CLOUDFLARE_API_" + "TOKEN=" + "aB3_".repeat(10), "CLOUDFLARE_API_TOKEN=" + "$" + "{CLOUDFLARE_API_TOKEN}"],
  "Cloudflare API token | quoted camelCase": ['cfApi' + 'Token: "' + "Zy9-".repeat(10) + '"', 'cfApiToken: "' + "Zy9-".repeat(5) + '"'],
  "Cloudflare account id": ["CLOUDFLARE_ACCOUNT_" + "ID=" + "0123456789abcdef".repeat(2), "CLOUDFLARE_ACCOUNT_ID=your-account-id"],
  "Cloudflare account id | wrangler json": ['"account' + '_id": "' + "fedcba9876543210".repeat(2) + '"', '"account_id": "<account id>"'],
  "Restream client secret": ["RESTREAM_CLIENT_" + "SECRET=" + "q1".repeat(8), "const restreamClientSecret = context.env." + "RESTREAM_CLIENT_SECRET;"],
  "Restream client secret | placeholder": ["RESTREAM_CLIENT_" + "SECRET=" + "q1".repeat(8) + ".", "RESTREAM_CLIENT_SECRET=your-client-secret"],
  "Restream client secret | function call": ["restreamClient" + "Secret = " + "a1".repeat(10), "const restreamClientSecret = getRestreamClientSecret(env)"],
  "home folder path | macOS, kit.json shape": ['"mainRoot": "/Us' + 'ers/someone/x"', "https://example.com/Users/a/"],
  "home folder path | inside a word": ["/ho" + "me/someone/x", "src/home/components/x"],
  "home folder path": ["/ho" + "me/someone/Projects/x", "~/Projects/x"],
  "long value after a key name": ['private_' + 'key = "' + "A1b2C3d4".repeat(5) + '"', 'key = "ordinary-words-only-no-digits-in-this-long-name"'],
  "long value after a key name | hex, camelCase": ["signing" + "Key: " + "0123456789abcdef".repeat(2), "checksum: " + "0123456789abcdef".repeat(2)],
  "long value after a key name | unquoted base64": ["DB_PASS" + "WORD=" + "aGVsbG8gd29ybGQgdGhpcyBpcyBsb25n" + "Zm9vYmFy", "DB_PASS" + "WORD=" + "a".repeat(40)],
};

test("the guard itself catches each token shape and lets a near miss through", () => {
  const labels = TOKEN_PATTERNS.map(([label]) => label);
  const covered = new Set(Object.keys(SAMPLES).map((key) => key.split(" | ")[0]));
  assert.deepEqual(labels.filter((l) => !covered.has(l)), [], "a pattern has no sample");
  for (const [key, [hit, miss]] of Object.entries(SAMPLES)) {
    const pattern = TOKEN_PATTERNS.find(([label]) => label === key.split(" | ")[0]);
    assert.ok(pattern, `${key}: no pattern with that label`);
    assert.match(hit, pattern[1], `${key}: should match`);
    assert.doesNotMatch(miss, pattern[1], `${key}: near miss should not match`);
  }
});

test("the scan covers docs, the planning map and this test file (its fake tokens are built from pieces, so no file is skipped)", () => {
  for (const wanted of ["README.md", "AGENTS.md", "docs/agents/kitchen.md", "docs/wayfinder/README.md", "test/repo-guard.test.mjs"]) {
    assert.ok(files.includes(wanted), `${wanted} is not scanned`);
  }
  assert.ok(files.some((f) => f.startsWith("docs/wayfinder/producer/research/")), "the research notes are not scanned");
});

test("the guard itself catches a secret file name and not a normal one", () => {
  for (const name of [".env", ".env.local", "a.key", "cert.pem", ".dev.vars", ".dev.vars.production"]) assert.ok(SECRET_NAME.test(name), name);
  for (const name of ["README.md", "environment.md", "keyboard.mjs"]) assert.ok(!SECRET_NAME.test(name), name);
});
