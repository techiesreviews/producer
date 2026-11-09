// Browser checks and screenshots for `kit specs` (the whole page), served through the real Worker with the page's
// own headers. Four views in Chromium: desktop 1366x900 and phone 390x844 (an Android phone's browser name), each in
// light and dark; then the setup screen in a real Firefox, light and dark, which names itself and keeps working.
import assert from "node:assert/strict";
import { join } from "node:path";

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];
const STREAM = ["Restream Studio", "Wave.video", "OBS", "Other"];
const AGENTS = "Claude Code i Codex i T3 Code";
const GUEST = ["Yes", "No · my mic only", "Solo show"];
const OFF_REASON = "Firefox does not let web pages receive the sound of a shared tab, so the guest cannot be heard here. Use Chrome or Edge.";

// The colour the browser paints for a CSS colour, as [r, g, b] (a canvas turns oklch and light-dark into pixels).
const paint = (page, expression) => page.evaluate((e) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  c.fillStyle = e === "body" ? getComputedStyle(document.body).backgroundColor : e;
  c.fillRect(0, 0, 1, 1);
  return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
}, expression);
// A theme token as the browser paints it (the canvas does not read var()): a probe element takes it as its colour.
const token = async (page, name) => paint(page, await page.evaluate((n) => {
  const probe = document.body.appendChild(document.createElement("i"));
  probe.style.color = `var(--${n})`;
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, name));
const lightness = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// The setup screen: the heading with this browser's chip, the steps that exist ("I stream with", "AI agent", "Guest agreed",
// "Sound", "Speech to text") and the open button, step 1's choices pressing one at a time with its done mark, the
// guest step's answers, the wide (label beside) or compact (label above) layout, and no word on the screen beyond its
// labels (no explainer). Leaves "Restream Studio" picked and the guest answer Yes.
async function checkSetup(page, name, { phone, touch, chip }) {
  const words = (await page.locator("#screen").innerText()).replace(/\s+/g, " ").trim();
  const label = await page.locator("#browserChip").innerText();
  assert.match(label, chip, `${name}: the browser chip names this browser`);
  assert.match(words, new RegExp(`^Set up ${label} 1 I stream with ${STREAM.join(" ")} 2 AI agent ${AGENTS} Copy connect message 3 Guest agreed ${GUEST.join(" ")} 4 Sound Microphone 5 Speech to text Load speech model · \\d+ MB Open producer screen$`), `${name}: the screen says only its labels`);
  assert.equal(await page.locator(".step").count(), 5, `${name}: five steps, one per feature that exists`);
  const options = page.locator("#streamSeg button");
  assert.deepEqual(await options.allInnerTexts(), STREAM, `${name}: the four choices`);
  const pressed = () => page.locator('#streamSeg button[aria-pressed="true"]').allInnerTexts();
  assert.deepEqual(await pressed(), ["Restream Studio"], `${name}: Restream Studio is picked on arrival`);
  assert.equal(await page.locator("#streamSeg").getAttribute("role"), "group", `${name}: the choices are one named group`);
  assert.equal(await page.locator("#streamSeg").evaluate((el) => document.getElementById(el.getAttribute("aria-labelledby"))?.textContent), "I stream with", `${name}: named by its step`);
  // Done: the step number turns green, and reads at 4.5:1 on its green tint as the browser paints it over the panel.
  const done = await page.locator("#sStream .step__n").evaluate((el) => {
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const px = (...fills) => { for (const f of fills) { c.fillStyle = f; c.fillRect(0, 0, 1, 1); } return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const panel = getComputedStyle(el.closest(".steps")).backgroundColor;
    return { number: px(getComputedStyle(el).color), tint: px(panel, getComputedStyle(el).backgroundColor) };
  });
  const [r, g, b] = done.number;
  assert.ok(g > r + 40 && g > b + 20, `${name}: the done step's number is green (${done.number})`);
  const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const [hi, lo] = [lum(done.number), lum(done.tint)].sort((p, q) => q - p);
  const contrast = (hi + 0.05) / (lo + 0.05);
  assert.ok(contrast >= 4.5, `${name}: the done number reads at ${contrast.toFixed(2)}:1 on its tint (4.5:1 needed)`);
  assert.ok(await page.locator("#sStream").evaluate((el) => el.hasAttribute("data-done")), `${name}: step 1 is done`);

  // Pick by mouse or tap, then by keyboard; one choice is pressed at a time.
  const wave = options.nth(1);
  if (touch) await wave.tap(); else await wave.click();
  assert.deepEqual(await pressed(), ["Wave.video"], `${name}: ${touch ? "a tap" : "a click"} picks Wave.video`);
  await wave.focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "OBS", `${name}: Tab moves to the next choice`);
  await page.keyboard.press("Space");
  assert.deepEqual(await pressed(), ["OBS"], `${name}: Space picks OBS`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  assert.deepEqual(await pressed(), ["Other"], `${name}: Enter picks Other`);
  const ink = await options.nth(3).evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.deepEqual(await paint(page, ink), await token(page, "ink"), `${name}: the picked choice is filled`);
  await options.nth(0).click();
  await page.evaluate(() => document.activeElement?.blur());
  assert.deepEqual(await pressed(), ["Restream Studio"], `${name}: back to Restream Studio`);

  // The guest step: nothing is picked on arrival (only the host answers); one answer at a time, by mouse, tap or
  // keyboard; the step is done once answered. The open button waits, saying what is missing first.
  const go = page.locator("#goBtn");
  const guestPressed = () => page.locator('#guestSeg button[aria-pressed="true"]').allInnerTexts();
  assert.deepEqual(await guestPressed(), [], `${name}: no guest answer on arrival`);
  assert.equal(await page.locator("#guestSeg").evaluate((el) => document.getElementById(el.getAttribute("aria-labelledby"))?.textContent), "Guest agreed", `${name}: the answers are named by their step`);
  assert.deepEqual([await go.getAttribute("aria-disabled"), await go.getAttribute("data-tip")], ["true", "Answer Guest agreed first."], `${name}: the open button waits for the guest answer`);
  const solo = page.locator("#guestSeg button").nth(2);
  if (touch) await solo.tap(); else await solo.click();
  assert.deepEqual(await guestPressed(), ["Solo show"], `${name}: ${touch ? "a tap" : "a click"} picks Solo show`);
  assert.ok(await page.locator("#sGuest").evaluate((el) => el.hasAttribute("data-done")), `${name}: the guest step is done`);
  assert.equal(await go.getAttribute("data-tip"), "Turn on the microphone first.", `${name}: then it waits for the microphone`);
  await page.locator("#guestSeg button").nth(0).focus();
  await page.keyboard.press("Enter");
  assert.deepEqual(await guestPressed(), ["Yes"], `${name}: Enter picks Yes`);
  await page.evaluate(() => document.activeElement?.blur());

  // Layout: the column is centred and at most 720px wide; wide puts the label beside the choices, compact above.
  const box = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
    return { width: innerWidth, steps: r(".steps"), label: r("#sStream .step__label"), seg: r("#streamSeg"), buttons: [...document.querySelectorAll("#streamSeg button")].map((b) => b.getBoundingClientRect().toJSON()) };
  });
  assert.ok(box.steps.width <= 720.5 && Math.abs(box.steps.left - (box.width - box.steps.right)) < 1, `${name}: the steps are a centred column`);
  for (const b of box.buttons) assert.ok(b.left >= box.seg.left && b.right <= box.seg.right && b.right <= box.width, `${name}: every choice sits inside its row and the window`);
  if (phone) {
    assert.ok(box.seg.top >= box.label.bottom, `${name}: compact: the choices sit under the label`);
    assert.equal(new Set(box.buttons.map((b) => Math.round(b.top))).size, 1, `${name}: compact: the four choices fit on one line`);
  } else {
    assert.ok(box.seg.left >= box.label.right && Math.abs((box.seg.top + box.seg.bottom) / 2 - (box.label.top + box.label.bottom) / 2) < 4, `${name}: wide: the choices sit beside the label`);
  }
  if (touch) for (const b of box.buttons) assert.ok(b.height >= 44, `${name}: each choice is a finger-sized target (${b.height}px)`);
}

