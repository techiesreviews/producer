// Browser checks for `kit specs search`: the search box over the whole question list (TOOLS-344, built to the approved
// prototype TOOLS-343), in Chromium through the real Worker. Desktop 1366x900 and phone 390x844, light and dark. The
// microphone, the studio tab and the speech worker are stand-ins; no agent is connected (the search needs none).
// Checks: the box under Asked and Skip says how many questions it searches; a word shows the matches at once (well under
// a second), grouped by the part the plan puts them under, the words marked, "k of 72" beside the heading, in place of
// the rows to swap in; "on now" marks the part on now; a click puts a match on the card ("Picked by you", the row reads
// "On card"); the agent's answer does not take a picked card; Enter takes the first match; Asked and Skip clear the
// search and the asked question reads "Asked ✓" in a later search; Escape and the clear button empty it; a plan with
// every part first says no part (no headings); a solo show searches points; nothing is sent, nothing stored.
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

// A made-up show the size of a real one: 10 parts and 72 questions, each part's questions under it. Part 2 and part 6
// hold the word "cookie" (two questions each), nothing else does.
const TOPICS = ["welcome", "cookie", "risk", "story", "demo", "cookie", "alerts", "teaching", "close", "bonus"];
function bigPlan() {
  const lines = ["Show: Search Test", "Guest: Sam Example"];
  let n = 0;
  TOPICS.forEach((topic, p) => {
    lines.push(`${p + 3} Part about ${topic === "cookie" ? (p === 1 ? "sessions" : "visibility") : topic}`);
    for (let q = 0; q < (p < 2 ? 8 : 7); q++) {
      n += 1;
      const word = topic !== "cookie" ? `${topic} thing` : q < 2 ? "cookie" : "login thing";
      lines.push(`${n}. Question ${n}: what about the ${word}?`);
    }
  });
  return lines.join("\n");
}

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
    const phone = Boolean(options.isMobile);
    const context = await browser.newContext(ownAddress(options));
    const page = await context.newPage();
    await page.addInitScript(standIns);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const text = (sel) => page.locator(sel).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const rows = () => page.locator("#findList").evaluate((list) => [...list.children].map((el) => (el.classList.contains("grp")
      ? `# ${el.textContent}` : el.classList.contains("alt") ? `${el.querySelector(".alt__q").textContent} [${el.querySelector(".chip").textContent}]` : el.textContent)));
    const shot = async (file) => { const path = join(out, `search-${name}-${file}.png`); await page.waitForTimeout(150); await page.screenshot({ path }); screenshots.push(path); };
    const find = page.locator("#findIn");

    await openScreen(page, press, { plan: bigPlan(), guest: true, agent: !phone });
    // The box under Asked and Skip, the rows to swap in below it while it is empty.
    assert.equal(await find.isVisible(), true, `${name}: the search box shows`);
    assert.deepEqual([await find.getAttribute("placeholder"), await find.getAttribute("aria-label")], ["Search all 72 questions", "Search all 72 questions"], `${name}: it says what it searches`);
    assert.deepEqual([await page.locator("#alts").isVisible(), await page.locator("#findList").isVisible(), await page.locator("#findX").isVisible()], [true, false, false], `${name}: empty: the rows to swap in, no matches, no clear button`);
    const askedBox = await page.locator("#askedBtn").boundingBox();
    const findBox = await find.boundingBox();
    assert.ok(findBox.y > askedBox.y + askedBox.height, `${name}: the box sits under Asked and Skip`);
    ok(`${name}: the search box under Asked and Skip says "Search all 72 questions"`);

    // A word: the matches at once, grouped by part, the words marked, in place of the rows to swap in. Typed key by key,
    // the time from the last key to the list on screen.
    const sent = requests.length;
    await press(find);
    await find.pressSequentially("cooki");
    const ms = await page.evaluate(() => new Promise((resolve) => {
      const input = document.querySelector("#findIn");
      const t0 = performance.now();
      input.value += "e";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      requestAnimationFrame(() => resolve(performance.now() - t0));
    }));
    assert.ok(ms < 1000, `${name}: matches on screen ${ms.toFixed(1)} ms after the last key, under a second`);
    assert.deepEqual(await rows(), [
      "# Part 2 · Part about sessions", "Question 9: what about the cookie? [Q9]", "Question 10: what about the cookie? [Q10]",
      "# Part 6 · Part about visibility", "Question 38: what about the cookie? [Q38]", "Question 39: what about the cookie? [Q39]",
    ], `${name}: the four matches in show order, grouped by part`);
    assert.deepEqual([await text("#findTitle"), await text("#findCount")], ["Matches for “cookie”", "4 of 72"], `${name}: the heading and the count`);
    assert.deepEqual(await page.locator("#findList mark").allTextContents(), ["cookie", "cookie", "cookie", "cookie"], `${name}: the word is marked`);
    assert.deepEqual([await page.locator("#alts").isVisible(), await page.locator("#findX").isVisible()], [false, true], `${name}: the matches take the place of the rows to swap in; the clear button shows`);
    assert.equal(requests.length, sent, `${name}: typing sends nothing`);
    await shot("matches");
    ok(`${name}: "cookie" shows 4 of 72 at once (${ms.toFixed(1)} ms), grouped by part, marked; nothing sent`);

    // A click (a tap on a phone) puts a match on the card; its row reads "On card"; the search stays.
    await press(page.locator('#findList .alt[data-n="38"]'));
    assert.deepEqual([await text("#qMain"), await text("#qWhy"), await text("#qSrc")], ["Question 38: what about the cookie?", "Picked by you. Stays here until Asked or Skip.", "Q38 · your list"], `${name}: the match on the card`);
    assert.deepEqual([await page.locator('#findList .alt[data-n="38"]').getAttribute("data-s"), await text('#findList .alt[data-n="38"] .chip'), await find.inputValue()], ["card", "On card", "cookie"], `${name}: its row reads On card; the search stays`);
    if (!phone) {
      // The agent's answer does not take a picked card: it waits below to swap in.
      await page.evaluate(() => window.__relay.call("post_suggestions", { suggestions: [{ question: 5, why: "fits" }] }));
      assert.equal(await text("#qMain"), "Question 38: what about the cookie?", `${name}: the agent's answer leaves the pick on the card`);
    }
    await shot("picked");
    ok(`${name}: a click puts the match on the card ("Picked by you"), its row reads On card`);

    // Enter takes the first match that is not on the card.
    if (phone) await press(find); else await find.focus();
    await page.keyboard.press("Enter");
    assert.equal(await text("#qMain"), "Question 9: what about the cookie?", `${name}: Enter takes the first match`);
    ok(`${name}: Enter takes the first match`);

    // Asked clears the search; the rows to swap in come back; a later search shows the asked one as "Asked ✓".
    await press(page.locator("#askedBtn"));
    assert.deepEqual([await find.inputValue(), await page.locator("#findList").isVisible(), await page.locator("#alts").isVisible()], ["", false, true], `${name}: Asked clears the search`);
    await press(find);
    await find.fill("cookie");
    assert.equal(await text('#findList .alt[data-n="9"] .chip'), "Asked ✓", `${name}: the asked question says so in the search`);
    await press(page.locator('#findList .alt[data-n="10"]'));
    await press(page.locator("#skipBtn"));
    assert.equal(await find.inputValue(), "", `${name}: Skip clears the search too`);
    ok(`${name}: Asked and Skip clear the search; an asked question reads "Asked ✓"`);

    // Escape (a computer) and the clear button empty the box; a word with no match says so.
    await press(find);
    await find.fill("zebra");
    assert.deepEqual([await text("#findCount"), await text("#findList .pool__state")], ["0 of 72", "No question with “zebra”."], `${name}: no match says so`);
    if (!phone) {
      await page.keyboard.press("Escape");
      assert.equal(await find.inputValue(), "", `${name}: Escape empties the box`);
      await find.fill("zebra");
    }
    await press(page.locator("#findX"));
    assert.deepEqual([await find.inputValue(), await page.locator("#findX").isVisible(), await page.locator("#alts").isVisible()], ["", false, true], `${name}: the clear button empties the box`);
    ok(`${name}: no match says so; Escape and the clear button empty the box`);

    // Start: the part on now is marked in the search.
    await press(page.locator("#runBtn"));
    await press(find);
    await find.fill("question 3:");
    assert.deepEqual((await rows())[0], "# Part 1 · Part about welcomeon now", `${name}: the part on now says so`);
    await press(page.locator("#findX"));
    ok(`${name}: "on now" marks the part on now`);

    const stored = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length }));
    assert.deepEqual(stored, { local: 0, session: 0, cookie: "", databases: 0 }, `${name}: nothing stored`);
    assert.deepEqual(problems, [], `${name}: no console errors`);
    ok(`${name}: nothing stored, no console errors`);
    await context.close();
  }

  // A solo show whose plan lists every part first and the points after them: the plan says no part, so no headings.
  {
    const context = await browser.newContext(ownAddress(VIEWS[0]));
    const page = await context.newPage();
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    const plan = ["Show: Solo Test", "5 Intro", "10 The rooms", "1. The cookie jar?", "2. A late call?", "3. Another cookie?"].join("\n");
    await openScreen(page, (l) => l.click(), { plan, guest: false });
    const find = page.locator("#findIn");
    assert.equal(await find.getAttribute("placeholder"), "Search all 3 points", "solo: it searches points");
    await find.fill("cookie");
    const list = await page.locator("#findList").evaluate((el) => [...el.children].map((c) => `${c.className}: ${c.textContent}`));
    assert.deepEqual(list, ["alt: The cookie jar?On card", "alt: Another cookie?Point 3"], "no part headings, show order, Point chips (point 1 is on the card)");
    await page.locator('#findList .alt[data-n="3"]').click();
    assert.equal(await page.locator("#qWhy").textContent(), "Picked by you. Stays here until Said or Skip.", "solo: Said");
    const path = join(out, "search-solo-no-parts.png");
    await page.screenshot({ path });
    screenshots.push(path);
    ok("a plan with every part first: matches without headings; a solo show searches points");
    await context.close();
  }

  return { checks, screenshots };
}
