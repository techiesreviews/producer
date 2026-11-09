// Browser checks for `kit specs speech`: the microphone, the speech model and the listening sign, end to end in a
// real Chromium served through the real Worker. A recorded clip of two people taking turns (test/fixtures/two-voices)
// is the microphone (Chromium's fake capture device), so the page hears it exactly as it would hear a person.
// Checks: the model loads from this site with progress on its button and is kept in the browser; the meter moves;
// the guest step; the studio tab's sound as a second source (a stand-in for the browser's tab picker); "Open producer
// screen" starts listening with the sign; the text comes within the delay and accuracy targets (middle delay under
// 1.5 s, at most 20 % word errors); Stop ends the microphone and the tab at once and Listen starts them again; the page
// never plays a sound; no sound and no text leave the page; nothing is stored apart from the model files.
// Then twoVoices: the clip split by speaker into the microphone (the host's turns) and the shared tab (the guest's
// turns), as on a call, to prove each text comes back labelled with its own source and never mixed; and tabFailures.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { delays, wordErrors } from "../speech-score.mjs";

const fixture = resolve(import.meta.dirname, "../fixtures/two-voices");
const clip = JSON.parse(readFileSync(`${fixture}.json`, "utf8"));
const TARGET = { middleDelay: 1.5, wordErrors: 0.2 };

