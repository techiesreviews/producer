// Browser checks for `kit specs load`: step 3's "Let my agent load it" (card 14, TOOLS-174), in Chromium through the real
// Worker. Desktop 1366x900 and phone 390x844, light and dark. The microphone, the studio tab and the relay are stand-ins
// (as in the other suites); the relay stand-in plays the agent (window.__relay.call(tool, args)). Time is Playwright's
// clock, so the 90 seconds the agent has to answer pass at once.
// Checks: the button is switched off with its reason until an agent is connected, then ready; a press sends the load cue
// to the agent's wait and the button says it is loading; the agent's load_show puts the show in the plan box, the top bar
// and the run order and the button reads "Loaded by Claude Code · 4 questions · 2 parts" with the show in its tooltip;
// the agent can still read the show back with get_context (notes included); the host can still edit, and the button then
// goes back; a broken or too big plan and every extra field (guest consent, the microphone, the tab) is refused with a
// plain reason while the page stays as it was; "Guest agreed" is never ticked and no microphone or tab sharing starts;
// a plan the host typed is not overwritten unless the host pressed the button; a fixed plan (the show has started) is
// not changed; with no answer in 90 seconds the button says so and can be pressed again; nothing is stored.
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

// Made-up show, guest and questions.
const SHOW = {
  show: "Sample Show",
  guest: "Sample Guest",
  questions: ["How did it start?", "Who paid first?", "What went wrong first?", "What would you change now?"],
  parts: [{ name: "Intro", minutes: 3 }, { name: "Her story", minutes: 8 }],
  notes: "Ask about the early days.",
};
const SHOW_TEXT = "Show: Sample Show\nGuest: Sample Guest\n3 min Intro\n8 min Her story\n1. How did it start?\n2. Who paid first?\n3. What went wrong first?\n4. What would you change now?";
const HOST_PLAN = "Show: My Own\n5 Only part\n1. Typed by the host?";

