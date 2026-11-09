// Browser checks for `kit specs speech`: the microphone, the speech model and the listening sign, end to end in a
// real Chromium served through the real Worker. A recorded clip of two people taking turns (test/fixtures/two-voices)
// is the microphone (Chromium's fake capture device), so the page hears it exactly as it would hear a person.
// Checks: the model loads from this site with progress on its button and is kept in the browser; the meter moves;
// the guest step; "Open producer screen" starts listening with the sign; the text comes within the delay and accuracy
// targets (middle delay under 1.5 s, at most 20 % word errors); Stop ends the microphone at once and Listen starts it
// again; the page never plays a sound; no sound and no text leave the page; nothing is stored apart from the model files.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { delays, wordErrors } from "../speech-score.mjs";

const fixture = resolve(import.meta.dirname, "../fixtures/two-voices");
const clip = JSON.parse(readFileSync(`${fixture}.json`, "utf8"));
const TARGET = { middleDelay: 1.5, wordErrors: 0.2 };

// Watches the page from inside, for the checks only: when the microphone opened, every message the speech worker
// sent (with the time it arrived), the workers and streams the page got, and anything joined to the speakers.
// window.__watch.fail = "NotAllowedError" (or another name) makes the next microphone request fail that way.
function watch() {
  window.__watch = { messages: [], streams: [], workers: [], speakers: 0, micAt: null, fail: null };
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...args) {
      super(...args);
      window.__watch.workers.push(this);
      this.addEventListener("message", ({ data }) => window.__watch.messages.push({ ...data, arrived: performance.now() }));
    }
  };
  const media = navigator.mediaDevices;
  const open = media.getUserMedia.bind(media);
  media.getUserMedia = async (...args) => {
    if (window.__watch.fail) throw new DOMException("refused for the check", window.__watch.fail);
    const stream = await open(...args);
    window.__watch.micAt = performance.now();
    window.__watch.streams.push(stream);
    return stream;
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode) window.__watch.speakers++;
    return connect.call(this, target, ...rest);
  };
  document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`));
}

// Chromium names the audio tap the page uses (ScriptProcessorNode) as deprecated. It is kept on purpose: its
// replacement (an AudioWorklet) must load a script file, which the page's policy (its own inline script only) forbids.
const KNOWN_WARNING = /^console warning: The ScriptProcessorNode is deprecated\./;

// The contrast of a control's text on its own background, as the browser paints it over the page (WCAG ratio).
const paintedContrast = (page, selector) => page.locator(selector).evaluate((el) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const px = (...fills) => { for (const f of fills) { c.fillStyle = f; c.fillRect(0, 0, 1, 1); } return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const behind = getComputedStyle(document.querySelector(".top")).backgroundColor;
  const ground = px(behind, getComputedStyle(el).backgroundColor);
  const ink = px(behind, getComputedStyle(el).backgroundColor, getComputedStyle(el).color);
  const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const [hi, lo] = [lum(ink), lum(ground)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
});

const text = (page, id) => page.locator(`#${id}`).evaluate((el) => el.innerText.replace(/\s+/g, " ").trim());

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID };
// More looks of the same steps and sign: each guest answer, a phone, dark, and Firefox. [name, browser, options, answer, chip]
const VIEWS = [
  ["phone-light", "chromium", { ...PHONE, colorScheme: "light" }, "No · my mic only", "Guest: no"],
  ["phone-dark", "chromium", { ...PHONE, colorScheme: "dark" }, "Solo show", null],
  ["desktop-dark", "chromium", { viewport: { width: 1366, height: 900 }, colorScheme: "dark" }, "Yes", "Guest ✓"],
  ["firefox-desktop-light", "firefox", { viewport: { width: 1366, height: 900 }, colorScheme: "light" }, "No · my mic only", "Guest: no"],
];

