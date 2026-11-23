// Browser checks for `kit specs relevant`: the "Relevant now" list under the search box (TOOLS-346, built to the
// approved prototype TOOLS-343), in Chromium through the real Worker. Desktop 1366x900 and phone 390x844, light and
// dark. The microphone, the studio tab and the speech worker are stand-ins; a stand-in agent plays the agent's calls.
// Checks: before the agent's first answer the rows to swap in show as before and no list; the agent's answer (up to six
// matches, best first) puts its best match on the card and the rest in "Relevant now", grouped by part in the order of
// their best match, with the count, under a few frames; the cue carries the questions already asked; a click puts a
// match on the card ("Picked by you") and it stays through the next answer, which changes only the list; Asked takes the
// best match still open; the search hides the list while it holds words; "on now" marks the part on now; nothing stored.
import assert from "node:assert/strict";
import { join } from "node:path";

// The Worker limits tokens per client address; each browser context gets its own made-up one (documentation range).
let nextClient = 0;
const ownAddress = (options) => ({ ...options, extraHTTPHeaders: { "cf-connecting-ip": `2001:db8:44:${++nextClient}::1` } });

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];

// Stand-ins: the microphone and the studio tab (quiet tones), the speech worker (ready at once) and the relay
// (window.__relay.call(tool, args) plays one agent call).
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

// A stand-in show the size of a real one: 10 parts and 72 questions, each part's questions under it.
function bigPlan() {
  const lines = ["Show: Relevant Test", "Guest: Sam Example"];
  let n = 0;
  for (let p = 0; p < 10; p++) {
    lines.push(`${p + 3} Part ${p + 1} topic`);
    for (let q = 0; q < (p < 2 ? 8 : 7); q++) lines.push(`${++n}. Question ${n}, in part ${p + 1}?`);
  }
  return lines.join("\n");
}

