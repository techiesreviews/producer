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

// The setup screen: the heading with this browser's chip, one step ("I stream with") whose choices press one at a
// time, the step's done mark, the wide (label beside) or compact (label above) layout, and no word on the screen
// beyond its labels (no explainer). Leaves "Restream Studio" picked, as on arrival.
async function checkSetup(page, name, { phone, touch, chip }) {
  const words = (await page.locator("#screen").innerText()).replace(/\s+/g, " ").trim();
  const label = await page.locator("#browserChip").innerText();
  assert.match(label, chip, `${name}: the browser chip names this browser`);
  assert.equal(words, `Set up ${label} 1 I stream with ${STREAM.join(" ")}`, `${name}: the screen says only its labels`);
  assert.equal(await page.locator(".step").count(), 1, `${name}: one step, until the next feature exists`);
  const options = page.locator("#streamSeg button");
  assert.deepEqual(await options.allInnerTexts(), STREAM, `${name}: the four choices`);
  const pressed = () => page.locator('#streamSeg button[aria-pressed="true"]').allInnerTexts();
  assert.deepEqual(await pressed(), ["Restream Studio"], `${name}: Restream Studio is picked on arrival`);
  assert.equal(await page.locator("#streamSeg").getAttribute("role"), "group", `${name}: the choices are one named group`);
  assert.equal(await page.locator("#streamSeg").evaluate((el) => document.getElementById(el.getAttribute("aria-labelledby"))?.textContent), "I stream with", `${name}: named by its step`);
  // Done: the step number turns green.
  const doneColour = await page.locator("#sStream .step__n").evaluate((el) => getComputedStyle(el).color);
  assert.deepEqual(await paint(page, doneColour), await token(page, "agent"), `${name}: the done step's number is green`);
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

export async function run({ browser, playwright, base, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);

  for (const view of VIEWS) {
    const { name, ...options } = view;
    const context = await browser.newContext(options);
    const page = await context.newPage();
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
      await checkSetup(page, name, { phone: false, touch: false, chip: /^Firefox \d+ · desktop$/ });
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