// The one switched-off pattern on a real choice row: a choice with aria-disabled and a reason (as a later step adds
// one, for example tab sound in Firefox) is greyed with the "i" mark, shows its reason by mouse or tap and by
// keyboard focus, and pressing it (click, tap, Enter) never picks it. Returns the close-up screenshots.
async function checkSwitchedOff(page, name, out, { touch }) {
  await page.evaluate((reason) => {
    const b = Object.assign(document.createElement("button"), { type: "button", id: "offChoice" });
    b.setAttribute("aria-pressed", "false");
    b.setAttribute("aria-disabled", "true");
    b.dataset.tip = reason;
    b.dataset.v = "off";
    const mark = Object.assign(document.createElement("span"), { className: "off-mark", textContent: "i" });
    mark.setAttribute("aria-hidden", "true");
    b.append(mark, " Tab sound");
    document.getElementById("streamSeg").append(b);
  }, OFF_REASON);
  const off = page.locator("#offChoice");
  const tip = page.locator("#tip");
  const pressed = () => page.locator('#streamSeg button[aria-pressed="true"]').allInnerTexts();
  const look = await off.evaluate((el) => ({ color: getComputedStyle(el).color, cursor: getComputedStyle(el).cursor, mark: getComputedStyle(el.querySelector(".off-mark")).borderTopStyle }));
  assert.deepEqual(await paint(page, look.color), await token(page, "faint"), `${name}: the switched-off choice is greyed`);
  assert.equal(look.mark, "solid", `${name}: it carries the round "i" mark`);
  if (!touch) assert.equal(look.cursor, "help", `${name}: the pointer asks "why?"`);

  if (touch) await off.tap({ force: true }); else await off.hover();
  await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, OFF_REASON);
  await page.waitForTimeout(150);
  const shot = join(out, `page-${name}-switched-off.png`);
  const r = await off.boundingBox();
  const width = Math.min(page.viewportSize().width, 640);
  await page.screenshot({ path: shot, clip: { x: Math.max(0, Math.min(r.x + r.width / 2 - width / 2, page.viewportSize().width - width)), y: Math.max(0, r.y - 60), width, height: 200 } });
  if (!touch) {
    // The hover opened the reason; close it first, so the press itself must show it again. Playwright counts
    // aria-disabled as not clickable: force the press.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#tip").hasAttribute("data-on"));
    await off.click({ force: true });
  }
  await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, OFF_REASON);
  assert.deepEqual(await pressed(), ["Restream Studio"], `${name}: ${touch ? "a tap" : "a click"} shows the reason and picks nothing`);
  await page.keyboard.press("Escape");

  await page.locator("#streamSeg button").nth(3).focus();
  await page.keyboard.press("Tab");
  assert.ok(await off.evaluate((el) => el === document.activeElement), `${name}: the keyboard still reaches the switched-off choice`);
  await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, OFF_REASON);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  assert.deepEqual(await pressed(), ["Restream Studio"], `${name}: Enter and Space on it pick nothing`);
  assert.equal(await tip.textContent(), OFF_REASON, `${name}: the reason stays on screen`);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { document.activeElement?.blur(); document.getElementById("offChoice").remove(); });
  return [shot];
}

