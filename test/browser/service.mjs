// Browser checks for `kit specs service`: the browser's own speech service (the Web Speech API) as the opt-in second
// way to turn speech into text, in a real Chromium served through the real Worker. The service itself is a stand-in
// the checks put in before the page runs (the real one sends the sound to Google, which a check must never do), so
// what is checked is the page: the opt-in, the track it hands over, the listening sign, Stop and Listen, the plain
// failure, switching back to the model on this computer, and that nothing is stored and nothing is requested.
// The microphone is Chromium's fake capture device. The real service's delay and accuracy are for a person to judge
// in Chrome (the service was not measured in the TOOLS-150 test; its delay and accuracy are still to be judged).
import assert from "node:assert/strict";
import { join } from "node:path";

// A narrow window with a touch screen on a computer's browser (the service is offered on computers only, so a phone's own
// browser is not used here; the page suite checks that a phone shows it off).
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 };
// [name, context options]: wide in light, a phone in dark, and the narrowest phone.
const VIEWS = [
  ["desktop-light", { viewport: { width: 1366, height: 900 }, colorScheme: "light" }],
  ["narrow-dark", { ...PHONE, colorScheme: "dark" }],
  ["narrow-320", { ...PHONE, viewport: { width: 320, height: 640 }, colorScheme: "light" }],
];
const WARNING = "Browser service · audio goes to Google";
const SIGN_TIP = "Browser service: your voice goes to Google to become text.";

// Before the page runs: a stand-in speech service that remembers what the page did to it, a log of every microphone
// stream and of every Worker the page starts, and anything joined to the speakers. The stand-in never sends anything.
function watch() {
  window.__service = { made: [] };
  class Recognition {
    constructor() { this.log = []; window.__service.made.push(this); }
    start(track) {
      if (window.__service.failStart) throw new DOMException("refused for the check", "InvalidStateError");
      this.log.push({ type: "start", isTrack: track instanceof MediaStreamTrack, kind: track?.kind, id: track?.id });
    }
    abort() { this.log.push({ type: "abort" }); }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = Recognition;
  window.__watch = { streams: [], workers: 0, speakers: 0, shares: 0, tabs: [], hold: false, release: null, reject: false };
  const W = window.Worker;
  window.Worker = class extends W { constructor(...args) { super(...args); window.__watch.workers++; } };
  const media = navigator.mediaDevices;
  const open = media.getUserMedia.bind(media);
  media.getUserMedia = async (...args) => {
    const stream = await open(...args);
    window.__watch.streams.push(stream);
    return stream;
  };
  // A stand-in for the browser's tab picker: a tab with a sound track and a tiny picture. With hold set it waits, as the
  // real picker does while the host chooses, until release() is called.
  media.getDisplayMedia = async () => {
    window.__watch.shares++;
    if (window.__watch.reject) throw new DOMException("refused for the check", "NotAllowedError");
    const context = new AudioContext();
    const sound = context.createMediaStreamDestination();
    const tone = context.createOscillator();
    tone.connect(sound);
    tone.start();
    const canvas = Object.assign(document.createElement("canvas"), { width: 32, height: 32 });
    canvas.getContext("2d").fillRect(0, 0, 1, 1);
    const stream = new MediaStream([...sound.stream.getAudioTracks(), ...canvas.captureStream(2).getVideoTracks()]);
    window.__watch.tabs.push(stream);
    if (window.__watch.hold) await new Promise((go) => { window.__watch.release = go; });
    return stream;
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    if (target instanceof AudioDestinationNode) window.__watch.speakers++;
    return connect.call(this, target, ...rest);
  };
  document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`));
}
// Chromium names the page's audio tap (ScriptProcessorNode) as deprecated; it is kept on purpose (see speech.mjs).
const KNOWN_WARNING = /^console warning: The ScriptProcessorNode is deprecated\./;

const text = (page, id) => page.locator(`#${id}`).evaluate((el) => el.innerText.replace(/\s+/g, " ").trim());
const sessions = (page) => page.evaluate(() => window.__service.made.map((r) => r.log));
const allEnded = (page) => page.evaluate(() => window.__watch.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")));
/** What the service would send back: one result, as the browser shapes it. */
const say = (page, words, isFinal = true) => page.evaluate(([w, f]) => {
  const r = window.__service.made.at(-1);
  r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: w }], { isFinal: f })] });
}, [words, isFinal]);

