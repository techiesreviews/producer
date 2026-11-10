// Browser checks for `kit specs demo`: step 3's "Load demo show" (TOOLS-193), in Chromium through the real Worker. Desktop
// 1366x900 and phone 390x844, light and dark. The microphone, the studio tab, the speech worker, the relay (the fake
// agent) are stand-ins (as in the other suites). Time is Playwright's clock.
// Checks: one click puts the made-up demo show in the plan box (host's own format), the top bar, step 3 and the button,
// which says Demo loaded with its counts, readable and inside the screen, and asks nobody (no request, nothing
// stored); the guest, microphone and tab are untouched; the agent reads the demo back with get_context (notes
// included); the host can still edit it (the button goes back, a small edit keeps the notes, another show takes them
// away) and load it again; a fixed plan (the show has started) is not replaced; on the producer screen the demo's
// first question is on the Next question card and its run order runs; End & report shows the demo's run order plan
// against real, its questions not asked and the guest, and the agent's report fills the rest. Made-up names only.
import assert from "node:assert/strict";
import { join } from "node:path";

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];
const KNOWN_WARNING = /^The ScriptProcessorNode is deprecated\./;

// The demo as the host's own plan text (what the plan box holds), and its words on the screen.
const DEMO_TEXT = [
  "Show: Demo show: A small app's first year", "Guest: Demo Guest", "3 min Intro", "8 min The first year", "4 min Wrap-up",
  "1. What made you start building the app?", "2. What did the very first version do?", "3. Who was your first real user?", "4. What went wrong in the first month?",
  "5. How did you decide on the price?", "6. What did you try that nobody wanted?", "7. What would you do differently today?", "8. What is the next big step?",
].join("\n");
const DEMO_NOTES = "Demo notes, made up for trying the screen: the guest is a placeholder. Ask about the early days, the price, and the one thing that went wrong.";
const IDLE = { text: "Load demo show", state: null, off: null, tip: "Fills in a sample show to try the whole screen. Nothing is stored. You can still change it." };
const LOADED = { text: "Demo loaded ✓", state: "ok", off: null, tip: "A sample show, not a real one. Change it in the box, or load your own." };
const REPORT = { topics: ["Why the app got built"], asked: [], clips: [{ at: "0:12", note: "The very first version" }] };

// Stand-ins: the microphone and the studio tab (quiet tones), the speech worker (ready at once), the relay
// (window.__relay.call(tool, args) plays one agent call), the clipboard (window.__copied) and the save picker
// (window.__saved).
function standIns() {
  const tone = () => {
    const context = new AudioContext();
    const osc = context.createOscillator();
    const out = context.createMediaStreamDestination();
    osc.connect(out);
    osc.start();
    return out.stream;
  };
  window.__tracks = [];
  navigator.mediaDevices.getUserMedia = async () => { const s = tone(); window.__tracks.push(...s.getTracks()); return s; };
  navigator.mediaDevices.getDisplayMedia = async () => {
    const video = document.createElement("canvas").captureStream(1).getVideoTracks()[0];
    video.getSettings = () => ({ displaySurface: "browser" });
    const s = new MediaStream([video, ...tone().getAudioTracks()]);
    window.__tracks.push(...s.getTracks());
    return s;
  };
  const RealWorker = window.Worker;
  window.Worker = function Worker(url, options) {
    if (!String(url).includes("/speech/")) return new RealWorker(url, options);
    const fake = new EventTarget();
    fake.emit = (data) => fake.dispatchEvent(new MessageEvent("message", { data }));
    fake.postMessage = (message) => { if (message?.type === "load") queueMicrotask(() => fake.emit({ type: "ready" })); };
    fake.terminate = () => {};
    window.__speech = fake;
    return fake;
  };
  const relay = { sockets: [], answers: new Map(), next: 1 };
  class RelaySocket extends EventTarget {
    constructor(url, protocols) {
      super();
      Object.assign(this, { url, protocols, readyState: 0 });
      relay.sockets.push(this);
      queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); });
    }
    emit(message) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
    send(text) {
      const m = JSON.parse(text);
      if (m.type === "result") relay.answers.get(m.id)?.(m);
    }
    close(code = 1000) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.dispatchEvent(Object.assign(new Event("close"), { code }));
    }
  }
  relay.call = (tool, args = {}) => new Promise((resolve) => {
    const id = `call-${relay.next++}`;
    relay.answers.set(id, resolve);
    relay.sockets.at(-1).emit({ type: "call", id, tool, args });
  });
  window.WebSocket = RelaySocket;
  window.__relay = relay;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t) => { window.__copied = t; } } });
  if (sessionStorage.length || localStorage.length) throw new Error("storage must start empty");
  window.showSaveFilePicker = async (options) => {
    window.__picked = options;
    return { name: options.suggestedName, createWritable: async () => { let text = ""; return { write: async (t) => { text += t; }, close: async () => { window.__saved = text; } }; } };
  };
}

