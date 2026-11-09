// The speech model and the engine that runs it, served from this site (never from an outside host while the page
// runs). Each file is pinned by size and SHA-256. Before a build they are fetched once, at build time, from their
// published homes (the npm registry and the model's page on Hugging Face) into a cache folder outside the repo,
// checked, and copied into dist/speech/ by scripts/build.mjs. The repo holds only this list.
// A Worker static asset is at most 25 MiB, so a larger file is served in parts (see PART_BYTES); the page's speech
// worker (src/speech/worker.mjs) joins them, checks the whole file and keeps it in the browser's cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

/** Largest part served as one static asset: under Cloudflare's 25 MiB limit per file. */
export const PART_BYTES = 24 * 1024 * 1024;

/** The model: Moonshine base (English, MIT), 8-bit, as the TOOLS-150 test ran it on the processor. */
export const MODEL = {
  name: "Moonshine base",
  repo: "onnx-community/moonshine-base-ONNX",
  revision: "b1e9b6aae3c3c7298f10c3798393fdf38e8fbbad",
};

const NPM = {
  transformers: { name: "@huggingface/transformers", version: "4.3.2", integrity: "sha512-V3+dqf3iWlRYJ9I9GreM3zGQd0lAXnnoPeddmkOQYWAEE4l/+Fi6p7tx/qVUJlKQgLXGim2W76rTOzz+eC0i7g==" },
  ort: { name: "onnxruntime-web", version: "1.31.0-dev.20260914-8d85527a0", integrity: "sha512-Iy7rtadoBgxS/LLvDr3QW38DB1PNXRnr0GJMcL0TAt7c9qjgVQl83UlGCVyeAnK2InpmW8Uc3PL8XIuqtDeF6g==" },
};

const hf = (file) => `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${file}`;

/**
 * Every file under dist/speech/, by its served path. `npm` names the package and the file inside its tarball;
 * `url` a direct download. The engine is the processor-only build of ONNX Runtime (no graphics chip: Lex's choice).
 */
export const SPEECH_FILES = [
  { path: "vendor/transformers.min.js", npm: [NPM.transformers, "package/dist/transformers.min.js"], size: 587917, sha256: "8b5a3171f8876bab2b1820a7d65eb87628e3d30bb5ea85b9dd398e76eb34decb" },
  { path: "vendor/ort.wasm.min.mjs", npm: [NPM.ort, "package/dist/ort.wasm.min.mjs"], size: 50195, sha256: "1617c813ada08592706d29a9963ab6258864dce4299bd402d2196bd648b63bfe" },
  { path: "vendor/ort-wasm-simd-threaded.mjs", npm: [NPM.ort, "package/dist/ort-wasm-simd-threaded.mjs"], size: 24381, sha256: "c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f" },
  { path: "vendor/ort-wasm-simd-threaded.wasm", npm: [NPM.ort, "package/dist/ort-wasm-simd-threaded.wasm"], size: 14264838, sha256: "06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3" },
  { path: "model/config.json", url: hf("config.json"), size: 922, sha256: "fab7241d1e9fc6c2370c4c6dfb5da79bb54d67ed9ab6b507ac51d29d2abe01d1" },
  { path: "model/generation_config.json", url: hf("generation_config.json"), size: 147, sha256: "f9b3f711b57be7def2e50a8942f64f36ee0a55fad5b84ff93a687b6c5bcc1d44" },
  { path: "model/preprocessor_config.json", url: hf("preprocessor_config.json"), size: 128, sha256: "fa43a7017ef85cd1d0fba0d9aae77c8adb16990ae6f11115631f41ec5d8aa679" },
  { path: "model/tokenizer.json", url: hf("tokenizer.json"), size: 3761754, sha256: "7b913404bdd039af4756783218af4440bc07fb7d6d8258d677e34f95b3ec416f" },
  { path: "model/tokenizer_config.json", url: hf("tokenizer_config.json"), size: 135735, sha256: "edaee394565d428ea98a663ae7209cdcfeefc5585c42d7a570ff7c986df2cd15" },
  { path: "model/onnx/encoder_model_quantized.onnx", url: hf("onnx/encoder_model_quantized.onnx"), size: 20513063, sha256: "1dd9ab0a7f987113d30affcba5a068d11c8f90fa0223caa3e491ade431ad9751" },
  { path: "model/onnx/decoder_model_merged_quantized.onnx", url: hf("onnx/decoder_model_merged_quantized.onnx"), size: 42498870, sha256: "cc9f3cd6698a369c6008b41aa60aa3fb3322e7f03c9bdf19d8e6b7200afca4f3" },
];

/** Bytes the browser downloads once (and then keeps): every file above. */
export const SPEECH_BYTES = SPEECH_FILES.reduce((sum, f) => sum + f.size, 0);

