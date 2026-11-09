// The page script. build.mjs inlines src/browser.mjs, src/listen.mjs, src/ui/tooltip.mjs, src/agent-message.mjs and
// src/agent-link.mjs above this file.
const tooltip = installTooltip();
const $ = (id) => document.getElementById(id);

/** This browser and what it can do. A control the browser cannot run is switched off with its reason. */
const browser = detectBrowser(window);
$("browserChip").textContent = browser.label;

/** Switch a control off (with the reason in its tooltip) or back on. */
function switchOff(el, reason) {
  if (reason) {
    el.setAttribute("aria-disabled", "true");
    el.dataset.tip = reason;
  } else {
    el.removeAttribute("aria-disabled");
  }
}
const done = (step, yes) => $(step).toggleAttribute("data-done", yes);

/** A row of choices: one is pressed at a time; a switched-off choice is never picked (the tooltip shows why). */
function choices(group, onPick = () => {}) {
  group.addEventListener("click", (e) => {
    const picked = e.target.closest("button");
    if (!picked || picked.getAttribute("aria-disabled") === "true") return;
    for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === picked));
    onPick(picked.dataset.v);
  });
}

const state = { guest: null, mic: false, speech: false, listening: false };

// Step 1 is done from the start: one choice is always picked.
choices(document.getElementById("streamSeg"));

// Step 2, the AI agent. Copy connect message copies the message with this tab's token; the button then reads
// Waiting for the agent, then connected (a press disconnects). Test times one sample answer. The page talks only to
// its own site: the token from /api/agent-token and the relay at /api/relay.
choices(document.getElementById("agentSeg"));
const agentName = () => document.querySelector('#agentSeg [aria-pressed="true"]').textContent.trim();
const connectBtn = document.getElementById("connectBtn");
const testBtn = document.getElementById("testBtn");
const messageBox = document.getElementById("agentMessage");
const dot = (kind) => Object.assign(document.createElement("span"), { className: `dot dot--${kind}` });
let copyFailed = false;

// A button's state and words. An open tooltip on it follows: the new tip, or none.
function label(button, state, tip, ...content) {
  if (state) button.dataset.state = state; else button.removeAttribute("data-state");
  const open = button.getAttribute("aria-describedby") === "tip";
  if (tip) button.dataset.tip = tip; else button.removeAttribute("data-tip");
  button.replaceChildren(...content);
  if (open) { if (tip) tooltip.show(button); else tooltip.hide(); }
}

function renderAgent({ state, failed, test, passed }) {
  const name = agentName();
  if (state !== "waiting") { copyFailed = false; messageBox.hidden = true; }
  if (state === "on") label(connectBtn, "ok", "Click to disconnect.", dot("ok"), `${name} connected`);
  else if (state === "waiting") label(connectBtn, "busy", copyFailed ? `Copy the message below, then paste it into ${name}.` : `Message copied. Paste it into ${name}.`, dot("think"), `Waiting for ${name}…`);
  else if (state === "elsewhere") label(connectBtn, null, `${name} is connected in another tab. Click to use this tab.`, "Use this tab");
  else label(connectBtn, null, `Copies a message. Paste it into ${name}.`, failed ? "No connection · try again" : "Copy connect message");

  testBtn.hidden = state !== "on";
  if (test.state === "busy") label(testBtn, "busy", null, dot("think"), "Testing…");
  else if (test.state === "ok") label(testBtn, "ok", `Sample: "${test.sample}"`, `Test ✓ · ${test.seconds.toFixed(1)} s`);
  else if (test.state === "fail") label(testBtn, null, `No answer in ${AGENT_TEST_MS / 1000} seconds. Check ${name}, then test again.`, "Test · no answer");
  else label(testBtn, null, null, "Test");
  document.getElementById("sAgent").toggleAttribute("data-done", state === "on" && passed);
}