async function one(browser, base, out, [name, options]) {
  const touch = Boolean(options.hasTouch);
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const requests = [];
  const problems = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("websocket", (ws) => problems.push(`a WebSocket opened: ${ws.url()}`));
  page.on("console", (m) => {
    const line = `console ${m.type()}: ${m.text()}`;
    if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(line)) problems.push(line);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  const press = (locator) => (touch ? locator.tap() : locator.click());
  const shots = [];
  const shot = async (label, fullStep = false) => {
    const path = join(out, `service-${name}-${label}.png`);
    await page.screenshot({ path, ...(fullStep ? {} : { clip: { x: 0, y: 0, width: options.viewport.width, height: 120 } }) });
    shots.push(path);
  };

  // The opt-in: the model is picked on arrival; picking the service is the choice, and its one warning line is on it.
  assert.equal(await page.locator('#engineSeg [aria-pressed="true"]').innerText(), "On this computer", `${name}: the model on this computer is the default`);
  await press(page.getByRole("button", { name: "Yes", exact: true }));
  await press(page.locator("#micBtn"));
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await press(page.locator("#browserChoice"));
  assert.equal(await page.locator('#engineSeg [aria-pressed="true"]').innerText(), WARNING, `${name}: the service is picked, with its warning on the choice`);
  assert.equal(await page.locator("#goBtn").getAttribute("aria-disabled"), null, `${name}: with the guest, the microphone and the service, the open button is on (no tab to share)`);
  // The warning about the guest reaches the host on the choice itself (the tab button's own reason, on a phone, is the browser's).
  const tip = await page.locator("#browserChoice").getAttribute("data-tip");
  assert.match(tip, /guest/, `${name}: for a guest who said yes the choice's tooltip names the guest`);
  assert.match(tip, /headphones/, `${name}: and the way out`);
  // The service hears the host's microphone only, so the guest's tab sound is never offered to it: the tab button is off
  // with its reason (on a phone the browser's own reason comes first, which is also off). With the model it is back.
  assert.equal(await page.locator("#tabBtn").getAttribute("aria-disabled"), "true", `${name}: the tab-sound button is switched off`);
  if (!touch) assert.equal(await page.locator("#tabBtn").getAttribute("data-tip"), "Browser service hears your microphone only. Without headphones your guest's voice goes to it too.", `${name}: with the plain reason`);
  await page.mouse.move(0, 0);
  await shot("setup", true);

  // Open producer screen: the sign names the service, its tooltip says where the voice goes, and the service listens
  // to the microphone's own track (no second microphone opens), in English, with no model loaded.
  await press(page.locator("#goBtn"));
  assert.equal(await text(page, "listenTxt"), "Listening · host mic · browser service", `${name}: the sign names the service`);
  assert.equal(await page.locator("#listenTxt").getAttribute("data-tip"), SIGN_TIP, `${name}: and its tooltip says the voice goes to Google`);
  const first = await sessions(page);
  assert.equal(first.length, 1, `${name}: one session`);
  assert.deepEqual(first[0].map((e) => [e.type, e.isTrack, e.kind]), [["start", true, "audio"]], `${name}: started with an audio track`);
  const mine = await page.evaluate(() => window.__watch.streams.flatMap((s) => s.getAudioTracks().map((t) => t.id)));
  assert.ok(mine.includes(first[0][0].id), `${name}: the track is the microphone the page already holds`);
  assert.equal(await page.evaluate(() => window.__watch.streams.length), 1, `${name}: only one microphone was opened`);
  assert.equal(await page.evaluate(() => window.__watch.workers), 0, `${name}: the speech model was not started`);
  const box = await page.evaluate(() => {
    const r = document.querySelector("#listen").getBoundingClientRect();
    return { left: r.left, right: r.right, width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  assert.ok(box.left >= 0 && box.right <= box.width && box.scrollWidth <= box.width, `${name}: the sign fits the window, no sideways scroll`);
  await shot("listening");

  // Text from the service arrives without a problem, a draft and then a final piece.
  await say(page, "hello", false);
  await say(page, "Hello there.", true);

  // The browser ending the session by itself (it does after a while) starts a new one on a fresh service.
  await page.evaluate(() => window.__service.made.at(-1).onend());
  assert.equal((await sessions(page)).length, 2, `${name}: a session the browser ends starts again while listening`);

  // Stop: the service is aborted at once and the microphone ends; the sign says so and Listen starts it all again.
  await press(page.locator("#stopBtn"));
  assert.deepEqual((await sessions(page)).at(-1).map((e) => e.type), ["start", "abort"], `${name}: Stop aborts the service at once`);
  assert.ok(await allEnded(page), `${name}: and ends the microphone`);
  assert.equal(await text(page, "listenTxt"), "Not listening", `${name}: the sign says Not listening`);
  assert.equal(await page.locator("#listenTxt").getAttribute("data-tip"), "Not listening. The microphone is off.", `${name}: nothing is sent while not listening`);
  await shot("stopped");
  await press(page.locator("#stopBtn"));
  await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
  const again = await sessions(page);
  assert.equal(again.length, 3, `${name}: Listen starts a new session`);
  assert.deepEqual(again.at(-1).map((e) => [e.type, e.isTrack]), [["start", true]], `${name}: with the new microphone's track`);
  assert.equal(await text(page, "listenTxt"), "Listening · host mic · browser service", `${name}: the sign names the service again`);
  await press(page.locator("#stopBtn"));

  // A service that fails on the producer screen (here: it cannot be reached) stops the microphone and brings the setup
  // back with the reason on the choice itself, back on the model on this computer.
  await press(page.locator("#stopBtn"));
  await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
  await page.evaluate(() => window.__service.made.at(-1).onerror({ error: "network" }));
  assert.ok(await allEnded(page), `${name}: the microphone stops`);
  assert.equal(await page.locator("#setup").isVisible(), true, `${name}: the setup comes back`);
  assert.equal(await page.locator("#topLive").isHidden(), true, `${name}: and the sign goes with the producer screen`);
  assert.equal(await text(page, "browserChoice"), "Browser service failed · audio goes to Google", `${name}: the choice says it failed`);
  assert.equal(await page.locator("#browserChoice").getAttribute("data-tip"), "The browser's speech service could not be reached.", `${name}: with the reason`);
  // Focus lands on the choice with its reason open, so a keyboard or screen-reader host is told why the setup came back.
  await page.waitForFunction(() => document.activeElement?.id === "browserChoice" && document.querySelector("#tip[data-on]")?.textContent === "The browser's speech service could not be reached.", null, { timeout: 5000 }).catch(async () => {
    throw new Error(`${name}: focus should move to the failed choice with its reason open (active: ${await page.evaluate(() => document.activeElement?.id)}, tip: ${await page.evaluate(() => document.querySelector("#tip").textContent + "/" + document.querySelector("#tip").hasAttribute("data-on"))})`);
  });
  assert.equal(await page.locator("#browserChoice").getAttribute("data-state"), "error", `${name}: and the failed look, as the other failed controls have`);
  const painted = await page.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.color = "var(--accent-ink)";
    const want = getComputedStyle(probe).color;
    probe.remove();
    return { want, got: getComputedStyle(document.querySelector("#browserChoice")).color };
  });
  assert.equal(painted.got, painted.want, `${name}: the failed choice is painted in the failed colour (${painted.got})`);
  const failedFit = await page.evaluate(() => {
    const c = document.querySelector("#browserChoice").getBoundingClientRect();
    const r = document.querySelector("#engineSeg").getBoundingClientRect();
    return c.left >= r.left - 0.5 && c.right <= r.right + 0.5 && c.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  });
  assert.ok(failedFit, `${name}: the longest state, the failed label, fits its row and the window`);
  assert.equal(await page.locator('#engineSeg [aria-pressed="true"]').innerText(), "On this computer", `${name}: the model on this computer is picked again`);
  assert.equal(await page.locator("#goBtn").getAttribute("data-tip"), "Turn on the microphone first.", `${name}: and the open button waits again`);
  await shot("failed", true);
  await press(page.locator("#browserChoice"));
  assert.equal(await text(page, "browserChoice"), WARNING, `${name}: picked again, the choice shows its plain warning line again`);
  assert.equal(await page.locator("#browserChoice").getAttribute("data-state"), null, `${name}: and no longer looks failed`);
  assert.equal(await page.locator("#browserChoice .nowrap").innerText(), "audio goes to Google", `${name}: the warning is one unbreakable piece`);

  // Switching back to the model on this computer: the step is not done until the model is loaded, and nothing listens.
  await press(page.locator('#engineSeg [data-v="local"]'));
  assert.equal(await page.locator("#sSpeech").evaluate((el) => el.hasAttribute("data-done")), false, `${name}: switched back, the step waits for the model`);
  assert.equal(await page.locator("#speechBtn").isVisible(), true, `${name}: with its load button`);
  assert.equal((await sessions(page)).at(-1).at(-1).type, "abort", `${name}: no service session is left running`);

  // Up to here no request left the page but the page itself.
  assert.deepEqual(requests, [`${base}/`], `${name}: no request but the page itself while it listened through the service`);

  // The model failing to load while the page listens through the service must not touch that listening: the model is
  // not what turns the speech into text now. (Pressing load starts the model's worker; its manifest is held back, then
  // refused, as a failed download would be.)
  let held = null;
  await page.route("**/speech/manifest.json", (route) => { held = route; });
  await press(page.locator("#speechBtn"));
  await page.waitForFunction(() => document.querySelector("#speechTxt").textContent === "Loading 0%");
  await press(page.locator("#browserChoice"));
  await press(page.locator("#micBtn"));
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await press(page.locator("#goBtn"));
  assert.equal(await text(page, "listenTxt"), "Listening · host mic · browser service", `${name}: listening through the service while the model loads`);
  await page.waitForTimeout(200);
  assert.ok(held, `${name}: the model asked for its manifest`);
  await held.abort();
  await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "error");
  assert.equal(await text(page, "listenTxt"), "Listening · host mic · browser service", `${name}: a model failure leaves the service listening`);
  assert.equal(await page.locator("#live").isVisible(), true, `${name}: and the producer screen open`);
  assert.equal(await allEnded(page), false, `${name}: and the microphone on`);

  // The microphone ending by itself (unplugged, or the permission taken back) stops the sign and the service at once.
  await page.evaluate(() => { const t = window.__watch.streams.at(-1).getAudioTracks()[0]; t.stop(); t.dispatchEvent(new Event("ended")); });
  assert.equal(await text(page, "listenTxt"), "Not listening", `${name}: an ended microphone stops the sign`);
  assert.equal((await sessions(page)).at(-1).at(-1).type, "abort", `${name}: and the service is aborted`);

  // A service the browser refuses to start: Listen brings the setup back with the reason on the choice, the
  // microphone ends and the sign goes.
  await page.evaluate(() => { window.__service.failStart = true; });
  await press(page.locator("#stopBtn"));
  await page.waitForFunction(() => !document.querySelector("#setup").hidden);
  assert.equal(await page.locator("#topLive").isHidden(), true, `${name}: the sign goes with the producer screen`);
  assert.ok(await allEnded(page), `${name}: every microphone track has ended`);
  assert.equal(await text(page, "browserChoice"), "Browser service failed · audio goes to Google", `${name}: the choice says it failed`);
  assert.equal(await page.locator("#browserChoice").getAttribute("data-tip"), "The browser's speech service could not start.", `${name}: with the reason`);
  await page.evaluate(() => { window.__service.failStart = false; });

  // Nothing went out, nothing is kept, nothing plays.
  assert.deepEqual(requests.filter((u) => !u.startsWith(`${base}/speech/`)), [`${base}/`], `${name}: no request but the page, apart from the model's own files from this site`);
  assert.deepEqual(requests.filter((u) => u.startsWith(`${base}/speech/`) && !/\/speech\/(worker|lanes|resample|repeat|segmenter)\.mjs$|\/speech\/manifest\.json$/.test(u)), [], `${name}: and those are only its scripts and its manifest`);
  assert.equal(await page.evaluate(() => window.__watch.speakers), 0, `${name}: nothing is joined to the speakers`);
  const kept = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length }));
  assert.deepEqual(kept, { local: 0, session: 0, cookie: "", databases: 0, caches: 0 }, `${name}: nothing is stored`);
  assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation`);
  await context.close();
  return shots;
}

// The model finishing its load after the host picked the browser service changes nothing: the service stays picked, the
// model's button stays out of the way, and the sign still names the service. (A stand-in worker answers "ready" only when
// told to.)
async function modelReadyLate(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(watch);
  await page.addInitScript(() => {
    window.Worker = class {
      constructor() { this.listeners = []; window.__worker = this; }
      addEventListener(type, fn) { if (type === "message") this.listeners.push(fn); }
      postMessage() {}
      terminate() {}
    };
  });
  await page.goto(`${base}/`);
  await page.locator("#speechBtn").click();
  await page.locator("#browserChoice").click();
  await page.evaluate(() => window.__worker.listeners.forEach((fn) => fn({ data: { type: "ready" } })));
  assert.equal(await page.locator('#engineSeg [aria-pressed="true"]').innerText(), WARNING, "the service stays picked");
  assert.equal(await page.locator("#speechBtn").isVisible(), false, "and the model's button stays out of the way");
  await page.getByRole("button", { name: "Solo show", exact: true }).click();
  await page.locator("#micBtn").click();
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await page.locator("#goBtn").click();
  assert.equal(await text(page, "listenTxt"), "Listening · host mic · browser service", "the sign still names the service");
  await context.close();
}

// A guest's tab that is already shared (or whose picker is still open) when the host picks the browser service is let go:
// the service hears the host's microphone only, so no tab joins, the tab button says why, and a later Listen does not ask
// for a tab again.
async function tabLetGo(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  const tracksEnded = (i) => page.evaluate((n) => window.__watch.tabs[n].getTracks().every((t) => t.readyState === "ended"), i);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#micBtn").click();
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");

  // 1. Shared first, then the service picked.
  await page.locator("#tabBtn").click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  await page.locator("#browserChoice").click();
  assert.ok(await tracksEnded(0), "a shared tab is let go when the browser service is picked");
  assert.equal(await page.locator("#tabBtn").getAttribute("aria-disabled"), "true", "and the tab button is switched off");
  assert.equal(await page.locator("#tabMeter").isHidden(), true, "with no meter for the tab");
  await page.locator("#goBtn").click();
  await page.locator("#stopBtn").click(); // Stop
  await page.locator("#stopBtn").click(); // Listen again
  await page.waitForFunction(() => document.querySelector("#listen").dataset.on === "true");
  assert.equal(await page.evaluate(() => window.__watch.shares), 1, "a later Listen does not ask for a tab again");
  assert.equal(await text(page, "listenTxt"), "Listening · host mic · browser service", "and the sign never says guest tab");
  await page.locator("#stopBtn").click();
  await context.close();
}

// The picker still open when the service is picked: what the picker hands over later is let go, and no tab joins.
// A tab that failed to share leaves no failure behind when the host goes round the browser service and back.
async function staleTabFailure(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.evaluate(() => { window.__watch.reject = true; });
  await page.locator("#tabBtn").click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "error");
  await page.locator("#browserChoice").click();
  await page.locator('#engineSeg [data-v="local"]').click();
  assert.equal(await page.locator("#tabBtn").getAttribute("data-state"), null, "an old tab failure is gone after picking the service and the model again");
  await context.close();
}

async function tabPickerOpen(browser, base) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.evaluate(() => { window.__watch.hold = true; });
  await page.locator("#tabBtn").click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "busy");
  await page.locator("#browserChoice").click();
  await page.evaluate(() => window.__watch.release());
  await page.waitForFunction(() => window.__watch.tabs[0].getTracks().every((t) => t.readyState === "ended"));
  assert.equal(await page.locator("#tabBtn").getAttribute("aria-disabled"), "true", "the tab button stays off");
  assert.equal(await page.locator("#tabMeter").isHidden(), true, "no tab joined after the picker was answered");
  assert.equal(await page.locator("#tabBtn").getAttribute("data-state"), null, "and the button shows no shared tab");
  await context.close();
}

// Which engine gets the microphone's sound: a stand-in for the model's worker answers "ready" and counts the sound the
// page hands it. With the browser service picked none arrives (the sound goes to the service's own track and nowhere
// else); with the model on this computer picked it does.
async function soundGoesToOneEngine(browser, base) {
  const counts = {};
  for (const engine of ["browser", "local"]) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(watch);
    await page.addInitScript(() => {
      window.__sound = 0;
      window.Worker = class {
        constructor() { this.listeners = []; }
        addEventListener(type, fn) { if (type === "message") this.listeners.push(fn); }
        postMessage(message) {
          if (message.type === "load") setTimeout(() => this.listeners.forEach((fn) => fn({ data: { type: "ready" } })), 10);
          if (message.type === "audio") window.__sound++;
        }
        terminate() {}
      };
    });
    await page.goto(`${base}/`);
    await page.locator("#speechBtn").click();
    await page.waitForFunction(() => document.querySelector("#speechTxt").textContent === "Speech ready");
    if (engine === "browser") await page.locator("#browserChoice").click();
    await page.getByRole("button", { name: "Solo show", exact: true }).click();
    await page.locator("#micBtn").click();
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    await page.locator("#goBtn").click();
    await page.waitForTimeout(1200);
    counts[engine] = await page.evaluate(() => window.__sound);
    await context.close();
  }
  assert.equal(counts.browser, 0, "with the browser service picked, no sound goes to the model's worker");
  assert.ok(counts.local > 0, `with the model on this computer picked, the sound goes to its worker (${counts.local} pieces)`);
}

// The warning names the company of the browser that is open: an Edge and a browser that is not named, through the real
// page (a stand-in service in place), the choice, the sign's tooltip and nothing else.
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.3200.12";
const UNNAMED = "Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Mystery/1.0";
async function company(browser, base, [name, userAgent, choice, tip, viewport = { width: 1366, height: 900 }]) {
  const context = await browser.newContext({ viewport, userAgent, ...(viewport.width < 600 ? { hasTouch: true } : {}) });
  const page = await context.newPage();
  await page.addInitScript(watch);
  await page.goto(`${base}/`);
  assert.equal(await text(page, "browserChoice"), choice, `${name}: the choice names who gets the audio`);
  const fit = () => page.evaluate(() => {
    const c = document.querySelector("#browserChoice").getBoundingClientRect();
    const r = document.querySelector("#engineSeg").getBoundingClientRect();
    return c.left >= r.left - 0.5 && c.right <= r.right + 0.5 && c.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth;
  });
  assert.ok(await fit(), `${name}: the choice fits its row and the window`);
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#micBtn").click();
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  if (viewport.width < 600) await page.locator("#browserChoice").tap(); else await page.locator("#browserChoice").click();
  assert.ok(await fit(), `${name}: and still fits once picked`);
  for (const [answer, guestWarned] of [["No · my mic only", true], ["Solo show", false]]) {
    await page.getByRole("button", { name: answer, exact: true }).click();
    const note = await page.locator("#browserChoice").getAttribute("data-tip");
    assert.equal(/headphones/.test(note), guestWarned, `${name}: the choice's tooltip ${guestWarned ? "warns about the guest" : "leaves the guest out"} for "${answer}"`);
  }
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#goBtn").click();
  assert.equal(await page.locator("#listenTxt").getAttribute("data-tip"), tip, `${name}: and so does the sign's tooltip`);
  await context.close();
}

