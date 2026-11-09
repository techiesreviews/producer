// Browser detection (src/browser.mjs): one case per browser the setup screen must name, with what it can do
// and the reason a later step shows on a switched-off control (wording from the TOOLS-149 table).
import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBrowser, REASONS } from "../src/browser.mjs";

const fn = () => {};
// A window as the browser hands it to the page: only the parts detectBrowser reads.
const env = ({ ua, secure = true, touch = 0, display = true, mic = true, wasm = true, speech = "webkit", mobile }) => ({
  isSecureContext: secure,
  navigator: {
    userAgent: ua,
    maxTouchPoints: touch,
    ...(mobile === undefined ? {} : { userAgentData: { mobile, brands: [] } }),
    ...(secure ? { mediaDevices: { ...(mic ? { getUserMedia: fn } : {}), ...(display ? { getDisplayMedia: fn } : {}) } } : {}),
  },
  ...(wasm ? { WebAssembly: { instantiate: fn } } : {}),
  ...(speech === "webkit" ? { webkitSpeechRecognition: fn } : speech === "plain" ? { SpeechRecognition: fn } : {}),
});

const UA = {
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.3200.12",
  firefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0",
  safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  androidPhone: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.7000.10 Mobile/15E148 Safari/604.1",
  headless: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36",
};

const onOff = (b) => Object.fromEntries(Object.entries(b.features).map(([k, f]) => [k, f.on]));
// Every feature that is off carries a reason for its tooltip; one that is on carries none.
const reasonsAreSet = (b) => {
  for (const [name, f] of Object.entries(b.features)) {
    if (f.on) assert.equal(f.reason, undefined, `${b.label}: ${name} is on and has no reason`);
    else assert.ok(typeof f.reason === "string" && f.reason.length > 10, `${b.label}: ${name} is off and says why`);
  }
};

test("Chrome on a computer: everything on, with the tab-sharing tip", () => {
  const b = detectBrowser(env({ ua: UA.chrome }));
  assert.equal(b.label, "Chrome 157 · desktop");
  assert.deepEqual(onOff(b), { secure: true, microphone: true, tabSound: true, wasm: true, webSpeech: true });
  assert.equal(b.features.tabSound.tip, "Tab sound only arrives if you share a browser tab and tick 'Also share tab audio'.");
  reasonsAreSet(b);
});

test("Edge on a computer: named Edge, not Chrome; the same features", () => {
  const b = detectBrowser(env({ ua: UA.edge }));
  assert.equal(b.label, "Edge 157 · desktop");
  assert.deepEqual(onOff(b), { secure: true, microphone: true, tabSound: true, wasm: true, webSpeech: true });
});

test("Firefox: no tab sound and no speech service of its own; the microphone and the model still work", () => {
  const b = detectBrowser(env({ ua: UA.firefox, speech: "none" }));
  assert.equal(b.label, "Firefox 140 · desktop");
  assert.deepEqual(onOff(b), { secure: true, microphone: true, tabSound: false, wasm: true, webSpeech: false });
  assert.equal(b.features.tabSound.reason, "Firefox does not let web pages receive the sound of a shared tab, so the guest cannot be heard here. Use Chrome or Edge.");
  assert.equal(b.features.webSpeech.reason, REASONS.webSpeech);
  reasonsAreSet(b);
});

test("Firefox keeps tab sound off even when it gains a speech service of its own", () => {
  const b = detectBrowser(env({ ua: UA.firefox, speech: "plain" }));
  assert.equal(b.features.tabSound.on, false);
  assert.equal(b.features.webSpeech.on, true);
});

test("Safari on a Mac: no tab sound, with Safari's own reason", () => {
  const b = detectBrowser(env({ ua: UA.safari }));
  assert.equal(b.label, "Safari 26 · desktop");
  assert.deepEqual(onOff(b), { secure: true, microphone: true, tabSound: false, wasm: true, webSpeech: true });
  assert.equal(b.features.tabSound.reason, "Safari does not give web pages any sound from a shared tab or screen, so the guest cannot be heard here. Use Chrome or Edge.");
  reasonsAreSet(b);
});

test("phones and tablets: no tab sound, with the phone reason", () => {
  const phone = "Phone and tablet browsers generally cannot share a tab with sound. Use Chrome or Edge on a computer.";
  const cases = [
    [env({ ua: UA.androidPhone, display: false, mobile: true }), "Chrome 157 · phone"],
    [env({ ua: UA.androidTablet, display: false, mobile: false }), "Chrome 157 · tablet"],
    [env({ ua: UA.iphone }), "Safari 18 · phone"],
    [env({ ua: UA.iphoneChrome }), "Chrome 157 · phone"],
    // iPadOS asks for the desktop site: a Mac that has a touch screen is an iPad.
    [env({ ua: UA.safari, touch: 5 }), "Safari 26 · tablet"],
  ];
  for (const [e, label] of cases) {
    const b = detectBrowser(e);
    assert.equal(b.label, label);
    assert.equal(b.features.tabSound.on, false, `${label}: no tab sound`);
    assert.equal(b.features.tabSound.reason, phone, `${label}: the phone reason`);
    assert.equal(b.features.microphone.on, true, `${label}: the microphone works`);
    reasonsAreSet(b);
  }
});

test("Chrome on an address that is not secure: microphone and tab sound off, saying why", () => {
  const b = detectBrowser(env({ ua: UA.chrome, secure: false }));
  assert.deepEqual(onOff(b), { secure: false, microphone: false, tabSound: false, wasm: true, webSpeech: true });
  for (const name of ["secure", "microphone", "tabSound"]) assert.equal(b.features[name].reason, REASONS.secure, name);
  reasonsAreSet(b);
});

test("a browser that cannot run WebAssembly (Lockdown Mode, a locked-down office) cannot run the speech model", () => {
  const b = detectBrowser(env({ ua: UA.iphone, wasm: false }));
  assert.equal(b.features.wasm.on, false);
  assert.equal(b.features.wasm.reason, REASONS.wasm);
});

test("a Chrome with no microphone access on a secure page says the browser keeps it off", () => {
  const b = detectBrowser(env({ ua: UA.chrome, mic: false }));
  assert.equal(b.features.microphone.on, false);
  assert.equal(b.features.microphone.reason, REASONS.microphone);
});

test("a Chrome without screen sharing (an old or trimmed build) has no tab sound", () => {
  const b = detectBrowser(env({ ua: UA.chrome, display: false }));
  assert.equal(b.features.tabSound.on, false);
  assert.equal(b.features.tabSound.reason, REASONS.tabOther);
});

test("the headless Chrome of the browser checks counts as Chrome", () => {
  assert.equal(detectBrowser(env({ ua: UA.headless })).label, "Chrome 153 · desktop");
});

test("an unknown browser gets a plain name and no version; nothing breaks on a missing navigator", () => {
  const b = detectBrowser(env({ ua: "SomethingNew/1.0" }));
  assert.equal(b.label, "Browser · desktop");
  const bare = detectBrowser({});
  assert.equal(bare.label, "Browser · desktop");
  assert.deepEqual(onOff(bare), { secure: false, microphone: false, tabSound: false, wasm: false, webSpeech: false });
  reasonsAreSet(bare);
});

test("every reason is one or two plain sentences that fit a tooltip", () => {
  for (const [name, text] of Object.entries(REASONS)) {
    assert.match(text, /^[A-Z].*\.$/, `${name} is a sentence`);
    assert.ok(text.length <= 140, `${name} fits a tooltip (${text.length} characters)`);
  }
});
