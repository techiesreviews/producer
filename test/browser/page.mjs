// Browser checks and screenshots for `kit specs` (the whole page), served through the real Worker with the page's
// own headers. Four views in Chromium: desktop 1366x900 and phone 390x844 (an Android phone's browser name), each in
// light and dark; then the setup screen in a real Firefox, light and dark, which names itself and keeps working.
import assert from "node:assert/strict";
import { join } from "node:path";
import { AGENT_WAYS, mcpLine } from "../../src/agent-ways.mjs";
import { connectMessage } from "../../src/agent-message.mjs";

const ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

const VIEWS = [
  { name: "desktop-light", colorScheme: "light", viewport: { width: 1366, height: 900 } },
  { name: "desktop-dark", colorScheme: "dark", viewport: { width: 1366, height: 900 } },
  { name: "phone-light", colorScheme: "light", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
  { name: "phone-dark", colorScheme: "dark", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID },
];
const STREAM = ["Restream Studio", "Wave.video", "OBS", "Other"];
// The Worker limits tokens per client address (20 a minute); a real Cloudflare sets the address itself, and here each
// browser context gets its own made-up one, so the many connections these checks make do not meet that limit.
let nextClient = 0;
const ownAddress = (context) => context.setExtraHTTPHeaders({ "cf-connecting-ip": `203.0.113.${++nextClient}` });

const AGENTS = "Claude Code Codex T3 Code slower i API key";
const CODEX_TIP = "Codex blocks the network in safe mode: allow network or use the MCP line";
const T3_TIP = "Slower: about 6 seconds an answer. T3 Code cannot take a private MCP line, so it uses the connect message.";
const LOCK_TIP = "Disconnect first to pick another agent.";
const T3_MCP_TIP = "T3 Code cannot take a private MCP line. Use the connect message.";
const TEST_TIP = "Warm-up before you go live. For quicker answers, pick a fast model setting and use a fresh small chat.";
const GUEST = ["Yes", "No · my mic only", "Solo show"];
const KEY_TIP = "Comes later: your own paid AI key, capped at about €5 per stream.";
const OFF_REASON = "Firefox does not let web pages receive the sound of a shared tab, so the guest cannot be heard here. Use Chrome or Edge.";
const PHONE_REASON = "Phone and tablet browsers generally cannot share a tab with sound. Use Chrome or Edge on a computer.";
const TAB_LABEL = "Share the studio tab with sound";

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
const text = (page, id) => page.locator(`#${id}`).evaluate((el) => el.innerText.replace(/\s+/g, " ").trim());
const lightness = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// The setup screen: the heading with this browser's chip, the steps that exist ("I stream with", "AI agent", "Show,
// questions & plan", "Guest agreed", "Sound", "Speech to text") and the open button, step 1's choices pressing one at
// a time with its done mark, the guest step's answers, the wide (label beside) or compact (label above) layout, and no
// word on the screen beyond its labels (no explainer). Leaves "Restream Studio" picked and the guest answer Yes.
async function checkSetup(page, name, { phone, touch, chip, tabOff, service = true }) {
  const words = (await page.locator("#screen").innerText()).replace(/\s+/g, " ").trim();
  const label = await page.locator("#browserChip").innerText();
  assert.match(label, chip, `${name}: the browser chip names this browser`);
  assert.match(words, new RegExp(`^Set up ${label} 1 I stream with ${STREAM.join(" ")} 2 AI agent ${AGENTS} Copy connect message slower Connect with MCP recommended 3 Show, questions & plan i Let my agent load it Paste it myself 4 Guest agreed ${GUEST.join(" ")} 5 Sound Microphone ${tabOff ? "i " : ""}${TAB_LABEL} 6 Speech to text On this computer ${service ? "Browser service · audio goes to Google" : "i Browser service"} Load speech model · \\d+ MB Open producer screen$`), `${name}: the screen says only its labels`);
  assert.equal(await page.locator(".step").count(), 6, `${name}: six steps, one per feature that exists`);
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

// The tab-sound button in the Sound step. Chrome on a computer: ready, with how to share it and the headphones advice
// in its tooltip, no meter yet. A browser that cannot (Firefox, a phone): switched off with the "i" mark and the plain
// reason, shown by hover, tap or focus, and a press never asks the browser to share anything. The guest's answer No or
// Solo show switches it off with its own reason, and Yes brings it back. It fits its row and is finger-sized on touch.
// `reason` is the browser's reason, or null when the browser can. Leaves the guest answer Yes. Returns screenshots.
async function checkTabSound(page, name, out, { touch, reason }) {
  const btn = page.locator("#tabBtn");
  const tip = page.locator("#tip");
  const shots = [];
  const asked = () => page.evaluate(() => window.__displayCalls);
  const showsTip = (t) => page.waitForFunction((x) => document.querySelector("#tip[data-on]")?.textContent === x, t);
  const press = async () => { if (touch) await btn.tap({ force: true }); else await btn.click({ force: true }); };
  const answer = async (label) => { const b = page.getByRole("button", { name: label, exact: true }); if (touch) await b.tap(); else await b.click(); await page.evaluate(() => document.activeElement?.blur()); };
  const close = async () => { await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("#tip").hasAttribute("data-on")); };
  const shoot = async (label) => {
    await page.waitForTimeout(150);
    const r = await page.locator("#sSound").boundingBox();
    const shot = join(out, `page-${name}-tab-${label}.png`);
    await page.screenshot({ path: shot, clip: { x: 0, y: Math.max(0, r.y - 8), width: page.viewportSize().width, height: Math.min(r.height + 130, 300) } });
    shots.push(shot);
  };

  assert.equal(await page.locator("#tabTxt").innerText(), TAB_LABEL, `${name}: the button says what it does`);
  assert.equal(await page.locator("#tabMeter").isHidden(), true, `${name}: no tab meter until a tab is shared`);
  assert.equal(await btn.getAttribute("data-state"), null, `${name}: the tab button starts plain`);
  const box = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, tab: r("#tabBtn"), row: r("#sSound .step__ctl"), mic: r("#micBtn") };
  });
  assert.ok(box.tab.left >= box.row.left - 0.5 && box.tab.right <= box.row.right + 0.5 && box.tab.right <= box.width, `${name}: the tab button sits inside its row and the window`);
  assert.ok(box.scrollWidth <= box.width, `${name}: no sideways scroll with the tab button`);
  if (touch) assert.ok(box.tab.height >= 44, `${name}: the tab button is a finger-sized target (${box.tab.height}px)`);

  if (reason) {
    assert.equal(await btn.getAttribute("aria-disabled"), "true", `${name}: switched off in this browser`);
    assert.equal(await btn.getAttribute("data-tip"), reason, `${name}: with the plain reason`);
    assert.equal(await btn.locator(".off-mark").count(), 1, `${name}: carrying the round "i" mark`);
    const look = await btn.evaluate((el) => ({ color: getComputedStyle(el).color, cursor: getComputedStyle(el).cursor }));
    assert.deepEqual(await paint(page, look.color), await token(page, "faint"), `${name}: greyed`);
    if (!touch) assert.equal(look.cursor, "help", `${name}: the pointer asks "why?"`);
    if (touch) await btn.tap({ force: true }); else await btn.hover();
    await showsTip(reason);
    await shoot("off");
    await close();
    await press();
    await showsTip(reason);
    assert.equal(await asked(), 0, `${name}: pressing it asks the browser for nothing`);
    await close();
    assert.equal(await page.locator("#sSound").evaluate((el) => el.hasAttribute("data-done")), false, `${name}: the Sound step waits for the microphone`);
  } else {
    assert.equal(await btn.getAttribute("aria-disabled"), null, `${name}: ready in this browser`);
    const idle = await btn.getAttribute("data-tip");
    assert.match(idle, /^Pick a browser tab and tick "Also share tab audio"\./, `${name}: the tooltip says how to share`);
    assert.match(idle, /Wear headphones/, `${name}: and asks the host for headphones`);
    if (touch) await btn.tap(); else await btn.hover();
    await showsTip(idle);
    await shoot("ready");
    await close();
    await page.evaluate(() => document.activeElement?.blur());
  }

  // The guest's answer: No and Solo show switch it off with their own reasons (a browser's own reason wins); Yes brings it back.
  const expect = { "No · my mic only": "Your guest said no: only your microphone is listened to.", "Solo show": "Solo show: no guest to hear." };
  for (const [label, why] of Object.entries(expect)) {
    await answer(label);
    assert.equal(await btn.getAttribute("aria-disabled"), "true", `${name}: ${label}: the tab button is switched off`);
    assert.equal(await btn.getAttribute("data-tip"), reason ?? why, `${name}: ${label}: ${reason ? "the browser's own reason stays" : "with the reason"}`);
  }
  if (!reason) { await answer("No · my mic only"); await shoot("guest-no"); }
  await answer("Yes");
  // OBS has no studio tab: the button is off with its own reason (a browser's own reason still comes first), and the
  // Open button does not wait for it. Back on Restream Studio it is ready again.
  const OBS_REASON = "No tab sound with OBS: it has no studio tab to share. Only your microphone is listened to.";
  const pick = async (label) => { const b = page.getByRole("button", { name: label, exact: true }); if (touch) await b.tap(); else await b.click(); await page.evaluate(() => document.activeElement?.blur()); };
  await pick("OBS");
  assert.equal(await btn.getAttribute("aria-disabled"), "true", `${name}: OBS: the tab button is switched off`);
  assert.equal(await btn.getAttribute("data-tip"), reason ?? OBS_REASON, `${name}: OBS: ${reason ? "the browser's own reason stays" : "with its reason"}`);
  await pick("Restream Studio");
  assert.equal(await btn.getAttribute("aria-disabled"), reason ? "true" : null, `${name}: back on Restream Studio: ${reason ? "still off in this browser" : "ready again"}`);
  assert.equal(await btn.getAttribute("aria-disabled"), reason ? "true" : null, `${name}: Yes: ${reason ? "still off in this browser" : "the tab button is ready again"}`);
  // Leave nothing open for the next check: the pointer moves off and the tooltip the last answer opened is closed.
  if (!touch) await page.mouse.move(5, 600);
  await close();
  return shots;
}