// Watches the page from inside, for the checks only: when the microphone opened, every message the speech worker
// sent (with the time it arrived), the workers and streams the page got, and anything joined to the speakers.
// window.__watch.fail = "NotAllowedError" (or another name) makes the next microphone request fail that way, and
// window.__watch.micHold = true keeps it waiting until window.__watch.micRelease() is called.
// The tab picker is a stand-in (headless Chromium has no real tab to share): window.__watch.share says what the next
// share does: "tab" (a browser tab whose sound is silent until window.__watch.tabGain is turned up), "window" (a window),
// "silent" (a tab that comes without sound) or "cancel" (the host closes the picker); window.__watch.hold = true keeps
// the picker open until window.__watch.release() is called. Every stream it hands out is in window.__watch.shares, and
// every option the page asked with in window.__watch.shareOptions. window.__voices(...) loads the clip split by speaker.
function watch() {
  window.__watch = { messages: [], streams: [], shares: [], shareOptions: [], share: "tab", hold: false, release: null, micHold: false, micRelease: null, tabGain: null, voices: null, workers: [], speakers: 0, micAt: null, fail: null };
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
    if (window.__watch.micHold) await new Promise((resolve) => { window.__watch.micRelease = resolve; });
    if (window.__watch.fail) throw new DOMException("refused for the check", window.__watch.fail);
    const stream = window.__watch.voices ? window.__watch.voices.stream("host") : await open(...args);
    window.__watch.micAt = performance.now();
    window.__watch.streams.push(stream);
    return stream;
  };
  media.getDisplayMedia = async (options) => {
    const w = window.__watch;
    w.shareOptions.push(options);
    if (w.hold) await new Promise((resolve) => { w.release = resolve; });
    if (w.share === "cancel") throw new DOMException("refused for the check", "NotAllowedError");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    canvas.getContext("2d").fillRect(0, 0, 1, 1);
    const video = canvas.captureStream(2).getVideoTracks()[0];
    const settings = { displaySurface: w.share === "window" ? "window" : "browser", width: 320, height: 180 };
    video.getSettings = () => settings;
    const stream = new MediaStream([video]);
    if (w.share !== "silent") {
      if (w.voices) stream.addTrack(w.voices.stream("guest").getAudioTracks()[0]);
      else {
        const context = new AudioContext();
        const out = context.createMediaStreamDestination();
        const gain = context.createGain();
        const tone = context.createOscillator();
        gain.gain.value = 0;
        tone.connect(gain);
        gain.connect(out);
        tone.start();
        w.tabGain = gain;
        stream.addTrack(out.stream.getAudioTracks()[0]);
      }
    }
    w.shares.push(stream);
    return stream;
  };
  // The clip split by speaker: the host's turns reach the microphone, the guest's turns the shared tab, as on a call.
  window.__voices = async ({ wav, windows }) => {
    const context = new AudioContext();
    await context.resume();
    const buffer = await context.decodeAudioData(Uint8Array.from(atob(wav), (c) => c.charCodeAt(0)).buffer);
    const gains = {};
    window.__watch.voices = {
      stream(who) {
        const out = context.createMediaStreamDestination();
        gains[who] = context.createGain();
        gains[who].gain.value = 0;
        gains[who].connect(out);
        return out.stream;
      },
      // Plays the clip on both: each source's gain opens only over its own speaker's turns. Returns when it began.
      start() {
        const t0 = context.currentTime + 0.2;
        for (const who of ["host", "guest"]) {
          for (const [from, to] of windows[who]) {
            gains[who].gain.setValueAtTime(1, t0 + from - 0.15);
            gains[who].gain.setValueAtTime(0, t0 + to + 0.2);
          }
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(gains[who]);
          source.start(t0);
        }
        return performance.now() + 200;
      },
    };
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
const paintedContrast = (page, selector, behindSelector = ".top") => page.locator(selector).evaluate((el, behindSelector) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const px = (...fills) => { for (const f of fills) { c.fillStyle = f; c.fillRect(0, 0, 1, 1); } return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const behind = getComputedStyle(document.querySelector(behindSelector)).backgroundColor;
  const ground = px(behind, getComputedStyle(el).backgroundColor);
  const ink = px(behind, getComputedStyle(el).backgroundColor, getComputedStyle(el).color);
  const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const [hi, lo] = [lum(ink), lum(ground)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}, behindSelector);

const text = (page, id) => page.locator(`#${id}`).evaluate((el) => el.innerText.replace(/\s+/g, " ").trim());

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID };
// More looks of the same steps and sign: each guest answer, a phone, dark, and Firefox. [name, browser, options, answer, chip, tab]
// `tab` is whether the tab's sound is shared in that look (a Yes in a browser that can).
const VIEWS = [
  ["phone-light", "chromium", { ...PHONE, colorScheme: "light" }, "No · my mic only", "Guest: no", false],
  ["phone-dark", "chromium", { ...PHONE, colorScheme: "dark" }, "Solo show", null, false],
  ["desktop-dark", "chromium", { viewport: { width: 1366, height: 900 }, colorScheme: "dark" }, "Yes", "Guest ✓", true],
  ["firefox-desktop-light", "firefox", { viewport: { width: 1366, height: 900 }, colorScheme: "light" }, "No · my mic only", "Guest: no", false],
  // A guest who said yes in a browser that cannot share a tab: the tab button is off with its reason, and the host can still open the screen.
  ["firefox-desktop-dark", "firefox", { viewport: { width: 1366, height: 900 }, colorScheme: "dark" }, "Yes", "Guest ✓", false],
];

// One look: load the model, answer the guest step, turn on the microphone, open the producer screen; the sign reads
// right and fits the window; Stop ends the microphone. Screenshots of the ready setup, the sign and the stopped sign.
async function view(browser, base, out, [name, , options, answer, chip, tab]) {
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
  // A guest who said yes is heard through the studio tab: share it (the stand-in picker), then the sign names both.
  const heard = tab ? "host mic + guest tab" : "host mic";
  if (tab) {
    await press(page.locator("#tabBtn"));
    await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
    assert.equal(await text(page, "tabBtn"), "Restream Studio tab", `${name}: the shared tab shows on its button`);
  } else {
    assert.equal(await page.locator("#tabBtn").getAttribute("aria-disabled"), "true", `${name}: the tab button is switched off`);
  }
  const shots = [join(out, `speech-${name}-setup.png`), join(out, `speech-${name}-listening.png`), join(out, `speech-${name}-stopped.png`)];
  // The whole setup screen. A fullPage screenshot of a page taller than the window (a phone, from card 09) makes Chromium
  // forget the phone's touch pointer for the rest of the run, so the window is made as tall as the page and put back.
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, tall) });
  await page.screenshot({ path: shots[0] });
  await page.setViewportSize(size);
  await press(page.locator("#goBtn"));
  assert.equal(await text(page, "listenTxt"), `Listening · ${heard}`, `${name}: the sign (its words are read aloud on a phone too)`);
  if (answer === "Yes" && !tab) assert.equal(await page.locator("#listenTxt").getAttribute("data-tip"), "Host mic only: this browser cannot share a tab's sound.", `${name}: a yes without a tab says the browser cannot, with no way back to promise`);
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
  assert.ok(await page.evaluate(() => [...window.__watch.streams, ...window.__watch.shares].every((s) => s.getTracks().every((t) => t.readyState === "ended"))), `${name}: Stop ends the microphone${tab ? " and the shared tab" : ""}`);
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

