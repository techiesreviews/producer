// Browser checks for `kit specs cues`: the page sends a cue to the connected agent at a pause, in Chromium through
// the real Worker (desktop, light; this card adds nothing to see). The microphone, the speech worker and the relay
// are stand-ins: the speech stand-in hands the page final lines and a pause as the real worker does, and the relay
// stand-in plays the agent's calls. Checks: get_context gives the pasted plan with the part on now; a pause after
// 30 s of new speech hands the waiting agent one cue with the lines labelled, the run position and the guest's name;
// a second pause within the minute sends nothing; the page's own share of the time (pause to cue out, answer in to
// answer taken) stays under 0.3 s; nothing is stored and nothing but the token request leaves the page.
import assert from "node:assert/strict";

const KNOWN_WARNING = /^The ScriptProcessorNode is deprecated\./;
const PAGE_BUDGET_MS = 300;

const PLAN = ["Show: Techies Live", "Guest: Jane Doe", "3 Intro", "8 Her story", "1. How did it start?", "2. Who paid first?"].join("\n");

// Stand-ins for the microphone and the studio tab (quiet tones), the speech worker (ready at once; window.__speech.emit(data) hands the
// page a message as the worker would) and the relay (window.__relay.call(tool, args) plays one agent call).
function standIns() {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const out = context.createMediaStreamDestination();
    tone.connect(out);
    tone.start();
    return out.stream;
  };
  navigator.mediaDevices.getDisplayMedia = async () => {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const out = context.createMediaStreamDestination();
    tone.connect(out);
    tone.start();
    const video = document.createElement("canvas").captureStream(1).getVideoTracks()[0];
    video.getSettings = () => ({ displaySurface: "browser" });
    return new MediaStream([video, ...out.stream.getAudioTracks()]);
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
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }, 0);
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

export async function run({ browser, base }) {
  const checks = [];
  const ok = (name) => checks.push(name);
  const context = await browser.newContext({ colorScheme: "light", viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(standIns);
  const requests = [];
  const problems = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  await page.goto(`${base}/`);
  const loaded = requests.length;

  // The plan, then the agent: Copy connect message (the clipboard may refuse: the message then shows below).
  await page.locator("#planBtn").click();
  await page.locator("#planIn").fill(PLAN);
  await page.locator("#connectBtn").click();
  await page.waitForFunction(() => window.__relay.sockets.length === 1);
  const before = (await page.evaluate(() => window.__relay.call("get_context"))).result;
  assert.deepEqual(before, {
    showTitle: "Techies Live",
    guestName: "Jane Doe",
    questions: [{ n: 1, text: "How did it start?" }, { n: 2, text: "Who paid first?" }],
    segments: [{ title: "Intro", plannedMinutes: 3 }, { title: "Her story", plannedMinutes: 8 }],
    seq: 0,
  }, "get_context gives the agent the pasted plan");
  ok("get_context: the pasted plan (show, guest, questions, run order)");

  // The producer screen, and the show clock started: the first part is on now.
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  await page.locator("#micBtn").click();
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await page.locator("#tabBtn").click();
  await page.waitForFunction(() => document.querySelector("#tabBtn").dataset.state === "ok");
  await page.locator("#speechBtn").click();
  await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
  await page.locator("#goBtn").click();
  await page.locator("#runBtn").click();
  const during = (await page.evaluate(() => window.__relay.call("get_context"))).result;
  assert.deepEqual(during.segments[0], { title: "Intro", plannedMinutes: 3, live: true }, "the part on now is marked live");
  ok("get_context: the part on now is marked live once the clock runs");

  // The agent waits; 31 s of speech, then the worker's pause: one cue reaches the wait at once.
  await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
  const out = await page.evaluate(async () => {
    const lines = [["host", "How did it start?", 0, 2], ["guest", "Honestly as a joke: the rent went up and I found an old camper.", 2.5, 18], ["guest", "Two weeks later I was editing at a campsite.", 18.5, 31.5]];
    lines.forEach(([source, text, start, end], i) => window.__speech.emit({ type: "text", source, piece: i + 1, final: true, text, start, end }));
    window.__speech.emit({ type: "pause", source: "host", at: 2 }); // the host is quiet, but the guest has only just spoken
    const t0 = performance.now();
    window.__speech.emit({ type: "pause", source: "guest", at: 31.5 });
    const cue = (await window.__wait).result;
    return { cue, ms: performance.now() - t0 };
  });
  assert.equal(out.cue.cue, "pause");
  assert.equal(out.cue.seq, 1);
  assert.deepEqual(out.cue.transcript.map((l) => [l.speaker, l.text.slice(0, 18)]), [["host", "How did it start?"], ["guest", "Honestly as a joke"], ["guest", "Two weeks later I "]], "the lines since the last cue, labelled host and guest");
  assert.deepEqual(out.cue.position, { segment: 1, title: "Intro", minutesLeft: 3 }, "the run position");
  assert.equal(out.cue.guestName, "Jane Doe", "the guest's name from the plan");
  assert.ok(out.ms < PAGE_BUDGET_MS, `pause to cue out: ${out.ms.toFixed(1)} ms, under ${PAGE_BUDGET_MS} ms`);
  ok(`cue: a pause after 31.5 s of speech hands the waiting agent one cue with labels, position and guest (${out.ms.toFixed(1)} ms)`);

  // The answer comes back (the page keeps it in its memory only, for the question card: the unit checks read it). A
  // second pause within the minute sends nothing: the agent's next wait stays held.
  const back = await page.evaluate(async () => {
    const t0 = performance.now();
    const shown = (await window.__relay.call("post_suggestions", { suggestions: [{ question: 2, why: "follows the camper story" }] })).result.shown;
    const ms = performance.now() - t0;
    let cued = false;
    window.__relay.call("wait_for_cue", { seq: 1, holdMs: 25000 }).then((r) => { cued = !r.result.idle; });
    window.__speech.emit({ type: "text", source: "guest", piece: 4, final: true, text: "And it worked.", start: 32, end: 64 });
    window.__speech.emit({ type: "pause", source: "guest", at: 64 });
    await new Promise((r) => setTimeout(r, 500));
    return { shown, ms, cued };
  });
  assert.equal(back.shown, 1, "the page takes the answer");
  assert.ok(back.ms < PAGE_BUDGET_MS, `answer in to answer taken: ${back.ms.toFixed(1)} ms, under ${PAGE_BUDGET_MS} ms`);
  assert.equal(back.cued, false, "a second pause within the minute sends no cue");
  ok(`answer: taken in ${back.ms.toFixed(1)} ms; no second cue within the minute`);

  // Nothing stored, nothing sent but the token request (the relay is the stand-in).
  const kept = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  assert.deepEqual(kept, { local: 0, session: 0, cookie: "" }, "nothing stored in the browser");
  assert.deepEqual(requests.slice(loaded).map((u) => new URL(u).pathname), ["/api/agent-token"], "only the token request left the page");
  assert.deepEqual(problems, [], "no console errors");
  ok("privacy: nothing stored; only the token request left the page");
  await context.close();
  return { checks, screenshots: [] };
}
