// Browser checks for `kit specs report`: End & report and the end report screen (card 12), in Chromium through the
// real Worker. Desktop 1366x900 (wide) and phone 390x844 (compact), light and dark. The microphone, the speech worker,
// the relay (the fake agent), the clipboard and the save picker are stand-ins. Time is Playwright's clock.
// Checks: End & report stops listening, freezes the run order, sends the agent the end cue (with the last words and
// their show times) and shows the report screen at once with the page's own parts while the agent's say they wait; the
// agent's post_report fills the topics and clip moments; Copy and Save report give exactly what the screen shows (the
// picker, and the plain download where there is no picker); with no agent, topics and clips are switched off with the
// reason; a slow agent switches off after two minutes and a late report still fills in; a disconnect says so; nothing
// of the show is left in browser storage once the tab is closed. Made-up names only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];
const KNOWN_WARNING = /^The ScriptProcessorNode is deprecated\./;
const PLAN = ["Show: Techies Live", "Guest: Jane Doe", "3 Intro", "8 Her story", "4 Wrap-up", "1. How did it start?", "2. Who paid first?", "3. What went wrong first?", "4. What is next?"].join("\n");
const REPORT = { topics: ["Leaving her job to build the app", "Pricing the first version"], asked: [4], clips: [{ at: "0:12", note: "\"It started in a van.\"" }, { at: "9:30", note: "Why she tripled the price" }] };
const WAITING = "Waiting for Claude Code…";
const NO_AGENT = "No agent was connected when the show ended.";

// Stand-ins: the microphone and the studio tab (quiet tones), the speech worker (ready at once), the relay
// (window.__relay.call(tool, args) plays one agent call), the clipboard (window.__copied) and the save picker
// (window.__saved; window.__noPicker before the page loads leaves the browser without one).
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
const noPicker = () => { delete window.showSaveFilePicker; };

/** Setup to the producer screen with the plan pasted; with `agent`, the fake agent connects first. */
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
  // A phone browser cannot share a tab with sound: the button is switched off, and the guest is not heard.
  if ((await page.locator("#tabBtn").getAttribute("aria-disabled")) !== "true") {
    await press(page.locator("#tabBtn"));
    await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  }
  await press(page.locator("#speechBtn"));
  await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
  await press(page.locator("#goBtn"));
}

/** The show: Start; 12 s in the host asks, the guest answers; Intro ends at 2:40; Her story runs 9:40, over its 8 minutes.
 * The page's clock stands still between the steps (resumed after End & report), so the times are exact. */
async function playShow(page, press) {
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await press(page.locator("#runBtn"));
  await page.clock.fastForward(12_000);
  await page.evaluate(() => {
    window.__speech.emit({ type: "text", source: "host", piece: 1, final: true, text: "So how did it start?", start: 0, end: 2 });
    window.__speech.emit({ type: "text", source: "guest", piece: 2, final: true, text: "It started in a van.", start: 2, end: 4 });
  });
  await press(page.locator("#askedBtn")); // Q1
  await press(page.locator("#skipBtn")); // Q2
  await page.clock.fastForward(148_000);
  await press(page.locator("#runBtn")); // Next part at 2:40
  await page.clock.fastForward(580_000);
  await page.evaluate(() => window.__speech.emit({ type: "text", source: "guest", piece: 3, final: true, text: "Thanks for having me.", start: 5, end: 7 }));
}

const SCREEN = `(() => {
  const t = (el) => el.textContent.replace(/\\s+/g, " ").trim();
  const rows = (id) => [...document.querySelectorAll("#" + id + " > li")].map((li) => [...li.children].map(t).filter(Boolean).join(" | "));
  return {
    title: t(document.querySelector("#reportTitle")),
    stats: [...document.querySelectorAll("#reportStats > li")].map((li) => [...li.children].map(t).join(" ")),
    statParts: [...document.querySelectorAll("#reportStats > li")].map((li) => [...li.children].map(t)),
    clips: rows("clipList"), real: rows("realList"), topics: rows("topicList"), notAsked: rows("notAskedList"), heard: rows("heardList"),
    count: t(document.querySelector("#heardCount")),
  };
})()`;