// Counts how often the page asks the browser to share a tab or screen (window.__displayCalls), for the checks that a
// switched-off tab button asks for nothing. The call itself is refused, so no real picker is ever involved.
function countDisplayCalls() {
  window.__displayCalls = 0;
  const media = navigator.mediaDevices;
  if (media?.getDisplayMedia) media.getDisplayMedia = async () => { window.__displayCalls++; throw new DOMException("refused for the check", "NotAllowedError"); };
}

// Step 6's two ways to turn speech into text: the model on this computer (picked on arrival) and the browser's own
// speech service (opt-in, its one warning line on the choice itself, no toast or explainer). Where the browser has
// no such service the choice is greyed with the "i" and its reason, and pressing it picks nothing. Returns the screenshot.
const SERVICE_TIP = "Your voice goes to Google, and your guest's too without headphones."; // the guest answer is Yes here
const NO_SERVICE_REASON = "This browser has no speech service of its own.";
const PHONE_SERVICE_REASON = "The browser's speech service is only offered on a computer. Use the model on this computer.";
async function checkEngine(page, name, out, { touch, available, reason = NO_SERVICE_REASON }) {
  const choice = page.locator("#browserChoice");
  const local = page.locator('#engineSeg [data-v="local"]');
  // Scrolls the control into view and waits until the page has stopped scrolling.
  const settled = async (l) => {
    await l.scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((done) => {
      let last = -1;
      let still = 0;
      const frame = () => { if (scrollY === last) { if (++still >= 4) return done(); } else { still = 0; last = scrollY; } requestAnimationFrame(frame); };
      frame();
    }));
  };
  const press = async (l) => {
    await settled(l);
    await (touch ? l.tap({ force: true }) : l.click({ force: true }));
  };
  const pressed = () => page.locator('#engineSeg button[aria-pressed="true"]').allInnerTexts();
  const shows = async (el, tip) => {
    // On a phone this step sits below the fold: scroll to it first, because a scroll takes an open tooltip away.
    await settled(el);
    if (touch) await el.tap({ force: true }); else await el.hover();
    await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, tip, { timeout: 3000 }).catch(async (error) => {
      throw new Error(`${name}: the tooltip did not show "${tip}" (shows ${JSON.stringify(await page.evaluate(() => [document.querySelector("#tip").textContent, document.querySelector("#tip").hasAttribute("data-on")]))})`, { cause: error });
    });
  };
  assert.deepEqual(await pressed(), ["On this computer"], `${name}: the model on this computer is picked on arrival`);
  assert.equal(await page.locator("#speechBtn").isVisible(), true, `${name}: with its load button`);
  assert.equal(await page.locator("#sSpeech").evaluate((el) => el.hasAttribute("data-done")), false, `${name}: and the step not done`);
  assert.equal(await local.getAttribute("data-tip"), null, `${name}: the default way carries no note (a tip under it would cover the other choice on a phone)`);
  assert.equal(await page.locator("#engineSeg").getAttribute("role"), "group", `${name}: the two ways are one named group`);
  assert.equal(await page.locator("#engineSeg").evaluate((el) => document.getElementById(el.getAttribute("aria-labelledby"))?.textContent), "Speech to text", `${name}: named by its step`);

  if (!available) {
    assert.equal(await choice.getAttribute("aria-disabled"), "true", `${name}: the browser service is switched off here`);
    assert.equal(await choice.locator(".off-mark").count(), 1, `${name}: with the round "i"`);
    await shows(choice, reason);
    await press(choice);
    assert.deepEqual(await pressed(), ["On this computer"], `${name}: pressing it picks nothing`);
    assert.equal(await page.locator("#speechBtn").isVisible(), true, `${name}: the load button stays`);
    await page.keyboard.press("Escape");
    return [];
  }

  assert.equal(await choice.getAttribute("aria-disabled"), null, `${name}: the browser service can be picked`);
  assert.equal(await text(page, "browserChoice"), "Browser service · audio goes to Google", `${name}: the warning is one plain line on the choice itself`);
  await shows(choice, SERVICE_TIP);
  assert.equal(await page.locator("#sSpeech").evaluate((el) => el.querySelectorAll("p, small, .note, [role=note]").length), 0, `${name}: no explainer text`);
  assert.equal(await page.locator(".toast, [role=alert]").count(), 0, `${name}: no toast`);

  // By keyboard: Tab from the first choice reaches the service, a Space picks it (with a visible focus ring), Shift+Tab and Space pick the model again.
  if (!touch) {
    await local.focus();
    await page.keyboard.press("Tab");
    assert.ok(await choice.evaluate((el) => el === document.activeElement), `${name}: Tab reaches the browser service`);
    assert.notEqual(await choice.evaluate((el) => getComputedStyle(el).outlineStyle), "none", `${name}: and it shows a focus ring`);
    await page.keyboard.press("Space");
    assert.deepEqual(await pressed(), ["Browser service · audio goes to Google"], `${name}: Space picks it`);
    assert.equal(await page.locator("#speechBtn").isVisible(), false, `${name}: and the load button steps aside`);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Space");
    assert.deepEqual(await pressed(), ["On this computer"], `${name}: Shift+Tab and Space pick the model again`);
    await page.keyboard.press("Escape");
  }

  await press(choice);
  assert.deepEqual(await pressed(), ["Browser service · audio goes to Google"], `${name}: picking it is the opt-in, and the warning stays on it`);
  assert.equal(await page.locator("#speechBtn").isVisible(), false, `${name}: nothing to load, so the load button steps aside`);
  assert.equal(await page.locator("#sSpeech").evaluate((el) => el.hasAttribute("data-done")), true, `${name}: the step is done`);
  const box = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    return { choice: r("#browserChoice"), seg: r("#engineSeg"), width: innerWidth, scrollWidth: document.documentElement.scrollWidth };
  });
  assert.ok(box.scrollWidth <= box.width && box.choice.left >= box.seg.left - 0.5 && box.choice.right <= box.seg.right + 0.5 && box.choice.right <= box.width, `${name}: the long choice fits its row and the window`);
  if (touch) assert.ok(box.choice.height >= 44, `${name}: finger-sized (${box.choice.height}px)`);
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  const shot = join(out, `page-${name}-speech-engine.png`);
  const step = await page.locator("#sSpeech").boundingBox();
  await page.screenshot({ path: shot, clip: { x: Math.max(0, step.x - 8), y: Math.max(0, step.y - 8), width: Math.min(page.viewportSize().width, step.width + 16), height: step.height + 16 } });

  await press(local);
  assert.deepEqual(await pressed(), ["On this computer"], `${name}: switching back picks the model again`);
  assert.equal(await page.locator("#speechBtn").isVisible(), true, `${name}: its load button comes back`);
  assert.equal(await page.locator("#sSpeech").evaluate((el) => el.hasAttribute("data-done")), false, `${name}: and the step is not done until it is loaded`);
  await page.keyboard.press("Escape");
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