// Stand-ins: counted microphone and tab asks (the agent must never cause one), and the relay.
function standIns() {
  window.__media = { mic: 0, tab: 0 };
  navigator.mediaDevices.getUserMedia = async () => { window.__media.mic += 1; throw new DOMException("not asked for in this suite", "NotAllowedError"); };
  navigator.mediaDevices.getDisplayMedia = async () => { window.__media.tab += 1; throw new DOMException("not asked for in this suite", "NotAllowedError"); };
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

export async function run({ browser, base, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);

  for (const view of VIEWS) {
    const { name, ...options } = view;
    const phone = Boolean(options.isMobile);
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-10T09:00:00Z") });
    await page.addInitScript(standIns);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const pressOff = (locator) => (options.hasTouch ? locator.tap({ force: true }) : locator.click({ force: true }));
    const text = (sel) => page.locator(sel).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const load = page.locator("#loadBtn");
    const button = async () => ({ text: await text("#loadBtn"), state: await load.getAttribute("data-state"), off: await load.getAttribute("aria-disabled"), tip: await load.getAttribute("data-tip") });
    const shot = async (file) => { const path = join(out, `load-${name}-${file}.png`); await page.keyboard.press("Escape"); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(200); await page.locator("#sPlan").scrollIntoViewIfNeeded(); await page.screenshot({ path }); screenshots.push(path); };
    const guestUntouched = async (when) => {
      assert.equal(await page.locator('#guestSeg [aria-pressed="true"]').count(), 0, `${name}: ${when}: no Guest agreed answer was given`);
      assert.equal(await page.locator("#sGuest").getAttribute("data-done"), null, `${name}: ${when}: step 4 is not done`);
      assert.deepEqual(await page.evaluate(() => window.__media), { mic: 0, tab: 0 }, `${name}: ${when}: no microphone and no tab sharing was asked for`);
    };

    // Off with its reason until an agent is connected.
    assert.deepEqual(await button(), { text: "i Let my agent load it", state: null, off: "true", tip: "Connect your agent first (step 2)." }, `${name}: switched off, with its reason`);
    assert.equal(await load.getAttribute("class"), "tb tb--primary", `${name}: the orange look of a primary button`);
    await pressOff(load);
    assert.equal(await page.evaluate(() => window.__relay.sockets.length), 0, `${name}: a press on the switched-off button asks nobody`);
    await shot("off");
    ok(`${name}: switched off with its reason until an agent is connected`);

    // The agent connects: the button is ready.
    await press(page.locator("#connectBtn"));
    await page.waitForFunction(() => window.__relay.sockets.length === 1 && window.__relay.sockets[0].readyState === 1);
    await page.evaluate(() => window.__relay.call("get_context"));
    await page.waitForFunction(() => document.querySelector("#loadBtn").getAttribute("aria-disabled") === null);
    assert.deepEqual(await button(), { text: "Let my agent load it", state: null, off: null, tip: "Claude Code sends the show name, guest, questions and run order. You can still change them." }, `${name}: ready once the agent is connected`);
    await shot("ready");
    ok(`${name}: ready once the agent is connected, the tooltip says what the agent sends`);

    // A press sends the cue; the button says the agent is loading and takes no second press.
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
    await press(load);
    const cue = await page.evaluate(async () => (await window.__wait).result);
    assert.deepEqual([cue.cue, cue.transcript], ["load_show", []], `${name}: the press sends the load cue`);
    assert.deepEqual(await button(), { text: "Agent is loading…", state: "busy", off: null, tip: "Waiting for Claude Code to send the show." }, `${name}: the button says the agent is loading`);
    const busyContrast = await paintedContrast(load);
    assert.ok(busyContrast >= 4.5, `${name}: Agent is loading… reads at ${busyContrast.toFixed(2)}:1`);
    await press(load);
    assert.equal((await button()).state, "busy", `${name}: a second press changes nothing`);
    await shot("loading");
    ok(`${name}: a press sends the cue; Agent is loading… on the button, readable, one press only`);

    // The agent's load_show: the show lands in the plan box, the top bar and the button; nothing else moves.
    const loaded = await page.evaluate((show) => window.__relay.call("load_show", show), SHOW);
    assert.deepEqual(loaded.result, { loaded: true, questions: 4, parts: 2 }, `${name}: the page answers what it loaded`);
    assert.deepEqual(await button(), { text: "Loaded by Claude Code · 4 questions · 2 parts", state: "ok", off: null, tip: "Show: Sample Show. Guest: Sample Guest. 4 questions, 2 parts, guest notes." }, `${name}: Loaded by Claude Code, with the show in its tooltip`);
    assert.equal(await load.getAttribute("class"), "tb", `${name}: no longer the orange look`);
    const loadedContrast = await paintedContrast(load);
    assert.ok(loadedContrast >= 4.5, `${name}: the loaded state reads at ${loadedContrast.toFixed(2)}:1`);
    assert.equal(await page.locator("#planIn").inputValue(), SHOW_TEXT, `${name}: the show is in the plan box, in the host's own format`);
    assert.equal(await text("#planBtn"), "4 questions · 2 parts ✓", `${name}: the plan button reads it back`);
    assert.equal(await text("#showLine"), "· Sample Show · guest Sample Guest", `${name}: the top bar names the show and the guest`);
    assert.equal(await page.locator("#sPlan").getAttribute("data-done"), "", `${name}: step 3 is done`);
    await guestUntouched("after the load");
    assert.equal(await page.locator("#goBtn").getAttribute("aria-disabled"), "true", `${name}: Open producer screen still waits for the host's own steps`);
    await shot("loaded");
    ok(`${name}: the loaded show is in the box, the top bar and the button; Guest agreed, the microphone and the tab untouched`);

    // The agent reads it back: questions, run order, show, guest and the notes.
    const back = await page.evaluate(() => window.__relay.call("get_context"));
    assert.deepEqual([back.result.showTitle, back.result.guestName, back.result.questions.length, back.result.segments.map((s) => [s.title, s.plannedMinutes]), back.result.notes], ["Sample Show", "Sample Guest", 4, [["Intro", 3], ["Her story", 8]], "Ask about the early days."], `${name}: get_context gives the loaded show with its notes`);
    ok(`${name}: get_context gives the loaded show back, notes included`);

    // Refused: broken, too big, and every field that is not the show. The page stays as it was.
    const refused = (args) => page.evaluate((a) => window.__relay.call("load_show", a), args).then((r) => r.error);
    assert.match(await refused({}), /"parts" is needed/, `${name}: a plan with no run order is refused`);
    assert.match(await refused({ parts: [{ name: "Intro", minutes: 0 }] }), /whole minutes/, `${name}: a part with no minutes is refused`);
    assert.match(await refused({ ...SHOW, notes: "n".repeat(300 * 1024) }), /too big\. Limit: 200 KB/, `${name}: more than 200 KB is refused as too big`);
    for (const field of ["guestAgreed", "consent", "microphone", "shareTab"]) {
      const reason = await refused({ ...SHOW, [field]: true });
      assert.match(reason, new RegExp(`Unknown field "${field}"`), `${name}: ${field} is refused`);
      assert.match(reason, /Guest consent, the microphone and tab sharing are the host's own clicks/, `${name}: and the reason says whose clicks they are`);
    }
    assert.equal(await page.locator("#planIn").inputValue(), SHOW_TEXT, `${name}: a refused plan changes nothing`);
    assert.equal((await button()).state, "ok", `${name}: and the button still shows what was loaded`);
    await guestUntouched("after the refusals");
    ok(`${name}: broken, too big and extra fields (consent, microphone, tab) are refused with a plain reason; nothing moves`);

    // The host can still edit: the button goes back; a plan the host typed is theirs.
    await page.locator("#planBtn").click();
    await page.locator("#planIn").fill(HOST_PLAN);
    assert.deepEqual(await button(), { text: "Let my agent load it", state: null, off: null, tip: "Claude Code sends the show name, guest, questions and run order. You can still change them." }, `${name}: after the host's edit the button is ready again`);
    assert.equal(await text("#planBtn"), "1 question · 1 part ✓", `${name}: the host's plan reads as typed`);
    assert.match(await refused(SHOW), /The host already has a plan in the page\. Ask the host to press Let my agent load it/, `${name}: the agent cannot overwrite what the host typed`);
    assert.equal(await page.locator("#planIn").inputValue(), HOST_PLAN, `${name}: the host's plan stays`);
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 1, holdMs: 25000 }); });
    await press(load);
    const again = await page.evaluate(async () => (await window.__wait).result);
    assert.equal(again.cue, "load_show", `${name}: pressing the button is the host's go-ahead`);
    const over = await page.evaluate((show) => window.__relay.call("load_show", show), SHOW);
    assert.deepEqual(over.result, { loaded: true, questions: 4, parts: 2 }, `${name}: after the press the agent's show replaces the typed one`);
    assert.equal((await button()).text, "Loaded by Claude Code · 4 questions · 2 parts", `${name}: loaded again`);
    ok(`${name}: the host can edit (the button goes back); the agent loads over a typed plan only after the host's press`);

    // A fixed plan (the show has started) is not changed.
    await page.evaluate(() => { document.querySelector("#planIn").readOnly = true; });
    assert.match(await refused({ ...SHOW, show: "Another" }), /The show has started, so the plan stays as it is\./, `${name}: a started show's plan is not changed`);
    assert.equal(await page.locator("#planIn").inputValue(), SHOW_TEXT, `${name}: and stays as it was`);
    await page.evaluate(() => { document.querySelector("#planIn").readOnly = false; });
    ok(`${name}: a fixed plan is not changed`);

    // No answer in 90 seconds: the button says so and can be pressed again. (The agent keeps calling, so it stays connected.)
    await page.locator("#planIn").fill(HOST_PLAN);
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 2, holdMs: 25000 }); });
    await press(load);
    assert.equal((await button()).state, "busy", `${name}: asking again`);
    for (let i = 0; i < 4; i++) {
      await page.evaluate((seq) => { window.__relay.call("wait_for_cue", { seq, holdMs: 25000 }); }, 3 + i);
      await page.clock.fastForward(23_000);
    }
    assert.deepEqual(await button(), { text: "Not loaded · try again", state: "error", off: null, tip: "No show came back from Claude Code in 90 seconds. Check Claude Code, then press again." }, `${name}: with no answer the button says so`);
    const failedContrast = await paintedContrast(load);
    assert.ok(failedContrast >= 4.5, `${name}: the failed state reads at ${failedContrast.toFixed(2)}:1`);
    await shot("failed");
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 7, holdMs: 25000 }); });
    await press(load);
    assert.equal((await button()).state, "busy", `${name}: a press tries again`);
    ok(`${name}: no answer in 90 seconds: "Not loaded · try again" with its reason, a press tries again`);

    // Nothing is stored, nothing but the page and its token was asked for, and the layout holds.
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], `${name}: nothing is stored in the browser`);
    assert.deepEqual([...new Set(requests)].sort(), ["/", "/api/agent-token"], `${name}: only the page and its token were requested`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name}: no sideways scroll${phone ? " on the phone" : ""}`);
    assert.deepEqual(problems, [], `${name}: no console errors, no page errors, no CSP violations`);
    ok(`${name}: nothing stored, only the page and its token requested, no sideways scroll, a clean console`);
    await context.close();
  }

  return { checks, screenshots };
}