/** Every part the screen shows is a line of the file, in the screen's order. */
function sameAsScreen(md, screen, name) {
  const lines = md.split("\n");
  let at = 0;
  const expect = [
    `# ${screen.title.replace(/^End report /, "End report · ")}`,
    ...screen.statParts.map(([value, words]) => {
      const [label, note] = words.split(" · ");
      return `- ${label[0].toUpperCase()}${label.slice(1)}: ${value}${note ? ` (${note})` : ""}`;
    }),
    "## Clip moments", ...screen.clips.map((r) => (r.startsWith("i | ") ? r.replace(/^i \| /, "Off: ") : r === WAITING || r === "None." ? r : `- ${r.replace(" | ", " · ")}`)),
    "## Run order · plan vs real", ...screen.real.map((r) => `- ${r.split(" | ").join(" · ")}`),
    "## Topics covered", ...screen.topics.map((r) => (r.startsWith("i | ") ? r.replace(/^i \| /, "Off: ") : r === WAITING || r === "None." ? r : `- ${r}`)),
    "## Questions not asked", ...screen.notAsked.map((r) => `- ${r.split(" | ").join(" · ")}`),
    "## What was heard", ...screen.heard.map((r) => `- ${r.replace(" | ", " · ")}`),
  ];
  for (const line of expect) {
    const found = lines.indexOf(line, at);
    assert.ok(found >= 0, `${name}: the file has "${line}" after line ${at}:\n${md}`);
    at = found + 1;
  }
  assert.equal(lines.filter((l) => l.startsWith("- ") || l.startsWith("Off: ") || l === WAITING).length, expect.filter((l) => l.startsWith("- ") || l.startsWith("Off: ") || l === WAITING).length, `${name}: and nothing more`);
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
    await page.clock.install({ time: new Date("2026-11-09T19:00:00") });
    await page.addInitScript(standIns);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const shot = async (file) => { const path = join(out, `report-${name}-${file}.png`); await page.keyboard.press("Escape"); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(200); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
    const screen = () => page.evaluate(SCREEN);

    await openScreen(page, press, { agent: true });
    await playShow(page, press);
    const end = page.locator("#endBtn");
    assert.equal(await end.isVisible(), true, `${name}: End & report is in the top bar`);
    const words = await end.evaluate((el) => [...el.children].filter((c) => c.getBoundingClientRect().width > 1).map((c) => c.textContent));
    assert.deepEqual(words, [phone ? "End" : "End & report"], `${name}: its words (${phone ? "short on a phone" : "in full"})`);
    assert.equal(await page.getByRole("button", { name: "End & report", exact: true }).count(), 1, `${name}: a screen reader hears End & report`);

    // End & report: the agent's held wait gets the end cue with the words since the last cue and their show times;
    // the report screen is there at once, before any answer.
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
    const shownMs = await page.evaluate(() => new Promise((resolve) => {
      const t0 = performance.now();
      document.querySelector("#endBtn").click();
      resolve(document.querySelector("#report").hidden ? Infinity : performance.now() - t0);
    }));
    assert.ok(shownMs < 300, `${name}: the report screen shows ${shownMs.toFixed(1)} ms after the press, without waiting for the agent`);
    await page.clock.resume();
    const cue = (await page.evaluate(() => window.__wait)).result;
    assert.equal(cue.cue, "end_report", `${name}: the agent gets the end cue`);
    assert.deepEqual(cue.transcript, [{ speaker: "host", text: "So how did it start?", at: "0:12" }, { speaker: "guest", text: "It started in a van.", at: "0:12" }, { speaker: "guest", text: "Thanks for having me.", at: "12:20" }], `${name}: with the words and their show times`);
    const stopped = await page.evaluate(() => ({ tracks: window.__tracks.every((t) => t.readyState === "ended"), top: document.querySelector("#topLive").hidden, live: document.querySelector("#live").hidden, setup: document.querySelector("#setup").hidden, focus: document.activeElement?.id }));
    assert.deepEqual(stopped, { tracks: true, top: true, live: true, setup: true, focus: "reportTitle" }, `${name}: listening stopped (microphone and tab let go), the live screen gone, the keyboard on the report's heading`);
    ok(`${name}: End & report stops listening and shows the report at once (${shownMs.toFixed(1)} ms); the agent gets the end cue with show times`);

    const { statParts, ...waiting } = await screen();
    assert.equal(statParts.length, 4, `${name}: four numbers`);
    assert.deepEqual(waiting, {
      title: "End report Techies Live · guest Jane Doe · 9 Nov 2026",
      stats: ["12:20 show time · +1:20 over", "1 / 4 list questions asked", "0 new from the agent", "— viewer questions used · no viewer chat yet"],
      clips: [WAITING],
      real: ["3:00 | Intro | −0:20", "8:00 | Her story | +1:40", "4:00 | Wrap-up | not reached"],
      topics: [WAITING],
      notAsked: ["Q2 | Who paid first? | skipped", "Q3 | What went wrong first? | no time", "Q4 | What is next? | no time"],
      heard: ["0:12 | Host: So how did it start?", "0:12 | Jane Doe: It started in a van.", "12:20 | Jane Doe: Thanks for having me."],
      count: "3 lines",
    }, `${name}: the page's own parts at once; the agent's parts wait`);
    assert.equal(await page.locator("#clipList .dot--think").count(), 1, `${name}: the waiting part breathes`);
    await shot("waiting");
    ok(`${name}: while the agent works the page shows the numbers, plan against real and questions not asked; topics and clips say they wait`);

    // The agent's report fills in its parts; its word on Q4 joins the numbers.
    const posted = await page.evaluate((r) => window.__relay.call("post_report", r), REPORT);
    assert.deepEqual(posted.result, { shown: true }, `${name}: the page took the report`);
    const full = await screen();
    assert.deepEqual([full.stats[1], full.clips, full.topics, full.notAsked], [
      "2 / 4 list questions asked",
      ["0:12 | \"It started in a van.\"", "9:30 | Why she tripled the price"],
      ["Leaving her job to build the app", "Pricing the first version"],
      ["Q2 | Who paid first? | skipped", "Q3 | What went wrong first? | no time"],
    ], `${name}: topics, clip moments and the agent's word on the questions`);
    const lay = await page.evaluate(() => {
      const box = (id) => document.getElementById(id).closest(".panel").getBoundingClientRect().toJSON();
      return { width: innerWidth, scroll: document.documentElement.scrollWidth, clips: box("clipList"), real: box("realList"), topics: box("topicList") };
    });
    assert.ok(lay.scroll <= lay.width, `${name}: no sideways scroll (${lay.scroll} > ${lay.width})`);
    if (phone) assert.ok(lay.clips.bottom <= lay.real.top && lay.real.bottom <= lay.topics.top, `${name}: compact: one column`);
    else assert.ok(Math.abs(lay.clips.top - lay.real.top) < 1 && lay.clips.right < lay.real.left, `${name}: wide: two columns`);
    if (options.hasTouch) for (const sel of ["#copyBtn", "#saveBtn", "#heardBox summary"]) {
      const h = await page.locator(sel).evaluate((el) => el.getBoundingClientRect().height);
      assert.ok(h >= 44, `${name}: ${sel} is finger-sized (${h}px)`);
    }
    await shot("report");
    await press(page.locator("#heardBox summary"));
    assert.equal(await page.locator("#heardList").isVisible(), true, `${name}: What was heard opens`);
    await shot("heard");
    ok(`${name}: the agent's report fills topics and clip moments; ${phone ? "compact" : "wide"} layout`);

    // Copy and Save report: the same Markdown, exactly what the screen shows.
    await press(page.locator("#copyBtn"));
    assert.equal(await page.locator("#copyBtn").textContent(), "Copied ✓", `${name}: Copied ✓ on the button`);
    await page.clock.fastForward(2000);
    assert.equal(await page.locator("#copyBtn").textContent(), "Copy", `${name}: then Copy again`);
    await press(page.locator("#saveBtn"));
    await page.waitForFunction(() => typeof window.__saved === "string");
    const files = await page.evaluate(() => ({ copied: window.__copied, saved: window.__saved, name: window.__picked.suggestedName, types: window.__picked.types }));
    assert.equal(files.name, "producer-report-2026-11-09.md", `${name}: the file's name`);
    assert.deepEqual(files.types, [{ description: "Markdown", accept: { "text/markdown": [".md"] } }], `${name}: a Markdown file`);
    assert.equal(files.saved, files.copied, `${name}: Copy and Save report give the same text`);
    sameAsScreen(files.saved, await screen(), name);
    assert.deepEqual([await page.locator("#saveBtn").textContent(), await page.locator("#saveBtn").getAttribute("data-state")], ["Saved ✓ · producer-report-2026-11-09.md", "ok"], `${name}: Saved on the button`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: the saved button does not push the page sideways`);
    await shot("saved");
    ok(`${name}: Copy and Save report write exactly what the screen shows (producer-report-2026-11-09.md)`);

    // Nothing of the show in browser storage, then or after the tab closes; a fresh tab starts at setup.
    const storage = () => page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length }));
    const empty = { local: 0, session: 0, cookie: "", databases: 0, caches: 0 };
    assert.deepEqual(await storage(), empty, `${name}: nothing stored while the report shows`);
    assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation`);
    assert.deepEqual(requests, ["/", "/api/agent-token"], `${name}: only the page and the token request`);
    await page.close();
    const again = await context.newPage();
    await again.goto(`${base}/`);
    const after = await again.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length, report: document.querySelector("#report").hidden, setup: document.querySelector("#setup").hidden, plan: document.querySelector("#planIn").value, show: document.querySelector("#showLine").textContent }));
    assert.deepEqual(after, { ...empty, report: true, setup: false, plan: "", show: "· no show loaded yet" }, `${name}: after the tab closes nothing of the show is left; a new tab starts at setup`);
    ok(`${name}: nothing of the show in browser storage, during the report or after the tab closes`);
    await context.close();
  }

  // No agent: the page fills the numbers and plan against real itself; topics and clips are switched off with the
  // reason. A browser without the save picker downloads the file.
  {
    const context = await browser.newContext({ ...VIEWS[0], acceptDownloads: true });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-09T19:00:00") });
    await page.addInitScript(standIns);
    await page.addInitScript(noPicker);
    await page.goto(`${base}/`);
    const press = (l) => l.click();
    await openScreen(page, press, { agent: false });
    await playShow(page, press);
    await press(page.locator("#endBtn"));
    await page.clock.resume();
    const s = await page.evaluate(SCREEN);
    assert.deepEqual([s.stats[0], s.stats[1], s.clips, s.topics, s.real.length, s.notAsked.length], ["12:20 show time · +1:20 over", "1 / 4 list questions asked", [`i | ${NO_AGENT}`], [`i | ${NO_AGENT}`], 3, 3], "no agent: numbers and plan against real by the page; topics and clips off with the reason");
    assert.equal(await page.locator("#topicList .off-mark").count(), 1, "no agent: the round i on the switched-off part");
    const path = join(out, "report-desktop-no-agent.png");
    await page.screenshot({ path, fullPage: true });
    screenshots.push(path);
    ok("no agent: the numbers and plan against real by the page; topics and clips switched off with the reason");
    const [download] = await Promise.all([page.waitForEvent("download"), press(page.locator("#saveBtn"))]);
    assert.equal(download.suggestedFilename(), "producer-report-2026-11-09.md", "no picker: the download's name");
    const md = readFileSync(await download.path(), "utf8");
    sameAsScreen(md, s, "no picker");
    assert.match(md, new RegExp(`## Topics covered\\n\\nOff: ${NO_AGENT.replace(/\./g, "\\.")}`), "the file carries the reason");
    assert.equal(await page.locator("#saveBtn").textContent(), "Saved ✓ · producer-report-2026-11-09.md", "no picker: Saved on the button");
    ok("no picker: Save report downloads the same file");
    await context.close();
  }

  // A slow agent: after two minutes its parts switch off with the reason; a late report still fills them and the
  // Save button offers the newer report again. A report before End & report is refused. A disconnect says so.
  {
    const context = await browser.newContext(VIEWS[0]);
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-11-09T19:00:00") });
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    await openScreen(page, (l) => l.click(), { agent: true });
    const early = await page.evaluate((r) => window.__relay.call("post_report", r), REPORT);
    assert.equal(early.error, "There is no show to report on yet.", "a report before End & report is refused");
    await page.locator("#endBtn").click();
    assert.deepEqual((await page.evaluate(SCREEN)).topics, [WAITING], "waiting");
    await page.locator("#saveBtn").click();
    await page.waitForFunction(() => typeof window.__saved === "string");
    assert.match(await page.evaluate(() => window.__saved), /## Topics covered\n\nWaiting for Claude Code…\n/, "a save while the agent works holds what the screen shows");
    await page.clock.fastForward(120_000);
    await page.waitForFunction(() => document.querySelector("#topicList").textContent.includes("No report came back"));
    const reason = "No report came back from Claude Code in 2 minutes.";
    assert.deepEqual([(await page.evaluate(SCREEN)).topics, (await page.evaluate(SCREEN)).clips], [[`i | ${reason}`], [`i | ${reason}`]], "after two minutes: off with the reason");
    assert.equal(await page.locator("#saveBtn").textContent(), "Save report", "the saved file is older than the screen: Save report again");
    await page.evaluate((r) => window.__relay.call("post_report", r), REPORT);
    assert.deepEqual((await page.evaluate(SCREEN)).topics, REPORT.topics, "a late report still fills in");
    ok("a slow agent: off with the reason after two minutes; a late report fills in; a report before End is refused");
    await context.close();
  }
  {
    const context = await browser.newContext(VIEWS[2]);
    const page = await context.newPage();
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    await openScreen(page, (l) => l.tap(), { agent: true });
    await page.locator("#endBtn").tap();
    await page.evaluate(() => window.__relay.sockets.at(-1).close(4003));
    await page.waitForFunction(() => document.querySelector("#clipList").textContent.includes("disconnected"));
    const s = await page.evaluate(SCREEN);
    assert.deepEqual([s.clips, s.real, s.heard, s.stats[0]], [["i | Claude Code disconnected before its report came."], ["3:00 | Intro | not run", "8:00 | Her story | not run", "4:00 | Wrap-up | not run"], ["Nothing was heard."], "— show time · clock not started"], "a disconnect while waiting says so; a clock never started says so");
    const path = join(out, "report-phone-disconnected.png");
    await page.screenshot({ path, fullPage: true });
    screenshots.push(path);
    ok("the agent disconnects while the report waits: its parts say so; a show never started reads not run");
    await context.close();
  }

  return { checks, screenshots };
}
