// Browser checks for `kit specs solo`: the solo show (TOOLS-336, built to the solo prototype TOOLS-338), in Chromium
// through the real Worker. Desktop 1366x900 and phone 390x844, light and dark. The microphone, the speech worker and the
// relay are stand-ins (as in the questions suite); the relay stand-in plays the agent, which reads the Restream chat
// through its own connection and hands it over with post_chat.
// Checks: Show type comes first with Solo show picked, the guest step and the guest tab stay out of the way, the steps
// number in order; the list reads as points; Connect Restream chat is switched off with its reason until an agent is
// connected (and with any stream but Restream), then sends the read_chat cue, waits for the live stream, and is
// connected; the agent hears it is a solo show and what is next on the card. On the producer screen: Your next point
// with Said and Skip, the viewer chat under the run order (questions bold with Use, Answered and Skip, plain chat quiet,
// Questions only), the agent's pick on the card with Use; Use puts the viewer question on the card (Answered, Back to
// your point); the end report lists the viewer questions answered and not answered and the points not said; after End
// the agent hears the chat is off. A viewer's words never become markup; nothing is stored; no outside request.
import assert from "node:assert/strict";
import { join } from "node:path";

// The Worker limits tokens per client address (10 a minute, one IPv6 /64 as one client); each browser context gets its
// own made-up one (its own /64 in the documentation range), so these checks never meet that limit.
let nextClient = 0;
const ownAddress = (options) => ({ ...options, extraHTTPHeaders: { "cf-connecting-ip": `2001:db8:9:${++nextClient}::1` } });

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];

// A made-up solo show and made-up viewers (Restream hides the viewers' names as "Person 1" and so on).
const PLAN = ["Show: Solo Test", "Guest: Not Used", "5 Intro", "10 The five rooms", "1. The late call", "2. Look first, then act", "3. Where your job stops"].join("\n");
const CHAT = [
  { author: "Person 1", platform: "YouTube", text: "Hello from Accra", time: "2026-12-01T19:01:00Z" },
  { author: "Person 2", platform: "LinkedIn", text: "How often do you test a restore?", time: "2026-12-01T19:01:10Z" },
  { author: "Person 3", platform: "YouTube", text: "Who tells the client at night?", time: "2026-12-01T19:01:20Z", pick: "fits Look first, then act" },
  { author: "Person 4", platform: "Twitch", text: "<b>bold</b> <img src=x onerror=alert(1)>", time: "2026-12-01T19:01:30Z" },
];

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

