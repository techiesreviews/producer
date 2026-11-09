// Browser checks for `kit specs runorder`: step 3's show plan pasted by hand, and the run order with the show clock on
// the producer screen, in Chromium through the real Worker. Desktop 1366x900 (wide) and phone 390x844 (compact), light
// and dark. Time is Playwright's fake clock, paused, so minutes pass at once and exactly. The microphone and the speech model are stand-ins
// here (the speech suite checks the real ones): only the producer screen behind them is under test.
// Checks: the paste box opens from "Paste it myself" with the example under it; a bad line shows on the button and the
// box; a good plan shows its counts on the button and the show line; the producer screen shows the run order and the
// clock; Start starts the clock (a double click does not skip a part); time left, over time and the plan difference;
// Next part keeps each part's real time; the plan ends; compact shows now and next with All; nothing is stored or sent.
import assert from "node:assert/strict";
import { join } from "node:path";

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];

// Chromium's note that the microphone's sound tap (card 03) uses an older audio node; not a problem of this page.
const KNOWN_WARNING = /^The ScriptProcessorNode is deprecated\./;

// A plan of five parts and twelve questions (the mock-up's counts). Names are made up.
const PLAN = [
  "Show: Techies Live",
  "Guest: Jane Doe",
  "3 Intro",
  "8 Her story",
  "15 min Pricing & growth",
  "10 Viewer questions",
  "4 Wrap-up",
  ...Array.from({ length: 12 }, (_, i) => `${i + 1}. Question number ${i + 1}?`),
].join("\n");

// Stand-ins for the microphone (a quiet tone) and the speech worker (ready at once), so the producer screen opens.
function standIns() {
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const out = context.createMediaStreamDestination();
    tone.connect(out);
    tone.start();
    return out.stream;
  };
  const RealWorker = window.Worker;
  window.Worker = function Worker(url, options) {
    if (!String(url).includes("/speech/")) return new RealWorker(url, options);
    const fake = new EventTarget();
    fake.postMessage = (message) => { if (message?.type === "load") queueMicrotask(() => fake.dispatchEvent(new MessageEvent("message", { data: { type: "ready" } }))); };
    fake.terminate = () => {};
    return fake;
  };
}

// Contrast of an element's text on what it is painted over (its own background over the panel's), as the browser paints it.
const paintedContrast = (locator) => locator.evaluate((el) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const px = (...fills) => { c.clearRect(0, 0, 1, 1); for (const f of fills) { c.fillStyle = f; c.fillRect(0, 0, 1, 1); } return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const row = el.closest(".run");
  const panel = getComputedStyle(el.closest(".panel")).backgroundColor;
  const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const [hi, lo] = [lum(px(getComputedStyle(el).color)), lum(px(panel, getComputedStyle(row).backgroundColor))].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
});