// Contrast of an element's text on what it is painted over (its own background over its nearest painted parent's).
const paintedContrast = (locator) => locator.evaluate((el) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const px = (...fills) => { c.clearRect(0, 0, 1, 1); for (const f of fills) { c.fillStyle = f; c.fillRect(0, 0, 1, 1); } return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  let under = el.parentElement;
  while (under && /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(under).backgroundColor)) under = under.parentElement;
  const [hi, lo] = [lum(px(getComputedStyle(el).color)), lum(px(getComputedStyle(under ?? document.body).backgroundColor, getComputedStyle(el).backgroundColor))].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
});

const SCREEN = `(() => {
  const t = (el) => el.textContent.replace(/\\s+/g, " ").trim();
  const rows = (id) => [...document.querySelectorAll("#" + id + " > li")].map((li) => [...li.children].map(t).filter(Boolean).join(" | "));
  return {
    title: t(document.querySelector("#reportTitle")),
    stats: [...document.querySelectorAll("#reportStats > li")].map((li) => [...li.children].map(t).join(" ")),
    clips: rows("clipList"), real: rows("realList"), topics: rows("topicList"), notAsked: rows("notAskedList"),
  };
})()`;

export async function run({ browser, base, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);

  for (const view of VIEWS) {
    const { name, ...options } = view;
    const phone = Boolean(options.isMobile);
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-10T09:00:00") });
    await page.addInitScript(standIns);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const text = (sel) => page.locator(sel).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const demo = page.locator("#demoBtn");
    const button = async () => ({ text: await text("#demoBtn"), state: await demo.getAttribute("data-state"), off: await demo.getAttribute("aria-disabled"), tip: await demo.getAttribute("data-tip") });
    const shot = async (file, fullPage = false) => { const path = join(out, `demo-${name}-${file}.png`); await page.keyboard.press("Escape"); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(200); if (!fullPage) await page.locator("#sPlan").scrollIntoViewIfNeeded(); await page.screenshot({ path, fullPage }); screenshots.push(path); };
    const context_ = () => page.evaluate(() => window.__relay.call("get_context")).then((r) => r.result);

    // Ready from the start: no agent, no typing needed.
    assert.deepEqual(await button(), IDLE, `${name}: Load demo show is ready from the start`);
    assert.equal(await demo.getAttribute("class"), "tb", `${name}: a plain button, the orange look stays with the primary one`);
    await shot("ready");
    ok(`${name}: Load demo show is ready without an agent or a plan`);

    // One click: the demo is in the box, the plan button, the top bar and step 3; it asks nobody and stores nothing.
    await press(demo);
    assert.deepEqual(await button(), LOADED, `${name}: the button says Demo loaded with the counts`);
    assert.equal(await page.locator("#planIn").inputValue(), DEMO_TEXT, `${name}: the demo is in the plan box, in the host's own format`);
    assert.equal(await text("#planBtn"), "8 questions · 3 parts ✓", `${name}: the plan button reads it back`);
    assert.equal(await text("#showLine"), "· Demo show: A small app's first year · guest Demo Guest", `${name}: the top bar names the demo show and its placeholder guest`);
    assert.equal(await page.locator("#sPlan").getAttribute("data-done"), "", `${name}: step 3 is done`);
    assert.equal(await page.locator("#planIn").isEditable(), true, `${name}: the box can still be edited`);
    const contrast = await paintedContrast(demo);
    assert.ok(contrast >= 4.5, `${name}: Demo loaded reads at ${contrast.toFixed(2)}:1`);
    const fits = await page.evaluate(() => { const b = document.querySelector("#demoBtn").getBoundingClientRect(); const c = document.querySelector("#sPlan").getBoundingClientRect(); return { sideways: document.documentElement.scrollWidth > window.innerWidth, inside: b.right <= c.right + 0.5 && b.left >= c.left - 0.5 }; });
    assert.deepEqual(fits, { sideways: false, inside: true }, `${name}: the button fits the screen and the step`);
    assert.deepEqual(requests, ["/"], `${name}: loading the demo asked nobody (only the page itself was requested)`);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], `${name}: nothing is stored`);
    assert.equal(await page.locator('#guestSeg [aria-pressed="true"]').count(), 0, `${name}: no Guest agreed answer was given`);
    assert.equal(await page.evaluate(() => window.__tracks.length), 0, `${name}: no microphone or tab was asked for`);
    await press(page.locator("#planBtn"));
    await shot("loaded");
    ok(`${name}: one click loads the demo into the box, the top bar and the button; readable, fits, asks nobody, stores nothing`);

    // The agent reads it back (the notes belong to the demo).
    await press(page.locator("#connectBtn"));
    await page.waitForFunction(() => window.__relay.sockets.length === 1 && window.__relay.sockets[0].readyState === 1);
    const back = await context_();
    assert.deepEqual([back.showTitle, back.guestName, back.questions.length, back.segments.map((s) => [s.title, s.plannedMinutes]), back.notes], ["Demo show: A small app's first year", "Demo Guest", 8, [["Intro", 3], ["The first year", 8], ["Wrap-up", 4]], DEMO_NOTES], `${name}: get_context gives the demo with its notes`);
    ok(`${name}: get_context gives the demo back, notes included`);

    // The host can still edit: the button goes back, a small edit keeps the notes, another show takes them away, and the demo loads again.
    await page.locator("#planIn").fill(DEMO_TEXT.replace("Who was your first real user?", "Who was your first user?"));
    assert.deepEqual(await button(), IDLE, `${name}: after the host's edit the button goes back`);
    assert.equal(await text("#planBtn"), "8 questions · 3 parts ✓", `${name}: the edited plan still reads`);
    assert.equal((await context_()).notes, DEMO_NOTES, `${name}: a small edit keeps the notes`);
    await page.locator("#planIn").fill("Show: My Own\n5 Only part\n1. Typed by the host?");
    assert.equal("notes" in (await context_()), false, `${name}: another show in the box takes the notes away`);
    await press(demo);
    assert.deepEqual(await button(), LOADED, `${name}: the demo loads again`);
    assert.equal(await page.locator("#planIn").inputValue(), DEMO_TEXT, `${name}: and the box holds the demo again`);
    assert.equal((await context_()).notes, DEMO_NOTES, `${name}: with its notes`);
    ok(`${name}: the host can edit (the button goes back; notes stay through a small edit, go with another show) and load the demo again`);

    // The agent's load and the demo take turns: each replaces the other, with the notes that go with it.
    const load = page.locator("#loadBtn");
    const loadText = () => text("#loadBtn");
    const AGENT_SHOW = { show: "Sample Show", guest: "Sample Guest", questions: ["How did it start?"], parts: [{ name: "Intro", minutes: 3 }], notes: "Ask about the early days." };
    await page.locator("#planIn").fill("Show: My Own\n5 Only part\n1. Typed by the host?");
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
    await press(load);
    await page.evaluate(() => window.__wait);
    assert.equal(await loadText(), "Agent is loading…", `${name}: the agent is asked`);
    await press(demo);
    assert.equal(await loadText(), "Let my agent load it", `${name}: loading the demo gives up the request, nothing is left waiting`);
    assert.deepEqual([await button(), (await context_()).notes], [LOADED, DEMO_NOTES], `${name}: the demo and its notes are in`);
    assert.deepEqual((await page.evaluate((s) => window.__relay.call("load_show", s), AGENT_SHOW)).error?.length > 0, true, `${name}: a late answer to the given-up request is refused, the demo stays`);
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 1, holdMs: 25000 }); });
    await press(load);
    await page.evaluate(() => window.__wait);
    assert.deepEqual((await page.evaluate((s) => window.__relay.call("load_show", s), AGENT_SHOW)).result, { loaded: true, questions: 1, parts: 1 }, `${name}: after a new press the agent's show loads over the demo`);
    assert.deepEqual([await button(), (await context_()).notes, (await loadText()).startsWith("Loaded by Claude Code")], [IDLE, "Ask about the early days.", true], `${name}: the demo button goes back and the agent's notes replace the demo's`);
    await press(demo);
    assert.deepEqual([await button(), (await loadText()).startsWith("Loaded by"), (await context_()).notes], [LOADED, false, DEMO_NOTES], `${name}: the demo over the agent's show: its button goes back, the demo's notes return`);
    ok(`${name}: the agent's load and the demo replace each other, with their own notes; a request on its way is given up`);

    // A fixed plan (the show has started) is not replaced.
    await page.locator("#planIn").fill("Show: My Own\n5 Only part\n1. Typed by the host?");
    await page.evaluate(() => { document.querySelector("#planIn").readOnly = true; });
    await press(demo);
    assert.equal(await page.locator("#planIn").inputValue(), "Show: My Own\n5 Only part\n1. Typed by the host?", `${name}: a fixed plan stays as it is`);
    await page.evaluate(() => { document.querySelector("#planIn").readOnly = false; });
    await press(demo);
    assert.deepEqual(await button(), LOADED, `${name}: loaded again once the plan is free`);
    ok(`${name}: a fixed plan is not replaced`);

    // The producer screen: the demo's first question on the card, its run order; then the report.
    await press(page.locator("#guestSeg button").first());
    await press(page.locator("#micBtn"));
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    if ((await page.locator("#tabBtn").getAttribute("aria-disabled")) !== "true") {
      await press(page.locator("#tabBtn"));
      await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
    }
    await press(page.locator("#speechBtn"));
    await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
    await press(page.locator("#goBtn"));
    assert.equal(await text("#qMain"), "What made you start building the app?", `${name}: the Next question card shows the demo's first question`);
    const runRows = await page.locator("#runList > li").evaluateAll((lis) => lis.map((li) => li.textContent.replace(/\s+/g, " ").trim()));
    assert.equal(runRows.length, 3, `${name}: the run order has the demo's three parts`);
    assert.match(runRows.join("|"), /Intro.*3:00.*The first year.*8:00.*Wrap-up.*4:00/, `${name}: with their planned times`);
    await shot("screen", true);
    ok(`${name}: the Next question card shows the demo's first question and the run order its three parts`);

    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
    await press(page.locator("#runBtn"));
    // The show has started: the demo button is switched off with its reason, and still says the demo is in.
    assert.deepEqual(await button(), { ...LOADED, text: "i Demo loaded ✓", off: "true", tip: "The show has started, so the plan stays as it is." }, `${name}: once the clock runs the demo button is switched off with its reason`);
    assert.equal(await demo.locator(".off-mark").count(), 1, `${name}: with the round i`);
    await page.clock.fastForward(150_000);
    await press(page.locator("#askedBtn")); // Q1
    assert.equal(await text("#qMain"), "What did the very first version do?", `${name}: Asked moves the card to the demo's second question`);
    await press(page.locator("#skipBtn")); // Q2
    assert.equal(await text("#qMain"), "Who was your first real user?", `${name}: Skip moves it on again`);
    await page.clock.fastForward(30_000);
    await press(page.locator("#runBtn")); // Next part at 3:00
    await page.clock.fastForward(540_000);
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
    await press(page.locator("#endBtn"));
    await page.clock.resume();
    const screen = await page.evaluate(SCREEN);
    assert.deepEqual(screen.stats.slice(0, 2), ["12:00 show time · +1:00 over", "1 / 8 list questions asked"], `${name}: the report's numbers come from the demo show`);
    assert.equal(screen.title, "End report Demo show: A small app's first year · guest Demo Guest · 10 Nov 2026", `${name}: the report names the demo show and guest`);
    assert.deepEqual(screen.real, ["3:00 | Intro | 0:00", "8:00 | The first year | +1:00", "4:00 | Wrap-up | not reached"], `${name}: plan against real for the demo's three parts`);
    assert.deepEqual([screen.notAsked.length, screen.notAsked[0], screen.notAsked[1]], [7, "Q2 | What did the very first version do? | skipped", "Q3 | Who was your first real user? | no time"], `${name}: the demo's questions not asked`);
    assert.deepEqual((await page.evaluate((r) => window.__relay.call("post_report", r), REPORT)).result, { shown: true }, `${name}: the agent's report is taken`);
    const full = await page.evaluate(SCREEN);
    assert.deepEqual([full.topics, full.clips], [["Why the app got built"], ["0:12 | The very first version"]], `${name}: and fills the topics and clip moments`);
    await shot("report", true);
    ok(`${name}: End & report fills the demo's numbers, run order against real and questions not asked; the agent's report fills the rest`);

    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], `${name}: nothing was stored`);
    assert.deepEqual([...new Set(requests)].sort(), ["/", "/api/agent-token"], `${name}: only the page and the agent's token were requested`);
    assert.deepEqual(problems, [], `${name}: no console errors, no page errors, no CSP violations`);
    ok(`${name}: nothing stored, only the page and the agent's token requested, no errors`);
    await context.close();
  }

  return { checks, screenshots };
}