// Contrast of an element's text on what it is painted over (its own background over its nearest painted parent's), as the browser paints it.
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
    const context = await browser.newContext(ownAddress(options));
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-12-01T19:00:00Z") });
    await page.addInitScript(standIns);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("dialog", (d) => { problems.push(`dialog: ${d.message()}`); d.dismiss(); });
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
    await page.goto(`${base}/`);
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const pressOff = (locator) => (options.hasTouch ? locator.tap({ force: true }) : locator.click({ force: true }));
    const text = (sel) => page.locator(sel).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const button = async (sel) => ({ text: await text(sel), state: await page.locator(sel).getAttribute("data-state"), off: await page.locator(sel).getAttribute("aria-disabled"), tip: await page.locator(sel).getAttribute("data-tip") });
    const shot = async (file, sel) => {
      const path = join(out, `solo-${name}-${file}.png`);
      await page.keyboard.press("Escape");
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(200);
      if (sel) await page.locator(sel).scrollIntoViewIfNeeded();
      await page.screenshot({ path, fullPage: !phone });
      screenshots.push(path);
    };
    const card = async () => ({
      title: await text("#nextTitle"),
      q: await text("#qMain"),
      why: await page.locator("#qWhy").isVisible() ? await text("#qWhy") : null,
      src: await text("#qSrc"),
      done: await text("#askedBtn"),
      alts: await page.locator("#alts .alt").evaluateAll((els) => els.map((el) => [el.querySelector(".alt__q").textContent, el.querySelector(".chip, .alt__use").textContent])),
    });
    const relayCall = (tool, args) => page.evaluate(([t, a]) => window.__relay.call(t, a), [tool, args]);

    // ---- Setup: Show type first, Solo show picked; no guest step, no guest tab; the steps number in order.
    assert.deepEqual(await page.locator("#modeSeg button").allInnerTexts(), ["Solo show", "With a guest"], `${name}: the show type's choices`);
    assert.equal(await page.locator('#modeSeg [aria-pressed="true"]').textContent(), "Solo show", `${name}: Solo show is picked from the start`);
    assert.equal(await page.locator("#sMode").getAttribute("data-done"), "", `${name}: and the step is done`);
    assert.equal(await page.locator("#sGuest").isVisible(), false, `${name}: no Guest agreed step on a solo show`);
    assert.equal(await page.locator("#tabSource").isVisible(), false, `${name}: no guest tab to share on a solo show`);
    const labels = await page.locator(".step:not([hidden]) .step__label").allInnerTexts();
    assert.deepEqual(labels, ["Show type", "I stream with", "AI agent", "Show, points & plan", "Viewer chat", "Sound", "Speech to text"], `${name}: the steps of the solo prototype, in its order`);
    assert.deepEqual(await page.locator(".step:not([hidden]) .step__n").allInnerTexts(), ["1", "2", "3", "4", "5", "6", "7"], `${name}: numbered in order`);
    ok(`${name}: Show type first with Solo show picked; no guest step or guest tab; the steps of the prototype, numbered in order`);

    // With a guest brings the guest step and the tab back (numbered again); Solo show takes them away.
    await press(page.locator('#modeSeg [data-v="guest"]'));
    assert.equal(await page.locator("#sGuest").isVisible(), true, `${name}: with a guest, the guest step is back`);
    assert.equal(await text("#planLabel"), "Show, questions & plan", `${name}: and the list is questions`);
    assert.deepEqual(await page.locator(".step:not([hidden]) .step__n").allInnerTexts(), ["1", "2", "3", "4", "5", "6", "7", "8"], `${name}: numbered again`);
    assert.equal(await page.locator("#goBtn").getAttribute("data-tip"), "Answer Guest agreed first.", `${name}: a show with a guest waits for the guest's answer`);
    await press(page.locator('#modeSeg [data-v="solo"]'));
    assert.equal(await page.locator("#sGuest").isVisible(), false, `${name}: Solo show again`);
    ok(`${name}: With a guest brings the guest step back, Solo show takes it away`);

    // ---- Viewer chat: switched off with its reason until an agent is connected, and with a stream that is not Restream.
    assert.deepEqual(await button("#chatBtn"), { text: "i Connect Restream chat", state: null, off: "true", tip: "Connect your agent first (step 3)." }, `${name}: switched off until an agent is connected`);
    await press(page.locator('#streamSeg [data-v="obs"]'));
    assert.equal((await button("#chatBtn")).tip, "Viewer chat works with Restream streams only.", `${name}: Restream only`);
    assert.equal(await page.locator("#sChat").getAttribute("data-done"), "", `${name}: not needed with OBS, so the step is done`);
    await press(page.locator('#streamSeg [data-v="restream"]'));

    await press(page.locator("#connectBtn"));
    await page.waitForFunction(() => window.__relay.sockets.length === 1 && window.__relay.sockets[0].readyState === 1);
    assert.equal((await relayCall("get_context", {})).result.chatOn, undefined, `${name}: before Connect Restream chat the agent is not told the chat is on`);
    await page.waitForFunction(() => document.querySelector("#chatBtn").getAttribute("aria-disabled") === null);
    const ready = await button("#chatBtn");
    assert.deepEqual([ready.text, ready.state, ready.off], ["Connect Restream chat", null, null], `${name}: ready once the agent is connected`);
    assert.match(ready.tip, /Claude Code reads your Restream chat with its own Restream connection/, `${name}: the tooltip says how`);
    await shot("setup", "#sChat");

    // A press: the read_chat cue reaches the agent's wait; the button says it connects; the agent says no stream is live yet.
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
    await press(page.locator("#chatBtn"));
    const cue = await page.evaluate(async () => (await window.__wait).result);
    assert.deepEqual([cue.cue, cue.transcript], ["read_chat", []], `${name}: the press sends the read_chat cue`);
    assert.deepEqual(await button("#chatBtn"), { text: "Connecting chat…", state: "busy", off: null, tip: "Waiting for Claude Code to read your Restream chat." }, `${name}: Connecting chat… on the button`);
    const busy = await paintedContrast(page.locator("#chatBtn"));
    assert.ok(busy >= 4.5, `${name}: Connecting chat… reads at ${busy.toFixed(2)}:1`);
    const waited = await relayCall("post_chat", { messages: [], waiting: "no live stream yet" });
    assert.deepEqual(waited.result, { shown: 0 }, `${name}: the page takes the agent's waiting line`);
    assert.equal(await text("#chatBtn"), "Chat · waiting for your live stream", `${name}: the button waits for the live stream`);
    assert.equal(await page.locator("#sChat").getAttribute("data-done"), "", `${name}: the step is done while the agent watches for the stream`);
    ok(`${name}: Connect Restream chat: off with its reason, then ready, the read_chat cue, Connecting chat…, waiting for the live stream`);

    // ---- The plan: points, not questions; the top bar says solo; the agent hears it is a solo show.
    await press(page.locator("#planBtn"));
    await page.locator("#planIn").fill(PLAN);
    assert.equal(await text("#planBtn"), "3 points · 2 parts ✓", `${name}: the list is the host's points`);
    if (!phone) assert.equal(await text("#showLine"), "· Solo Test · solo", `${name}: the top bar says solo and names no guest`);
    const ctx = (await relayCall("get_context", {})).result;
    assert.equal(ctx.solo, true, `${name}: get_context says it is a solo show`);
    assert.equal(ctx.guestName, undefined, `${name}: and names no guest`);
    ok(`${name}: the list reads as points, the top bar says solo, the agent hears it is a solo show`);

    // Another stream ends the chat (the agent hears it is off); back on Restream a press connects it again.
    await press(page.locator('#streamSeg [data-v="obs"]'));
    assert.match((await relayCall("post_chat", { messages: [] })).error, /switched it off/, `${name}: OBS ends the chat: the agent hears it is off`);
    await press(page.locator('#streamSeg [data-v="restream"]'));
    assert.equal(await text("#chatBtn"), "Connect Restream chat", `${name}: back on Restream, ready to connect again`);
    await press(page.locator("#chatBtn"));
    assert.equal(await text("#chatBtn"), "Connecting chat…", `${name}: connecting again`);
    const again = (await relayCall("wait_for_cue", { seq: 1, holdMs: 25000 })).result;
    assert.deepEqual([again.cue, again.seq], ["read_chat", 2], `${name}: the agent hears read_chat again`);
    // A viewer asks before the show starts: its time says so, not a show time.
    await relayCall("post_chat", { messages: [{ author: "Person 5", platform: "YouTube", text: "Is this the security stream?" }] });
    assert.equal(await text("#chatBtn"), "Restream chat connected ✓", `${name}: connected`);
    ok(`${name}: another stream ends the chat; back on Restream it connects again`);

    // ---- The producer screen: the microphone, the speech model, open.
    await press(page.locator("#micBtn"));
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    await press(page.locator("#speechBtn"));
    await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
    assert.equal(await page.locator("#goBtn").getAttribute("aria-disabled"), null, `${name}: no guest step in the way of Open producer screen`);
    await press(page.locator("#goBtn"));
    assert.equal(await page.locator("#live").isVisible(), true, `${name}: the producer screen shows`);
    assert.equal(await text("#listenSrc"), "host mic", `${name}: only the host's microphone is listened to`);
    assert.deepEqual(await card(), { title: "Your next point", q: "The late call", why: "Next in your plan.", src: "Point 1 of 3 · your plan", done: "Said", alts: [["Look first, then act", "Point 2"], ["Where your job stops", "Point 3"]] }, `${name}: Your next point with Said and Skip`);
    assert.equal(await page.locator("#nextFoot").isVisible(), false, `${name}: no Suggest now on a solo show (as the prototype)`);
    assert.equal(await page.locator("#chat").isVisible(), true, `${name}: the viewer chat panel shows`);
    assert.equal(await text("#chatList .msg .msg__t"), "before", `${name}: a message from before Start says "before", never a show time`);
    await press(page.locator("#runBtn")); // Start
    const other = page.locator('#modeSeg [data-v="guest"]');
    assert.deepEqual([await other.getAttribute("aria-disabled"), await other.getAttribute("data-tip")], ["true", "The show has started, so the show type stays as it is."], `${name}: once the clock runs the show type is fixed`);
    await other.dispatchEvent("click"); // the setup is out of sight on the producer screen: the press goes to the button itself
    assert.equal(await page.locator('#modeSeg [aria-pressed="true"]').getAttribute("data-v"), "solo", `${name}: and a press changes nothing`);
    ok(`${name}: the producer screen: Your next point, Said and Skip, the viewer chat waiting for the live stream`);

    // ---- The chat arrives: plain chat quiet, questions bold with their buttons; the agent's pick waits on the card with Use.
    const posted = await relayCall("post_chat", { messages: CHAT });
    assert.deepEqual(posted.result, { shown: 4 }, `${name}: four messages shown`);
    assert.equal(await text("#chatBtn"), "Restream chat connected ✓", `${name}: the setup's button reads connected`);
    assert.equal(await page.locator("#chatState").isVisible(), false, `${name}: no state line once messages show`);
    const rows = await page.locator("#chatList .msg").evaluateAll((els) => els.map((el) => [el.querySelector(".msg__who").textContent, el.querySelector(".msg__x").textContent, el.hasAttribute("data-q"), [...el.querySelectorAll(".msg__act button:not([hidden])")].map((b) => b.textContent)]));
    assert.deepEqual(rows, [
      ["Person 5", "Is this the security stream?", true, ["Use", "Answered", "Skip"]],
      ["Person 1", "Hello from Accra", false, []],
      ["Person 2", "How often do you test a restore?", true, ["Use", "Answered", "Skip"]],
      ["Person 3", "Who tells the client at night?", true, ["Use", "Answered", "Skip"]],
      ["Person 4", "<b>bold</b> <img src=x onerror=alert(1)>", false, []],
    ], `${name}: each message with who and what; a question carries Use, Answered and Skip`);
    assert.equal(await page.locator("#chatList img, #chatList b").count(), 0, `${name}: a viewer's words never become markup`);
    assert.equal(await text("#openChip"), "3 open", `${name}: three questions wait`);
    const withPick = await card();
    assert.deepEqual(withPick.alts[0], ["Who tells the client at night?", "Use"], `${name}: the agent's pick waits on the card, with Use`);
    assert.equal(await page.locator("#alts .alt").first().locator(".alt__why").textContent(), "AI pick: fits Look first, then act · Person 3 · YouTube", `${name}: with the agent's few words why`);
    assert.equal(withPick.q, "The late call", `${name}: the pick never takes the card by itself`);
    const accent = await paintedContrast(page.locator("#alts .alt__use"));
    assert.ok(accent >= 3, `${name}: Use reads at ${accent.toFixed(2)}:1`);
    await shot("chat-pick", "#next");
    ok(`${name}: the chat under the run order; questions bold with Use, Answered and Skip; the agent's pick on the card with Use; no markup from the chat`);

    // ---- The agent hears what is next on the card with each cue.
    await page.evaluate(() => { window.__wait = window.__relay.call("wait_for_cue", { seq: 2, holdMs: 25000 }); });
    const said = await page.evaluate(async () => {
      window.__speech.emit({ type: "text", source: "host", piece: 1, final: true, text: "So that was the late call.", start: 0, end: 31 });
      window.__speech.emit({ type: "pause", source: "host", at: 31 });
      return (await window.__wait).result;
    });
    assert.equal(said.position.next, "Point 1: The late call", `${name}: the cue names the next point, so the agent can pick a question that fits`);
    assert.equal(said.guestName, undefined, `${name}: no guest's name on a solo show`);
    assert.equal(said.solo, true, `${name}: the cue says it is a solo show`);
    assert.equal(said.chatOn, true, `${name}: and that the viewer chat is connected`);
    // An answer with suggestions never changes the host's next point on a solo show: the agent offers viewer questions instead.
    await page.evaluate((seq) => { window.__relay.call("wait_for_cue", { seq, holdMs: 1000, suggestions: [{ text: "Agent's own question?" }, { question: 3 }] }); }, said.seq);
    await page.waitForTimeout(100);
    assert.deepEqual([(await card()).q, (await card()).why], ["The late call", "Next in your plan."], `${name}: the agent's suggestions leave the solo card alone`);
    ok(`${name}: each cue names the next point on the card`);

    // ---- Use: the pick goes on the card as the viewer question; Back to your point; Answered.
    await press(page.locator("#alts .alt").first());
    assert.deepEqual(await card(), { title: "Viewer question", q: "Who tells the client at night?", why: "Person 3 · YouTube · asked at 0:00", src: "From the chat", done: "Answered", alts: [["The late call", "Point 1"]] }, `${name}: Use puts the viewer question on the card`);
    assert.equal(await text('#chatList .msg[data-s="card"] [data-act="card"]'), "On card", `${name}: the chat says On card`);
    await shot("viewer-on-card", "#next");
    await press(page.locator("#alts .alt").first());
    assert.equal((await card()).title, "Your next point", `${name}: Back to your point takes it off again`);
    await press(page.locator('#chatList .msg:nth-child(1) [data-act="card"]'));
    assert.equal((await card()).why, "Person 5 · YouTube · asked before the show", `${name}: a question from before Start says so on the card`);
    await press(page.locator('#chatList .msg:nth-child(1) [data-act="card"]'));
    await press(page.locator('#chatList .msg:nth-child(4) [data-act="card"]'));
    assert.equal((await card()).q, "Who tells the client at night?", `${name}: Use in the chat does the same`);
    await page.clock.fastForward(65_000);
    await press(page.locator("#askedBtn"));
    assert.equal((await card()).q, "The late call", `${name}: Answered: back to the next point`);
    assert.match(await text('#chatList .msg:nth-child(4) [data-act="answered"]'), /^Answered ✓ · 1:0\d$/, `${name}: Answered ✓ with the show time on the chat's button`);
    assert.equal(await text("#openChip"), "2 open", `${name}: two questions left`);
    ok(`${name}: Use (on the card or in the chat) puts the viewer question on the card; Back to your point; Answered marks it with its time`);

    // ---- Skip in the chat; Questions only; Said moves the plan on.
    await press(page.locator('#chatList .msg:nth-child(3) [data-act="skipped"]'));
    assert.equal(await text('#chatList .msg:nth-child(3) [data-act="skipped"]'), "Skipped", `${name}: Skipped on the button`);
    assert.equal(await text("#openChip"), "1 open", `${name}: one open`);
    await press(page.locator("#qOnlyBtn"));
    assert.equal(await page.locator("#chatList .msg:not([hidden])").count(), 3, `${name}: Questions only hides the hellos`);
    await press(page.locator("#qOnlyBtn"));
    await press(page.locator("#askedBtn"));
    assert.equal((await card()).q, "Look first, then act", `${name}: Said moves to the next point`);
    await shot("live", phone ? "#chat" : null);
    ok(`${name}: Skip in the chat, Questions only, Said moves the plan on`);

    // ---- End & report: the viewer questions answered and not answered, the points not said; the agent hears the chat is off.
    await press(page.locator("#endBtn"));
    assert.equal(await page.locator("#report").isVisible(), true, `${name}: the end report shows`);
    assert.match(await text("#reportChip"), /^Solo Test · solo · 1 Dec 2026$/, `${name}: the show, solo, the date`);
    const stats = await page.locator("#reportStats .stat").evaluateAll((els) => els.map((el) => [...el.children].map((c) => c.textContent).join(" ").replace(/\s+/g, " ").trim()));
    assert.equal(stats[1], "1 of 3 points said", `${name}: points said`);
    assert.equal(stats[2], "1 viewer questions answered", `${name}: viewer questions answered`);
    assert.equal(stats[3], "2 viewer questions not answered · 1 skipped", `${name}: not answered, and how many skipped`);
    const listOf = (sel) => page.locator(`${sel} li`).evaluateAll((els) => els.map((el) => [...el.children].map((c) => c.textContent.replace(/\s+/g, " ").trim()).join(" | ")));
    assert.match((await listOf("#ansList"))[0], /^1:0\d \| Who tells the client at night\?Person 3 · YouTube \| answered$/, `${name}: the answered question with its time and viewer`);
    assert.deepEqual(await listOf("#notAnsList"), ["before | Is this the security stream?Person 5 · YouTube | no time", "0:00 | How often do you test a restore?Person 2 · LinkedIn | skipped"], `${name}: the questions not answered, in the chat's order`);
    assert.deepEqual(await listOf("#notSaidList"), ["Point 2 | Look first, then act | no time", "Point 3 | Where your job stops | no time"], `${name}: the points not said`);
    for (const id of ["#clipsPanel", "#topicsPanel", "#notAskedPanel"]) assert.equal(await page.locator(id).isVisible(), false, `${name}: no ${id} on a solo report (as the prototype)`);
    const after = await relayCall("post_chat", { messages: [{ author: "Person 9", text: "Late?" }] });
    assert.match(after.error, /switched it off/, `${name}: after End the agent hears the chat is off`);
    await shot("report");
    ok(`${name}: the end report lists the viewer questions answered and not answered and the points not said; the chat stops with the show`);

    // Nothing stored; only this site; no console problems.
    const stored = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, dbs: (await indexedDB.databases?.())?.map((d) => d.name) ?? [] }));
    assert.deepEqual([stored.local, stored.session, stored.cookie], [0, 0, ""], `${name}: nothing stored`);
    assert.ok(requests.every((p) => p === "/" || p.startsWith("/speech/") || p.startsWith("/api/")), `${name}: only this site's own paths: ${[...new Set(requests)].join(", ")}`);
    assert.deepEqual(problems, [], `${name}: no console errors, policy violations or dialogs`);
    ok(`${name}: nothing stored, only this site, no console errors`);
    await context.close();
  }
  return { checks, screenshots };
}
