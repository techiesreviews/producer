// Browser checks and screenshots for `kit specs` (the whole page), served through the real Worker with the page's
// own headers. Four views: desktop 1366x900 and phone 390x844, each in light and dark.
import assert from "node:assert/strict";
import { join } from "node:path";

const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

// The colour the browser paints for a CSS colour, as [r, g, b] (a canvas turns oklch and light-dark into pixels).
const paint = (page, expression) => page.evaluate((e) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  c.fillStyle = e === "body" ? getComputedStyle(document.body).backgroundColor : e;
  c.fillRect(0, 0, 1, 1);
  return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
}, expression);
const lightness = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export async function run({ browser, base, out }) {
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
    assert.ok(box.scrollHeight <= box.height, `${name}: an empty shell does not scroll (${box.scrollHeight} > ${box.height})`);
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
    // The chip is the only tabbable thing on the page, so one Tab from the body lands on it.
    await page.mouse.move(5, 400);
    await page.locator("body").click({ position: { x: 5, y: 400 } });
    assert.equal(await tip.getAttribute("data-on"), null, `${name}: a press elsewhere hides it`);
    await page.keyboard.press("Tab");
    assert.ok(await chip.evaluate((el) => el === document.activeElement), `${name}: Tab reaches the Private chip`);
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
    await context.close();
  }

  // The Worker answers a page request only for the page: a POST is refused.
  const post = await fetch(`${base}/`, { method: "POST", body: "private talk" });
  assert.equal(post.status, 405, "a POST is refused");
  assert.equal((await fetch(`${base}/nothing-here`)).status, 404, "an unknown address is a 404");
  ok("the Worker refuses a POST and answers an unknown address with 404");
  return { checks, screenshots };
}