// A stand-in for the browser's WebSocket, put in before the page runs: the page's relay socket talks to it instead of
// the Worker's relay (these checks serve the page without a relay object). window.__relay.call(tool, args) sends a
// call as the relay would and resolves with the page's answer; a revoke is recorded and closes the socket with 4003.
function fakeRelay() {
  const relay = { sockets: [], answers: new Map(), revoked: false, next: 1 };
  class RelaySocket extends EventTarget {
    constructor(url, protocols) {
      super();
      Object.assign(this, { url, protocols, readyState: 0 });
      relay.sockets.push(this);
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); this.emit({ type: "ready", createdAt: Date.now() }); }, 0);
    }
    emit(message) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
    send(text) {
      const m = JSON.parse(text);
      if (m.type === "result") relay.answers.get(m.id)?.(m);
      if (m.type === "revoke") { relay.revoked = true; this.close(4003); }
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

// Step 2, the AI agent, as in the mock-up: Claude Code picked, Codex and T3 Code switched off with a reason; Copy
// connect message copies the message (the loop, this page's address and token) and reads Waiting for Claude Code;
// the agent's first call makes it Claude Code connected and shows Test; Test hands a sample cue to the held wait and
// shows the seconds of the answer (step 2 turns done); a press on the connected button disconnects (the token is
// revoked). Returns the close-up screenshots.
async function checkAgent(page, name, out, { base, touch, clipboard }) {
  const connect = page.locator("#connectBtn");
  const testBtn = page.locator("#testBtn");
  const shots = [];
  const press = (el) => (touch ? el.tap() : el.click());
  const shoot = async (label) => {
    await page.waitForTimeout(150);
    const r = await page.locator("#sAgent").boundingBox();
    const shot = join(out, `page-${name}-agent-${label}.png`);
    await page.screenshot({ path: shot, clip: { x: 0, y: Math.max(0, r.y - 8), width: page.viewportSize().width, height: Math.min(r.height + 90, 300) } });
    shots.push(shot);
  };
  const state = () => page.evaluate(() => {
    const b = document.getElementById("connectBtn");
    const t = document.getElementById("testBtn");
    return { label: b.textContent, state: b.dataset.state ?? null, tip: b.dataset.tip ?? null, dot: b.querySelector(".dot")?.className ?? null, test: t.hidden ? null : t.textContent, testTip: t.dataset.tip ?? null, done: document.getElementById("sAgent").hasAttribute("data-done") };
  });

  assert.deepEqual(await page.locator('#agentSeg button[aria-pressed="true"]').allInnerTexts(), ["Claude Code"], `${name}: Claude Code is picked`);
  for (const off of ["codex", "t3"]) {
    const b = page.locator(`#agentSeg [data-v="${off}"]`);
    assert.equal(await b.getAttribute("aria-disabled"), "true", `${name}: ${off} is switched off`);
    assert.equal(await b.getAttribute("data-tip"), "Comes next. Use Claude Code for now.", `${name}: ${off} says why`);
  }
  assert.deepEqual(await state(), { label: "Copy connect message", state: null, tip: "Copies a message. Paste it into Claude Code.", dot: null, test: null, testTip: null, done: false }, `${name}: off, Test hidden`);
  await shoot("off");

  // Copy: waiting, and the message on the clipboard with the loop, this page's address and a producer token.
  await press(connect);
  await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "Waiting for Claude Code…");
  const waiting = await state();
  assert.equal(waiting.state, "busy", `${name}: waiting is the busy look`);
  assert.equal(waiting.dot, "dot dot--think", `${name}: with the breathing dot`);
  // Without a clipboard (a browser that refuses the write), the message shows below, selected, and the tooltip says so.
  const boxShown = await page.locator("#agentMessage").isVisible();
  assert.equal(waiting.tip, boxShown ? "Copy the message below, then paste it into Claude Code." : "Message copied. Paste it into Claude Code.", `${name}: the tooltip says what to do`);
  await page.waitForFunction(() => __relay.sockets.length === 1);
  const socket = await page.evaluate(() => ({ url: __relay.sockets[0].url, protocols: __relay.sockets[0].protocols }));
  assert.equal(socket.url, `${base.replace("http", "ws")}/api/relay`, `${name}: the relay is this site's`);
  assert.equal(socket.protocols[0], "producer", `${name}: the producer subprotocol`);
  const agentToken = socket.protocols[1].slice(2);
  assert.match(agentToken, /^pr1-[0-9a-z]{8,10}-[A-Za-z0-9_-]{43}$/, `${name}: a producer token from the Worker`);
  if (clipboard) {
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(copied.includes(`TOKEN='${agentToken}'; URL='${base}'`), `${name}: the message carries this page's address and token`);
    assert.match(copied, /```bash\n[\s\S]*while out=\$\(curl -sS -m 40 [\s\S]*```/, `${name}: and the ready-made loop`);
  }
  if (clipboard) assert.equal(boxShown, false, `${name}: the message box stays hidden when the copy worked`);
  else if (boxShown) assert.match(await page.locator("#agentMessage").inputValue(), /while out=\$\(curl/, `${name}: the shown message holds the loop`);
  await shoot("waiting");

  // The agent's first call: connected, and Test appears.
  const context = await page.evaluate(() => __relay.call("get_context"));
  assert.deepEqual(context.result, { questions: [], segments: [], seq: 0 }, `${name}: the page answers get_context`);
  await page.waitForFunction(() => document.getElementById("connectBtn").dataset.state === "ok");
  const open = await page.evaluate(() => document.querySelector("#tip[data-on]")?.textContent ?? null);
  assert.ok(open === null || open === "Click to disconnect.", `${name}: an open tooltip follows the new state (${open})`);
  assert.deepEqual(await state(), { label: "Claude Code connected", state: "ok", tip: "Click to disconnect.", dot: "dot dot--ok", test: "Test", testTip: null, done: false }, `${name}: connected`);
  const green = await page.evaluate(() => getComputedStyle(document.getElementById("connectBtn")).color);
  assert.deepEqual(await paint(page, green), await token(page, "agent-ink"), `${name}: connected reads green`);
  await shoot("connected");

  // Test: the held wait gets the sample cue; the answer in the next wait shows its seconds and the sample.
  await page.evaluate(() => { window.__wait = __relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
  await press(testBtn);
  const cue = await page.evaluate(() => window.__wait);
  assert.equal(cue.result.cue, "suggest_now", `${name}: Test hands a cue to the waiting agent`);
  assert.deepEqual(cue.result.transcript.map((e) => e.speaker), ["host", "guest"], `${name}: labelled host and guest`);
  assert.equal((await state()).test, "Testing…", `${name}: Testing while the agent answers`);
  await page.evaluate((seq) => { __relay.call("wait_for_cue", { seq, holdMs: 25000, suggestions: [{ text: "What did the first month on the road cost?", why: "follows the van story" }] }); }, cue.result.seq);
  await page.waitForFunction(() => document.getElementById("testBtn").dataset.state === "ok");
  const tested = await state();
  assert.match(tested.test, /^Test ✓ · \d+\.\d s$/, `${name}: the seconds of the round trip (${tested.test})`);
  assert.equal(tested.testTip, 'Sample: "What did the first month on the road cost?"', `${name}: the sample answer in the tooltip`);
  assert.equal(tested.done, true, `${name}: step 2 is done`);
  if (!touch) {
    await page.mouse.move(1, 1);
    await testBtn.hover();
    await page.waitForFunction(() => document.querySelector("#tip[data-on]")?.textContent.startsWith("Sample:"));
  }
  await shoot("tested");
  if (!touch) await page.keyboard.press("Escape");

  // The keyboard reaches every control of the step, in order.
  await page.locator('#agentSeg [data-v="claude"]').focus();
  const order = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.textContent.trim())); }
  assert.deepEqual(order, ["i Codex", "i T3 Code", "connectBtn", "testBtn"], `${name}: Tab order`);
  await page.keyboard.press("Escape");

  // Layout: every control inside the window; on a touch screen each one is finger-sized.
  const { width, boxes } = await page.evaluate(() => ({ width: innerWidth, boxes: [...document.querySelectorAll("#sAgent button")].map((b) => b.getBoundingClientRect().toJSON()) }));
  for (const b of boxes) assert.ok(b.left >= 0 && b.right <= width + 0.5, `${name}: step 2 fits the window`);
  if (touch) for (const b of boxes) assert.ok(b.height >= 44, `${name}: finger-sized (${b.height}px)`);

  // Disconnect: the token is revoked and the step starts over; nothing was kept in the browser.
  await press(connect);
  await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "Copy connect message");
  assert.equal(await page.evaluate(() => __relay.revoked), true, `${name}: Disconnect revokes the token`);
  assert.deepEqual(await state(), { label: "Copy connect message", state: null, tip: "Copies a message. Paste it into Claude Code.", dot: null, test: null, testTip: null, done: false }, `${name}: back to off`);
  const kept = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  assert.deepEqual(kept, { local: 0, session: 0, cookie: "" }, `${name}: the token was never stored`);
  // Leaving or reloading the page revokes the token too (the page keeps none).
  await press(connect);
  await page.waitForFunction(() => __relay.sockets.length === 2);
  await page.evaluate(() => __relay.call("get_context"));
  await page.waitForFunction(() => document.getElementById("connectBtn").dataset.state === "ok");
  await page.evaluate(() => { __relay.revoked = false; dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })); });
  assert.equal(await page.evaluate(() => __relay.revoked), true, `${name}: leaving the page revokes the token`);
  assert.equal((await state()).label, "Copy connect message", `${name}: and the step starts over`);
  await page.evaluate(() => document.activeElement?.blur());
  return shots;
}