// The two sources kept apart, as on a call: the clip's host turns reach the microphone and its guest turns the shared
// tab (windows of the clip by speaker), both listened to at once. Each text must come back labelled with its own source
// and read right against that speaker's sentences only; neither source may make text for the other's turns.
async function twoVoices(browser, base, out) {
  const checks = [];
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const requests = [];
  const problems = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => {
    const line = `console ${m.type()}: ${m.text()}`;
    if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(line)) problems.push(line);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("worker", (w) => w.on("console", (m) => { if (m.type() === "error") problems.push(`worker console: ${m.text()}`); }));
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  const windows = { host: [], guest: [] };
  for (const u of clip.utterances) windows[u.who].push([u.start, u.end]);
  await page.evaluate((arg) => window.__voices(arg), { wav: readFileSync(`${fixture}.wav`).toString("base64"), windows });

  await page.locator("#speechBtn").click();
  await page.waitForFunction(() => /ready|failed/.test(document.querySelector("#speechTxt").textContent), null, { timeout: 120000 });
  assert.equal(await text(page, "speechBtn"), "Speech ready", "two voices: the model loads");
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#micBtn").click();
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await page.locator("#tabBtn").click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  const shot = join(out, "speech-two-voices-setup.png");
  await page.screenshot({ path: shot });
  const beforeListening = requests.length;
  await page.locator("#goBtn").click();
  const clipStart = await page.evaluate(() => window.__watch.voices.start());
  assert.equal(await text(page, "listenTxt"), "Listening · host mic + guest tab", "two voices: the sign names both sources");
  const liveShot = join(out, "speech-two-voices-listening.png");
  await page.screenshot({ path: liveShot });

  // Both meters move, each with its own speaker: sample them while the clip plays.
  const peaks = { mic: 0, tab: 0 };
  const clipEnd = clipStart + clip.seconds * 1000;
  while (await page.evaluate((end) => performance.now() < end, clipEnd)) {
    const now = await page.evaluate(() => [Number(document.querySelector("#micMeter").getAttribute("aria-valuenow")), Number(document.querySelector("#tabMeter").getAttribute("aria-valuenow"))]);
    peaks.mic = Math.max(peaks.mic, now[0]);
    peaks.tab = Math.max(peaks.tab, now[1]);
    await page.waitForTimeout(150);
  }
  assert.ok(peaks.mic >= 20 && peaks.tab >= 20, `two voices: both meters moved (microphone up to ${peaks.mic} %, tab up to ${peaks.tab} %)`);
  await page.waitForTimeout(6000);
  const all = await page.evaluate(() => window.__watch.messages);
  const texts = all.filter((m) => m.type === "text").map((m) => ({ ...m, at: (m.arrived - clipStart) / 1000 }));
  assert.ok(texts.every((m) => m.source === "host" || m.source === "guest"), "two voices: every text carries a source, host or guest");
  assert.ok(all.filter((m) => m.type === "pause").every((m) => m.source === "host" || m.source === "guest"), "and every pause");
  const result = {};
  for (const who of ["host", "guest"]) {
    const spoken = clip.utterances.filter((u) => u.who === who);
    const mine = texts.filter((m) => m.source === who);
    const finals = mine.filter((m) => m.final && m.at <= clip.seconds + 6);
    const score = wordErrors(spoken, finals);
    const delay = delays(spoken, mine);
    result[who] = { score, delay, finals: finals.length };
    assert.ok(finals.length >= spoken.length, `two voices: ${who}: at least one text for each of its ${spoken.length} sentences (${finals.length})`);
    assert.ok(score.rate <= TARGET.wordErrors, `two voices: ${who}: word errors ${(score.rate * 100).toFixed(1)} % (${score.errors} of ${score.words}), at most ${TARGET.wordErrors * 100} %, against its own sentences only`);
    assert.ok(delay.middle < TARGET.middleDelay, `two voices: ${who}: middle delay ${delay.middle.toFixed(2)} s, under ${TARGET.middleDelay} s with both sources running`);
    // Crossed over? Each source's text read against the OTHER speaker's sentences must be far worse than against its own.
    const other = wordErrors(clip.utterances.filter((u) => u.who !== who), finals);
    assert.ok(other.rate > 0.7, `two voices: ${who}: its text is not the other speaker's (${(other.rate * 100).toFixed(0)} % errors against them)`);
  }
  writeFileSync(join(out, "speech-two-voices.json"), JSON.stringify(result, null, 1));
  checks.push(`two voices: host turns on the microphone and guest turns on the tab, both listened to at once: host ${(result.host.score.rate * 100).toFixed(1)} % word errors (middle delay ${result.host.delay.middle.toFixed(2)} s), guest ${(result.guest.score.rate * 100).toFixed(1)} % (${result.guest.delay.middle.toFixed(2)} s), every text labelled with its own source, none crossed over`);

  assert.deepEqual(requests.slice(beforeListening).map((r) => r.url), [], "two voices: no request while listening");
  assert.equal(await page.evaluate(() => window.__watch.speakers), 0, "two voices: nothing is joined to the speakers");
  assert.equal(await page.locator("audio, video").count(), 0, "two voices: no sound element");
  assert.deepEqual(problems, [], "two voices: no console error, warning or policy violation");
  checks.push("two voices: no request while listening to both sources, nothing joined to the speakers");

  // Races around Listen's tab picker, on the same page (the model and both sources already worked).
  const stop = page.locator("#stopBtn");
  const listening = () => page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
  const sharesNow = () => page.evaluate(() => window.__watch.shares.length);
  const lastEnded = (count) => page.waitForFunction((n) => window.__watch.shares.length === n && window.__watch.shares.at(-1).getTracks().every((t) => t.readyState === "ended"), count);
  // 1. Stop while the picker is open: what the browser hands over afterwards is let go, and nothing shows as shared.
  await stop.click();
  await page.evaluate(() => { window.__watch.hold = true; });
  await stop.click();
  await listening();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "busy");
  const beforeHeld = await sharesNow();
  await stop.click();
  assert.equal(await text(page, "listenTxt"), "Not listening", "races: Stop with the picker open stops the sign");
  await page.evaluate(() => { window.__watch.hold = false; window.__watch.release(); });
  await lastEnded(beforeHeld + 1);
  assert.equal(await page.locator("#tabBtn").getAttribute("data-state"), null, "races: a tab picked after Stop is not shown as shared");
  assert.equal(await text(page, "listenTxt"), "Not listening", "races: and the sign stays Not listening");
  // 1b. The picker closed without a pick after Stop: nothing shows as failed on a page that has stopped.
  await page.evaluate(() => { window.__watch.share = "cancel"; window.__watch.hold = true; });
  await stop.click();
  await listening();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "busy");
  await stop.click();
  await page.evaluate(() => { window.__watch.hold = false; window.__watch.release(); });
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#tabBtn").getAttribute("data-state"), null, "races: a cancel that comes after Stop shows no failure");
  assert.equal(await text(page, "listenTxt"), "Not listening", "races: and the sign stays Not listening");
  // 2. A share that fails during Listen: listening goes on with the host's mic and the sign says how to get the tab.
  for (const mode of ["cancel", "window"]) {
    await page.evaluate((m) => { window.__watch.share = m; }, mode);
    await stop.click();
    await listening();
    await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "error");
    assert.equal(await text(page, "listenTxt"), "Listening · host mic", `races: ${mode}: listening goes on with the host's mic`);
    assert.equal(await page.locator("#listenTxt").getAttribute("data-tip"), "Host mic only: the guest tab is not shared. Press Stop, then Listen to pick it again.", `races: ${mode}: the sign says how to get the tab`);
    await stop.click();
  }
  await page.evaluate(() => { window.__watch.share = "tab"; });
  await stop.click();
  await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true" && document.querySelector("#listenSrc").textContent === "host mic + guest tab");
  // 3. The tab answers before a slow microphone: the Listen button stays busy, a second press does nothing, one microphone opens.
  await stop.click();
  await page.evaluate(() => { window.__watch.micHold = true; });
  const mics = await page.evaluate(() => window.__watch.streams.length);
  await stop.click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  assert.equal(await stop.getAttribute("data-state"), "busy", "races: the Listen button stays busy while the microphone is awaited");
  await stop.click();
  await page.evaluate(() => { window.__watch.micHold = false; window.__watch.micRelease(); });
  await listening();
  assert.equal(await page.evaluate(() => window.__watch.streams.length), mics + 1, "races: a second press while waiting opened no second microphone");
  await stop.click();
  assert.ok(await page.evaluate(() => [...window.__watch.streams, ...window.__watch.shares].every((s) => s.getTracks().every((t) => t.readyState === "ended"))), "races: Stop ends every microphone and tab");
  // 4. Listen fails at once (microphone blocked) while its picker is open; a second Listen waits for the same picker: the tab
  // the first press asked for is kept for the second, not cleaned up behind it.
  await page.evaluate(() => { window.__watch.hold = true; window.__watch.fail = "NotAllowedError"; });
  await stop.click();
  await page.waitForFunction(() => document.querySelector("#stopBtn").dataset.state === "error");
  await page.evaluate(() => { window.__watch.fail = null; window.__watch.micHold = true; });
  await stop.click();
  await page.waitForFunction(() => document.querySelector("#stopBtn").dataset.state === "busy");
  await page.evaluate(() => { window.__watch.hold = false; window.__watch.release(); });
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  await page.evaluate(() => { window.__watch.micHold = false; window.__watch.micRelease(); });
  await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true" && document.querySelector("#listenSrc").textContent === "host mic + guest tab");
  await stop.click();
  // 5. A Listen that failed, then the model fails, then the host sets it all up again: Stop reads Stop, with no old failure.
  await page.evaluate(() => { window.__watch.fail = "NotAllowedError"; });
  await stop.click();
  await page.waitForFunction(() => document.querySelector("#stopBtn").dataset.state === "error");
  await page.evaluate(() => window.__watch.workers.at(-1).dispatchEvent(new MessageEvent("message", { data: { type: "error", reason: "the check broke the model" } })));
  assert.equal(await page.locator("#setup").isVisible(), true, "races: the setup comes back after a model failure");
  await page.evaluate(() => { window.__watch.fail = null; });
  await page.locator("#micBtn").click();
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await page.locator("#tabBtn").click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  await page.locator("#speechBtn").click();
  await page.waitForFunction(() => document.querySelector("#speechTxt").textContent === "Speech ready", null, { timeout: 60000 });
  await page.locator("#goBtn").click();
  assert.deepEqual([await text(page, "stopBtn"), await stop.getAttribute("data-state"), await stop.getAttribute("data-tip")], ["Stop", null, null], "races: after a failed Listen and a model failure, Stop reads Stop with no old failure");
  await stop.click();
  checks.push("races: Stop while the tab picker is open lets the late tab go; a share that fails during Listen leaves listening on with the way back in the sign's tooltip; the Listen button stays busy until the microphone answers");
  assert.deepEqual(problems, [], "races: no console error, warning or policy violation");
  await context.close();
  return { shots: [shot, liveShot], checks };
}