/** The cache folder outside the repo, shared by every checkout: $PRODUCER_SPEECH_CACHE, else ~/.cache/producer-speech. */
export const cacheDir = () => process.env.PRODUCER_SPEECH_CACHE || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "producer-speech");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const cachedPath = (dir, file) => join(dir, file.path);

/** True when every file is in the cache with its pinned size (the hash is checked when it is written and copied). */
export function speechFilesReady(dir = cacheDir()) {
  return SPEECH_FILES.every((f) => existsSync(cachedPath(dir, f)) && statSync(cachedPath(dir, f)).size === f.size);
}

/** The files of one npm tarball (a plain ustar reader: name, size, then the data in 512-byte blocks). */
export function untar(tgz) {
  const tar = gunzipSync(tgz);
  const files = new Map();
  for (let at = 0; at + 512 <= tar.length;) {
    const head = tar.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const field = (from, length) => head.subarray(from, from + length).toString("utf8").replace(/\0.*$/s, "");
    const name = (field(345, 155) ? `${field(345, 155)}/` : "") + field(0, 100);
    const size = parseInt(field(124, 12).trim() || "0", 8);
    if ("0\0".includes(String.fromCharCode(head[156]))) files.set(name, tar.subarray(at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function download(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** Fetches every missing file into the cache, checks its size and SHA-256, and returns the cache folder. */
export async function fetchSpeechFiles(dir = cacheDir(), { log = () => {} } = {}) {
  const tarballs = new Map();
  for (const file of SPEECH_FILES) {
    const target = cachedPath(dir, file);
    if (existsSync(target) && statSync(target).size === file.size && sha256(readFileSync(target)) === file.sha256) continue;
    let data;
    if (file.npm) {
      const [pkg, inner] = file.npm;
      if (!tarballs.has(pkg.name)) {
        const url = `https://registry.npmjs.org/${pkg.name}/-/${pkg.name.split("/").pop()}-${pkg.version}.tgz`;
        log(`fetching ${url}`);
        const tgz = await download(url);
        const got = `sha512-${createHash("sha512").update(tgz).digest("base64")}`;
        if (got !== pkg.integrity) throw new Error(`${pkg.name}@${pkg.version}: the tarball does not match its pinned integrity`);
        tarballs.set(pkg.name, untar(tgz));
      }
      data = tarballs.get(pkg.name).get(inner);
      if (!data) throw new Error(`${pkg.name}@${pkg.version} has no ${inner}`);
    } else {
      log(`fetching ${file.url}`);
      data = await download(file.url);
    }
    if (data.length !== file.size || sha256(data) !== file.sha256) throw new Error(`${file.path}: size or SHA-256 differs from the pinned one`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.part`, data);
    renameSync(`${target}.part`, target);
  }
  return dir;
}

/**
 * Copies the files into <out>/speech/, a file over PART_BYTES as <path>.part1, .part2, ..., and returns the
 * manifest the speech worker reads: the version (from the pinned hashes), the total bytes and each file's parts.
 */
export function copySpeechFiles(dir, out) {
  const files = SPEECH_FILES.map((file) => {
    const data = readFileSync(cachedPath(dir, file));
    if (data.length !== file.size || sha256(data) !== file.sha256) throw new Error(`${file.path}: the cached copy differs from the pinned one; fetch it again`);
    return { path: file.path, size: file.size, sha256: file.sha256, parts: writeParts(out, file.path, data) };
  });
  return speechManifest(files);
}

/** The manifest's shape, also for a build without the files (the page then reports the model missing). */
export function speechManifest(files = SPEECH_FILES.map(({ path, size, sha256: hash }) => ({ path, size, sha256: hash, parts: [] }))) {
  const version = sha256(SPEECH_FILES.map((f) => `${f.path} ${f.sha256}`).join("\n")).slice(0, 12);
  return { version, model: MODEL.name, bytes: SPEECH_BYTES, files };
}

/** Writes one file under out: as it is, or over partBytes as <path>.part1, .part2, ...; returns the served paths. */
export function writeParts(out, path, data, partBytes = PART_BYTES) {
  if (data.length <= partBytes) {
    writeAt(join(out, path), data);
    return [path];
  }
  const parts = [];
  for (let start = 0, n = 1; start < data.length; start += partBytes, n++) {
    parts.push(`${path}.part${n}`);
    writeAt(join(out, `${path}.part${n}`), data.subarray(start, start + partBytes));
  }
  return parts;
}

function writeAt(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
}

if (import.meta.main) {
  const dir = await fetchSpeechFiles(cacheDir(), { log: (line) => console.log(line) });
  console.log(`Speech files ready in ${dir} (${(SPEECH_BYTES / 1e6).toFixed(1)} MB)`);
}
