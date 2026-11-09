// Browser checks for `kit specs questions`: the Next question card on the producer screen (card 11), in Chromium
// through the real Worker. Desktop 1366x900 (wide) and phone 390x844 (compact), light and dark. The microphone, the
// speech worker and the relay are stand-ins (as in the cues suite); the relay stand-in plays the agent (the fake agent).
// Time is Playwright's clock, running, so the 10 s spacing and the minute of thinking can be skipped at once.
// Checks: the first prepared question shows from the start; Suggest now sends a cue at once, says Thinking… on itself
// and lights the quiet thinking light without moving the card; the agent's answer takes the card once (question, a few
// words why, its source chip, the two to swap in) and the spacing shows on the button; Slow down doubles it; an
// alternative swaps in; Asked and Skip move on, by touch and by keyboard; an agent with no answer leaves the card; a
// disconnected agent leaves the list question and switches Suggest now off with "no agent"; layouts; nothing stored.
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

// Made-up names and questions.
const PLAN = ["Show: Techies Live", "Guest: Jane Doe", "3 Intro", "8 Her story", "1. How did it start?", "2. Who paid first?", "3. What went wrong first?", "4. What would you change now?"].join("\n");

// Stand-ins: the microphone and the studio tab (quiet tones), the speech worker (ready at once) and the relay
// (window.__relay.call(tool, args) plays one agent call; window.__relay.sockets.at(-1).close(4003) ends the token).
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
}

async function shareTab(page, press) {
  if ((await page.locator("#tabBtn").getAttribute("aria-disabled")) === "true") return;
  await press(page.locator("#tabBtn"));
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
}

// Contrast of an element's text on what it is painted over (its own background over the panel's), as the browser paints it.
const paintedContrast = (locator) => locator.evaluate((el) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const px = (...fills) => { c.clearRect(0, 0, 1, 1); for (const f of fills) { c.fillStyle = f; c.fillRect(0, 0, 1, 1); } return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const panel = getComputedStyle(el.closest(".panel")).backgroundColor;
  const [hi, lo] = [lum(px(getComputedStyle(el).color)), lum(px(panel, getComputedStyle(el).backgroundColor))].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
});

/** Setup to the producer screen; with `agent`, the fake agent connects first (get_context, so the link is on). */
async function openScreen(page, press, { agent }) {
  await press(page.locator("#planBtn"));
  await page.locator("#planIn").fill(PLAN);
  if (agent) {
    await press(page.locator("#connectBtn"));
    await page.waitForFunction(() => window.__relay.sockets.length === 1 && window.__relay.sockets[0].readyState === 1);
    await page.evaluate(() => window.__relay.call("get_context"));
  }
  await press(page.locator("#guestSeg button").first());
  await press(page.locator("#micBtn"));
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await shareTab(page, press);
  await press(page.locator("#speechBtn"));
  await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
  await press(page.locator("#goBtn"));
}