// Step 2, the AI agent, as in the mock-up: Claude Code picked, Codex and T3 Code on with their notes, the API key off; Copy
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
  // Codex and T3 Code are on, each with its own note; Claude Code's fast way carries none; the API key stays off.
  assert.equal(await page.locator('#agentSeg [data-v="claude"]').getAttribute("data-tip"), null, `${name}: Claude Code has no note`);
  for (const [v, tip] of [["codex", CODEX_TIP], ["t3", T3_TIP]]) {
    const b = page.locator(`#agentSeg [data-v="${v}"]`);
    assert.equal(await b.getAttribute("aria-disabled"), null, `${name}: ${v} is switched on`);
    assert.equal(await b.getAttribute("data-tip"), tip, `${name}: ${v} carries its note`);
  }
  assert.equal(await page.locator('#agentSeg [data-v="t3"] .tag').innerText(), "slower", `${name}: T3 Code is labelled slower`);
  assert.equal(await page.locator('#agentSeg .tag').count(), 1, `${name}: and only T3 Code is`);
  const key = page.locator('#agentSeg [data-v="key"]');
  assert.equal(await key.getAttribute("aria-disabled"), "true", `${name}: the API key is switched off`);
  assert.equal(await key.getAttribute("data-tip"), KEY_TIP, `${name}: and says when it comes`);
  assert.deepEqual(await state(), { label: "Copy connect message slower", state: null, tip: "Copies a message. Paste it into Claude Code.", dot: null, test: null, testTip: TEST_TIP, done: false }, `${name}: off, Test hidden`);
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
    assert.ok(copied.includes(`T='${agentToken}'; U='${base}/mcp'`), `${name}: the message carries this page's address and token`);
    assert.match(copied, /```bash\n[\s\S]*while o=\$\(curl -sS -m 40 [\s\S]*```/, `${name}: and the ready-made loop`);
  }
  if (clipboard) assert.equal(boxShown, false, `${name}: the message box stays hidden when the copy worked`);
  else if (boxShown) assert.match(await page.locator("#agentMessage").inputValue(), /while o=\$\(curl/, `${name}: the shown message holds the loop`);
  await shoot("waiting");

  // The agent's first call: connected, and Test appears.
  const context = await page.evaluate(() => __relay.call("get_context"));
  assert.deepEqual(context.result, { questions: [], segments: [], seq: 0 }, `${name}: the page answers get_context`);
  await page.waitForFunction(() => document.getElementById("connectBtn").dataset.state === "ok");
  const open = await page.evaluate(() => document.querySelector("#tip[data-on]")?.textContent ?? null);
  assert.ok(open === null || open === "Click to disconnect.", `${name}: an open tooltip follows the new state (${open})`);
  assert.deepEqual(await state(), { label: "Claude Code connected", state: "ok", tip: "Click to disconnect.", dot: "dot dot--ok", test: "Test", testTip: TEST_TIP, done: false }, `${name}: connected`);
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
  for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.textContent.trim())); }
  assert.deepEqual(order, ["i Codex", "i T3 Code slower", "i API key", "connectBtn", "testBtn"], `${name}: Tab order (the other agents are locked while connected; the way not used steps aside)`);
  await page.keyboard.press("Escape");

  // Layout: every control inside the window; on a touch screen each one is finger-sized.
  const { width, boxes } = await page.evaluate(() => ({ width: innerWidth, boxes: [...document.querySelectorAll("#sAgent button:not([hidden])")].map((b) => b.getBoundingClientRect().toJSON()) }));
  for (const b of boxes) assert.ok(b.left >= 0 && b.right <= width + 0.5, `${name}: step 2 fits the window`);
  if (touch) for (const b of boxes) assert.ok(b.height >= 44, `${name}: finger-sized (${b.height}px)`);

  // Disconnect: the token is revoked and the step starts over; nothing was kept in the browser.
  await press(connect);
  await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "Copy connect message slower");
  assert.equal(await page.evaluate(() => __relay.revoked), true, `${name}: Disconnect revokes the token`);
  assert.deepEqual(await state(), { label: "Copy connect message slower", state: null, tip: "Copies a message. Paste it into Claude Code.", dot: null, test: null, testTip: TEST_TIP, done: false }, `${name}: back to off`);
  const kept = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  assert.deepEqual(kept, { local: 0, session: 0, cookie: "" }, `${name}: the token was never stored`);
  // Leaving or reloading the page revokes the token too (the page keeps none).
  await press(connect);
  await page.waitForFunction(() => __relay.sockets.length === 2);
  await page.evaluate(() => __relay.call("get_context"));
  await page.waitForFunction(() => document.getElementById("connectBtn").dataset.state === "ok");
  await page.evaluate(() => { __relay.revoked = false; dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })); });
  assert.equal(await page.evaluate(() => __relay.revoked), true, `${name}: leaving the page revokes the token`);
  assert.equal((await state()).label, "Copy connect message slower", `${name}: and the step starts over`);
  await page.evaluate(() => document.activeElement?.blur());
  return shots;
}

