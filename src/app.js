// The page script. build.mjs inlines src/browser.mjs, src/listen.mjs, src/runorder.mjs, src/ui/tooltip.mjs,
// src/agent-ways.mjs, src/agent-message.mjs and src/agent-link.mjs above this file.
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

// Step 2, the AI agent. Each agent has up to two ways (src/agent-ways.mjs): Copy connect message (paste a message into
// the agent) and Connect with MCP (run one line in a terminal). Either copies its text with this tab's token; the
// button then reads Waiting for the agent, then connected (a press disconnects), and the way not used steps aside.
// While an agent is connected the other agents are switched off; while the page only waits, a new pick or the other
// way gives the wait up and revokes its token. Test times one sample answer. The page talks
// only to its own site: the token from /api/agent-token and the relay at /api/relay.
const agentSeg = document.getElementById("agentSeg");
choices(agentSeg);
const agentKey = () => agentSeg.querySelector('[data-v][aria-pressed="true"]').dataset.v;
const connectBtn = document.getElementById("connectBtn");
const mcpBtn = document.getElementById("mcpBtn");
const testBtn = document.getElementById("testBtn");
const messageBox = document.getElementById("agentMessage");
const dot = (kind) => Object.assign(document.createElement("span"), { className: `dot dot--${kind}` });
const tag = (text) => Object.assign(document.createElement("span"), { className: "tag", textContent: text });
const offMark = () => {
  const mark = Object.assign(document.createElement("span"), { className: "off-mark", textContent: "i" });
  mark.setAttribute("aria-hidden", "true");
  return mark;
};
let copyFailed = false;
let way = null; // "paste" or "mcp": the way the connection under way was started with

// Each agent's note and label on its chip.
for (const [v, w] of Object.entries(AGENT_WAYS)) {
  const chip = agentSeg.querySelector(`[data-v="${v}"]`);
  if (w.chipTip) chip.dataset.tip = w.chipTip;
  if (w.tag) chip.append(" ", tag(w.tag));
}

// A button's state and words. An open tooltip on it follows: the new tip, or none.
function label(button, state, tip, ...content) {
  if (state) button.dataset.state = state; else button.removeAttribute("data-state");
  const open = button.getAttribute("aria-describedby") === "tip";
  if (tip) button.dataset.tip = tip; else button.removeAttribute("data-tip");
  button.replaceChildren(...content);
  if (open) { if (tip) tooltip.show(button); else tooltip.hide(); }
}

function renderAgent({ state, failed, test, passed }) {
  const key = agentKey();
  const { name, pasteNote, pasteSlow, mcp } = AGENT_WAYS[key];
  if (state === "off" && !failed) way = null;
  if (state !== "waiting") { copyFailed = false; messageBox.hidden = true; }
  // Waiting can be left (pick another agent, press the other way: the unused token is revoked); a connected agent has
  // to be disconnected first, so only then are the other agents switched off and the other way put aside.
  const connected = state === "on" || state === "elsewhere";
  const active = way ?? "paste";

  for (const [v, w] of Object.entries(AGENT_WAYS)) {
    const chip = agentSeg.querySelector(`[data-v="${v}"]`);
    const locked = connected && v !== key;
    if (locked) chip.setAttribute("aria-disabled", "true"); else chip.removeAttribute("aria-disabled");
    const mark = chip.querySelector(".off-mark");
    if (mark && !locked) { if (mark.nextSibling?.nodeValue === " ") mark.nextSibling.remove(); mark.remove(); }
    if (locked && !mark) chip.prepend(offMark(), " ");
    const tip = locked ? LOCK_TIP : w.chipTip;
    if (tip) chip.dataset.tip = tip; else chip.removeAttribute("data-tip");
  }
  messageBox.setAttribute("aria-label", active === "mcp" ? "Connect line" : "Connect message");

  const failure = (kind) => (failed && way === kind ? "No connection · try again" : null);
  for (const [kind, button] of [["paste", connectBtn], ["mcp", mcpBtn]]) {
    const mine = state !== "off" && kind === active; // this way carries the connection
    button.hidden = connected && !mine;
    button.removeAttribute("aria-disabled");
    if (mine && state === "on") label(button, "ok", kind === "mcp" ? mcp.onTip : "Click to disconnect.", dot("ok"), `${name} connected`);
    else if (mine && state === "waiting") {
      const tip = kind === "mcp"
        ? (copyFailed ? "Copy the line below, then run it in a terminal." : "Line copied. Run it in a terminal.")
        : (copyFailed ? `Copy the message below, then paste it into ${name}.` : `Message copied. Paste it into ${name}.`);
      label(button, "busy", tip, dot("think"), `Waiting for ${name}…`);
    } else if (mine) label(button, null, `${name} is connected in another tab. Click to use this tab.`, "Use this tab");
    else if (kind === "paste") label(button, null, `Copies a message. Paste it into ${name}.${pasteNote ? ` ${pasteNote}.` : ""}`, failure("paste") ?? "Copy connect message", ...(!failure("paste") && pasteSlow && mcp ? [" ", tag("slower")] : []));
    else if (mcp) label(button, null, mcp.idleTip, failure("mcp") ?? "Connect with MCP");
    else {
      label(button, null, NO_MCP_TIP, offMark(), " Connect with MCP");
      button.setAttribute("aria-disabled", "true");
    }
  }

  testBtn.hidden = state !== "on";
  if (test.state === "busy") label(testBtn, "busy", null, dot("think"), "Testing…");
  else if (test.state === "ok") label(testBtn, "ok", `Sample: "${test.sample}"`, `Test ✓ · ${test.seconds.toFixed(1)} s`);
  else if (test.state === "fail") label(testBtn, null, `No answer in ${AGENT_TEST_MS / 1000} seconds. Check ${name}, then test again.`, "Test · no answer");
  else label(testBtn, null, TEST_TIP, "Test");
  document.getElementById("sAgent").toggleAttribute("data-done", state === "on" && passed);
}