export async function run({ playwright, base, out }) {
  const checks = [];
  const screenshots = [];
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  try {
    for (const view of VIEWS) {
      screenshots.push(...await one(browser, base, out, view));
      checks.push(`${view[0]}: the browser service is an opt-in with its warning on the choice; the sign names it and says where the voice goes; it listens to the microphone's track; Stop and Listen; a failure shows on the choice; switching back works; nothing is requested or stored`);
    }
    await company(browser, base, ["edge", EDGE, "Browser service · audio goes to Microsoft", "Browser service: your voice goes to Microsoft to become text."]);
    await company(browser, base, ["unnamed-320", UNNAMED, "Browser service · audio leaves this computer", "Browser service: your voice leaves this computer to become text.", { width: 320, height: 640 }]);
    await company(browser, base, ["unnamed", UNNAMED, "Browser service · audio leaves this computer", "Browser service: your voice leaves this computer to become text."]);
    checks.push("edge and an unnamed browser: the warning names Microsoft, or says the audio leaves this computer");
    await modelReadyLate(browser, base);
    checks.push("the model finishing its load after the browser service was picked changes nothing");
    await tabLetGo(browser, base);
    await tabPickerOpen(browser, base);
    await staleTabFailure(browser, base);
    checks.push("a tab already shared, or its picker still open, is let go when the browser service is picked, and a later Listen does not ask for it");
    await soundGoesToOneEngine(browser, base);
    checks.push("sound goes to the picked engine only: none to the model's worker with the browser service, some with the model");
  } finally {
    await browser.close();
  }
  return { checks, screenshots };
}