const agent = createAgentLink({
  net: {
    token: () => fetch("/api/agent-token", { method: "POST", cache: "no-store" }),
    socket: (protocols) => new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/relay`, protocols),
  },
  onChange: renderAgent,
});

// The clipboard write starts inside the click (Safari asks for that); the message follows once the token is in.
// Without a clipboard the message shows, selected, to copy by hand.
async function copyMessage() {
  const text = agent.connect().then((r) => (r ? connectMessage({ origin: location.origin, token: r.token }) : null));
  try {
    if (typeof ClipboardItem === "function" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((t) => { if (!t) throw new Error("no message"); return new Blob([t], { type: "text/plain" }); }) })]);
    } else {
      const t = await text;
      if (!t) return;
      await navigator.clipboard.writeText(t);
    }
  } catch {
    const t = await text;
    if (!t) return;
    copyFailed = true;
    messageBox.value = t;
    messageBox.hidden = false;
    renderAgent(agent.view());
    messageBox.focus();
    messageBox.select();
  }
}

connectBtn.addEventListener("click", () => {
  const { state } = agent.view();
  if (state === "on") agent.disconnect();
  else if (state === "elsewhere") agent.useHere();
  else copyMessage();
});
testBtn.addEventListener("click", () => agent.test());
// Leaving or reloading the page ends the connection: the page keeps no token, so the old one is revoked rather than
// left working for whoever holds the message.
addEventListener("pagehide", () => agent.disconnect());

// Step 2: the host's own answer for the guest. Nothing else sets it.
choices($("guestSeg"), (answer) => {
  state.guest = answer;
  done("sGuest", true);
  refresh();
});

// ---- Sound: the microphone, a live level meter, and the sound handed to the speech worker while listening ----
// The page never plays a sound: the microphone's sound runs into a silent end (a stream destination, not the
// speakers) only so the browser keeps handing it over. It never leaves the computer.
let mic = null;
const meter = $("micMeter");
const meterBar = meter.firstElementChild;

async function micOn() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  let context;
  let tap;
  try {
    context = new AudioContext();
    // A browser may start the sound paused; asking it to resume (not waiting on it) keeps the meter and the speech fed.
    // Not awaited, and a refusal is left alone on purpose: the sound then stays paused, which the still meter shows.
    context.resume().catch(() => {});
    const source = context.createMediaStreamSource(stream);
    tap = context.createScriptProcessor(4096, 1, 1);
    source.connect(tap);
    tap.connect(context.createMediaStreamDestination());
  } catch (error) {
    // The microphone was granted but the sound could not be set up: let it go, so the browser's microphone light goes out.
    for (const track of stream.getTracks()) track.stop();
    context?.close();
    throw error;
  }
  tap.onaudioprocess = (e) => {
    const samples = e.inputBuffer.getChannelData(0);
    const fill = meterFill(loudness(samples));
    meterBar.style.transform = `scaleX(${fill.toFixed(3)})`;
    meter.setAttribute("aria-valuenow", String(Math.round(fill * 100)));
    if (state.listening && speech) {
      const copy = samples.slice();
      speech.postMessage({ type: "audio", samples: copy, rate: context.sampleRate }, [copy.buffer]);
    }
  };
  // The microphone can also end on its own (unplugged, or the permission taken back): the page shows it at once.
  for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => micOff());
  mic = { stream, context };
}

function micOff() {
  if (!mic) return;
  for (const track of mic.stream.getTracks()) track.stop();
  mic.context.close();
  mic = null;
  speech?.postMessage({ type: "stop" });
  state.mic = false;
  state.listening = false;
  showMic();
  showSign();
  refresh();
}

const micBtn = $("micBtn");
const micTxt = $("micTxt");

/** What a failed microphone says on the control that asked for it, with the way out in its tooltip. */
function micProblem(error) {
  return error === "NotFoundError"
    ? { text: "No microphone found", tip: "This computer has no microphone the browser can use. Plug one in, then press again." }
    : { text: "Microphone blocked", tip: "The browser blocked the microphone. Allow it for this site (the icon beside the address), then press again." };
}

function showMic(error = "") {
  meter.hidden = !state.mic;
  if (!state.mic) meterBar.style.transform = "scaleX(0)";
  if (state.mic) {
    micBtn.dataset.state = "ok";
    micTxt.textContent = "Microphone";
    micBtn.dataset.tip = "Your microphone is on. Press to turn it off.";
  } else if (error) {
    const problem = micProblem(error);
    micBtn.dataset.state = "error";
    micTxt.textContent = problem.text;
    micBtn.dataset.tip = problem.tip;
  } else {
    micBtn.removeAttribute("data-state");
    micTxt.textContent = "Microphone";
    micBtn.removeAttribute("data-tip");
  }
  done("sSound", state.mic);
}

switchOff(micBtn, browser.features.microphone.on ? "" : browser.features.microphone.reason);
micBtn.addEventListener("click", async () => {
  if (micBtn.getAttribute("aria-disabled") === "true" || micBtn.dataset.state === "busy") return;
  if (state.mic) { micOff(); return; }
  micBtn.dataset.state = "busy";
  try {
    await micOn();
    state.mic = true;
    showMic();
  } catch (error) {
    state.mic = false;
    showMic(error?.name || "error");
  }
  refresh();
});

// ---- Speech to text: the model runs in a worker of this site and is downloaded once ----
let speech = null;
const speechBtn = $("speechBtn");
const speechTxt = $("speechTxt");
const speechIdle = speechTxt.textContent;
const SPEECH_TIP = speechBtn.dataset.tip;

/** What was heard, in this page's memory only and gone when the tab closes: the final lines and the newest draft. */
const heard = { lines: [], draft: null, lastPause: null };

function onSpeech({ data }) {
  if (data.type === "progress") {
    speechTxt.textContent = `Loading ${Math.floor((data.loaded / data.total) * 100)}%`;
  } else if (data.type === "ready") {
    state.speech = true;
    speechBtn.dataset.state = "ok";
    speechTxt.textContent = "Speech ready";
    speechBtn.dataset.tip = `Kept in this browser (${speechIdle.split("· ")[1]}): next time the model loads without downloading.`;
    done("sSpeech", true);
    refresh();
  } else if (data.type === "error") {
    // The model failed to load, or failed on the producer screen: the microphone stops and the setup comes back, so
    // the sign never shows listening in vain and the failed button (with its reason) offers to load it again.
    if (!$("live").hidden) {
      micOff();
      showScreen(false);
    }
    speech?.terminate();
    speech = null;
    state.speech = false;
    speechBtn.dataset.state = "error";
    speechTxt.textContent = "Speech model failed · try again";
    speechBtn.dataset.tip = `${data.reason[0].toUpperCase()}${data.reason.slice(1)}.`;
    done("sSpeech", false);
    refresh();
  } else if (data.type === "text") {
    if (data.final) {
      heard.lines.push({ source: "mic", text: data.text, start: data.start, end: data.end });
      if (heard.draft?.piece === data.piece) heard.draft = null;
    } else {
      heard.draft = { piece: data.piece, text: data.text };
    }
  } else if (data.type === "pause") {
    heard.lastPause = data.at;
  }
}

switchOff(speechBtn, browser.features.wasm.on ? "" : browser.features.wasm.reason);
speechBtn.addEventListener("click", () => {
  if (speechBtn.getAttribute("aria-disabled") === "true" || speech) return;
  speech = new Worker("/speech/worker.mjs", { type: "module", name: "speech" });
  speech.addEventListener("message", onSpeech);
  speech.addEventListener("error", () => onSpeech({ data: { type: "error", reason: "the speech worker could not start" } }));
  speechBtn.dataset.state = "busy";
  speechBtn.dataset.tip = SPEECH_TIP;
  speechTxt.textContent = "Loading 0%";
  speech.postMessage({ type: "load" });
});

// ---- Open producer screen: needs the guest's answer, the microphone and the speech model ----
const goBtn = $("goBtn");
function refresh() {
  switchOff(goBtn, openBlocked(state));
}
refresh();

/** The setup or the producer screen (with the listening sign in the top bar). */
function showScreen(live) {
  tooltip.hide();
  $("setup").hidden = live;
  $("live").hidden = !live;
  $("topLive").hidden = !live;
}

goBtn.addEventListener("click", () => {
  if (goBtn.getAttribute("aria-disabled") === "true") return;
  showScreen(true);
  startListening();
});

// ---- The listening sign: shows while the page listens; Stop ends the microphone at once; Listen starts it again ----
const stopBtn = $("stopBtn");
function showSign() {
  const sign = listeningSign(state);
  $("listen").dataset.on = String(sign.on);
  $("listenDot").className = sign.on ? "dot dot--live" : "dot";
  $("listenOn").hidden = !sign.on;
  $("listenOff").hidden = sign.on;
  $("listenSrc").textContent = sign.source;
  $("listenTxt").dataset.tip = sign.tip;
  const chip = $("guestChip");
  chip.hidden = !sign.chip;
  if (sign.chip) {
    chip.textContent = sign.chip.text;
    chip.className = sign.chip.ok ? "chip chip--ok" : "chip";
    chip.dataset.tip = sign.chip.tip;
  }
  stopBtn.textContent = sign.button;
  stopBtn.className = sign.on ? "tb" : "tb tb--primary";
  stopBtn.removeAttribute("data-state");
}

/** Listening needs the microphone and the speech model both; without either the sign stays "Not listening". */
function startListening() {
  state.listening = Boolean(mic && speech && state.speech);
  showSign();
}

stopBtn.addEventListener("click", async () => {
  if (stopBtn.dataset.state === "busy") return;
  if (state.listening) { micOff(); return; }
  stopBtn.dataset.state = "busy";
  stopBtn.removeAttribute("data-tip");
  try {
    await micOn();
    state.mic = true;
    showMic();
    startListening();
  } catch (error) {
    // The failure shows on Listen itself, as on the setup's microphone button; pressing it again tries again.
    showMic(error?.name || "error");
    showSign();
    const problem = micProblem(error?.name);
    stopBtn.className = "tb";
    stopBtn.dataset.state = "error";
    stopBtn.textContent = `${problem.text} · Listen`;
    stopBtn.dataset.tip = problem.tip;
  }
});