const agent = createAgentLink({
  net: {
    token: () => fetch("/api/agent-token", { method: "POST", cache: "no-store" }),
    socket: (protocols) => new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/relay`, protocols),
  },
  onChange: renderAgent,
});
// A new pick changes the names and tips on the buttons; a pick while the page waits for the old agent gives that wait up.
let picked = agentKey();
agentSeg.addEventListener("click", () => {
  if (agentKey() !== picked) {
    picked = agentKey();
    if (agent.view().state === "waiting") { agent.disconnect(); return; }
  }
  renderAgent(agent.view());
});
renderAgent(agent.view());

// The clipboard write starts inside the click (Safari asks for that); the text follows once the token is in. Without a
// clipboard the text shows, selected, to copy by hand.
async function copyWay(kind) {
  way = kind;
  const key = agentKey();
  const make = (token) => (kind === "mcp" ? mcpLine({ agent: key, origin: location.origin, token }) : connectMessage({ origin: location.origin, token, agent: key }));
  const text = agent.connect().then((r) => (r ? make(r.token) : null));
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

for (const [button, kind] of [[connectBtn, "paste"], [mcpBtn, "mcp"]]) {
  button.addEventListener("click", () => {
    const { state } = agent.view();
    if (state === "on") agent.disconnect();
    else if (state === "elsewhere") agent.useHere();
    else {
      if (state === "waiting" && way !== kind) agent.disconnect(); // the other way: the unused token is revoked first
      copyWay(kind);
    }
  });
}
testBtn.addEventListener("click", () => agent.test());
// Leaving or reloading the page ends the connection: the page keeps no token, so the old one is revoked rather than
// left working for whoever holds the message.
addEventListener("pagehide", () => agent.disconnect());

// Step 4: the host's own answer for the guest. Nothing else sets it.
choices($("guestSeg"), (answer) => {
  state.guest = answer;
  done("sGuest", true);
  refresh();
});

// ---- Step 3, the show plan pasted by hand (format: src/runorder.mjs). It lives in this page's memory only: never
// stored, never sent. Each change is read at once; the button says what was read, or which line is unclear. ----
const planBtn = $("planBtn");
const planBox = $("planBox");
const planIn = $("planIn");
/** The plan as last read clearly (null before), and its run order with the show clock. */
const show = { plan: null, run: null, parts: "" };
// The example's lines, a space apart in the text (a screen reader and a copy keep them apart; the layout ignores it).
for (const line of PLAN_EXAMPLE) $("planEg").append(" ", Object.assign(document.createElement("code"), { textContent: line }));

function readPasted() {
  const plan = readPlan(planIn.value);
  const said = planButton(plan);
  label(planBtn, said.state, said.tip, said.text);
  planIn.setAttribute("aria-invalid", String(said.state === "error"));
  if (said.state === "error") planIn.setAttribute("aria-describedby", "planBtn"); else planIn.removeAttribute("aria-describedby");
  show.plan = plan.ok ? plan : null;
  // A new run order only when the parts change: fixing a question keeps a running clock.
  const parts = plan.ok ? JSON.stringify(plan.parts) : "";
  if (parts !== show.parts) {
    show.parts = parts;
    show.run = plan.ok ? createRunOrder(plan.parts) : null;
    buildRuns();
  }
  $("showLine").textContent = showLine(show.plan);
  done("sPlan", Boolean(show.plan));
}
planIn.addEventListener("input", readPasted);
planBtn.addEventListener("click", () => {
  const open = planBox.hidden;
  planBox.hidden = !open;
  planBtn.setAttribute("aria-expanded", String(open));
  if (open) planIn.focus();
});

// ---- The run order and the show clock on the producer screen. Start starts the clock with the first part; Next
// part ends the current part at that moment and starts the next. Shown only when a plan is loaded. ----
const runs = $("runs");
const runList = $("runList");
const runBtn = $("runBtn");
const runsMore = $("runsMore");
const clock = $("clock");
let ticker = null;
let lastPress = 0;
const make = (tag, className, text = "") => Object.assign(document.createElement(tag), { className, textContent: text });
const setTone = (el, tone) => { if (tone) el.dataset.tone = tone; else el.removeAttribute("data-tone"); };

function buildRuns() {
  runList.replaceChildren(...(show.plan?.parts || []).map((part) => {
    const bar = make("span", "run__bar");
    bar.append(document.createElement("i"));
    const row = make("li", "run");
    row.append(make("span", "run__name", part.name), make("span", "run__t num"), bar);
    return row;
  }));
  runs.removeAttribute("data-open");
  runsMore.textContent = "All";
  runsMore.setAttribute("aria-expanded", "false");
  renderRun();
}

function renderRun() {
  runs.hidden = !show.run;
  clock.hidden = !show.run;
  if (!show.run) return;
  const view = show.run.view(Date.now());
  view.rows.forEach((row, i) => {
    const item = runList.children[i];
    const [, when, bar] = item.children;
    item.dataset.s = row.state;
    if (row.state === "now") item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
    if (when.textContent !== row.text) when.textContent = row.text;
    setTone(when, row.tone);
    bar.hidden = row.state !== "now";
    bar.firstChild.style.transform = `scaleX(${row.fill.toFixed(4)})`;
  });
  runs.toggleAttribute("data-finished", view.finished);
  runsMore.hidden = view.finished || view.rows.every((r) => ["now", "next"].includes(r.state));
  if (view.button) {
    if (runBtn.textContent !== view.button) runBtn.textContent = view.button;
    runBtn.className = view.started ? "tb tb--small" : "tb tb--primary tb--small";
    runBtn.hidden = false;
  } else if (!runBtn.hidden) {
    // The plan is done: Next part goes, and the keyboard lands on the list's heading rather than nowhere.
    const focused = document.activeElement === runBtn;
    runBtn.hidden = true;
    if (focused) $("runsTitle").focus();
  }

  $("clockTime").textContent = clockText(view.clock);
  const delta = $("clockDelta");
  delta.hidden = !view.started;
  if (view.started) {
    const ahead = view.delta < 0;
    const words = view.delta === 0 ? "on plan" : `${ahead ? "ahead of" : "behind"} plan by ${clockText(Math.abs(view.delta))}`;
    delta.replaceChildren(clockText(view.delta, true), make("span", "sr", ` ${words}`));
    setTone(delta, view.delta > 0 ? "late" : ahead ? "early" : "");
    clock.dataset.tip = `Show time, ${words}.`;
  } else {
    clock.dataset.tip = "Show time. It starts when you press Start.";
  }
}

runBtn.addEventListener("click", () => {
  // A double click on Start must not also end the first part: a second press within a second is ignored.
  const now = Date.now();
  if (!show.run || now - lastPress < 1000) return;
  lastPress = now;
  if (show.run.view(now).started) show.run.next(now); else show.run.start(now);
  ticker ??= setInterval(renderRun, 250);
  renderRun();
});
runsMore.addEventListener("click", () => {
  const open = !runs.hasAttribute("data-open");
  runs.toggleAttribute("data-open", open);
  runsMore.textContent = open ? "Less" : "All";
  runsMore.setAttribute("aria-expanded", String(open));
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
  if (live) renderRun();
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
