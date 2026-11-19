// Browser checks for `kit specs back`: Setup on the producer screen (TOOLS-348, built to the approved prototype
// TOOLS-343), in Chromium through the real Worker. Desktop 1366x900 and phone 390x844, light and dark. The microphone
// and the speech worker are stand-ins; a solo show, no agent.
// Checks: the producer screen's top bar has a quiet Setup button (its tooltip says the clock and the listening keep
// running); a press shows the setup while the show clock keeps counting in the top bar and the listening sign stays on,
// the Setup button goes and the keyboard lands on the setup's title; the setup's main button reads "Back to producer
// screen" and brings the producer screen back as it was, the keyboard on the Setup button; End & report works from the
// setup too; before the show opens the main button still reads "Open producer screen"; nothing stored, no console errors.
import assert from "node:assert/strict";
import { join } from "node:path";

let nextClient = 0;
const ownAddress = (options) => ({ ...options, extraHTTPHeaders: { "cf-connecting-ip": `2001:db8:48:${++nextClient}::1` } });

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];

// A made-up solo show.
const PLAN = ["Show: Back Test", "3 Intro", "1. The first point", "8 Main part", "2. The second point", "3. The third point"].join("\n");

// Stand-ins: the microphone and the studio tab (quiet tones) and the speech worker (ready at once).
function standIns() {
  const tone = () => {
    const context = new AudioContext();
    const osc = context.createOscillator();
    const out = context.createMediaStreamDestination();
    osc.connect(out);
    osc.start();
    return out.stream;
  };
  navigator.mediaDevices.getUserMedia = async () => tone();
  navigator.mediaDevices.getDisplayMedia = async () => {
    const video = document.createElement("canvas").captureStream(1).getVideoTracks()[0];
    video.getSettings = () => ({ displaySurface: "browser" });
    return new MediaStream([video, ...tone().getAudioTracks()]);
  };
  const RealWorker = window.Worker;
  window.Worker = function Worker(url, options) {
    if (!String(url).includes("/speech/")) return new RealWorker(url, options);
    const fake = new EventTarget();
    fake.emit = (data) => fake.dispatchEvent(new MessageEvent("message", { data }));
    fake.postMessage = (message) => { if (message?.type === "load") queueMicrotask(() => fake.emit({ type: "ready" })); };
    fake.terminate = () => {};
    return fake;
  };
}