/** Setup to the producer screen with this plan; guest: a show with a guest (the tab shared), else a solo show; agent: the fake agent connects. */
async function openScreen(page, press, { plan, guest, agent = false }) {
  await press(page.locator("#planBtn"));
  await page.locator("#planIn").fill(plan);
  if (agent) {
    await press(page.locator("#connectBtn"));
    await page.waitForFunction(() => window.__relay.sockets.length === 1 && window.__relay.sockets[0].readyState === 1);
    await page.evaluate(() => window.__relay.call("get_context"));
  }
  if (guest) {
    await press(page.locator('#modeSeg [data-v="guest"]'));
    await press(page.locator("#guestSeg button").first());
  }
  await press(page.locator("#micBtn"));
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  if (guest && (await page.locator("#tabBtn").getAttribute("aria-disabled")) !== "true") {
    await press(page.locator("#tabBtn"));
    await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  }
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
    const context = await browser.newContext(ownAddress(options));
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-19T19:00:00Z") });
    await page.addInitScript(standIns);
    const problems = [];
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const text = (sel) => page.locator(sel).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const rows = () => page.locator("#relList").evaluate((list) => [...list.children].map((el) => (el.classList.contains("grp")
      ? `# ${el.textContent}` : el.classList.contains("alt") ? `Q${el.dataset.n}` : el.textContent)));
    const shot = async (file) => { const path = join(out, `relevant-${name}-${file}.png`); await page.waitForTimeout(300); await page.screenshot({ path }); screenshots.push(path); };
    // A pause after 31 s of new speech sends a cue (at most one a minute: the clock skips ahead); the stand-in agent's
    // answer rides in its next wait, as Connect with MCP does. Gives the cue and the ms from the answer to the list on screen.
    const talk = { at: 0, seq: 0 };
    const pauseAnswer = async (numbers, why) => {
      await page.clock.fastForward(61_000);
      const cue = await page.evaluate(async ({ seq, at }) => {
        const wait = window.__relay.call("wait_for_cue", { seq, holdMs: 25000 });
        window.__speech.emit({ type: "text", source: "guest", piece: at + 1, final: true, text: "Whoever holds that cookie is logged in.", start: at, end: at + 31 });
        window.__speech.emit({ type: "pause", source: "guest", at: at + 31 });
        return (await wait).result;
      }, talk);
      assert.equal(cue.cue, "pause", `${name}: a pause sends the cue`);
      talk.at += 40;
      talk.seq = cue.seq;
      const ms = await page.evaluate(({ seq, suggestions }) => new Promise((resolve) => {
        const list = document.querySelector("#relList");
        const t0 = performance.now();
        const o = new MutationObserver(() => { o.disconnect(); requestAnimationFrame(() => resolve(performance.now() - t0)); });
        o.observe(list, { childList: true, attributes: true });
        setTimeout(() => { o.disconnect(); resolve(Infinity); }, 2000); // the list never changed
        window.__wait = window.__relay.call("wait_for_cue", { seq, holdMs: 25000, suggestions });
      }), { seq: cue.seq, suggestions: numbers.map((n, i) => ({ question: n, ...(i === 0 && why ? { why } : {}) })) });
      return { cue, ms };
    };

    await openScreen(page, press, { plan: bigPlan(), guest: true, agent: true });
    // Before the agent's first answer: the rows to swap in, as before; no list yet.
    assert.deepEqual([await page.locator("#relList").isVisible(), await page.locator("#relHead").isVisible(), await page.locator("#alts .alt").count()], [false, false, 2], `${name}: no list before the agent's first answer, the two rows to swap in`);
    ok(`${name}: before the agent answers, the two rows to swap in and no list`);

    // The agent's answer: the best match on the card, the other five in Relevant now, grouped by part (the best match's
    // part first), timed from the answer to the list on screen.
    const { ms } = await pauseAnswer([12, 3, 14, 40, 41, 2], "ties to the cookie");
    assert.ok(ms < 300, `${name}: the list on screen ${ms.toFixed(1)} ms after the answer`);
    assert.deepEqual([await text("#qMain"), await text("#qWhy"), await text("#qSrc")], ["Question 12, in part 2?", "ties to the cookie", "Q12 · your list"], `${name}: the best match on the card`);
    assert.deepEqual([await text("#relTitle"), await text("#relCount")], ["Relevant now", "5"], `${name}: the heading and the count`);
    assert.deepEqual(await rows(), ["# Part 1 · Part 1 topic", "Q3", "Q2", "# Part 2 · Part 2 topic", "Q14", "# Part 6 · Part 6 topic", "Q40", "Q41"], `${name}: grouped by part in the order of their best match`);
    assert.equal(await page.locator("#alts .alt").count(), 0, `${name}: the rows to swap in give way to the list`);
    const askedBox = await page.locator("#askedBtn").boundingBox();
    const findBox = await page.locator("#findIn").boundingBox();
    const listBox = await page.locator("#relList").boundingBox();
    assert.ok(findBox.y > askedBox.y && listBox.y > findBox.y, `${name}: the list sits under the search box, under Asked and Skip`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(width, 0, `${name}: no sideways scroll`);
    if (options.isMobile) {
      const row = await page.locator('#relList .alt[data-n="3"]').boundingBox();
      assert.ok(row.height >= 44, `${name}: a row is a 44 px tap target (${row.height})`);
    }
    await shot("answer");
    if (!options.hasTouch) {
      // An answer that lands while the keyboard is on a row keeps it on the same question, wherever that row moves to.
      await page.locator('#relList .alt[data-n="14"]').focus();
      await pauseAnswer([12, 40, 14, 3]);
      assert.deepEqual([await rows(), await page.evaluate(() => document.activeElement?.dataset.n)], [["# Part 6 · Part 6 topic", "Q40", "# Part 2 · Part 2 topic", "Q14", "# Part 1 · Part 1 topic", "Q3"], "14"], `${name}: the keyboard stays on Q14`);
      await pauseAnswer([12, 3, 40, 41, 2]);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset.n), "2", `${name}: its question gone, the keyboard goes to the row now in its place`);
      await pauseAnswer([12, 3, 14, 40, 41, 2]);
      ok(`${name}: a new answer keeps the keyboard on the same question, else on the row in its place`);
    }
    ok(`${name}: the agent's answer: best match on the card, 5 more in Relevant now grouped by part, ${ms.toFixed(1)} ms`);

    // A click puts a match on the card until Asked or Skip; the agent's best match goes back to the list.
    await press(page.locator('#relList .alt[data-n="40"]'));
    assert.deepEqual([await text("#qMain"), await text("#qWhy")], ["Question 40, in part 6?", "Picked by you. Stays here until Asked or Skip."], `${name}: the click puts it on the card`);
    assert.deepEqual(await rows(), ["# Part 2 · Part 2 topic", "Q12", "Q14", "# Part 1 · Part 1 topic", "Q3", "Q2", "# Part 6 · Part 6 topic", "Q41"], `${name}: the picked one leaves the list, the agent's best match comes back to it`);
    // The next answer changes only the list.
    await pauseAnswer([20, 21, 33], "next point");
    assert.equal(await text("#qMain"), "Question 40, in part 6?", `${name}: the pick stays on the card through the next answer`);
    assert.deepEqual(await rows(), ["# Part 3 · Part 3 topic", "Q20", "Q21", "# Part 5 · Part 5 topic", "Q33"], `${name}: the list follows the newest answer`);
    await page.waitForFunction(() => document.querySelector("#relSay").textContent === "3 relevant questions");
    await shot("picked");
    ok(`${name}: a click puts a match on the card and it stays through the next answer, which changes only the list`);

    // Asked: the best match still open takes the card; the cue to the agent names what was asked.
    await press(page.locator("#askedBtn"));
    assert.deepEqual([await text("#qMain"), await text("#qWhy")], ["Question 20, in part 3?", "next point"], `${name}: Asked: the best match takes the card`);
    assert.deepEqual(await rows(), ["# Part 3 · Part 3 topic", "Q21", "# Part 5 · Part 5 topic", "Q33"], `${name}: and leaves the list`);
    await press(page.locator("#skipBtn"));
    const { cue } = await pauseAnswer([21, 33, 34]);
    assert.deepEqual(cue.position.done, [20, 40], `${name}: the cue names the questions asked or skipped, so the agent leaves them out`);
    ok(`${name}: Asked and Skip take the best match still open; the cue names the questions already asked or skipped`);

    // The search hides the list while it holds words; clearing it brings the list back, heard again.
    await press(page.locator("#findIn"));
    await page.locator("#findIn").fill("part 9");
    assert.deepEqual([await page.locator("#relList").isVisible(), await page.locator("#findList").isVisible()], [false, true], `${name}: searching hides the list`);
    await page.evaluate(() => { document.querySelector("#relSay").textContent = ""; });
    await press(page.locator("#findX"));
    await page.waitForFunction(() => document.querySelector("#relSay").textContent === "2 relevant questions");
    assert.deepEqual([await page.locator("#relList").isVisible(), await rows()], [true, ["# Part 5 · Part 5 topic", "Q33", "Q34"]], `${name}: clearing brings it back`);
    // Every match asked or skipped: the list says so.
    // Separate single clicks; the search suite checks the browser's grouped double-taps.
    await page.locator("#skipBtn").click();
    await page.locator("#skipBtn").click();
    await page.waitForFunction(() => document.querySelector("#relSay").textContent === "No other matches right now.");
    assert.deepEqual([await rows(), await page.locator("#relCount").isVisible()], [["No other matches right now."], false], `${name}: none left says so, to a screen reader too`);
    ok(`${name}: the search hides the list while it holds words; none left says so`);

    // Start: the part on now says so. The list drawn again with the same questions is not announced again.
    await pauseAnswer([5, 1, 30]);
    await page.waitForFunction(() => document.querySelector("#relSay").textContent === "2 relevant questions");
    await page.evaluate(() => { document.querySelector("#relSay").textContent = ""; });
    await press(page.locator("#runBtn"));
    assert.deepEqual(await rows(), ["# Part 1 · Part 1 topicon now", "Q1", "# Part 4 · Part 4 topic", "Q30"], `${name}: "on now" marks the part on now`);
    await shot("on-now");
    await page.waitForTimeout(300);
    assert.equal(await text("#relSay"), "", `${name}: the same questions drawn again are not announced again`);
    // An answer naming only a question already asked: the card stays, the list says no other matches.
    await press(page.locator("#askedBtn")); // Q5; Q1 takes the card
    await pauseAnswer([5]);
    assert.deepEqual([await text("#qMain"), await rows()], ["Question 1, in part 1?", ["No other matches right now."]], `${name}: an answer naming only a question already asked keeps the card and empties the list`);
    ok(`${name}: "on now" marks the part on now`);

    const stored = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length }));
    assert.deepEqual(stored, { local: 0, session: 0, cookie: "", databases: 0 }, `${name}: nothing stored`);
    assert.deepEqual(problems, [], `${name}: no console errors`);
    ok(`${name}: nothing stored, no console errors`);
    await context.close();
  }
  // A first answer naming only a question already asked: the card stays, and the empty list takes the place of the rows
  // to swap in (SL-1 of #30).
  {
    const context = await browser.newContext(ownAddress(VIEWS[0]));
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-19T19:00:00Z") });
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    await openScreen(page, (l) => l.click(), { plan: bigPlan(), guest: true, agent: true });
    await page.locator("#askedBtn").click(); // Q1; Q2 on the card
    await page.clock.fastForward(61_000);
    const cue = await page.evaluate(async () => {
      const wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 });
      window.__speech.emit({ type: "text", source: "guest", piece: 1, final: true, text: "Whoever holds that cookie is logged in.", start: 0, end: 31 });
      window.__speech.emit({ type: "pause", source: "guest", at: 31 });
      return (await wait).result;
    });
    await page.evaluate((seq) => { window.__wait = window.__relay.call("wait_for_cue", { seq, holdMs: 25000, suggestions: [{ question: 1 }] }); }, cue.seq);
    await page.waitForFunction(() => document.querySelector("#relSay").textContent === "No other matches right now.");
    const seen = await page.evaluate(() => ({ q: document.querySelector("#qMain").textContent, alts: document.querySelectorAll("#alts .alt").length, list: document.querySelector("#relList").textContent, shown: !document.querySelector("#relList").hidden }));
    assert.deepEqual(seen, { q: "Question 2, in part 1?", alts: 0, list: "No other matches right now.", shown: true }, "a first answer naming only an asked question: the card stays, the empty list replaces the rows to swap in");
    ok("a first answer naming only an asked question: the card stays, the empty list replaces the rows to swap in");
    await context.close();
  }
  return { checks, screenshots };
}