// Card 09: the ways to connect, per agent. Each chip shows its note by mouse or tap and by keyboard (Claude Code
// none, Codex its safe-mode warning, T3 Code its "slower" note); Connect with MCP copies the agent's one-line setup
// (Claude Code, Codex) and shows the same waiting and connected looks as the message; T3 Code's MCP button is off with
// its reason; while connecting or connected the other agents are locked; Disconnect frees them. Returns screenshots.
async function checkWays(page, name, out, { base, touch, clipboard }) {
  const shots = [];
  const press = (el) => (touch ? el.tap() : el.click());
  // Playwright counts aria-disabled as not clickable: a press on a switched-off control is forced.
  const pressOff = (el) => (touch ? el.tap({ force: true }) : el.click({ force: true }));
  const chip = (v) => page.locator(`#agentSeg [data-v="${v}"]`);
  const pressed = async () => (await page.locator('#agentSeg button[aria-pressed="true"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const shownTip = () => page.evaluate(() => document.querySelector("#tip[data-on]")?.textContent ?? null);
  // Waits for the tooltip to show exactly this text; on a miss the assertion shows the text it did show.
  const showsTip = async (text) => {
    try { await page.waitForFunction((t) => document.querySelector("#tip[data-on]")?.textContent === t, text, { timeout: 4000 }); } catch { assert.equal(await shownTip(), text, `${name}: the tooltip`); }
  };
  const noTip = () => page.waitForFunction(() => !document.querySelector("#tip").hasAttribute("data-on"));
  // What was copied: the clipboard where the browser lets the check read it; else the text the page showed to copy by
  // hand; null when the browser took the copy and the check cannot read it back (Firefox).
  const copied = async () => ((await page.locator("#agentMessage").isVisible()) ? page.locator("#agentMessage").inputValue() : clipboard ? page.evaluate(() => navigator.clipboard.readText()) : null);
  const assertCopied = async (expected, message) => { const text = await copied(); if (text !== null) assert.equal(text, expected, message); };
  const lastToken = () => page.evaluate(() => __relay.sockets.at(-1).protocols[1].slice(2));
  const sockets = () => page.evaluate(() => __relay.sockets.length);
  const view = () => page.evaluate(() => {
    const f = (id) => {
      const b = document.getElementById(id);
      return { label: b.textContent.trim().replace(/\s+/g, " "), state: b.dataset.state ?? null, tip: b.dataset.tip ?? null, off: b.getAttribute("aria-disabled") === "true", shown: !b.hidden && getComputedStyle(b).display !== "none" };
    };
    return { paste: f("connectBtn"), mcp: f("mcpBtn") };
  });
  const shoot = async (label) => {
    await page.waitForTimeout(150);
    const r = await page.locator("#sAgent").boundingBox();
    const shot = join(out, `page-${name}-ways-${label}.png`);
    await page.screenshot({ path: shot, clip: { x: 0, y: Math.max(0, r.y - 8), width: page.viewportSize().width, height: Math.min(r.height + 90, 340) } });
    shots.push(shot);
  };
  const pick = async (v) => { await press(chip(v)); await page.mouse.move(1, 1); await page.keyboard.press("Escape"); };
  const reset = () => page.evaluate(() => document.activeElement?.blur());

  // Each chip's note, by mouse or tap: Claude Code none, Codex and T3 Code theirs.
  await press(chip("codex"));
  assert.deepEqual(await pressed(), ["Codex"], `${name}: ${touch ? "a tap" : "a click"} picks Codex`);
  await showsTip(CODEX_TIP);
  await shoot("codex-tip");
  await press(chip("t3"));
  assert.deepEqual(await pressed(), ["T3 Code slower"], `${name}: and T3 Code`);
  await showsTip(T3_TIP);
  await shoot("t3-tip");
  await press(chip("claude"));
  assert.deepEqual(await pressed(), ["Claude Code"], `${name}: and back to Claude Code`);
  await page.waitForTimeout(450);
  assert.equal(await shownTip(), null, `${name}: Claude Code's fast way shows no note`);
  // A tip opened by the keyboard on one chip, then a mouse click on the next chip: the click moves focus away from the
  // first chip, which must not cancel the second chip's tip that is about to open.
  if (!touch) {
    await chip("claude").focus();
    await page.keyboard.press("Tab");
    await showsTip(CODEX_TIP);
    await press(chip("t3"));
    await showsTip(T3_TIP);
    await press(chip("claude"));
    await page.mouse.move(1, 1);
    await page.keyboard.press("Escape");
    await reset();
  }
  // By keyboard: Tab onto a chip shows its note.
  await page.keyboard.press("Escape");
  await chip("claude").focus();
  await page.keyboard.press("Tab");
  await showsTip(CODEX_TIP);
  await page.keyboard.press("Tab");
  await showsTip(T3_TIP);
  await page.keyboard.press("Tab");
  await showsTip(KEY_TIP);
  await page.keyboard.press("Escape");
  await reset();
  assert.deepEqual(await pressed(), ["Claude Code"], `${name}: moving over the chips by keyboard picks nothing`);

  // Idle, per agent: the words and tips of the two ways.
  const idle = (agent, pasteTip, slow) => ({
    paste: { label: slow ? "Copy connect message slower" : "Copy connect message", state: null, tip: pasteTip, off: false, shown: true },
    mcp: agent.mcp
      ? { label: "Connect with MCP recommended", state: null, tip: agent.mcp.idleTip, off: false, shown: true }
      : { label: "i Connect with MCP", state: null, tip: T3_MCP_TIP, off: true, shown: true },
  });
  assert.deepEqual(await view(), idle(AGENT_WAYS.claude, "Copies a message. Paste it into Claude Code.", true), `${name}: Claude Code, idle`);
  assert.deepEqual([await page.locator("#connectBtn .tag").innerText(), await page.locator("#mcpBtn .tag").innerText()], ["slower", "recommended"], `${name}: Claude Code: the message way is slower, Connect with MCP is recommended`);
  // The keyboard reaches every control of the idle step, in order.
  await chip("claude").focus();
  const order = [];
  for (let i = 0; i < 5; i++) { await page.keyboard.press("Tab"); order.push(await page.evaluate(() => document.activeElement.id || document.activeElement.textContent.trim())); }
  assert.deepEqual(order, ["Codex", "T3 Code slower", "i API key", "connectBtn", "mcpBtn"], `${name}: Tab order, idle`);
  await page.keyboard.press("Escape");
  await reset();
  await pick("codex");
  assert.deepEqual(await view(), idle(AGENT_WAYS.codex, `Copies a message. Paste it into Codex. ${CODEX_TIP}.`, true), `${name}: Codex, idle: its paste way is the slower one and carries the warning`);
  assert.equal(await page.locator("#connectBtn .tag").innerText(), "slower", `${name}: the slower label sits on the paste way`);
  assert.equal(await page.locator("#mcpBtn .tag").innerText(), "recommended", `${name}: Codex: the recommended label sits on Connect with MCP`);
  await shoot("codex-idle");
  await pick("t3");
  assert.deepEqual(await view(), idle(AGENT_WAYS.t3, "Copies a message. Paste it into T3 Code.", false), `${name}: T3 Code, idle: no MCP way`);
  assert.equal(await page.locator("#connectBtn .tag").count(), 0, `${name}: T3 Code's chip already says slower, so its button does not say it twice`);
  assert.equal(await page.locator("#mcpBtn .tag").count(), 0, `${name}: T3 Code has no MCP way to recommend`);
  // The "slower" label reads at 4.5:1 on its own fill, as the browser paints it: on the picked chip (over the ink fill)
  // and on the paste button (over the page's surface).
  const tagContrast = (selector, under) => page.locator(selector).evaluate((el, under) => {
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const px = (...fills) => { for (const f of fills) { c.fillStyle = f; c.fillRect(0, 0, 1, 1); } return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const base = getComputedStyle(el.closest(under)).backgroundColor;
    const lum = (rgb) => { const [x, y, z] = rgb.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
    const [hi, lo] = [lum(px(getComputedStyle(el).color)), lum(px(base === "rgba(0, 0, 0, 0)" ? "white" : base, getComputedStyle(el).backgroundColor))].sort((p, q) => q - p);
    return (hi + 0.05) / (lo + 0.05);
  }, under);
  assert.ok(await tagContrast('#agentSeg [data-v="t3"] .tag', "button") >= 4.5, `${name}: the label on the picked chip reads at 4.5:1`);
  await pick("codex");
  assert.ok(await tagContrast("#connectBtn .tag", ".steps") >= 4.5, `${name}: the label on the paste button reads at 4.5:1`);
  assert.ok(await tagContrast("#mcpBtn .tag", ".steps") >= 4.5, `${name}: the recommended label on Connect with MCP reads at 4.5:1`);
  assert.ok(await tagContrast('#agentSeg [data-v="t3"] .tag', ".seg") >= 4.5, `${name}: the label on an unpicked chip reads at 4.5:1`);
  // Layout: everything inside the window, finger-sized on a touch screen, in the two states with the longest labels:
  // Claude Code and Codex ("Copy connect message slower" beside "Connect with MCP recommended") and T3 Code (its chip's tag).
  const fits = async (who) => {
    const { width, scrollWidth, boxes } = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll("#sAgent button:not([hidden])")].map((b) => b.getBoundingClientRect().toJSON()) }));
    assert.ok(scrollWidth <= width, `${name}: ${who}: no sideways scroll with the tags`);
    for (const b of boxes) assert.ok(b.left >= 0 && b.right <= width + 0.5, `${name}: ${who}: step 2 fits the window`);
    if (touch) for (const b of boxes) assert.ok(b.height >= 44, `${name}: ${who}: finger-sized (${b.height}px)`);
  };
  await fits("Codex");
  await pick("claude");
  await fits("Claude Code");
  await pick("t3");
  await fits("T3 Code");
  // T3 Code's MCP button is switched off: it shows its reason on a press, by mouse or tap, and by keyboard, and connects nothing.
  const before = await sockets();
  await pressOff(page.locator("#mcpBtn"));
  await showsTip(T3_MCP_TIP);
  await page.keyboard.press("Escape");
  await noTip();
  await page.locator("#connectBtn").focus();
  await page.keyboard.press("Tab");
  await showsTip(T3_MCP_TIP);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  assert.equal(await shownTip(), T3_MCP_TIP, `${name}: Enter and Space on it only show the reason`);
  assert.equal(await sockets(), before, `${name}: no connection was started`);
  assert.equal((await view()).mcp.state, null, `${name}: and nothing is waiting`);
  await shoot("t3-idle");
  await page.keyboard.press("Escape");
  await reset();

  // Giving up a wait: Codex's message was copied and nothing came back (curl is blocked in safe mode). Pressing Connect
  // with MCP revokes that token and copies the MCP line with a new one; picking another agent revokes it too.
  await pick("codex");
  const w0 = await sockets();
  await press(page.locator("#connectBtn"));
  await page.waitForFunction((n) => __relay.sockets.length > n, w0);
  await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "Waiting for Codex…");
  const tokenA = await lastToken();
  let w = await view();
  assert.equal(w.mcp.shown && w.mcp.off === false && w.mcp.label === "Connect with MCP recommended", true, `${name}: Codex waiting on the message: Connect with MCP is still there`);
  await page.evaluate(() => { __relay.revoked = false; });
  const w1 = await sockets();
  await press(page.locator("#mcpBtn"));
  await page.waitForFunction((n) => __relay.sockets.length > n && document.getElementById("mcpBtn").textContent === "Waiting for Codex…", w1);
  assert.equal(await page.evaluate(() => __relay.revoked), true, `${name}: giving up the wait revokes its token`);
  const tokenB = await lastToken();
  assert.notEqual(tokenB, tokenA, `${name}: the MCP line comes with a new token`);
  await assertCopied(mcpLine({ agent: "codex", origin: base, token: tokenB }), `${name}: and it is the MCP line for that token`);
  w = await view();
  assert.deepEqual([w.mcp.state, w.paste.label.startsWith("Copy connect message"), w.paste.state], ["busy", true, null], `${name}: the buttons follow the new way`);
  // A new pick while it waits gives that wait up too: nothing is left connected or locked.
  await page.evaluate(() => { __relay.revoked = false; });
  await press(chip("claude"));
  await page.waitForFunction(() => document.getElementById("mcpBtn").textContent === "Connect with MCP recommended");
  assert.equal(await page.evaluate(() => __relay.revoked), true, `${name}: a new pick while waiting revokes the token`);
  assert.deepEqual(await pressed(), ["Claude Code"], `${name}: and the pick is the new one`);
  assert.equal((await view()).mcp.state, null, `${name}: nothing is waiting any more`);
  for (const k of ["codex", "t3"]) assert.equal(await chip(k).getAttribute("aria-disabled"), null, `${name}: ${k} is open`);
  await page.mouse.move(1, 1);
  await reset();

  // Connect with MCP, Claude Code then Codex: the line is the agent's own, with this page's address and token.
  for (const agentKey of ["claude", "codex"]) {
    const agent = AGENT_WAYS[agentKey];
    await pick(agentKey);
    const first = await sockets();
    await press(page.locator("#mcpBtn"));
    await page.waitForFunction((n) => __relay.sockets.length > n, first);
    const label = `Waiting for ${agent.name}…`;
    await page.waitForFunction((l) => document.getElementById("mcpBtn").textContent === l, label);
    const token = await lastToken();
    await assertCopied(mcpLine({ agent: agentKey, origin: base, token }), `${name}: ${agent.name}: the copied line is its own, with this page's address and token`);
    const boxShown = await page.locator("#agentMessage").isVisible();
    if (clipboard) assert.equal(boxShown, false, `${name}: ${agent.name}: the line shows below only when the browser gave no clipboard`);
    let v = await view();
    assert.deepEqual(v.mcp, { label, state: "busy", tip: boxShown ? "Copy the line below, then run it in a terminal." : "Line copied. Run it in a terminal.", off: false, shown: true }, `${name}: ${agent.name}: waiting`);
    assert.equal(await page.locator("#mcpBtn .dot").evaluate((el) => el.className), "dot dot--think", `${name}: ${agent.name}: with the breathing dot`);
    // While the page only waits nothing is locked: the other way and the other agents stay open (a wait can be given up).
    assert.equal(v.paste.shown && v.paste.state === null, true, `${name}: ${agent.name}: the message way stays open while this one waits`);
    for (const other of Object.keys(AGENT_WAYS).filter((k) => k !== agentKey)) {
      assert.equal(await chip(other).getAttribute("aria-disabled"), null, `${name}: ${other} stays open while ${agent.name} waits`);
    }
    await shoot(`${agentKey}-mcp-waiting`);
    await page.evaluate(() => __relay.call("get_context"));
    await page.waitForFunction(() => document.getElementById("mcpBtn").dataset.state === "ok");
    v = await view();
    assert.deepEqual(v.mcp, { label: `${agent.name} connected`, state: "ok", tip: agent.mcp.onTip, off: false, shown: true }, `${name}: ${agent.name}: connected, and the tip says the entry stays until removed`);
    assert.ok(agent.mcp.onTip.includes(agent.mcp.remove), `${name}: with the command that removes it`);
    assert.equal(await page.locator("#testBtn").isVisible(), true, `${name}: ${agent.name}: Test appears`);
    assert.equal(v.paste.shown, false, `${name}: ${agent.name}: the other way steps aside while connected`);
    // Once connected the other agents are switched off: they show why and a press picks nothing.
    for (const other of Object.keys(AGENT_WAYS).filter((k) => k !== agentKey)) {
      assert.equal(await chip(other).getAttribute("aria-disabled"), "true", `${name}: ${other} is locked`);
      assert.equal(await chip(other).getAttribute("data-tip"), LOCK_TIP, `${name}: ${other} says why`);
    }
    if (agentKey === "claude") {
      const colours = await page.evaluate(() => { const c = document.querySelector('#agentSeg [data-v="t3"]'); return { chip: getComputedStyle(c).color, tag: getComputedStyle(c.querySelector(".tag")).color, fill: getComputedStyle(c.querySelector(".tag")).backgroundColor }; });
      assert.equal(colours.tag, colours.chip, `${name}: the locked T3 Code's label is switched off with it`);
      assert.equal(colours.fill, "rgba(0, 0, 0, 0)", `${name}: and has no fill`);
    }
    // Test works the same through MCP: a cue to the waiting agent, the answer in the next wait.
    await page.evaluate(() => { window.__wait = __relay.call("wait_for_cue", { seq: 0, holdMs: 25000 }); });
    await press(page.locator("#testBtn"));
    const cue = await page.evaluate(() => window.__wait);
    assert.equal(cue.result.cue, "suggest_now", `${name}: ${agent.name}: Test hands a cue to the waiting agent`);
    await page.evaluate((seq) => { __relay.call("wait_for_cue", { seq, holdMs: 25000, suggestions: [{ text: "What did the first month cost?", why: "follows the story" }] }); }, cue.result.seq);
    await page.waitForFunction(() => document.getElementById("testBtn").dataset.state === "ok");
    assert.match(await page.locator("#testBtn").innerText(), /^Test ✓ · \d+\.\d s$/, `${name}: ${agent.name}: Test shows its seconds`);
    assert.equal(await page.locator("#sAgent").evaluate((el) => el.hasAttribute("data-done")), true, `${name}: ${agent.name}: step 2 is done`);
    await shoot(`${agentKey}-mcp-connected`);
    // Locked: a press on another chip shows why and picks nothing; the keyboard reaches it too.
    const lockedChip = chip(agentKey === "claude" ? "codex" : "claude");
    await pressOff(lockedChip);
    await showsTip(LOCK_TIP);
    assert.deepEqual(await pressed(), [agent.name], `${name}: ${agent.name}: the pick does not move while connected`);
    await page.keyboard.press("Escape");
    // Disconnect: the token is revoked, both ways are back, and the agents are free again with their own notes.
    await page.evaluate(() => { __relay.revoked = false; });
    await press(page.locator("#mcpBtn"));
    await page.waitForFunction(() => document.getElementById("mcpBtn").textContent === "Connect with MCP recommended");
    assert.equal(await page.evaluate(() => __relay.revoked), true, `${name}: ${agent.name}: Disconnect revokes the token`);
    v = await view();
    assert.equal(v.paste.shown && v.mcp.shown, true, `${name}: ${agent.name}: both ways are back`);
    assert.equal(v.mcp.tip, agent.mcp.idleTip, `${name}: ${agent.name}: the tip is the idle one again`);
    for (const k of Object.keys(AGENT_WAYS).filter((x) => x !== agentKey)) {
      assert.equal(await chip(k).getAttribute("aria-disabled"), null, `${name}: ${k} is free again`);
      assert.equal(await chip(k).getAttribute("data-tip"), AGENT_WAYS[k].chipTip, `${name}: ${k} has its own note again`);
    }
    assert.equal(await page.locator("#testBtn").isVisible(), false, `${name}: Test is hidden again`);
    await reset();
  }

  // T3 Code, the paste way: its own message, waiting, connected, Disconnect.
  await pick("t3");
  const firstSocket = await sockets();
  await press(page.locator("#connectBtn"));
  await page.waitForFunction((n) => __relay.sockets.length > n, firstSocket);
  await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "Waiting for T3 Code…");
  await assertCopied(connectMessage({ origin: base, token: await lastToken(), agent: "t3" }), `${name}: T3 Code: the copied message is the T3 Code one`);
  const waitingView = await view();
  assert.deepEqual([waitingView.mcp.shown, waitingView.mcp.off], [true, true], `${name}: T3 Code: while it waits, its MCP button stays, switched off`);
  await page.evaluate(() => __relay.call("get_context"));
  await page.waitForFunction(() => document.getElementById("connectBtn").dataset.state === "ok");
  assert.equal((await view()).paste.label, "T3 Code connected", `${name}: T3 Code: connected`);
  assert.equal((await view()).mcp.shown, false, `${name}: T3 Code: once connected the MCP button steps aside`);
  await press(page.locator("#connectBtn"));
  await page.waitForFunction(() => document.getElementById("connectBtn").textContent.startsWith("Copy connect message"));

  // Back to the start, and nothing was stored.
  await pick("claude");
  assert.deepEqual(await view(), idle(AGENT_WAYS.claude, "Copies a message. Paste it into Claude Code.", true), `${name}: back to the start`);
  const kept = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }));
  assert.deepEqual(kept, { local: 0, session: 0, cookie: "" }, `${name}: nothing was stored`);
  await reset();
  return shots;
}

