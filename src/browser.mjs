// Which browser opened the page and what it can do. The setup screen names it in its chip; later steps read
// `features` to switch a control off and show its reason. Tab sound cannot be tested without asking the person to
// share, so it follows the TOOLS-149 table: only Chrome-family browsers on a computer hand a tab's sound to a page.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** Tooltip reasons for a feature that is off (the tab-sound ones are the TOOLS-149 wording). */
export const REASONS = {
  secure: "This page is not on a secure (https) address, so the browser keeps the microphone and tab sharing off.",
  microphone: "This browser does not let web pages use a microphone.",
  tabFirefox: "Firefox does not let web pages receive the sound of a shared tab, so the guest cannot be heard here. Use Chrome or Edge.",
  tabSafari: "Safari does not give web pages any sound from a shared tab or screen, so the guest cannot be heard here. Use Chrome or Edge.",
  tabPhone: "Phone and tablet browsers generally cannot share a tab with sound. Use Chrome or Edge on a computer.",
  tabOther: "This browser cannot share a tab with sound. Use Chrome or Edge on a computer.",
  wasm: "This browser cannot run the speech model (WebAssembly is off). Use a current Chrome, Edge, Firefox or Safari.",
  webSpeech: "This browser has no speech service of its own.",
};

// Most specific first: Edge, Opera and Samsung Internet also say "Chrome"; every browser says "Safari".
const NAMES = [
  ["Edge", /\bEdg(?:e|A|iOS)?\/(\d+)/],
  ["Opera", /\bOPR\/(\d+)/],
  ["Samsung Internet", /\bSamsungBrowser\/(\d+)/],
  ["Firefox", /\b(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /\bVersion\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//],
];

const on = (extra) => ({ on: true, ...extra });
const off = (reason) => ({ on: false, reason });

/** @param {object} win the page's window (or any object shaped like it) */
export function detectBrowser(win) {
  const nav = win.navigator || {};
  const ua = String(nav.userAgent || "");
  const [name, version] = (() => {
    for (const [label, pattern] of NAMES) {
      const m = ua.match(pattern);
      if (m) return [label, Number(m[1])];
    }
    return ["Browser", 0];
  })();

  const ios = /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && nav.maxTouchPoints > 1);
  const device = /\b(iPhone|iPod)\b/.test(ua) || (/\bAndroid\b/.test(ua) && /\bMobile\b/.test(ua)) || nav.userAgentData?.mobile === true || (!ios && /\bMobi/.test(ua))
    ? "phone"
    : ios || /\bAndroid\b/.test(ua) ? "tablet" : "desktop";
  // Every browser on an iPhone or iPad is Safari underneath.
  const engine = ios || name === "Safari" ? "webkit" : name === "Firefox" ? "gecko" : name === "Browser" ? "unknown" : "blink";

  const secure = win.isSecureContext === true;
  const media = secure ? nav.mediaDevices : undefined;
  const can = (f) => typeof f === "function";

  const microphone = !secure ? off(REASONS.secure) : can(media?.getUserMedia) ? on() : off(REASONS.microphone);
  const tabSound = device !== "desktop" ? off(REASONS.tabPhone)
    : engine === "gecko" ? off(REASONS.tabFirefox)
    : engine === "webkit" ? off(REASONS.tabSafari)
    : !secure ? off(REASONS.secure)
    : engine === "blink" && can(media?.getDisplayMedia) ? on({ tip: "Tab sound only arrives if you share a browser tab and tick 'Also share tab audio'." })
    : off(REASONS.tabOther);

  return {
    name,
    version,
    device,
    engine,
    label: `${name}${version ? ` ${version}` : ""} · ${device}`,
    features: {
      secure: secure ? on() : off(REASONS.secure),
      microphone,
      tabSound,
      wasm: can(win.WebAssembly?.instantiate) ? on() : off(REASONS.wasm),
      webSpeech: can(win.SpeechRecognition) || can(win.webkitSpeechRecognition) ? on() : off(REASONS.webSpeech),
    },
  };
}