export async function run({ browser, base, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);

  for (const view of VIEWS) {
    const { name, ...options } = view;
    const phone = Boolean(options.isMobile);
    const context = await browser.newContext(ownAddress(options));
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-12-01T19:00:00Z") });
    await page.addInitScript(standIns);
    const problems = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const text = (sel) => page.locator(sel).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const visible = (sel) => page.locator(sel).isVisible();
    const shot = async (file) => { const path = join(out, `back-${name}-${file}.png`); await page.waitForTimeout(150); await page.screenshot({ path }); screenshots.push(path); };
    const go = page.locator("#goBtn");
    const back = page.locator("#backBtn");

    // The setup: a plan, the microphone, the speech model. Before the show opens, the main button opens it.
    await press(page.locator("#planBtn"));
    await page.locator("#planIn").fill(PLAN);
    await press(page.locator("#micBtn"));
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    await press(page.locator("#speechBtn"));
    await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
    assert.equal(await text("#goBtn"), "Open producer screen", `${name}: before the show the main button opens it`);
    assert.equal(await back.isVisible(), false, `${name}: no Setup button on the setup screen`);
    await press(go);

    // The producer screen: a quiet Setup button in the top bar, with its tooltip.
    assert.deepEqual([await visible("#live"), await back.isVisible(), await text("#backBtn")], [true, true, "Setup"], `${name}: Setup in the top bar`);
    assert.equal(await back.getAttribute("data-tip"), "Back to setup. The clock and the listening keep running.", `${name}: its tooltip`);
    const box = await back.boundingBox();
    if (phone) {
      assert.ok(box.height >= 44 && box.width >= 44, `${name}: Setup is big enough to tap (${box.width} x ${box.height} px)`);
      // On a narrow screen Setup keeps its arrow and its name moves out of sight (a screen reader still hears it), so End stays on the second row.
      const end = await page.locator("#endBtn").boundingBox();
      assert.ok(Math.abs(end.y - box.y) < box.height, `${name}: End & report sits on Setup's row`);
    }
    await press(page.locator("#runBtn")); // Start: the show clock runs
    await page.clock.runFor(65_000);
    assert.equal(await text("#clockTime"), "1:05", `${name}: the clock runs`);
    await press(page.locator("#skipBtn")); // the card moves on to the second point
    const card = await text("#qMain");
    await shot("live");
    ok(`${name}: Setup in the top bar of the producer screen, with its tooltip`);

    // Setup: the setup shows, the clock keeps counting in the top bar and the listening sign stays on.
    await press(back);
    assert.deepEqual([await visible("#setup"), await visible("#live"), await visible("#topLive"), await back.isVisible()], [true, false, true, false], `${name}: the setup, with the top bar and no Setup button`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "setupTitle", `${name}: the keyboard lands on the setup's title`);
    assert.equal(await text("#goBtn"), "Back to producer screen", `${name}: the main button says where it goes`);
    assert.equal(await go.getAttribute("aria-disabled"), null, `${name}: and is on`);
    assert.match(await text("#listenTxt"), /Listening/, `${name}: still listening`);
    // While the show runs, the speech choice stays as it is (a switch would stop speech to text behind the sign).
    const other = page.locator('#engineSeg [data-v="browser"]');
    if (phone) {
      // Phones are never offered the browser's service: that reason stays.
      assert.deepEqual([await other.getAttribute("aria-disabled"), await other.getAttribute("data-tip")], ["true", "The browser's speech service is only offered on a computer. Use the model on this computer."], `${name}: the phone keeps its own reason`);
    } else {
      assert.deepEqual([await other.getAttribute("aria-disabled"), await other.getAttribute("data-tip")], ["true", "The show is running, so speech to text stays as it is."], `${name}: the other speech choice is off with its reason`);
      await other.click({ force: true });
      assert.equal(await page.locator('#engineSeg [data-v="local"]').getAttribute("aria-pressed"), "true", `${name}: a press changes nothing`);
      assert.match(await text("#listenTxt"), /Listening/, `${name}: and listening goes on`);
    }
    // The top bar's Stop and Listen own the microphone while the show runs: the Sound step's button is off with its reason.
    const mic = page.locator("#micBtn");
    assert.deepEqual([await mic.getAttribute("aria-disabled"), await mic.getAttribute("data-tip"), await mic.locator(".off-mark").count()], ["true", "The show is running: use Stop or Listen in the top bar.", 1], `${name}: Microphone is off with its reason`);
    await mic.click({ force: true });
    assert.deepEqual([await mic.getAttribute("data-state"), await text("#listenTxt")].map(String).map((s) => s.replace(/ ·.*/, "")), ["ok", "Listening"], `${name}: a press changes nothing`);
    await page.clock.runFor(10_000);
    assert.equal(await text("#clockTime"), "1:15", `${name}: the clock keeps counting on the setup screen`);
    await shot("setup");
    ok(`${name}: Setup shows the setup while the clock and the listening keep running; the main button reads Back to producer screen`);

    // Back to producer screen: as it was, the clock still running, the keyboard on Setup.
    await press(go);
    assert.deepEqual([await visible("#live"), await visible("#setup"), await text("#qMain"), await text("#clockTime")], [true, false, card, "1:15"], `${name}: the producer screen as it was`);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "backBtn", `${name}: the keyboard lands on Setup`);
    assert.match(await text("#listenTxt"), /Listening/, `${name}: still listening`);
    ok(`${name}: Back to producer screen brings it back as it was`);

    // End & report from the setup screen.
    await press(back);
    await press(page.locator("#endBtn"));
    assert.deepEqual([await visible("#report"), await visible("#setup"), await visible("#topLive")], [true, false, false], `${name}: End & report from the setup`);
    ok(`${name}: End & report works from the setup screen too`);

    const stored = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length }));
    assert.deepEqual(stored, { local: 0, session: 0, cookie: "", databases: 0 }, `${name}: nothing stored`);
    assert.deepEqual(problems, [], `${name}: no console errors`);
    ok(`${name}: nothing stored, no console errors`);
    await context.close();
  }
  // Before Start: a show type changed on the setup during the visit needs the guest's answer before going back.
  {
    const context = await browser.newContext(ownAddress(VIEWS[0]));
    const page = await context.newPage();
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    await page.locator("#planBtn").click();
    await page.locator("#planIn").fill(PLAN);
    await page.locator("#micBtn").click();
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    await page.locator("#speechBtn").click();
    await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
    await page.locator("#goBtn").click();
    await page.locator("#backBtn").click();
    await page.locator('#modeSeg [data-v="guest"]').click();
    const go = page.locator("#goBtn");
    assert.deepEqual([await go.getAttribute("aria-disabled"), await go.getAttribute("data-tip")], ["true", "Answer Guest agreed first."], "with a guest now: Back to producer screen waits for the guest's answer");
    await page.locator("#guestSeg button").first().click(); // Yes
    assert.equal(await go.getAttribute("aria-disabled"), null, "answered: Back to producer screen is on");
    // The guest said yes during the visit: the studio tab can be shared from the setup (it is not the top bar's).
    const tab = page.locator("#tabBtn");
    assert.equal(await tab.getAttribute("aria-disabled"), null, "the tab button is the host's to press");
    await tab.click();
    await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
    checks.push("a show type changed during the visit needs the guest's answer before Back to producer screen");
    await context.close();
  }
  return { checks, screenshots };
}