export async function run({ browser, playwright, base, out }) {
  const checks = [];
  const screenshots = [];
  const ok = (name) => checks.push(name);

  for (const view of VIEWS) {
    const { name, ...options } = view;
    const context = await browser.newContext(options);
    await ownAddress(context);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await context.newPage();
    await page.addInitScript(fakeRelay);
    await page.addInitScript(countDisplayCalls);
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
    // A computer's window shows the whole setup screen. A phone's may need a scroll once step 2 has its four agent choices
    // and two ways (card 09; card 07 adds step 3); it never scrolls sideways (checked above).
    if (!options.isMobile) assert.ok(box.scrollHeight <= box.height, `${name}: the setup screen does not scroll (${box.scrollHeight} > ${box.height})`);
    assert.ok(box.top.left === 0 && Math.round(box.top.width) === box.width, `${name}: the bar spans the window`);
    assert.ok(box.chip.right <= box.width && box.chip.left >= 0, `${name}: the Private chip is inside the window`);
    assert.ok(box.screen.top >= box.top.bottom - 0.5 && (options.isMobile ? Math.round(box.screen.bottom) >= box.height : Math.round(box.screen.bottom) === box.height), `${name}: the screen fills the rest`);
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

    await checkSetup(page, name, { phone: Boolean(options.isMobile), touch: Boolean(options.hasTouch), chip: options.isMobile ? /^Chrome 157 · phone$/ : /^Chrome \d+ · desktop$/, tabOff: Boolean(options.isMobile), service: !options.isMobile });
    ok(`${name}: the setup screen (browser chip, step 1, picking by mouse${options.hasTouch ? ", tap" : ""} and keyboard, ${options.isMobile ? "compact" : "wide"} layout, no extra words)`);

    screenshots.push(...await checkEngine(page, name, out, { touch: Boolean(options.hasTouch), available: !options.isMobile, reason: PHONE_SERVICE_REASON }));
    ok(options.isMobile
      ? `${name}: step 6 shows the browser service switched off on a phone, with its plain reason`
      : `${name}: step 6 offers the browser service as an opt-in with its warning on the choice, and switching back to the model works`);

    screenshots.push(...await checkTabSound(page, name, out, { touch: Boolean(options.hasTouch), reason: options.isMobile ? PHONE_REASON : null }));
    ok(`${name}: the tab-sound button (${options.isMobile ? "switched off with the phone reason" : "ready, with how to share and the headphones advice"}; the guest's answer switches it off and on; fits its row)`);

    screenshots.push(...await checkAgent(page, name, out, { base, touch: Boolean(options.hasTouch), clipboard: true }));
    screenshots.push(...await checkWays(page, name, out, { base, touch: Boolean(options.hasTouch), clipboard: true }));
    assert.deepEqual(requests, [`${base}/`, ...Array(7).fill(`${base}/api/agent-token`)], `${name}: besides the page, only this site's token was asked for (once per connection)`);
    assert.deepEqual(problems, [], `${name}: no console error, warning or policy violation while connecting`);
    ok(`${name}: step 2 (copy the connect message, waiting, connected, Test with its seconds, Disconnect), by ${options.hasTouch ? "tap" : "mouse"} and keyboard`);
    ok(`${name}: step 2 ways (each agent's note by ${options.hasTouch ? "tap" : "mouse"} and keyboard, the slower label on the message way and the recommended label on Connect with MCP for Claude Code and Codex, none for T3 Code, the agents locked while connected)`);

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

  // A 320px phone, connected through MCP with the other agents locked (each with its mark): nothing overflows and every
  // button is finger-sized. Then the agent goes quiet for a minute (a fast-forwarded clock): the page waits again, the
  // other agents are open again and both ways are shown.
  {
    const context = await browser.newContext({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID });
    await ownAddress(context);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
    const page = await context.newPage();
    await page.addInitScript(fakeRelay);
    await page.clock.install();
    await page.goto(`${base}/`);
    await page.locator("#mcpBtn").tap();
    await page.waitForFunction(() => __relay.sockets.length === 1);
    await page.evaluate(() => __relay.call("get_context"));
    await page.waitForFunction(() => document.getElementById("mcpBtn").dataset.state === "ok");
    const fit = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll("#sAgent button:not([hidden])")].map((b) => b.getBoundingClientRect().toJSON()), locked: document.querySelectorAll('#agentSeg [aria-disabled="true"] .off-mark').length }));
    assert.equal(fit.locked, 3, "320px: Codex and T3 Code carry the switched-off mark while locked, as the API key always does");
    assert.ok(fit.scrollWidth <= fit.width, `320px: no sideways scroll while connected (${fit.scrollWidth} > ${fit.width})`);
    for (const b of fit.boxes) { assert.ok(b.left >= 0 && b.right <= fit.width + 0.5, "320px: every control fits the window"); assert.ok(b.height >= 44, `320px: finger-sized (${b.height}px)`); }
    await page.clock.fastForward(61_000);
    await page.waitForFunction(() => document.getElementById("mcpBtn").textContent === "Waiting for Claude Code…");
    const quiet = await page.evaluate(() => ({ locked: document.querySelectorAll('#agentSeg [data-v="codex"][aria-disabled], #agentSeg [data-v="t3"][aria-disabled]').length, paste: !document.getElementById("connectBtn").hidden, test: !document.getElementById("testBtn").hidden }));
    assert.deepEqual(quiet, { locked: 0, paste: true, test: false }, "a quiet agent: the page waits again, the other agents are open, both ways shown, no Test");
    await page.evaluate(() => __relay.call("get_context"));
    await page.waitForFunction(() => document.getElementById("mcpBtn").dataset.state === "ok");
    assert.equal(await page.locator('#agentSeg [data-v="codex"]').getAttribute("aria-disabled"), "true", "and when the agent calls again the other agents are locked again");
    await context.close();
  }
  ok("a 320px phone connected through MCP fits and is finger-sized; a quiet agent frees the page to wait again");

  // Step 2 when things go wrong, in Chromium: no token (the Worker says too many tries), no clipboard (the message
  // shows, selected, to copy by hand), and the real relay socket under the page's policy.
  {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ownAddress(context);
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
    // The same through Connect with MCP: its button says so, the message button is back to normal; the label stays on
    // the MCP button when another agent with that way is picked.
    await page.locator("#mcpBtn").click();
    await page.waitForFunction(() => document.getElementById("mcpBtn").textContent === "No connection · try again");
    assert.equal((await page.locator("#connectBtn").innerText()).replace(/\s+/g, " "), "Copy connect message slower", "no token: the message button is not marked");
    await page.locator('#agentSeg [data-v="codex"]').click();
    assert.equal(await page.locator("#mcpBtn").innerText(), "No connection · try again", "no token: still said on the MCP button for Codex");
    await page.locator('#agentSeg [data-v="claude"]').click();
    assert.equal(await page.evaluate(() => __relay.sockets.length), 0, "no token: no relay socket through MCP either");
    await page.unroute("**/api/agent-token");
    await connect.click();
    await page.waitForFunction(() => document.getElementById("connectBtn").textContent === "Waiting for Claude Code…");
    await page.locator("#agentMessage").waitFor({ state: "visible" });
    const box = await page.evaluate(() => {
      const b = document.getElementById("agentMessage");
      return { focused: document.activeElement === b, start: b.selectionStart, end: b.selectionEnd, length: b.value.length, value: b.value, tip: document.getElementById("connectBtn").dataset.tip, protocols: __relay.sockets[0].protocols };
    });
    assert.ok(box.focused && box.start === 0 && box.end === box.length, "no clipboard: the message shows, focused and selected");
    assert.ok(box.value.includes(`T='${box.protocols[1].slice(2)}'; U='${base}/mcp'`) && box.value.includes("while o=$(curl"), "it holds this page's token, address and loop");
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
    await ownAddress(real);
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
      await ownAddress(context);
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
      await page.addInitScript(countDisplayCalls);
      await page.reload();
      await checkSetup(page, name, { phone: false, touch: false, chip: /^Firefox \d+ · desktop$/, tabOff: true, service: false });
      await checkEngine(page, name, out, { touch: false, available: false });
      screenshots.push(...await checkTabSound(page, name, out, { touch: false, reason: OFF_REASON }));
      screenshots.push(...await checkAgent(page, name, out, { base, touch: false, clipboard: false }));
      screenshots.push(...await checkWays(page, name, out, { base, touch: false, clipboard: false }));
      screenshots.push(...await checkSwitchedOff(page, name, out, { touch: false }));
      ok(`${name}: loads alone, names Firefox, the setup screen works, the browser service is switched off with its reason, and a switched-off choice shows its reason, with the tab-sound button off for Firefox`);
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