export async function run({ browser, base, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);

  for (const view of VIEWS) {
    const { name, ...options } = view;
    const phone = Boolean(options.isMobile);
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-09T19:00:00Z") });
    await page.addInitScript(standIns);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    // A switched-off control is still pressed (it shows its reason); Playwright would wait for it to switch on.
    const pressOff = (locator) => (options.hasTouch ? locator.tap({ force: true }) : locator.click({ force: true }));
    const text = (sel) => page.locator(sel).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const card = async () => ({
      q: await text("#qMain"),
      why: await page.locator("#qWhy").isVisible() ? await text("#qWhy") : null,
      src: await text("#qSrc"),
      alts: await page.locator("#alts .alt").evaluateAll((els) => els.map((el) => [el.querySelector(".alt__q").textContent, el.querySelector(".chip").textContent])),
    });
    const suggest = page.locator("#suggestBtn");
    const light = () => page.locator("#thinkDot").evaluate((el) => ({ cls: el.className, label: el.getAttribute("aria-label"), tip: el.dataset.tip }));
    const shot = async (file) => { const path = join(out, `questions-${name}-${file}.png`); await page.keyboard.press("Escape"); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(200); await page.screenshot({ path }); screenshots.push(path); };

    await openScreen(page, press, { agent: true });
    const next = page.locator("#next");
    assert.equal(await next.isVisible(), true, `${name}: the Next question card shows`);
    assert.equal(await text("#nextTitle"), "Next question", `${name}: its heading`);

    // The start: the first prepared question, never an empty card; the agent is ready, Suggest now is on.
    assert.deepEqual(await card(), { q: "How did it start?", why: "Next on your list.", src: "Q1 · your list", alts: [["Who paid first?", "Q2 · your list"], ["What went wrong first?", "Q3 · your list"]] }, `${name}: the first prepared question at the start`);
    assert.deepEqual(await light(), { cls: "dot dot--ok", label: "Agent ready", tip: "Agent ready." }, `${name}: the light is green`);
    assert.deepEqual([await text("#suggestBtn"), await suggest.getAttribute("aria-disabled")], ["Suggest now", null], `${name}: Suggest now is on`);
    assert.deepEqual([await text("#turnChip"), await page.locator("#slowBtn").getAttribute("aria-checked")], ["0 turns", "false"], `${name}: no turn yet, Slow down off`);
    await shot("start");
    if (!phone) {
      // "Next on your list." only while the card shows the first prepared question still open.
      await page.locator("#alts .alt").nth(1).click(); // Q3 on the card
      assert.equal(await page.locator("#qWhy").isVisible(), false, `${name}: no "Next on your list." for Q3 while Q1 is open`);
      await page.locator("#alts .alt").nth(1).click(); // Q1 back
      assert.equal(await text("#qWhy"), "Next on your list.", `${name}: back on Q1`);
    }
    ok(`${name}: the first prepared question from the start, the light green, Suggest now on`);

    // Suggest now: the cue reaches the agent's wait at once; the button and the light say the agent thinks; the card
    // keeps its question and does not move.
    const box = await next.boundingBox();
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
    await press(suggest);
    const cue = await page.evaluate(async () => (await window.__wait).result);
    assert.deepEqual([cue.cue, cue.seq], ["suggest_now", 1], `${name}: Suggest now sends a cue at once`);
    assert.deepEqual([await text("#suggestBtn"), await suggest.getAttribute("data-state")], ["Thinking…", "busy"], `${name}: Thinking… on the button`);
    const busyContrast = await paintedContrast(suggest);
    assert.ok(busyContrast >= 4.5, `${name}: Thinking… reads at ${busyContrast.toFixed(2)}:1`);
    assert.deepEqual(await light(), { cls: "dot dot--think", label: "Agent is thinking", tip: "Agent is thinking. The card stays until it is ready." }, `${name}: the quiet light breathes`);
    assert.equal((await card()).q, "How did it start?", `${name}: the card keeps its question while the agent thinks`);
    assert.deepEqual(await next.boundingBox(), box, `${name}: the thinking light does not move the card`);
    assert.equal(await text("#turnChip"), "1 turn", `${name}: one turn`);
    await shot("thinking");
    ok(`${name}: Suggest now: a cue at once, Thinking… on the button, the light breathes, the card stays put`);

    // The answer: the agent's first suggestion takes the card with its why and source; the others and the old question
    // to swap in. The spacing shows on the button; a press too soon sends nothing and shows why.
    // The card's own share of the time: from the agent's answer arriving to the new question on screen.
    const onScreenMs = await page.evaluate(() => new Promise((resolve) => {
      const main = document.querySelector("#qMain");
      const t0 = performance.now();
      new MutationObserver((_, o) => { if (main.textContent === "What went wrong first?") { o.disconnect(); resolve(performance.now() - t0); } }).observe(main, { childList: true, characterData: true, subtree: true });
      window.__wait = window.__relay.call("wait_for_cue", { seq: 1, holdMs: 25000, suggestions: [{ question: 3, why: "She hinted at a hard first year." }, { text: "What surprised you most about who pays?", why: "Ties to her pricing story." }] });
    }));
    assert.ok(onScreenMs < 300, `${name}: answer in to question on screen in ${onScreenMs.toFixed(1)} ms, under 300 ms`);
    assert.deepEqual(await card(), { q: "What went wrong first?", why: "She hinted at a hard first year.", src: "Q3 · your list", alts: [["What surprised you most about who pays?", "New"], ["How did it start?", "Q1 · your list"]] }, `${name}: the agent's answer on the card`);
    assert.deepEqual(await light(), { cls: "dot dot--ok", label: "Agent ready", tip: "Agent ready." }, `${name}: the light is green again`);
    assert.match(await text("#suggestBtn"), /^Suggest now · (9|10) s$/, `${name}: the 10 s spacing on the button`);
    assert.deepEqual([await suggest.getAttribute("aria-disabled"), await suggest.getAttribute("data-tip")], ["true", "One every 10 s."], `${name}: switched off with its reason`);
    await pressOff(suggest);
    await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, "One every 10 s.");
    const cued = await page.evaluate(() => Promise.race([window.__wait.then(() => true), new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(false))))]));
    assert.equal(cued, false, `${name}: the press too soon sends no cue (the agent's wait stays held)`);
    ok(`${name}: a press too soon shows the reason in the tooltip`);
    const accent = await paintedContrast(page.locator("#qSrc"));
    assert.ok(accent >= 4.5, `${name}: the source chip reads at ${accent.toFixed(2)}:1`);
    await shot("suggestion");
    ok(`${name}: the answer takes the card with why and source, the two to swap in (on screen in ${onScreenMs.toFixed(1)} ms); the 10 s spacing on the button`);

    // The curl loop sends the same answer again after an idle round: shown once.
    // Skip: a tap on a phone, the keyboard (Enter) on a computer.
    if (phone) await press(page.locator("#skipBtn")); else { await page.locator("#skipBtn").focus(); await page.keyboard.press("Enter"); }
    assert.equal((await card()).q, "What surprised you most about who pays?", `${name}: Skip moves to the first alternative`);
    await page.evaluate(() => window.__relay.call("post_suggestions", { suggestions: [{ question: 3, why: "She hinted at a hard first year." }, { text: "What surprised you most about who pays?", why: "Ties to her pricing story." }] }));
    assert.equal((await card()).q, "What surprised you most about who pays?", `${name}: the same answer again changes nothing`);
    ok(`${name}: an answer is shown once`);

    // After 10 s Suggest now is on again; Slow down doubles the spacing.
    await page.clock.fastForward(10_000);
    await page.waitForFunction(() => document.querySelector("#suggestBtn").textContent === "Suggest now");
    assert.equal(await suggest.getAttribute("aria-disabled"), null, `${name}: Suggest now is on again after 10 s`);
    if (phone) await press(page.locator("#slowBtn")); else { await page.locator("#slowBtn").focus(); await page.keyboard.press("Space"); }
    assert.equal(await page.locator("#slowBtn").getAttribute("aria-checked"), "true", `${name}: Slow down on`);
    assert.equal(await page.locator("#turnChip").getAttribute("data-tip"), "Agent turns this show. At most one in 2 minutes on its own.", `${name}: the turn chip's tooltip follows Slow down`);
    await press(suggest);
    await page.evaluate(() => window.__wait);
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 2, holdMs: 25000, suggestions: [{ text: "Who was your first hire, and why them?" }] }); });
    await page.waitForFunction(() => document.querySelector("#qMain").textContent === "Who was your first hire, and why them?");
    assert.deepEqual([await page.locator("#qWhy").isVisible(), await text("#qSrc")], [false, "New"], `${name}: no why when the agent gave none`);
    assert.match(await text("#suggestBtn"), /^Suggest now · (19|20) s$/, `${name}: 20 s with Slow down`);
    assert.equal(await suggest.getAttribute("data-tip"), "One every 20 s with Slow down.", `${name}: and says so`);
    assert.equal(await text("#turnChip"), "2 turns", `${name}: two turns`);
    ok(`${name}: Slow down doubles the spacing; a suggestion with no why shows none`);

    // An alternative swaps in (by keyboard on a computer: the focus stays on it); Asked by keyboard moves on.
    const before = await card();
    if (phone) await press(page.locator("#alts .alt").nth(1)); else { await page.locator("#alts .alt").nth(1).focus(); await page.keyboard.press("Enter"); }
    const swapped = await card();
    assert.deepEqual([swapped.q, swapped.alts[1][0]], [before.alts[1][0], before.q], `${name}: an alternative swaps with the card`);
    if (!phone) assert.ok(await page.evaluate(() => document.activeElement === document.querySelectorAll("#alts .alt")[1]), `${name}: the focus stays on the alternative`);
    await page.locator("#askedBtn").focus();
    await page.keyboard.press("Enter");
    assert.equal((await card()).q, swapped.alts[0][0], `${name}: Asked (Enter) moves to the first alternative`);
    ok(`${name}: an alternative swaps in; Asked by keyboard moves on`);

    // An agent that takes the cue and gives no answer: the card stays as it is; the light and the button are back at once.
    await page.clock.fastForward(20_000);
    const kept = await card();
    await press(suggest);
    assert.equal(await text("#suggestBtn"), "Thinking…", `${name}: thinking`);
    assert.equal((await page.evaluate(() => window.__wait)).result.seq, 3, `${name}: the cue reached the agent's wait`);
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 3, holdMs: 25000 }); });
    await page.waitForFunction(() => document.querySelector("#thinkDot").className === "dot dot--ok");
    assert.match(await text("#suggestBtn"), /^Suggest now · (19|20) s$/, `${name}: Suggest now counts down again`);
    assert.deepEqual(await card(), kept, `${name}: no answer leaves the card as it is`);
    ok(`${name}: an agent that gives no answer: the card stays; the light and Suggest now are back at once`);

    // An agent that takes the cue and keeps calling (an older seq: the cue comes again) but never answers: after a
    // minute the light goes back to green and Suggest now is on again; the card stays as it is.
    await page.clock.fastForward(20_000);
    await press(suggest);
    assert.equal((await page.evaluate(() => window.__wait)).result.seq, 4, `${name}: the cue reached the agent's wait`);
    for (let i = 0; i < 4; i++) {
      const again = await page.evaluate(() => window.__relay.call("wait_for_cue", { seq: 3, holdMs: 25000 }));
      assert.equal(again.result.seq, 4, `${name}: the agent is handed the cue again`);
      assert.equal(await text("#suggestBtn"), "Thinking…", `${name}: still thinking (${i * 16} s)`);
      await page.clock.fastForward(16_000);
    }
    await page.waitForFunction(() => document.querySelector("#thinkDot").className === "dot dot--ok");
    assert.deepEqual([await text("#suggestBtn"), await suggest.getAttribute("aria-disabled")], ["Suggest now", null], `${name}: after a minute Suggest now is on again`);
    assert.deepEqual(await card(), kept, `${name}: the card stays as it is`);
    ok(`${name}: an agent that never answers: after a minute the light and Suggest now are back`);

    // The agent disconnects mid-show: the card keeps its question, Suggest now says "no agent" on itself, the light is grey.
    await page.evaluate(() => window.__relay.sockets.at(-1).close(4003));
    await page.waitForFunction(() => document.querySelector("#suggestBtn").getAttribute("aria-disabled") === "true");
    assert.deepEqual(await card(), kept, `${name}: the card keeps its question`);
    assert.deepEqual([await text("#suggestBtn"), await suggest.getAttribute("data-tip")], ["i Suggest now · no agent", "No agent connected. The next question comes from your list."], `${name}: "no agent" on Suggest now`);
    assert.deepEqual(await light(), { cls: "dot", label: "No agent", tip: "No agent: the next question comes from your list." }, `${name}: the light is grey`);
    await press(page.locator("#askedBtn"));
    assert.ok((await text("#qMain")).length > 0, `${name}: Asked still moves on from the list`);
    await shot("no-agent");
    ok(`${name}: a disconnected agent leaves the question; Suggest now "no agent"; the light grey`);

    // Layout: wide puts the card in the left column beside the run order, compact on top; nothing sideways; touch sizes.
    const lay = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, next: document.querySelector("#next").getBoundingClientRect().toJSON(), runs: document.querySelector("#runs").getBoundingClientRect().toJSON() }));
    assert.ok(lay.scroll <= lay.width, `${name}: no sideways scroll (${lay.scroll} > ${lay.width})`);
    if (phone) assert.ok(lay.next.bottom <= lay.runs.top && lay.next.width >= lay.width - 2 * 12, `${name}: compact: the card on top, across the window`);
    else assert.ok(lay.next.right <= lay.runs.left && lay.next.width > lay.runs.width, `${name}: wide: the card is the wide left column`);
    if (options.hasTouch) for (const sel of ["#askedBtn", "#skipBtn", "#suggestBtn", "#slowBtn", "#alts .alt"]) {
      const h = await page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(h >= 44, `${name}: ${sel} is finger-sized (${h}px)`);
    }
    ok(`${name}: ${phone ? "compact" : "wide"} layout`);

    // Nothing kept, nothing sent but the token request.
    const stored = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length }));
    assert.deepEqual(stored, { local: 0, session: 0, cookie: "", databases: 0 }, `${name}: nothing stored`);
    assert.deepEqual(requests, ["/", "/api/agent-token"], `${name}: only the page and the token request`);
    assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation`);
    ok(`${name}: nothing stored, nothing sent`);
    await context.close();
  }

  // No agent at all: the list question shows and Suggest now is off with "no agent".
  {
    const context = await browser.newContext(VIEWS[0]);
    const page = await context.newPage();
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    await openScreen(page, (l) => l.click(), { agent: false });
    assert.equal(await page.locator("#qMain").textContent(), "How did it start?", "no agent: the first prepared question");
    assert.deepEqual([await page.locator("#suggestBtn").textContent(), await page.locator("#suggestBtn").getAttribute("aria-disabled")], ["i Suggest now · no agent", "true"], "no agent: Suggest now off, saying so");
    await page.locator("#suggestBtn").click({ force: true });
    await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, "No agent connected. The next question comes from your list.");
    ok("no agent from the start: the list question; Suggest now off with no agent");
    await context.close();
  }

  // No plan and no agent: the card says there is no question, and Asked and Skip are off.
  {
    const context = await browser.newContext(VIEWS[2]);
    const page = await context.newPage();
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    await page.locator("#guestSeg button").first().tap();
    await page.locator("#micBtn").tap();
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    await page.locator("#speechBtn").tap();
    await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
    await page.locator("#goBtn").tap();
    assert.equal(await page.locator("#qMain").textContent(), "No question yet", "no plan: no question yet");
    assert.deepEqual([await page.locator("#askedBtn").getAttribute("aria-disabled"), await page.locator("#skipBtn").getAttribute("aria-disabled")], ["true", "true"], "no plan: Asked and Skip off");
    assert.equal(await page.locator("#alts .alt").count(), 0, "no plan: nothing to swap in");
    const path = join(out, "questions-phone-no-plan.png");
    await page.screenshot({ path });
    screenshots.push(path);
    ok("no plan, no agent: No question yet; Asked and Skip off");
    await context.close();
  }

  return { checks, screenshots };
}