// The colour a theme token computes to, as an element's text colour would.
const tokenColour = (page, name) => page.evaluate((n) => {
  const probe = document.body.appendChild(document.createElement("i"));
  probe.style.color = `var(--${n})`;
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, name);
// Contrast of the clock's plan difference on the clock's own background, as the browser paints it.
const clockContrast = (page) => page.locator("#clockDelta").evaluate((el) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const px = (fill) => { c.clearRect(0, 0, 1, 1); c.fillStyle = fill; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const [hi, lo] = [lum(px(getComputedStyle(el).color)), lum(px(getComputedStyle(el.closest(".clock")).backgroundColor))].sort((p, q) => q - p);
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
    await page.clock.install({ time: new Date("2026-11-09T19:00:00Z") });
    await page.addInitScript(standIns);
    const requests = [];
    const problems = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("console", (m) => { if (["error", "warning"].includes(m.type()) && !KNOWN_WARNING.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    await page.addInitScript(() => { document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP: ${e.violatedDirective} ${e.blockedURI}`)); });
    await page.goto(`${base}/`);
    await page.clock.pauseAt(new Date("2026-11-09T19:00:30Z")); // from here time moves only when a check moves it
    const press = (locator) => (options.hasTouch ? locator.tap() : locator.click());
    const text = (id) => page.locator(`#${id}`).evaluate((el) => el.textContent.replace(/\s+/g, " ").trim());
    const shot = async (file, clip) => { const path = join(out, `runorder-${name}-${file}.png`); await page.screenshot({ path, ...(clip ? { clip } : {}) }); screenshots.push(path); };

    // Step 3 sits between the agent and the guest steps, with its button only; the box is closed.
    assert.deepEqual(await page.locator(".step .step__label").allInnerTexts(), ["I stream with", "AI agent", "Show, questions & plan", "Guest agreed", "Sound", "Speech to text"], `${name}: step 3 is the show plan`);
    assert.deepEqual(await page.locator(".step__n").allInnerTexts(), ["1", "2", "3", "4", "5", "6"], `${name}: the steps are numbered in order`);
    const planBtn = page.locator("#planBtn");
    const box = page.locator("#planIn");
    assert.equal(await text("planBtn"), "Paste it myself", `${name}: the button's name`);
    assert.equal(await planBtn.getAttribute("aria-expanded"), "false", `${name}: the box starts closed`);
    assert.equal(await box.isVisible(), false, `${name}: no box until asked`);
    ok(`${name}: step 3 "Show, questions & plan" with Paste it myself`);

    // Paste it myself opens the box, focused, with the example's lines under it.
    await press(planBtn);
    assert.equal(await planBtn.getAttribute("aria-expanded"), "true", `${name}: the button says the box is open`);
    assert.ok(await box.evaluate((el) => el === document.activeElement), `${name}: the box has the focus`);
    assert.equal(await text("planEg"), "Example Show: Techies Live Guest: Jane Doe 10 Intro 20 Her story 1. How did it start?", `${name}: the example under the box`);
    assert.equal(await box.evaluate((el) => document.getElementById(el.getAttribute("aria-labelledby")).textContent), "Show, questions & plan", `${name}: the box is named by its step`);
    const boxRect = await box.boundingBox();
    const egRect = await page.locator("#planEg").boundingBox();
    assert.ok(egRect.y >= boxRect.y + boxRect.height - 1, `${name}: the example sits under the box`);
    if (phone) assert.ok(await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), `${name}: 16px text, so focusing the box does not zoom the phone`);
    ok(`${name}: the paste box opens focused, with the example under it`);

    // A bad line: the button names it, the box is marked invalid and described by the button, the step is not done.
    await box.fill("3 Intro\nhello there");
    assert.equal(await text("planBtn"), "Line 2 not clear", `${name}: the bad line on the button`);
    assert.equal(await planBtn.getAttribute("data-state"), "error", `${name}: in the error look`);
    assert.match(await planBtn.getAttribute("data-tip"), /^Line 2: "hello there"\. A part is minutes/, `${name}: the tooltip says how to write it`);
    assert.deepEqual([await box.getAttribute("aria-invalid"), await box.getAttribute("aria-describedby")], ["true", "planBtn"], `${name}: the box is invalid, described by the button`);
    assert.equal(await page.locator("#sPlan").getAttribute("data-done"), null, `${name}: not done`);
    await box.fill("1. Only a question?");
    assert.equal(await text("planBtn"), "No parts with minutes", `${name}: no run order in it`);
    ok(`${name}: a bad paste shows on the button and the box, no toast`);

    // The plan: counts on the button, the step done, the show line names the show and the guest.
    await box.fill(PLAN);
    assert.equal(await text("planBtn"), "12 questions · 5 parts ✓", `${name}: what was read`);
    assert.equal(await planBtn.getAttribute("data-state"), "ok", `${name}: in the ok look`);
    assert.deepEqual([await box.getAttribute("aria-invalid"), await box.getAttribute("aria-describedby")], ["false", null], `${name}: the box is fine again`);
    assert.equal(await page.locator("#sPlan").getAttribute("data-done"), "", `${name}: step 3 is done`);
    assert.equal(await text("showLine"), "· Techies Live · guest Jane Doe", `${name}: the show line`);
    await page.evaluate(() => document.activeElement?.blur());
    const step = await page.locator("#sPlan").boundingBox();
    await shot("setup-plan", { x: 0, y: Math.max(0, step.y - 8), width: options.viewport.width, height: Math.min(step.height + 16, options.viewport.height - Math.max(0, step.y - 8)) });
    const wide = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(wide.scroll <= wide.width, `${name}: no sideways scroll with the box open (${wide.scroll} > ${wide.width})`);
    await press(planBtn);
    assert.equal(await box.isVisible(), false, `${name}: the button closes the box again`);
    assert.equal(await text("planBtn"), "12 questions · 5 parts ✓", `${name}: and still says what was read`);
    ok(`${name}: a good plan shows "12 questions · 5 parts ✓", the step done and the show line`);

    const boxBackground = await box.evaluate((el) => getComputedStyle(el).backgroundColor);
    // Guest, microphone (stand-in), speech (stand-in), then the producer screen.
    await press(page.locator("#guestSeg button").first());
    await press(page.locator("#micBtn"));
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    await press(page.locator("#speechBtn"));
    await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
    await press(page.locator("#goBtn"));
    assert.equal(await page.locator("#live").isVisible(), true, `${name}: the producer screen`);

    // Before Start: the clock reads 0:00 with no plan difference; Start is the one orange button; the first part is next.
    const runBtn = page.locator("#runBtn");
    const rows = page.locator("#runList .run");
    const states = () => rows.evaluateAll((els) => els.map((el) => el.dataset.s));
    const times = () => page.locator("#runList .run__t").allInnerTexts();
    const visibleNames = () => rows.evaluateAll((els) => els.filter((el) => el.checkVisibility()).map((el) => el.querySelector(".run__name").textContent));
    assert.equal(await page.locator("#runs").isVisible(), true, `${name}: the run order shows`);
    assert.equal(await text("runsTitle"), "Run order", `${name}: its heading`);
    assert.deepEqual([await text("clockTime"), await page.locator("#clockDelta").isVisible()], ["0:00", false], `${name}: the clock waits at 0:00`);
    assert.equal(await page.locator("#clock").getAttribute("data-tip"), "Show time. It starts when you press Start.", `${name}: its tooltip`);
    assert.deepEqual([await text("runBtn"), await runBtn.getAttribute("class")], ["Start", "tb tb--primary tb--small"], `${name}: Start, orange`);
    assert.deepEqual(await states(), ["next", "later", "later", "later", "later"], `${name}: the first part is next`);
    assert.deepEqual(await times(), ["3:00", "8:00", "15:00", "10:00", "4:00"], `${name}: each part's planned minutes`);
    if (phone) {
      assert.deepEqual(await visibleNames(), ["Intro"], `${name}: compact shows only the next part`);
      assert.equal(await page.locator("#runsMore").isVisible(), true, `${name}: with All`);
    } else {
      assert.equal(await visibleNames().then((n) => n.length), 5, `${name}: wide shows every part`);
      assert.equal(await page.locator("#runsMore").isVisible(), false, `${name}: All is for a narrow window only`);
    }
    await shot("live-ready");
    ok(`${name}: the producer screen: run order, clock at 0:00, Start`);

    // Start (a double click counts once): the clock runs, the first part is now with its time left and bar.
    if (options.hasTouch) { await runBtn.tap(); await runBtn.tap(); } else await runBtn.dblclick();
    assert.equal(await text("runBtn"), "Next part", `${name}: Start becomes Next part`);
    assert.deepEqual(await states(), ["now", "next", "later", "later", "later"], `${name}: a double press on Start does not also end the first part`);
    await page.clock.runFor(70_000);
    assert.equal(await text("clockTime"), "1:10", `${name}: the clock runs`);
    assert.equal(await text("clockDelta"), "0:00 on plan", `${name}: on plan (the words after the time are for screen readers)`);
    assert.equal((await times())[0], "1:50 left", `${name}: time left in the part`);
    assert.equal(await rows.first().getAttribute("aria-current"), "step", `${name}: the current part is marked for screen readers`);
    const fill = await page.locator("#runList .run").first().locator(".run__bar > i").evaluate((el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
    assert.ok(Math.abs(fill - 70 / 180) < 0.02, `${name}: the bar is ${Math.round(fill * 100)} % full (70 of 180 s)`);
    ok(`${name}: Start runs the clock; time left and the bar; a double press counts once`);

    // Over time: the part reads how far over, in orange (readable on the tint), and the show is behind plan.
    await page.clock.runFor(130_000);
    assert.equal(await text("clockTime"), "3:20", `${name}: 3:20 in`);
    assert.equal((await times())[0], "0:20 over", `${name}: 20 s over the part`);
    const over = page.locator("#runList .run").first().locator(".run__t");
    assert.equal(await over.getAttribute("data-tone"), "late", `${name}: in the late colour`);
    const contrast = await paintedContrast(over);
    assert.ok(contrast >= 4.5, `${name}: the late time reads at ${contrast.toFixed(2)}:1 on the current part's tint`);
    assert.deepEqual([await text("clockDelta"), await page.locator("#clockDelta").getAttribute("data-tone")], ["+0:20 behind plan by 0:20", "late"], `${name}: behind plan`);
    assert.equal(await page.locator("#clock").getAttribute("data-tip"), "Show time, behind plan by 0:20.", `${name}: the clock's tooltip says it in words`);
    assert.equal(await page.locator("#clockDelta").evaluate((el) => getComputedStyle(el).color), await tokenColour(page, "accent-ink"), `${name}: behind plan is painted orange`);
    const behindContrast = await clockContrast(page);
    assert.ok(behindContrast >= 4.5, `${name}: and reads at ${behindContrast.toFixed(2)}:1 on the clock`);
    await shot("live-over");
    ok(`${name}: over time shows on the part and as the plan difference`);

    // Next part: the first part keeps its real time (3:20, so +0:20); the second is now; ahead after a short part.
    await press(runBtn);
    assert.deepEqual(await states(), ["done", "now", "next", "later", "later"], `${name}: on to the second part`);
    assert.deepEqual((await times()).slice(0, 2), ["+0:20", "8:00 left"], `${name}: the first part's real time against the plan`);
    if (phone) {
      assert.deepEqual(await visibleNames(), ["Her story", "Pricing & growth"], `${name}: compact shows now and next`);
      await press(page.locator("#runsMore"));
      assert.deepEqual([(await visibleNames()).length, await text("runsMore"), await page.locator("#runsMore").getAttribute("aria-expanded")], [5, "Less", "true"], `${name}: All shows every part`);
      await shot("live-all");
      await press(page.locator("#runsMore"));
      assert.deepEqual([(await visibleNames()).length, await text("runsMore")], [2, "All"], `${name}: Less goes back`);
    }
    // Once the clock runs the plan is fixed: the box takes no edits and its button says why. Even a change that
    // reaches the box (a reworded question and a changed part, then an empty box) leaves the run order as it started.
    assert.deepEqual([await box.evaluate((el) => el.readOnly), await planBtn.getAttribute("data-tip")], [true, "The show has started, so the plan stays as it is."], `${name}: the plan is fixed once the clock runs`);
    assert.notEqual(await box.evaluate((el) => getComputedStyle(el).backgroundColor), boxBackground, `${name}: and the box looks fixed (greyed)`);
    // The two changes below are set from a script, standing in for an edit the host can no longer make.
    assert.equal(await text("planBtn"), "12 questions · 5 parts ✓", `${name}: and its button still says what runs`);
    const before = await text("clockTime");
    await page.evaluate((plan) => { const box = document.querySelector("#planIn"); box.value = plan; box.dispatchEvent(new Event("input")); }, PLAN.replace("Question number 3?", "A reworded question?").replace("4 Wrap-up", "5 Wrap-up"));
    await page.clock.runFor(10_000);
    assert.notEqual(await text("clockTime"), before, `${name}: the clock goes on after the plan is edited`);
    assert.deepEqual(await states(), ["done", "now", "next", "later", "later"], `${name}: the run order stays as it started`);
    assert.equal((await times())[4], "4:00", `${name}: a part changed once the clock runs does not replace the timing`);
    await page.evaluate(() => { const box = document.querySelector("#planIn"); box.value = ""; box.dispatchEvent(new Event("input")); });
    await page.clock.runFor(1_000);
    assert.deepEqual([await page.locator("#runs").isVisible(), await page.locator("#clock").isVisible(), await states()], [true, true, ["done", "now", "next", "later", "later"]], `${name}: an emptied box leaves the run order and the clock`);
    await page.evaluate((plan) => { const box = document.querySelector("#planIn"); box.value = plan; box.dispatchEvent(new Event("input")); }, PLAN);
    await page.clock.runFor(7 * 60_000 - 11_000);
    await press(runBtn); // Her story: 7:00 of 8:00, a minute early
    assert.deepEqual([(await times())[1], await text("clockDelta")], ["−1:00", "−0:40 ahead of plan by 0:40"], `${name}: ahead of plan by 0:40 overall`);
    assert.equal(await page.locator("#clockDelta").getAttribute("data-tone"), "early", `${name}: in green`);
    assert.equal(await page.locator("#clockDelta").evaluate((el) => getComputedStyle(el).color), await tokenColour(page, "agent-ink"), `${name}: ahead of plan is painted green`);
    const aheadContrast = await clockContrast(page);
    assert.ok(aheadContrast >= 4.5, `${name}: and reads at ${aheadContrast.toFixed(2)}:1 on the clock`);
    ok(`${name}: Next part keeps each part's real time; ahead and behind add up`);

    // Two presses on Next part 200 ms apart move on one part only; a press a second later moves on again.
    await page.clock.runFor(2_000);
    await press(runBtn);
    await page.clock.runFor(200);
    await press(runBtn);
    assert.deepEqual(await states(), ["done", "done", "done", "now", "next"], `${name}: a quick second press on Next part is ignored`);
    await page.clock.runFor(1_000);
    await press(runBtn);
    assert.deepEqual(await states(), ["done", "done", "done", "done", "now"], `${name}: a press a second later moves on`);

    // To the end: the last Next part ends the plan, the button goes (focus to the heading), every part shows.
    await page.clock.runFor(2_000);
    await runBtn.focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await states(), ["done", "done", "done", "done", "done"], `${name}: every part done`);
    assert.equal(await runBtn.isVisible(), false, `${name}: no Next part after the last part`);
    assert.ok(await page.evaluate(() => document.activeElement?.id === "runsTitle"), `${name}: the keyboard lands on the heading`);
    assert.equal((await visibleNames()).length, 5, `${name}: the whole plan shows, compact too`);
    assert.equal(await page.locator("#runsMore").isVisible(), false, `${name}: no All when everything shows`);
    ok(`${name}: the plan ends; the clock goes on`);

    // Layout: wide puts the run order in the right column, compact across the window; nothing sideways; touch sizes.
    const lay = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, runs: document.querySelector("#runs").getBoundingClientRect().toJSON(), clock: document.querySelector("#clock").getBoundingClientRect().toJSON() }));
    assert.ok(lay.scroll <= lay.width, `${name}: no sideways scroll (${lay.scroll} > ${lay.width})`);
    assert.ok(lay.clock.right <= lay.width && lay.clock.left >= 0, `${name}: the clock is inside the window`);
    if (phone) assert.ok(lay.runs.width >= lay.width - 2 * 12, `${name}: compact: the run order spans the window`);
    else assert.ok(lay.runs.left > lay.width / 2 && lay.runs.width >= 16 * 14, `${name}: wide: the run order is the right column`);
    if (options.hasTouch) for (const id of ["planBtn", "runsMore"]) {
      const h = await page.locator(`#${id}`).evaluate((el) => el.getBoundingClientRect().height || 44);
      assert.ok(h >= 44, `${name}: #${id} is finger-sized (${h}px)`);
    }
    await shot("live-done");
    ok(`${name}: ${phone ? "compact" : "wide"} layout`);

    // Nothing kept and nothing sent: the page is the only request, no storage, no console problem.
    const kept = await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie, databases: (await indexedDB.databases()).length, caches: (await caches.keys()).length }));
    assert.deepEqual(kept, { local: 0, session: 0, cookie: "", databases: 0, caches: 0 }, `${name}: nothing stored`);
    assert.deepEqual(requests, [`${base}/`], `${name}: the plan went nowhere: the page is the only request`);
    assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation`);
    ok(`${name}: the plan stays in page memory: nothing stored, nothing sent`);
    await context.close();
  }

  // Long names with no spaces (a pasted link, say): the bar stays one row and nothing scrolls sideways, in setup and
  // on the producer screen, where the part's name wraps inside its row.
  {
    const context = await browser.newContext(VIEWS[0]);
    const page = await context.newPage();
    await page.addInitScript(standIns);
    await page.goto(`${base}/`);
    await page.locator("#planBtn").click();
    await page.locator("#planIn").fill(`Show: ${"x".repeat(150)}\nGuest: ${"y".repeat(80)}\n5 ${"z".repeat(200)}\n4 Outro`);
    const fits = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth, bar: document.querySelector(".top").getBoundingClientRect().height, clock: document.querySelector("#clock").getBoundingClientRect().right }));
    let box = await fits();
    assert.ok(box.scroll <= box.width && box.bar < 60, `long names: setup keeps one bar row and no sideways scroll (${JSON.stringify(box)})`);
    await page.locator("#guestSeg button").first().click();
    await page.locator("#micBtn").click();
    await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
    await page.locator("#speechBtn").click();
    await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
    await page.locator("#goBtn").click();
    box = await fits();
    assert.ok(box.scroll <= box.width && box.bar < 60 && box.clock <= box.width, `long names: the producer screen keeps one bar row, the clock inside the window (${JSON.stringify(box)})`);
    const shot = join(out, "runorder-long-names.png");
    await page.screenshot({ path: shot });
    screenshots.push(shot);
    ok("long names: one bar row, no sideways scroll, the clock inside the window");
    await context.close();
  }

  // A touch target for Start and Next part on a phone (checked apart: the plan run above hides the button at the end).
  const context = await browser.newContext(VIEWS[2]);
  const page = await context.newPage();
  await page.addInitScript(standIns);
  await page.goto(`${base}/`);
  await page.locator("#planBtn").tap();
  await page.locator("#planIn").fill("3 Intro\n4 Outro");
  await page.locator("#guestSeg button").first().tap();
  await page.locator("#micBtn").tap();
  await page.waitForFunction(() => document.querySelector("#micBtn").dataset.state === "ok");
  await page.locator("#speechBtn").tap();
  await page.waitForFunction(() => document.querySelector("#speechBtn").dataset.state === "ok");
  await page.locator("#goBtn").tap();
  const height = await page.locator("#runBtn").evaluate((el) => el.getBoundingClientRect().height);
  assert.ok(height >= 44, `phone: Start is finger-sized (${height}px)`);
  await page.locator("#runBtn").tap();
  assert.equal(await page.locator("#runsMore").isVisible(), false, "phone: now and next are the whole plan: no All");
  ok("phone: Start is finger-sized; no All when now and next are the whole plan");
  await context.close();

  return { checks, screenshots };
}