export async function run({ browser, playwright, base, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);

  for (const view of VIEWS) {
    const { name, ...options } = view;
    const context = await browser.newContext(options);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await context.newPage();
    await page.addInitScript(fakeRelay);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });

    const response = await page.goto(`${base}/`);
    assert.equal(response.status(), 200, `${name}: the page loads`);
    assert.equal(await page.title(), "Producer", `${name}: title`);

    // The page asks for no outside file: its own document is the only request, and the browser reports no problem.
    assert.deepEqual(requests, [`${base}/`], `${name}: only the page itself was requested`);
    assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation`);
    ok(`${name}: loads, one request, no console problem`);

    // The policy header reaches the browser, and the browser honours it (microphone and screen capture are on for this site).
    const headers = response.headers();
    assert.match(headers["permissions-policy"], /microphone=\(self\)/, `${name}: microphone for this site`);
    assert.match(headers["permissions-policy"], /display-capture=\(self\)/, `${name}: screen capture for this site`);
    assert.equal(await page.evaluate(() => document.featurePolicy?.allowsFeature("microphone") ?? true), true, `${name}: the page may use the microphone`);
    assert.equal(await page.evaluate(() => document.featurePolicy?.allowsFeature("display-capture") ?? true), true, `${name}: the page may capture the screen`);
    assert.equal(await page.evaluate(() => document.featurePolicy?.allowsFeature("camera") ?? false), false, `${name}: no camera`);
    ok(`${name}: page policy`);

    // No storage: nothing written by loading, using the tooltip or waiting.
    const kept = await page.evaluate(async () => ({
      local: localStorage.length, session: sessionStorage.length, cookie: document.cookie,
      databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length,
    }));
    assert.deepEqual(kept, { local: 0, session: 0, cookie: "", databases: 0, caches: 0 }, `${name}: nothing stored`);
    ok(`${name}: nothing stored`);

    // Layout: the bar fits, the page does not scroll sideways, the shell fills the window.
    const box = await page.evaluate(() => {
      const top = document.querySelector(".top").getBoundingClientRect();
      const chip = document.querySelector(".private").getBoundingClientRect();
      const screen = document.querySelector("#screen").getBoundingClientRect();
      return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, scrollHeight: document.documentElement.scrollHeight, top, chip, screen };
    });
    assert.ok(box.scrollWidth <= box.width, `${name}: no sideways scroll (${box.scrollWidth} > ${box.width})`);
    assert.ok(box.scrollHeight <= box.height, `${name}: the setup screen does not scroll (${box.scrollHeight} > ${box.height})`);
    assert.ok(box.top.left === 0 && Math.round(box.top.width) === box.width, `${name}: the bar spans the window`);
    assert.ok(box.chip.right <= box.width && box.chip.left >= 0, `${name}: the Private chip is inside the window`);
    assert.ok(box.screen.top >= box.top.bottom - 0.5 && Math.round(box.screen.bottom) === box.height, `${name}: the screen fills the rest`);
    ok(`${name}: layout`);

    // The words: the name always; the label "Private" always readable (shown wide, hidden visually on a phone), the show line wide only.
    const words = await page.evaluate(() => ({
      brand: document.querySelector(".brand").textContent.replace(/\s+/g, " ").trim(),
      showLine: getComputedStyle(document.querySelector(".brand small")).display,
      chip: document.querySelector(".private").textContent.trim(),
      chipLabelWidth: document.querySelector(".private .long").getBoundingClientRect().width,
    }));
    assert.match(words.brand, /^Producer/, `${name}: brand`);
    assert.equal(words.chip, "Private", `${name}: the chip's name`);
    if (options.isMobile) {
      assert.equal(words.showLine, "none", `${name}: the show line makes room on a phone`);
      assert.ok(words.chipLabelWidth <= 1, `${name}: the label is hidden visually, still read aloud`);
    } else {
      assert.notEqual(words.showLine, "none", `${name}: the show line shows`);
      assert.ok(words.chipLabelWidth > 20, `${name}: the label shows`);
    }
    ok(`${name}: words`);

    // Theme: the page follows the system.
    const bg = await paint(page, "body");
    if (options.colorScheme === "light") assert.ok(lightness(bg) > 0.9, `${name}: light page (${bg})`);
    else assert.ok(lightness(bg) < 0.1, `${name}: dark page (${bg})`);
    ok(`${name}: ${options.colorScheme} theme`);

    const plain = join(out, `page-${name}.png`);
    await page.screenshot({ path: plain });
    screenshots.push(plain);

    await checkSetup(page, name, { phone: Boolean(options.isMobile), touch: Boolean(options.hasTouch), chip: options.isMobile ? /^Chrome 157 · phone$/ : /^Chrome \d+ · desktop$/ });
    ok(`${name}: the setup screen (browser chip, step 1, picking by mouse${options.hasTouch ? ", tap" : ""} and keyboard, ${options.isMobile ? "compact" : "wide"} layout, no extra words)`);

    screenshots.push(...await checkAgent(page, name, out, { base, touch: Boolean(options.hasTouch), clipboard: true }));
    assert.deepEqual(requests, [`${base}/`, `${base}/api/agent-token`, `${base}/api/agent-token`], `${name}: besides the page, only this site's token was asked for (once per connection)`);
    assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation while connecting`);
    ok(`${name}: step 2 (copy the connect message, waiting, connected, Test with its seconds, Disconnect), by ${options.hasTouch ? "tap" : "mouse"} and keyboard`);

    // The Private chip is a real control (a button), so a screen reader and the keyboard reach it as one.
    assert.equal(await page.locator(".private").evaluate((el) => el.tagName), "BUTTON", `${name}: the chip is a button`);

    // The one shared tooltip: hover (after a short delay), focus, tap; inside the window; Escape and leaving hide it.
    const chip = page.locator(".private");
    const tip = page.locator("#tip");
    const tipInside = async () => page.evaluate(() => { const r = document.querySelector("#tip").getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
    const expected = "Only you see this window. Never share it on stream.";
    if (options.hasTouch) {
      await chip.tap();
    } else {
      await chip.hover();
    }
    await page.waitForSelector("#tip[data-on]");
    await page.waitForTimeout(200); // the fade-in
    assert.equal(await tip.textContent(), expected, `${name}: tooltip text`);
    assert.ok(await tipInside(), `${name}: the tooltip is inside the window`);
    assert.equal(await chip.getAttribute("aria-describedby"), "tip", `${name}: the chip is described by the tooltip`);
    const closeUp = join(out, `page-${name}-tooltip.png`);
    await page.screenshot({ path: closeUp, clip: { x: 0, y: 0, width: Math.min(options.viewport.width, 640), height: 140 } });
    screenshots.push(closeUp);
    await page.keyboard.press("Escape");
    assert.equal(await tip.getAttribute("data-on"), null, `${name}: Escape hides it`);
    assert.equal(await chip.getAttribute("aria-describedby"), null, `${name}: and the description goes with it`);
    ok(`${name}: tooltip on ${options.hasTouch ? "tap" : "hover"}`);
    // The chip is the first control in the tab order: one Shift+Tab back from the screen below the bar lands on it.
    await page.mouse.move(5, 400);
    await page.locator("body").click({ position: { x: 5, y: 400 } });
    assert.equal(await tip.getAttribute("data-on"), null, `${name}: a press elsewhere hides it`);
    await page.keyboard.press("Shift+Tab");
    assert.ok(await chip.evaluate((el) => el === document.activeElement), `${name}: Shift+Tab reaches the Private chip`);
    await page.waitForSelector("#tip[data-on]");
    assert.equal(await tip.textContent(), expected, `${name}: tooltip text on focus`);
    ok(`${name}: tooltip on keyboard focus`);
    // Reading the tooltip: with a mouse it stays open while the pointer crosses onto it, and goes when the pointer leaves both.
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.activeElement?.blur());
    if (!options.hasTouch) {
      await chip.hover();
      await page.waitForSelector("#tip[data-on]");
      const t = await tip.boundingBox();
      await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
      await page.waitForTimeout(400);
      assert.notEqual(await tip.getAttribute("data-on"), null, `${name}: the tooltip stays while the pointer is on it`);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(200);
      assert.notEqual(await tip.getAttribute("data-on"), null, `${name}: a press on the tooltip (to select its words) does not close it`);
      await page.mouse.move(5, 600, { steps: 4 });
      await page.waitForFunction(() => !document.querySelector("#tip").hasAttribute("data-on"));
      ok(`${name}: the tooltip can be hovered, and leaves with the pointer`);
    }

    // More controls with a tip, made with the DOM (the page's policy forbids inline styles and handlers): one at each
    // edge, a switched-off one, and a short tip at the right edge followed by a long one near it. Each tooltip is
    // measured fresh, stays inside the window and is as wide as its text wants (a stale position once squeezed it).
    const LONG = "A long reason that wraps onto a few lines when it is shown close to the right edge of the window.";
    const controls = [
      ["edge-r", "R", LONG, "right:0;bottom:0"],
      ["edge-l", "L", "Left edge, so the tooltip must not hang off the left side.", "left:0;top:200px"],
      ["off", "Off", "Not available yet.", "left:40%;top:300px"],
      ["edge-s", "S", "Hi", "right:0;top:400px"],
      ["edge-w", "W", LONG, "right:40px;top:450px"],
    ];
    await page.evaluate((list) => {
      for (const [id, label, text, css] of list) {
        const b = Object.assign(document.createElement("button"), { id, textContent: label });
        b.dataset.tip = text;
        b.style.cssText = `position:fixed;${css}`;
        if (id === "off") { b.setAttribute("aria-disabled", "true"); b.onclick = () => { window.pressed = true; }; }
        document.body.append(b);
      }
    }, controls);
    const showOwn = async (id, text) => {
      const control = page.locator(`#${id}`);
      if (options.hasTouch) await control.tap({ force: true }); else await control.hover({ force: true });
      await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, text);
      await page.waitForTimeout(150);
    };
    for (const [id, , text] of controls) {
      await showOwn(id, text);
      assert.ok(await tipInside(), `${name}: the tooltip of #${id} is inside the window`);
      if (id === "edge-w") {
        const width = (await tip.boundingBox()).width;
        const wanted = Math.min(280, options.viewport.width - 24);
        assert.ok(width >= wanted - 30, `${name}: the tooltip of #${id} is ${Math.round(width)}px wide, not squeezed (about ${wanted})`);
      }
      if (id !== "edge-s") await page.keyboard.press("Escape");
    }
    await page.locator("#off").click({ force: true });
    await page.waitForFunction(() => document.querySelector("#tip[data-on]")?.textContent === "Not available yet.");
    assert.equal(await page.evaluate(() => window.pressed ?? false), false, `${name}: a switched-off control shows its reason when pressed, and does not run its action`);
    ok(`${name}: tooltip placement at both edges and after a short one, and the reason of a switched-off control`);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { for (const id of ["edge-r", "edge-l", "off", "edge-s", "edge-w"]) document.getElementById(id).remove(); });

    screenshots.push(...await checkSwitchedOff(page, name, out, { touch: Boolean(options.hasTouch) }));
    ok(`${name}: a switched-off choice looks off, shows its reason by ${options.hasTouch ? "tap" : "mouse"} and keyboard, and is never picked`);
    await context.close();
  }

  // The compact switch point is the mock-up's: at a 620px window the choices sit under the label, at 625px beside it
  // (the old switch point sat near 630px). A 320px phone may wrap the choices, but never scrolls sideways.
  for (const [width, compact] of [[620, true], [625, false], [320, true]]) {
    const context = await browser.newContext({ viewport: { width, height: 700 }, ...(width === 320 ? { isMobile: true, hasTouch: true } : {}) });
    const page = await context.newPage();
    await page.goto(`${base}/`);
    const box = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect().toJSON();
      return { label: r("#sStream .step__label"), seg: r("#streamSeg"), scrollWidth: document.documentElement.scrollWidth, buttons: [...document.querySelectorAll("#streamSeg button")].map((b) => b.getBoundingClientRect().toJSON()) };
    });
    assert.ok(box.scrollWidth <= width, `${width}px: no sideways scroll`);
    for (const b of box.buttons) assert.ok(b.left >= box.seg.left && b.right <= box.seg.right, `${width}px: every choice sits inside its row`);
    if (compact) assert.ok(box.seg.top >= box.label.bottom, `${width}px: compact, the choices sit under the label`);
    else assert.ok(box.seg.left >= box.label.right && box.seg.top < box.label.bottom, `${width}px: wide, the choices sit beside the label`);
    await context.close();
  }
  ok("the setup goes compact at a 620px window, as in the mock-up");

  // Step 2 when things go wrong, in Chromium: no token (the Worker says too many tries), no clipboard (the message
  // shows, selected, to copy by hand), and the real relay socket under the page's policy.
  {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();
    const problems = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
    await page.addInitScript(fakeRelay);
    await page.addInitScript(() => {
      const refuse = () => Promise.reject(new DOMException("Write permission denied.", "NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", { value: { write: refuse, writeText: refuse }, configurable: true });
    });
    await page.route("**/api/agent-token", (route) => route.fulfill({ status: 429, contentType: "application/json", body: '{"error":"Too many requests"}' }));
    await page.goto(`${base}/`);
    const connect = page.locator("#connectBtn");
    await connect.click();
    await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "No connection · try again");
    assert.equal(await page.evaluate(() => __relay.sockets.length), 0, "no token: no relay socket");
    assert.equal(await page.locator("#agentMessage").isHidden(), true, "no token: no message");
    await page.unroute("**/api/agent-token");
    await connect.click();
    await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "Waiting for Claude Code…");
    await page.locator("#agentMessage").waitFor({ state: "visible" });
    const box = await page.evaluate(() => {
      const b = document.getElementById("agentMessage");
      return { focused: document.activeElement === b, start: b.selectionStart, end: b.selectionEnd, length: b.value.length, value: b.value, tip: document.getElementById("connectBtn").dataset.tip, protocols: __relay.sockets[0].protocols };
    });
    assert.ok(box.focused && box.start === 0 && box.end === box.length, "no clipboard: the message shows, focused and selected");
    assert.ok(box.value.includes(`TOKEN='${box.protocols[1].slice(2)}'; URL='${base}'`) && box.value.includes("while out=$(curl"), "it holds this page's token, address and loop");
    assert.equal(box.tip, "Copy the message below, then paste it into Claude Code.", "the tooltip says so");
    const shot = join(out, "page-desktop-light-agent-no-clipboard.png");
    const r = await page.locator("#sAgent").boundingBox();
    await page.screenshot({ path: shot, clip: { x: 0, y: Math.max(0, r.y - 8), width: 1366, height: r.height + 24 } });
    screenshots.push(shot);
    await page.evaluate(() => __relay.call("get_context"));
    await page.waitForFunction(() => document.getElementById("connectBtn").dataset.state === "ok");
    assert.equal(await page.locator("#agentMessage").isHidden(), true, "the message box goes once the agent is connected");
    assert.deepEqual(problems.filter((p) => !p.includes("429")), [], "no console problem beyond the refused token");
    await context.close();

    // The real WebSocket under the page's own policy: the browser may try this site's relay (the upgrade fails here,
    // there is no relay object), and the policy does not block it.
    const real = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await real.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const plain = await real.newPage();
    const blocked = [];
    plain.on("console", (m) => { if (/CSP|Content Security Policy|Refused to connect/i.test(m.text())) blocked.push(m.text()); });
    await plain.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
    const tried = [];
    plain.on("websocket", (ws) => tried.push(ws.url()));
    await plain.goto(`${base}/`);
    await plain.locator("#connectBtn").click();
    await plain.waitForFunction(() => document.getElementById("connectBtn").textContent === "Waiting for Claude Code…");
    for (let i = 0; i < 50 && !tried.length; i++) await plain.waitForTimeout(20);
    assert.deepEqual(tried, [`${base.replace("http", "ws")}/api/relay`], "the page opens this site's relay socket");
    await plain.waitForTimeout(200);
    assert.deepEqual(blocked, [], "the page policy lets the relay socket through");
    await real.close();
  }
  ok("step 2: no token says so and recovers; without a clipboard the message shows selected; the page policy lets the real relay socket through");

  // The same screen in a real Firefox: it names itself, lays out the same and keeps every rule (no request, no
  // console problem). Firefox has no switched-off row of its own yet: the rows that switch off there come with
  // their features.
  const { firefox } = playwright;
  const fox = await firefox.launch({ headless: true });
  try {
    for (const colorScheme of ["light", "dark"]) {
      const name = `firefox-desktop-${colorScheme}`;
      const context = await fox.newContext({ colorScheme, viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      const requests = [];
      const problems = [];
      page.on("request", (r) => requests.push(r.url()));
      page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
      page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
      await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
      assert.equal((await page.goto(`${base}/`)).status(), 200, `${name}: the page loads`);
      assert.deepEqual(requests, [`${base}/`], `${name}: only the page itself was requested`);
      assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation`);
      const bg = await paint(page, "body");
      assert.ok(colorScheme === "light" ? lightness(bg) > 0.9 : lightness(bg) < 0.1, `${name}: ${colorScheme} page (${bg})`);
      const plain = join(out, `page-${name}.png`);
      await page.screenshot({ path: plain });
      screenshots.push(plain);
      await page.addInitScript(fakeRelay);
      await page.reload();
      await checkSetup(page, name, { phone: false, touch: false, chip: /^Firefox \d+ · desktop$/ });
      screenshots.push(...await checkAgent(page, name, out, { base, touch: false, clipboard: false }));
      screenshots.push(...await checkSwitchedOff(page, name, out, { touch: false }));
      ok(`${name}: loads alone, names Firefox, the setup screen works and a switched-off choice shows its reason`);
      await context.close();
    }
  } finally {
    await fox.close();
  }

  // The Worker answers a page request only for the page: a POST is refused.
  const post = await fetch(`${base}/`, { method: "POST", body: "private talk" });
  assert.equal(post.status, 405, "a POST is refused");
  assert.equal((await fetch(`${base}/nothing-here`)).status, 404, "an unknown address is a 404");
  ok("the Worker refuses a POST and answers an unknown address with 404");
  return { checks, screenshots };
}
