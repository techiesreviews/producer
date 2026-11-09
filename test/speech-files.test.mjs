// The pinned speech model and engine (scripts/speech-files.mjs): from their published homes only, every file pinned,
// and every served part small enough for a Worker static asset.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { MODEL, PART_BYTES, SPEECH_BYTES, SPEECH_FILES, speechManifest, untar, writeParts } from "../scripts/speech-files.mjs";

const CLOUDFLARE_ASSET_LIMIT = 25 * 1024 * 1024;

test("every served file or part fits a Worker static asset (25 MiB)", () => {
  assert.ok(PART_BYTES < CLOUDFLARE_ASSET_LIMIT);
  const parts = SPEECH_FILES.flatMap((f) => Array.from({ length: Math.ceil(f.size / PART_BYTES) }, (_, i) => Math.min(PART_BYTES, f.size - i * PART_BYTES)));
  assert.ok(parts.every((p) => p > 0 && p <= PART_BYTES));
  assert.equal(SPEECH_FILES.filter((f) => f.size > PART_BYTES).map((f) => f.path).join(), "model/onnx/decoder_model_merged_quantized.onnx", "only the decoder is split");
});

test("the model is Moonshine base, 8-bit, English, at a fixed revision; the engine runs on the processor only", () => {
  assert.equal(MODEL.repo, "onnx-community/moonshine-base-ONNX");
  assert.match(MODEL.revision, /^[0-9a-f]{40}$/);
  const paths = SPEECH_FILES.map((f) => f.path);
  assert.ok(paths.includes("model/onnx/encoder_model_quantized.onnx") && paths.includes("model/onnx/decoder_model_merged_quantized.onnx"));
  assert.ok(paths.includes("vendor/ort-wasm-simd-threaded.wasm"));
  assert.ok(!paths.some((p) => /webgpu|jsep|asyncify|fp16/.test(p)), "no graphics-chip build");
  assert.ok(Math.abs(SPEECH_BYTES / 1e6 - 81.8) < 0.1, `82 MB to download once (${SPEECH_BYTES})`);
});

test("each file is pinned by size and SHA-256 and comes from the npm registry or the model's page at its revision", () => {
  for (const f of SPEECH_FILES) {
    assert.match(f.path, /^(vendor|model)\/[\w./-]+$/, f.path);
    assert.ok(!f.path.includes(".."), f.path);
    assert.match(f.sha256, /^[0-9a-f]{64}$/, f.path);
    assert.ok(Number.isInteger(f.size) && f.size > 0, f.path);
    if (f.npm) {
      assert.match(f.npm[0].version, /^\d+\.\d+\.\d+/, f.path);
      assert.match(f.npm[0].integrity, /^sha512-[A-Za-z0-9+/]{86}==$/, f.path);
    } else {
      assert.ok(f.url.startsWith(`https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/`), f.url);
    }
  }
});

test("the manifest: a version from the pinned hashes, the total and, without the files, no parts", () => {
  const m = speechManifest();
  assert.match(m.version, /^[0-9a-f]{12}$/);
  assert.equal(m.version, speechManifest().version);
  assert.equal(m.bytes, SPEECH_BYTES);
  assert.equal(m.files.length, SPEECH_FILES.length);
  assert.ok(m.files.every((f) => f.parts.length === 0));
});

test("the tarball reader finds a file by its path", () => {
  const block = (name, body) => {
    const head = Buffer.alloc(512);
    head.write(name, 0);
    head.write(body.length.toString(8).padStart(11, "0"), 124);
    head.write("0", 156);
    return Buffer.concat([head, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
  };
  const files = untar(gzipSync(Buffer.concat([block("package/a.txt", "hello"), block("package/dist/b.js", "x".repeat(600)), Buffer.alloc(1024)])));
  assert.equal(files.get("package/a.txt").toString(), "hello");
  assert.equal(files.get("package/dist/b.js").length, 600);
});

test("a file over the part size is served in parts that join back into it", () => {
  const out = resolve(import.meta.dirname, "../.scratch/test-parts");
  rmSync(out, { recursive: true, force: true });
  const data = Buffer.from(Array.from({ length: 2500 }, (_, i) => i % 251));
  assert.deepEqual(writeParts(out, "model/small.bin", data.subarray(0, 1000), 1000), ["model/small.bin"]);
  const parts = writeParts(out, "model/big.bin", data, 1000);
  assert.deepEqual(parts, ["model/big.bin.part1", "model/big.bin.part2", "model/big.bin.part3"]);
  const joined = Buffer.concat(parts.map((p) => readFileSync(join(out, p))));
  assert.ok(joined.equals(data));
  assert.equal(readFileSync(join(out, parts[2])).length, 500);
});