// What a failed or unwanted tab share looks like on the setup's tab button: a closed picker, a tab that came without
// sound and a window each say so on the button, readable as painted, with the way out in the tooltip, and the share
// that came is let go; pressing a shared tab's button stops sharing; the guest's No or Solo show stops it at once, even
// while the picker is still open.
async function tabFailures(browser, base, out) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  const btn = page.locator("#tabBtn");
  const label = () => text(page, "tabTxt");
  const ended = () => page.evaluate(() => window.__watch.shares.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
  const shots = [];
  for (const [mode, words, tip] of [
    ["cancel", "Tab not shared · try again", /^The browser did not share a tab\. Press again, pick a browser tab and tick "Also share tab audio"\.$/],
    ["silent", "No tab sound · try again", /^The tab came without sound\. Press again and tick "Also share tab audio"\.$/],
    ["window", "Share a browser tab · try again", /^A window or a whole screen was shared\. Press again and pick a browser tab\.$/],
  ]) {
    await page.evaluate((m) => { window.__watch.share = m; }, mode);
    await btn.click();
    await page.waitForFunction((t) => document.querySelector("#tabTxt").textContent === t, words);
    assert.equal(await btn.getAttribute("data-state"), "error", `${mode}: the button shows the failure`);
    assert.match(await btn.getAttribute("data-tip"), tip, `${mode}: with the way out`);
    assert.equal(await page.locator("#tabMeter").isHidden(), true, `${mode}: no tab meter`);
    assert.ok(await ended(), `${mode}: whatever the browser handed over is let go`);
    const contrast = await paintedContrast(page, "#tabBtn", ".steps");
    assert.ok(contrast >= 4.5, `${mode}: the failure reads at ${contrast.toFixed(2)}:1 as painted`);
    const shot = join(out, `speech-tab-${mode}.png`);
    const r = await page.locator("#sSound").boundingBox();
    await page.screenshot({ path: shot, clip: { x: 0, y: Math.max(0, r.y - 8), width: 1366, height: r.height + 20 } });
    shots.push(shot);
  }

  // A share that works after a failure; pressing the shared tab's button stops sharing.
  await page.evaluate(() => { window.__watch.share = "tab"; });
  await btn.click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  assert.equal(await label(), "Restream Studio tab", "a share that works shows the studio's name");
  await page.getByRole("button", { name: "Wave.video", exact: true }).click();
  assert.equal(await label(), "Wave.video tab", "the name follows the studio picked in step 1");
  const okShot = join(out, "speech-tab-shared.png");
  const row = await page.locator("#sSound").boundingBox();
  await page.screenshot({ path: okShot, clip: { x: 0, y: Math.max(0, row.y - 8), width: 1366, height: row.height + 20 } });
  shots.push(okShot);
  await btn.click();
  assert.equal(await label(), "Share the studio tab with sound", "pressing a shared tab's button stops sharing");
  assert.ok(await ended(), "and ends its tracks");
  assert.equal(await page.locator("#tabMeter").isHidden(), true, "and its meter goes");

  // No and Solo show stop a shared tab at once.
  for (const [answer, reason] of [["No · my mic only", "Your guest said no: only your microphone is listened to."], ["Solo show", "Solo show: no guest to hear."]]) {
    await page.getByRole("button", { name: "Yes", exact: true }).click();
    await btn.click();
    await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
    await page.getByRole("button", { name: answer, exact: true }).click();
    assert.ok(await ended(), `${answer}: the shared tab stops at once`);
    assert.equal(await btn.getAttribute("aria-disabled"), "true", `${answer}: and the button is switched off`);
    assert.equal(await btn.getAttribute("data-tip"), reason, `${answer}: with its reason`);
    assert.equal(await page.locator("#tabMeter").isHidden(), true, `${answer}: and its meter goes`);
  }

  // OBS has no studio tab: picking it stops a shared tab at once and switches the button off with its reason; the open
  // button does not wait for it.
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await btn.click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  await page.getByRole("button", { name: "OBS", exact: true }).click();
  assert.ok(await ended(), "OBS: the shared tab stops at once");
  assert.equal(await btn.getAttribute("aria-disabled"), "true", "OBS: the tab button is switched off");
  assert.equal(await btn.getAttribute("data-tip"), "No tab sound with OBS: it has no studio tab to share. Only your microphone is listened to.", "OBS: with its reason");
  assert.equal(await page.locator("#sSound").evaluate((el) => el.hasAttribute("data-done")), false, "OBS: the Sound step waits for the microphone only (not on yet)");
  await page.getByRole("button", { name: "Restream Studio", exact: true }).click();
  assert.equal(await btn.getAttribute("aria-disabled"), null, "back on Restream Studio the tab button is ready again");

  // A picker closed after the host changed the answer to No and back to Yes: no old failure is left on the button.
  await page.evaluate(() => { window.__watch.share = "cancel"; window.__watch.hold = true; });
  await btn.click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "busy");
  await page.getByRole("button", { name: "No · my mic only", exact: true }).click();
  await page.evaluate(() => { window.__watch.hold = false; window.__watch.release(); });
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  assert.equal(await btn.getAttribute("data-state"), null, "No then Yes around a closed picker: no failure is left on the button");
  assert.equal(await label(), "Share the studio tab with sound", "and it reads as ready");
  await page.evaluate(() => { window.__watch.share = "tab"; });

  // The same while the browser's picker is still open: the answer wins, and what the browser hands over is let go.
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.evaluate(() => { window.__watch.hold = true; });
  await btn.click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "busy");
  assert.equal(await label(), "Pick the tab…", "while the picker is open the button says so");
  await page.getByRole("button", { name: "No · my mic only", exact: true }).click();
  await page.evaluate(() => { window.__watch.hold = false; window.__watch.release(); });
  await page.waitForFunction(() => window.__watch.shares.at(-1)?.getTracks().every((t) => t.readyState === "ended"));
  assert.equal(await btn.getAttribute("aria-disabled"), "true", "No while the picker was open: the button ends up switched off");
  assert.equal(await page.locator("#tabMeter").isHidden(), true, "and no meter shows");
  await context.close();
  return shots;
}