// One look: load the model, answer the guest step, turn on the microphone, open the producer screen; the sign reads
// right and fits the window; Stop ends the microphone. Screenshots of the ready setup, the sign and the stopped sign.
async function view(browser, base, out, [name, , options, answer, chip]) {
  const touch = Boolean(options.hasTouch);
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const problems = [];
  page.on("console", (m) => {
    const line = `console ${m.type()}: ${m.text()}`;
    if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(line)) problems.push(line);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  const press = (locator) => (touch ? locator.tap() : locator.click());
  await press(page.locator("#speechBtn"));
  await page.waitForFunction(() => /ready|failed/.test(document.querySelector("#speechTxt").textContent), null, { timeout: 120000 });
  assert.equal(await text(page, "speechBtn"), "Speech ready", `${name}: the model loads (${await page.locator("#speechBtn").getAttribute("data-tip")})`);
  await press(page.getByRole("button", { name: answer, exact: true }));
  await press(page.locator("#micBtn"));
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  const shots = [join(out, `speech-${name}-setup.png`), join(out, `speech-${name}-listening.png`), join(out, `speech-${name}-stopped.png`)];
  await page.screenshot({ path: shots[0], fullPage: true });
  await press(page.locator("#goBtn"));
  assert.equal(await text(page, "listenTxt"), "Listening · mic only", `${name}: the sign (its words are read aloud on a phone too)`);
  assert.equal(await page.locator("#guestChip").isVisible(), Boolean(chip), `${name}: the guest chip ${chip ? "shows" : "is left out on a solo show"}`);
  if (chip) assert.equal(await text(page, "guestChip"), chip, `${name}: the guest chip says the answer`);
  const box = await page.evaluate(() => {
    const r = document.querySelector("#listen").getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth, scrollWidth: document.documentElement.scrollWidth, stop: document.querySelector("#stopBtn").getBoundingClientRect().height };
  });
  assert.ok(box.left >= 0 && box.right <= box.width && box.scrollWidth <= box.width, `${name}: the sign fits the window, no sideways scroll`);
  if (touch) assert.ok(box.stop >= 44, `${name}: Stop is a finger-sized target (${box.stop}px)`);
  await page.screenshot({ path: shots[1] });
  await press(page.locator("#stopBtn"));
  assert.ok(await page.evaluate(() => window.__watch.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended"))), `${name}: Stop ends the microphone`);
  assert.equal(await text(page, "listenTxt"), "Not listening", `${name}: the sign says Not listening`);
  const listenContrast = await paintedContrast(page, "#stopBtn");
  assert.ok(listenContrast >= 4.5, `${name}: Listen reads at ${listenContrast.toFixed(2)}:1`);
  await page.screenshot({ path: shots[2] });
  // A failed Listen: it says so on itself, readable as painted.
  await page.evaluate(() => { window.__watch.fail = "NotAllowedError"; });
  await press(page.locator("#stopBtn"));
  await page.waitForFunction(() => document.querySelector("#stopBtn").dataset.state === "error");
  assert.equal(await text(page, "stopBtn"), "Microphone blocked · Listen", `${name}: a failed Listen says so`);
  const failedContrast = await paintedContrast(page, "#stopBtn");
  assert.ok(failedContrast >= 4.5, `${name}: the failed Listen reads at ${failedContrast.toFixed(2)}:1`);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector("#listen").getBoundingClientRect().right <= innerWidth);
  assert.ok(fits, `${name}: the failed Listen still fits the window`);
  shots.push(join(out, `speech-${name}-listen-failed.png`));
  await page.screenshot({ path: shots[3] });
  assert.equal(await page.evaluate(() => window.__watch.speakers), 0, `${name}: nothing is joined to the speakers`);
  assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation`);
  await context.close();
  return shots;
}

// What a failure looks like: the model missing on the site (its manifest lists no parts), then a blocked and a missing
// microphone; each says so on its own button with the reason in its tooltip, and the open button stays off.
async function failures(browser, base, out) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(watch);
  await page.route("**/speech/manifest.json", async (route) => {
    const manifest = await (await route.fetch()).json();
    await route.fulfill({ json: { ...manifest, files: manifest.files.map((f) => ({ ...f, parts: [] })) } });
  });
  await page.goto(`${base}/`);
  await page.locator("#speechBtn").click();
  await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "error");
  assert.equal(await text(page, "speechBtn"), "Speech model failed · try again", "a missing model says so on the button");
  assert.equal(await page.locator("#speechBtn").getAttribute("data-tip"), "The speech model is missing on this site.", "with the reason");
  for (const [name, label, tip] of [["NotAllowedError", "Microphone blocked", /^The browser blocked the microphone\./], ["NotFoundError", "No microphone found", /^This computer has no microphone/]]) {
    await page.evaluate((n) => { window.__watch.fail = n; }, name);
    await page.locator("#micBtn").click();
    await page.waitForFunction((l) => document.querySelector("#micTxt").textContent === l, label);
    assert.equal(await page.locator("#micBtn").getAttribute("data-state"), "error", `${name}: the button shows the failure`);
    assert.match(await page.locator("#micBtn").getAttribute("data-tip"), tip, `${name}: with the way out`);
    assert.equal(await page.locator("#micMeter").isHidden(), true, `${name}: no meter`);
  }
  await page.getByRole("button", { name: "Solo show", exact: true }).click();
  assert.deepEqual([await page.locator("#goBtn").getAttribute("aria-disabled"), await page.locator("#goBtn").getAttribute("data-tip")], ["true", "Turn on the microphone first."], "the open button stays off");
  const shot = join(out, "speech-failures.png");
  await page.screenshot({ path: shot });
  await context.close();
  return [shot];
}

export async function run({ playwright, base, dist, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);
  const manifest = JSON.parse(readFileSync(join(dist, "speech/manifest.json"), "utf8"));
  assert.ok(manifest.files.every((f) => f.parts.length), "the build holds the speech model");

  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${fixture}.wav`],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: "light" });
    const page = await context.newPage();
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push({ url: r.url(), method: r.method(), type: r.resourceType(), at: Date.now() }));
    page.on("websocket", (ws) => problems.push(`a WebSocket opened: ${ws.url()}`));
    page.on("console", (m) => {
      const line = `console ${m.type()}: ${m.text()}`;
      if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(line)) problems.push(line);
    });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") problems.push(`worker console: ${m.text()}`); }));
    await page.addInitScript(watch);
    await page.goto(`${base}/`);

    // The new steps, in order, and the open button switched off with the first missing step as its reason.
    const steps = await page.locator(".step .step__label").allInnerTexts();
    assert.deepEqual(steps, ["I stream with", "AI agent", "Guest agreed", "Sound", "Speech to text"], "the steps that exist, in order");
    const go = page.locator("#goBtn");
    assert.equal(await go.getAttribute("aria-disabled"), "true", "Open producer screen waits for the steps");
    assert.equal(await go.getAttribute("data-tip"), "Answer Guest agreed first.", "and says what is missing first");
    assert.match(await text(page, "speechBtn"), /^Load speech model · \d+ MB$/, "the speech button names its download size");
    ok("setup: the guest, sound and speech steps, and the open button waits with its reason");

    // The speech model: progress on the button, then ready. Downloaded from this site only.
    const shown = new Set();
    const speechBtn = page.locator("#speechBtn");
    await speechBtn.click();
    for (let i = 0; i < 600; i++) {
      const label = await text(page, "speechBtn");
      shown.add(label);
      if (label === "Speech ready" || /failed/.test(label)) break;
      await page.waitForTimeout(100);
    }
    assert.equal(await text(page, "speechBtn"), "Speech ready", `the model loads (${[...shown].join(" | ")})`);
    assert.equal(await speechBtn.getAttribute("data-state"), "ok", "and the button shows it is ready");
    assert.ok([...shown].some((l) => /^Loading \d+%$/.test(l)), `progress shows on the button (${[...shown].join(" | ")})`);
    const modelRequests = requests.filter((r) => r.url.includes("/speech/"));
    assert.ok(modelRequests.every((r) => r.url.startsWith(`${base}/speech/`) && r.method === "GET"), "every speech file comes from this site, by GET");
    const seen = new Set(modelRequests.map((r) => r.url));
    const missed = manifest.files.flatMap((f) => f.parts).filter((part) => !seen.has(`${base}/speech/${part}`));
    assert.deepEqual(missed, [], "the watcher sees the worker's own downloads: every part of every model file");
    ok(`speech: the model loads from this site with progress on its button (${[...shown].filter((l) => /%/.test(l)).length} steps)`);

    // The guest step: one answer at a time, the host's own click.
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    assert.equal(await page.locator("#sGuest").getAttribute("data-done"), "", "the guest step is done");
    assert.equal(await go.getAttribute("data-tip"), "Turn on the microphone first.", "the open button now waits for the microphone");
    ok("guest: Yes picked by the host");

    // The microphone: the meter moves while the clip plays.
    await page.locator("#micBtn").click();
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    let loudest = 0;
    for (let i = 0; i < 30 && loudest < 20; i++) {
      loudest = Math.max(loudest, Number(await page.locator("#micMeter").getAttribute("aria-valuenow")));
      await page.waitForTimeout(100);
    }
    assert.ok(await page.locator("#micMeter").isVisible(), "the level meter shows");
    assert.ok(loudest >= 20, `the meter moves with the sound (up to ${loudest} %)`);
    assert.equal(await go.getAttribute("aria-disabled"), null, "every step is done: the open button is on");
    const setupShot = join(out, "speech-setup-ready.png");
    await page.screenshot({ path: setupShot });
    screenshots.push(setupShot);
    ok(`sound: the microphone turns on and its meter moves (up to ${loudest} %)`);

    // Open producer screen: listening at once, with the sign.
    const beforeListening = requests.length;
    await go.click();
    assert.equal(await page.locator("#setup").isHidden(), true, "the setup makes way for the producer screen");
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "true", "the sign says listening");
    assert.equal(await text(page, "listenTxt"), "Listening · mic only", "and what it hears");
    assert.equal(await text(page, "guestChip"), "Guest ✓", "and the guest's answer");
    assert.equal(await text(page, "stopBtn"), "Stop", "with Stop beside it");
    const liveShot = join(out, "speech-listening.png");
    await page.screenshot({ path: liveShot });
    screenshots.push(liveShot);
    ok("live: the sign shows Listening · mic only, Guest ✓ and Stop");

    // Let the whole clip play once (it began when the microphone opened), then read what came back.
    const micAt = await page.evaluate(() => window.__watch.micAt);
    const clipEnd = micAt + clip.seconds * 1000;
    await page.waitForFunction((end) => performance.now() > end, clipEnd, { timeout: (clip.seconds + 30) * 1000, polling: 500 });
    const messages = (await page.evaluate(() => window.__watch.messages)).filter((m) => m.type === "text").map((m) => ({ ...m, at: (m.arrived - micAt) / 1000 }));
    const finals = messages.filter((m) => m.final && m.at <= clip.seconds);
    const score = wordErrors(clip.utterances, finals);
    const delay = delays(clip.utterances, messages.filter((m) => m.at <= clip.seconds));
    const pauses = (await page.evaluate(() => window.__watch.messages)).filter((m) => m.type === "pause").length;
    writeFileSync(join(out, "speech-heard.json"), JSON.stringify({ score, delay, pauses, finals: finals.map(({ piece, text: t, start, end, at }) => ({ piece, text: t, start, end, at })) }, null, 1));
    assert.ok(score.rate <= TARGET.wordErrors, `word errors ${(score.rate * 100).toFixed(1)} % (${score.errors} of ${score.words}), at most ${TARGET.wordErrors * 100} %`);
    assert.ok(delay.middle < TARGET.middleDelay, `middle delay ${delay.middle.toFixed(2)} s, under ${TARGET.middleDelay} s`);
    assert.ok(pauses >= 1, "a pause of about 1.5 s is noticed");
    ok(`speech: ${(score.rate * 100).toFixed(1)} % word errors on ${score.words} words; delay middle ${delay.middle.toFixed(2)} s, slowest 1 in 10 ${delay.slowest.toFixed(2)} s; ${pauses} pauses`);

    // Nothing left the page while it listened: no request at all (the model was already here), no WebSocket.
    assert.deepEqual(requests.slice(beforeListening).map((r) => r.url), [], "no request while listening");
    ok("privacy: no request while listening, so no sound and no text left the page");

    // Stop: the microphone ends at once and the sign says so; Listen starts it again.
    await page.locator("#stopBtn").click();
    const stopped = await page.evaluate(() => window.__watch.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
    assert.ok(stopped, "Stop ends every microphone track at once");
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "false", "the sign says not listening");
    assert.equal(await text(page, "listenTxt"), "Not listening", "in words");
    assert.equal(await text(page, "stopBtn"), "Listen", "and offers Listen");
    const stopShot = join(out, "speech-stopped.png");
    await page.screenshot({ path: stopShot });
    screenshots.push(stopShot);
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
    assert.equal(await text(page, "stopBtn"), "Stop", "Listen starts the microphone again");
    await page.locator("#stopBtn").click();
    const allEnded = () => page.evaluate(() => window.__watch.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
    assert.ok(await allEnded(), "and Stop ends it again");
    ok("stop: the microphone ends at once, the sign says Not listening, Listen starts it again");

    // A Listen that fails (the microphone blocked) says so on Listen itself; pressing it again tries again.
    await page.evaluate(() => { window.__watch.fail = "NotAllowedError"; });
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#stopBtn").dataset.state === "error");
    assert.equal(await text(page, "stopBtn"), "Microphone blocked · Listen", "the failure shows on the button");
    const failedContrast = await paintedContrast(page, "#stopBtn");
    assert.ok(failedContrast >= 4.5, `and reads at ${failedContrast.toFixed(2)}:1 as painted`);
    const failedShot = join(out, "speech-listen-failed.png");
    await page.screenshot({ path: failedShot, clip: { x: 0, y: 0, width: 1366, height: 120 } });
    screenshots.push(failedShot);
    assert.match(await page.locator("#stopBtn").getAttribute("data-tip"), /^The browser blocked the microphone\./, "with the way out in its tooltip");
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "false", "and the sign stays Not listening");
    await page.evaluate(() => { window.__watch.fail = null; });
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
    assert.equal(await text(page, "stopBtn"), "Stop", "pressed again, it listens");
    ok("listen: a blocked microphone shows on Listen with its way out; pressed again, it listens");

    // The microphone ending by itself (unplugged, or the permission taken back) stops the sign at once.
    await page.evaluate(() => window.__watch.streams.at(-1).getAudioTracks()[0].dispatchEvent(new Event("ended")));
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "false", "an ended microphone: the sign says Not listening");
    assert.ok(await allEnded(), "and every track is ended");
    ok("listen: a microphone that ends by itself stops the sign");

    // The speech model failing on the producer screen: the microphone stops and the setup comes back, with the failed
    // speech button and its reason, so the sign never shows listening while nothing turns into text.
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
    await page.evaluate(() => window.__watch.workers.at(-1).dispatchEvent(new MessageEvent("message", { data: { type: "error", reason: "the check broke the model" } })));
    assert.ok(await allEnded(), "the microphone stops");
    assert.equal(await page.locator("#setup").isVisible(), true, "the setup comes back");
    assert.equal(await page.locator("#topLive").isHidden(), true, "and the sign goes with the producer screen");
    assert.equal(await text(page, "speechBtn"), "Speech model failed · try again", "the speech button says it failed");
    assert.equal(await page.locator("#speechBtn").getAttribute("data-tip"), "The check broke the model.", "with the reason");
    assert.equal(await page.locator("#goBtn").getAttribute("data-tip"), "Turn on the microphone first.", "and the open button waits again");
    ok("speech: a model failure on the producer screen stops the microphone and brings back the setup with the reason");

    // The page never plays a sound: nothing is joined to the speakers.
    assert.equal(await page.evaluate(() => window.__watch.speakers), 0, "nothing is joined to the speakers");
    assert.equal(await page.locator("audio, video").count(), 0, "no sound element");
    ok("sound: the page never plays a sound");

    // Stored: only the model files, in one cache of this site; nothing else anywhere.
    const kept = await page.evaluate(async () => {
      const names = await caches.keys();
      const files = [];
      for (const name of names) for (const r of await (await caches.open(name)).keys()) files.push(new URL(r.url).pathname);
      return { names, files: files.sort(), local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length };
    });
    assert.deepEqual(kept.names, [`producer-speech-${manifest.version}`], "one cache, named for this model version");
    assert.deepEqual(kept.files, manifest.files.map((f) => `/speech/${f.path}`).sort(), "holding the model files only");
    assert.deepEqual([kept.local, kept.session, kept.cookie, kept.databases], [0, 0, "", 0], "and nothing else is stored");
    assert.deepEqual(problems, [], "no console error, warning or policy violation");
    ok("storage: only the model files, in one cache; nothing else");

    // A second visit loads the model from the browser's cache: no model file is downloaded again.
    const count = requests.length;
    await page.reload();
    await page.locator("#speechBtn").click();
    await page.waitForFunction(() => document.querySelector("#speechTxt").textContent === "Speech ready", null, { timeout: 60000 });
    const again = requests.slice(count).map((r) => new URL(r.url).pathname);
    assert.deepEqual(again.filter((p) => p.includes("/model/") || p.endsWith(".wasm")), [], `no model file downloaded again (${again.join(", ")})`);
    ok("cache: a second visit loads the model without downloading it");
    await context.close();

    screenshots.push(...await failures(browser, base, out));
    ok("failures: a missing model and a blocked or missing microphone say so on their buttons, and the open button waits");

    const fox = await playwright.firefox.launch({ headless: true, firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } });
    try {
      for (const v of VIEWS) {
        screenshots.push(...await view(v[1] === "firefox" ? fox : browser, base, out, v));
        ok(`${v[0]}: the model loads, "${v[3]}", the sign reads Listening · mic only${v[4] ? ` with ${v[4]}` : " without a guest chip"} and fits; Stop ends the microphone`);
      }
    } finally {
      await fox.close();
    }
  } finally {
    await browser.close();
  }
  return { checks, screenshots };
}