// Chromium's own tab sharing, with no stand-in: the picker is answered by the browser (the tab titled Studio, sound on),
// so this proves the options the page asks with are accepted by a real browser and the stream it hands back is read right:
// one browser-tab surface with one audio track, shown on the button, and ended when the button is pressed again.
async function realPicker(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const studio = await context.newPage();
  await studio.goto("data:text/html,<title>Studio</title><h1>studio</h1>");
  const page = await context.newPage();
  const problems = [];
  // Chromium logs "camera is not allowed" on any screen share when the page's policy forbids the camera (it checks the
  // picture request against that policy), yet the share works: the one known message, kept out of the problems.
  const KNOWN_SHARE_ERROR = /^console error: Permissions policy violation: camera is not allowed in this document\.$/;
  page.on("console", (m) => {
    const line = `console ${m.type()}: ${m.text()}`;
    if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(line) && !KNOWN_SHARE_ERROR.test(line)) problems.push(line);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.addInitScript(() => {
    const media = navigator.mediaDevices;
    const real = media.getDisplayMedia.bind(media);
    window.__real = [];
    media.getDisplayMedia = async (options) => { const stream = await real(options); window.__real.push(stream); return stream; };
  });
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#tabBtn").click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok" || document.querySelector("#tabBtn").dataset.state === "error", null, { timeout: 15000 });
  assert.equal(await text(page, "tabBtn"), "Restream Studio tab", "a real share is read right and shown on the button");
  const facts = await page.evaluate(() => ({ audio: window.__real[0].getAudioTracks().length, surface: window.__real[0].getVideoTracks()[0].getSettings().displaySurface }));
  assert.deepEqual(facts, { audio: 1, surface: "browser" }, "the browser gave one browser tab with its sound");
  await page.locator("#tabBtn").click();
  assert.ok(await page.evaluate(() => window.__real[0].getTracks().every((t) => t.readyState === "ended")), "pressing the button again ends the real share");
  assert.deepEqual(problems, [], "no console error or warning besides the two known ones");
  await context.close();
}

export async function run({ playwright, base, dist, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);
  const manifest = JSON.parse(readFileSync(join(dist, "speech/manifest.json"), "utf8"));
  assert.ok(manifest.files.every((f) => f.parts.length), "the build holds the speech model");

  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${fixture}.wav`, "--autoplay-policy=no-user-gesture-required", "--auto-select-tab-capture-source-by-title=Studio"],
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
    assert.deepEqual(steps, ["I stream with", "AI agent", "Show, questions & plan", "Guest agreed", "Sound", "Speech to text"], "the steps that exist, in order");
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
    ok(`sound: the microphone turns on and its meter moves (up to ${loudest} %)`);

    // The studio tab's sound: the open button waits for it (a guest who said yes is heard through it); the browser is
    // asked for a tab only, with no echo processing and a tiny picture; the button names the studio; its meter moves
    // with the tab's sound, apart from the microphone's.
    assert.equal(await go.getAttribute("data-tip"), "Share the studio tab with sound first.", "the open button waits for the tab sound");
    assert.equal(await page.locator("#sSound").evaluate((el) => el.hasAttribute("data-done")), false, "the Sound step is not done without it");
    await page.locator("#tabBtn").click();
    await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
    assert.equal(await text(page, "tabBtn"), "Restream Studio tab", "the shared tab shows on its button, named for the studio");
    const asked = await page.evaluate(() => window.__watch.shareOptions[0]);
    assert.deepEqual([asked.systemAudio, asked.selfBrowserSurface, asked.surfaceSwitching, asked.monitorTypeSurfaces], ["exclude", "exclude", "exclude", "exclude"], "only a browser tab is offered");
    assert.deepEqual(asked.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, "no echo processing on a tab's sound");
    assert.deepEqual([asked.video.frameRate.ideal, asked.video.width.ideal, asked.video.height.ideal], [2, 320, 180], "and a tiny, slow picture");
    assert.equal(await page.locator("#tabMeter").isVisible(), true, "the tab meter shows");
    assert.equal(await page.locator("#sSound").evaluate((el) => el.hasAttribute("data-done")), true, "the Sound step is done");
    assert.equal(await go.getAttribute("aria-disabled"), null, "every step is done: the open button is on");
    // The tab meter moves with the tab's own sound, not the microphone's (the clip plays on the microphone all the time).
    await page.evaluate(() => { window.__watch.tabGain.gain.value = 0.5; });
    let tabLoudest = 0;
    for (let i = 0; i < 30 && tabLoudest < 20; i++) {
      tabLoudest = Math.max(tabLoudest, Number(await page.locator("#tabMeter").getAttribute("aria-valuenow")));
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => { window.__watch.tabGain.gain.value = 0; });
    assert.ok(tabLoudest >= 20, `the tab meter moves with the tab's sound (up to ${tabLoudest} %)`);
    await page.waitForFunction(() => Number(document.querySelector("#tabMeter").getAttribute("aria-valuenow")) < 5, null, { timeout: 5000 });
    const setupShot = join(out, "speech-setup-ready.png");
    await page.screenshot({ path: setupShot });
    screenshots.push(setupShot);
    ok(`tab sound: the open button waits for it; only a tab is asked for; the button names the studio; its meter moves apart from the microphone's (up to ${tabLoudest} %)`);

    // Open producer screen: listening at once, with the sign.
    const beforeListening = requests.length;
    await go.click();
    assert.equal(await page.locator("#setup").isHidden(), true, "the setup makes way for the producer screen");
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "true", "the sign says listening");
    assert.equal(await text(page, "listenTxt"), "Listening · host mic + guest tab", "and what it hears: the host's mic and the guest's tab");
    assert.equal(await text(page, "guestChip"), "Guest ✓", "and the guest's answer");
    assert.equal(await text(page, "stopBtn"), "Stop", "with Stop beside it");
    const liveShot = join(out, "speech-listening.png");
    await page.screenshot({ path: liveShot });
    screenshots.push(liveShot);
    ok("live: the sign shows Listening · host mic + guest tab, Guest ✓ and Stop");

    // Let the whole clip play once (it began when the microphone opened), then read what came back.
    const micAt = await page.evaluate(() => window.__watch.micAt);
    const clipEnd = micAt + clip.seconds * 1000;
    await page.waitForFunction((end) => performance.now() > end, clipEnd, { timeout: (clip.seconds + 30) * 1000, polling: 500 });
    const messages = (await page.evaluate(() => window.__watch.messages)).filter((m) => m.type === "text").map((m) => ({ ...m, at: (m.arrived - micAt) / 1000 }));
    const finals = messages.filter((m) => m.final && m.at <= clip.seconds);
    const score = wordErrors(clip.utterances, finals);
    const delay = delays(clip.utterances, messages.filter((m) => m.at <= clip.seconds));
    const pauses = (await page.evaluate(() => window.__watch.messages)).filter((m) => m.type === "pause").length;
    // The tab was silent all along: whatever came back is the host's, and the guest source made no text.
    assert.deepEqual([...new Set((await page.evaluate(() => window.__watch.messages)).filter((m) => m.type === "text").map((m) => m.source))], ["host"], "every text is labelled host: the silent tab made none");
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
    const everyEnded = () => page.evaluate(() => [...window.__watch.streams, ...window.__watch.shares].every((s) => s.getTracks().every((t) => t.readyState === "ended")));
    assert.ok(await everyEnded(), "Stop ends every microphone and tab track at once");
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "false", "the sign says not listening");
    assert.equal(await text(page, "listenTxt"), "Not listening", "in words");
    assert.equal(await text(page, "stopBtn"), "Listen", "and offers Listen");
    const stopShot = join(out, "speech-stopped.png");
    await page.screenshot({ path: stopShot });
    screenshots.push(stopShot);
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
    assert.equal(await text(page, "stopBtn"), "Stop", "Listen starts the microphone again");
    // The browser asks again for the tab (it never remembers a share), so Listen asks for both in one press.
    await page.waitForFunction(() => document.querySelector("#listenSrc").textContent === "host mic + guest tab");
    assert.equal(await page.evaluate(() => window.__watch.shares.length), 2, "Listen asked the browser for the tab again");
    await page.locator("#stopBtn").click();
    const allEnded = everyEnded;
    assert.ok(await allEnded(), "and Stop ends them again");
    ok("stop: the microphone and the tab end at once, the sign says Not listening, Listen starts both again");

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
    await page.waitForFunction(() => window.__watch.shares.length >= 3 && window.__watch.shares.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
    await page.evaluate(() => { window.__watch.fail = null; });
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
    assert.equal(await text(page, "stopBtn"), "Stop", "pressed again, it listens");
    ok("listen: a blocked microphone shows on Listen with its way out, and a tab picked meanwhile is let go; pressed again, it listens");

    // The tab ending by itself (the host's "Stop sharing" in the browser, or the tab closing) shows at once and listening
    // goes on with the host's mic; Stop and Listen then ask for the tab again.
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true" && document.querySelector("#listenSrc").textContent === "host mic + guest tab");
    await page.evaluate(() => window.__watch.shares.at(-1).getTracks()[0].dispatchEvent(new Event("ended")));
    assert.equal(await text(page, "listenTxt"), "Listening · host mic", "a tab that ends by itself leaves the host's mic in the sign");
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "true", "and listening goes on");
    assert.equal(await page.locator("#listenTxt").getAttribute("data-tip"), "Host mic only: the guest tab is not shared. Press Stop, then Listen to pick it again.", "the tooltip says so, with the way back");
    assert.ok(await page.evaluate(() => window.__watch.shares.at(-1).getTracks().every((t) => t.readyState === "ended")), "its tracks are ended");
    await page.locator("#stopBtn").click();
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true" && document.querySelector("#listenSrc").textContent === "host mic + guest tab");
    ok("tab: a tab that ends by itself leaves the sign at host mic while listening goes on; Stop then Listen share it again");

    // The microphone ending by itself (unplugged, or the permission taken back) stops the sign at once, and the tab with it.
    await page.evaluate(() => window.__watch.streams.at(-1).getAudioTracks()[0].dispatchEvent(new Event("ended")));
    assert.equal(await page.locator("#listen").getAttribute("data-on"), "false", "an ended microphone: the sign says Not listening");
    assert.ok(await allEnded(), `and every track is ended, the tab's too (${JSON.stringify(await page.evaluate(() => [...window.__watch.streams.map((s) => ["mic", s.getTracks().map((t) => t.readyState)]), ...window.__watch.shares.map((s) => ["tab", s.getTracks().map((t) => t.readyState)])]))})`);
    ok("listen: a microphone that ends by itself stops the sign");

    // Still nothing left the page, over every listening stretch above (after Stop, a failed Listen and an ended microphone).
    assert.deepEqual(requests.slice(beforeListening).map((r) => r.url), [], "no request over any listening stretch");

    // The speech model failing on the producer screen: the microphone and the tab stop and the setup comes back, with the
    // failed speech button and its reason, so the sign never shows listening while nothing turns into text.
    await page.locator("#stopBtn").click();
    await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
    await page.evaluate(() => window.__watch.workers.at(-1).dispatchEvent(new MessageEvent("message", { data: { type: "error", reason: "the check broke the model" } })));
    assert.ok(await allEnded(), "the microphone stops, and the tab with it");
    assert.equal(await page.locator("#setup").isVisible(), true, "the setup comes back");
    assert.equal(await page.locator("#topLive").isHidden(), true, "and the sign goes with the producer screen");
    assert.equal(await text(page, "speechBtn"), "Speech model failed · try again", "the speech button says it failed");
    assert.equal(await page.locator("#speechBtn").getAttribute("data-tip"), "The check broke the model.", "with the reason");
    assert.equal(await page.locator("#goBtn").getAttribute("data-tip"), "Turn on the microphone first.", "and the open button waits again");
    assert.equal(await page.locator("#tabBtn").getAttribute("data-state"), null, "the tab button is plain again");
    ok("speech: a model failure on the producer screen stops the microphone and the tab and brings back the setup with the reason");

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
    const modelFiles = manifest.files.filter((f) => !/\.m?js$/.test(f.path)).map((f) => `/speech/${f.path}`).sort();
    assert.deepEqual(kept.files, modelFiles, "holding the model files and the engine's WebAssembly only (its scripts load as scripts)");
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

    const voices = await twoVoices(browser, base, out);
    screenshots.push(...voices.shots);
    for (const line of voices.checks) ok(line);

    await realPicker(browser, base);
    ok("real picker: Chromium's own tab sharing accepts what the page asks and hands back one browser tab with its sound, read right and ended on a second press");

    screenshots.push(...await tabFailures(browser, base, out));
    ok("tab failures: a closed picker, a tab without sound and a window each say so on the tab button with the way out; pressing it again stops the share; No or Solo show stops it, even while the picker is open");

    const fox = await playwright.firefox.launch({ headless: true, firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } });
    try {
      for (const v of VIEWS) {
        screenshots.push(...await view(v[1] === "firefox" ? fox : browser, base, out, v));
        ok(`${v[0]}: the model loads, "${v[3]}", the sign reads Listening · ${v[5] ? "host mic + guest tab" : "host mic"}${v[4] ? ` with ${v[4]}` : " without a guest chip"} and fits; Stop ends the microphone${v[5] ? " and the tab" : ""}`);
      }
    } finally {
      await fox.close();
    }
  } finally {
    await browser.close();
  }
  return { checks, screenshots };
}
