// The page script. build.mjs inlines src/browser.mjs, src/listen.mjs, src/web-speech.mjs, src/runorder.mjs, src/cues.mjs,
// src/questions.mjs, src/report.mjs,
// src/ui/tooltip.mjs, src/agent-ways.mjs, src/agent-message.mjs, src/agent-load.mjs, src/demo.mjs and src/agent-link.mjs above this file.
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

// engine: "local" is the speech model on this computer, "browser" is the browser's own speech service (opt-in; its audio
// goes to the browser maker's service, which src/browser.mjs names). speech is true when the picked engine is ready to
// turn the microphone into text. With the browser service only the host's microphone is heard: the guest's tab sound
// is never sent to it, because the guest agreed to being turned into text on this computer.
const state = { guest: null, mic: false, tab: false, speech: false, listening: false, engine: "local" };

// Step 1 is done from the start: one choice is always picked. The studio's name is on the tab-sound button once shared.
const streamName = () => document.querySelector('#streamSeg [aria-pressed="true"]').dataset.v;
choices(document.getElementById("streamSeg"), () => {
  // OBS has no studio tab: a tab that was shared stops, and Listen will not ask for it again.
  if (tabUi().off) { tabWanted = false; if (state.tab || tabPhase === "busy") tabOff(); }
  showTab();
  refresh();
});

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
    else if (mcp) label(button, null, mcp.idleTip, failure("mcp") ?? "Connect with MCP", ...(!failure("mcp") ? [" ", tag("recommended")] : []));
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
  onChange: (view) => { renderAgent(view); renderLoad(); renderCard(); renderEnding(view.state); },
  show: agentShow,
  load: loadFromAgent,
  report: reportFromAgent,
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

// Step 4: the host's own answer for the guest. Nothing else sets it. A guest who said no, or a solo show, is never
// listened to: a tab that was already shared stops, and Listen will not ask for it again.
choices($("guestSeg"), (answer) => {
  state.guest = answer;
  showBrowserChoice();
  if (answer !== "yes") { tabWanted = false; if (state.tab || tabPhase === "busy") tabOff(); }
  done("sGuest", true);
  showTab();
  refresh();
});

// ---- Step 3, the show plan pasted by hand (format: src/runorder.mjs). It lives in this page's memory only: never
// stored, never sent. Each change is read at once; the button says what was read, or which line is unclear. ----
const planBtn = $("planBtn");
const planBox = $("planBox");
const planIn = $("planIn");
/** The plan as last read clearly (null before), and its run order with the show clock. */
const show = { plan: null, run: null, parts: "", notes: "", notesFor: null };
// The example's lines, a space apart in the text (a screen reader and a copy keep them apart; the layout ignores it).
for (const line of PLAN_EXAMPLE) $("planEg").append(" ", Object.assign(document.createElement("code"), { textContent: line }));

function readPasted() {
  if (planIn.readOnly) return; // fixed once the show clock runs (lockPlan)
  const plan = readPlan(planIn.value);
  const said = planButton(plan);
  label(planBtn, said.state, said.tip, said.text);
  planIn.setAttribute("aria-invalid", String(said.state === "error"));
  if (said.state === "error") planIn.setAttribute("aria-describedby", "planBtn"); else planIn.removeAttribute("aria-describedby");
  show.plan = plan.ok ? plan : null;
  // A new run order only when the parts change.
  const parts = plan.ok ? JSON.stringify(plan.parts) : "";
  if (parts !== show.parts) {
    show.parts = parts;
    show.run = plan.ok ? createRunOrder(plan.parts) : null;
    buildRuns(plan.ok ? plan.parts : []);
  }
  $("showLine").textContent = showLine(show.plan);
  done("sPlan", Boolean(show.plan));
  questions.setPlan(show.plan?.questions ?? []);
  renderCard();
}
planIn.addEventListener("input", () => {
  // The host's own edit: what the agent loaded is no longer what is there, and the host's go-ahead for the agent is used up.
  if (loadState.phase === "loaded") { loadState.phase = "idle"; renderLoad(); }
  Object.assign(loadState, { byAgent: false, hostAsked: false });
  readPasted();
  // The agent's notes belong to the show it loaded: another show (or none) in the box takes them away, a small edit keeps them.
  if (show.notes && (show.plan ? show.plan.show !== show.notesFor?.show || show.plan.guest !== show.notesFor?.guest : !planIn.value.trim())) show.notes = "";
  demoLoaded = false;
  clearTimeout(demoTimer);
  demoConfirm = false;
  renderDemo();
});
planBtn.addEventListener("click", () => {
  const open = planBox.hidden;
  planBox.hidden = !open;
  planBtn.setAttribute("aria-expanded", String(open));
  if (open) planIn.focus();
});

// ---- Load demo show (src/demo.mjs): one click puts the built-in made-up show in the plan box, as the host's own text, with
// its notes. The host can still edit it; the button says Demo loaded until they do. In this page's memory only. ----
const demoBtn = $("demoBtn");
/** The demo is in the box and has not been edited since. */
let demoLoaded = false;
/** The first press over a plan of the host's own only asks (on the button); the second press, within 5 seconds, replaces it. */
let demoConfirm = false;
let demoTimer = 0;

function renderDemo() {
  const said = demoButton({ loaded: demoLoaded, locked: planIn.readOnly, confirm: demoConfirm });
  label(demoBtn, said.state, said.off || said.tip, ...(said.off ? [offMark(), " "] : []), said.text);
  switchOff(demoBtn, said.off);
}

demoBtn.addEventListener("click", () => {
  if (demoBtn.getAttribute("aria-disabled") === "true" || planIn.readOnly) return;
  clearTimeout(demoTimer);
  // A plan in the box that is not the untouched demo is the host's (or the agent's): the button asks before it replaces it.
  if (planIn.value.trim() && !demoLoaded && !demoConfirm) {
    demoConfirm = true;
    demoTimer = setTimeout(() => { demoConfirm = false; renderDemo(); }, 5000);
    renderDemo();
    return;
  }
  demoConfirm = false;
  planIn.value = planText(DEMO_SHOW);
  // What the agent loaded is no longer what is in the box; the host's own go-ahead for the agent is used up. A request
  // still on its way is given up too (its answer is refused with that reason), so nothing is left waiting.
  if (loadState.phase === "asking") loadState.gaveUp = true;
  if (loadState.phase !== "idle") { clearTimeout(loadState.timer); loadState.phase = "idle"; }
  Object.assign(loadState, { byAgent: false, hostAsked: false });
  readPasted();
  show.notes = DEMO_SHOW.notes;
  show.notesFor = DEMO_SHOW;
  demoLoaded = true;
  renderDemo();
  renderLoad();
});
renderDemo();

// ---- Let my agent load it (src/agent-load.mjs): the button asks the agent with a cue; the agent answers with its
// load_show tool, and the show lands in the plan box above, where the host can still change it. The tool carries the show
// only: nothing here reads or sets "Guest agreed", the microphone or the tab sharing. In this page's memory only. ----
const loadBtn = $("loadBtn");
/** phase: idle, asking (the cue went), loaded (the agent's show is in the box) or failed; byAgent: the box holds the agent's show;
 * hostAsked: the host pressed the button and has not edited the box since, so the agent may load over a plan they typed
 * (also after a refused try or a slow one: the agent's next try still counts). */
const loadState = { phase: "idle", name: "", plan: null, reason: "", byAgent: false, hostAsked: false, gaveUp: false, timer: 0 };

function renderLoad() {
  const link = agent.view().state;
  // The agent went (Disconnect, or another tab took it) while the page waited for the show, or after a failed try: nothing is
  // on its way any more. A quiet link ("waiting") is an agent busy with the host's outline, so the wait goes on.
  if ((link === "off" || link === "elsewhere") && (loadState.phase === "asking" || loadState.phase === "failed")) { clearTimeout(loadState.timer); Object.assign(loadState, { phase: "idle", hostAsked: false }); }
  const said = loadButton({ agent: link, locked: planIn.readOnly, load: { ...loadState, name: loadState.name || AGENT_WAYS[agentKey()].name } });
  label(loadBtn, said.state, said.off || said.tip || null, ...(said.off ? [offMark(), " "] : []), ...(said.state === "busy" ? [dot("think")] : []), said.text);
  switchOff(loadBtn, said.off);
  loadBtn.className = said.primary ? "tb tb--primary" : "tb";
}

function loadFailed(reason) {
  clearTimeout(loadState.timer);
  Object.assign(loadState, { phase: "failed", reason });
  renderLoad();
}

/** The agent's load_show: checked again here (the Worker checked it first), then the show goes into the plan box as the host's own format. */
function loadFromAgent(args) {
  const refuse = (reason) => {
    if (loadState.phase === "asking") loadFailed(`${loadState.name} could not load the show: ${reason[0].toLowerCase()}${reason.slice(1)}`);
    return { error: reason };
  };
  const read = readLoad(args);
  if (!read.ok) return refuse(read.reason);
  if (planIn.readOnly) return refuse("The show has started, so the plan stays as it is.");
  if (loadState.gaveUp && !loadState.hostAsked) return refuse("The host loaded the demo show instead. Nothing to do.");
  // A plan the host typed is theirs: the agent loads over it only when the host pressed the button.
  if (!loadState.hostAsked && planIn.value.trim() && !loadState.byAgent) return refuse("The host already has a plan in the page. Ask the host to press Let my agent load it, then call load_show again.");
  const text = planText(read.plan);
  const back = readPlan(text);
  const same = back.ok && back.show === read.plan.show && back.guest === read.plan.guest && JSON.stringify(back.parts) === JSON.stringify(read.plan.parts) && JSON.stringify(back.questions) === JSON.stringify(read.plan.questions);
  if (!same) return refuse("That show could not be read back clearly. Use plain names and questions.");
  planIn.value = text;
  readPasted();
  show.notes = read.plan.notes;
  show.notesFor = read.plan;
  demoLoaded = false;
  clearTimeout(demoTimer);
  demoConfirm = false;
  renderDemo();
  clearTimeout(loadState.timer);
  Object.assign(loadState, { phase: "loaded", name: loadState.name || AGENT_WAYS[agentKey()].name, plan: read.plan, byAgent: true, hostAsked: false, gaveUp: false });
  renderLoad();
  renderCard();
  return { result: { loaded: true, questions: read.plan.questions.length, parts: read.plan.parts.length } };
}

loadBtn.addEventListener("click", () => {
  if (loadBtn.getAttribute("aria-disabled") === "true" || loadBtn.dataset.state === "busy" || planIn.readOnly) return;
  const name = AGENT_WAYS[agentKey()].name;
  if (!agent.send({ cue: "load_show", transcript: [] })) return renderLoad();
  clearTimeout(loadState.timer);
  Object.assign(loadState, { phase: "asking", name, hostAsked: true, gaveUp: false });
  loadState.timer = setTimeout(() => { if (loadState.phase === "asking") loadFailed(`No show came back from ${name} in ${LOAD_WAIT_MS / 60_000} minutes. Check ${name}, then press again.`); }, LOAD_WAIT_MS);
  renderLoad();
});
renderLoad();

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

function buildRuns(parts) {
  runList.replaceChildren(...parts.map((part) => {
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
  let tip = "Show time. It starts when you press Start.";
  if (view.started) {
    const ahead = view.delta < 0;
    const words = view.delta === 0 ? "on plan" : `${ahead ? "ahead of" : "behind"} plan by ${clockText(Math.abs(view.delta))}`;
    // Rebuilt only when it changes, so a screen reader following the clock hears no churn.
    const said = `${clockText(view.delta, true)} ${words}`;
    if (delta.textContent !== said) delta.replaceChildren(clockText(view.delta, true), make("span", "sr", ` ${words}`));
    setTone(delta, view.delta > 0 ? "late" : ahead ? "early" : "");
    tip = `Show time, ${words}.`;
  }
  if (clock.dataset.tip !== tip) clock.dataset.tip = tip;
}

runBtn.addEventListener("click", () => {
  // A double click on Start must not also end the first part: a second press within a second is ignored.
  const now = Date.now();
  if (!show.run || now - lastPress < 1000) return;
  lastPress = now;
  if (show.run.view(now).started) show.run.next(now); else lockPlan(now);
  ticker ??= setInterval(renderRun, 250);
  renderRun();
});
// Start: the clock runs, and the plan stays as it is from then on (back in setup the box reads, but takes no edits),
// so step 3's button always describes the run order on the producer screen.
function lockPlan(now) {
  show.run.start(now);
  planIn.readOnly = true;
  label(planBtn, "ok", "The show has started, so the plan stays as it is.", planBtn.textContent);
  renderLoad();
  renderDemo();
}

// ---- Cues to the agent (src/cues.mjs): at a pause once 30 s of new speech was heard, at most once a minute; Suggest
// now at least 10 s apart; Slow down doubles both (both on the question card below). Each cue carries what was heard
// since the last one, the run position and the guest's name. The agent's answers go to the question card. Nothing is
// stored. ----
const cues = createCues({ send: (item) => agent.send(item), context: cueContext });

/** Where the show is when a cue goes: the current part of the run order, and the guest the plan names. */
function cueContext() {
  const context = {};
  if (show.plan?.guest) context.guestName = show.plan.guest;
  const position = show.run && runPosition(show.run.view(Date.now()));
  if (position) context.position = position;
  return context;
}

/** What get_context gives the agent: the plan the host pasted or the agent loaded (with its notes), with the part that is on now. */
function agentShow() {
  if (!show.plan) return null;
  const rows = show.run?.view(Date.now()).rows ?? [];
  return {
    showTitle: show.plan.show,
    guestName: show.plan.guest,
    questions: show.plan.questions.map((text, i) => ({ n: i + 1, text })),
    segments: show.plan.parts.map((part, i) => ({ title: part.name, plannedMinutes: part.minutes, ...(rows[i]?.state === "now" ? { live: true } : {}) })),
    ...(show.notes ? { notes: show.notes } : {}),
  };
}

// ---- The Next question card (src/questions.mjs): the next prepared question from the start and while the agent is
// slow or quiet; each answer from the agent takes the card once. Suggest now and the light in the corner show what the
// agent does; Slow down is the cue rules' switch. All in this page's memory. ----
const questions = createQuestions();
const qMain = $("qMain");
const qWhy = $("qWhy");
const qSrc = $("qSrc");
const altsBox = $("alts");
const askedBtn = $("askedBtn");
const skipBtn = $("skipBtn");
const suggestBtn = $("suggestBtn");
const slowBtn = $("slowBtn");
const thinkDot = $("thinkDot");
const turnChip = $("turnChip");
const asking = { since: 0, timer: 0, alts: "" }; // since: when the newest cue went

/** A control switched off with its reason (the round "i" in front), or on again. */
function offable(button, reason, ...content) {
  label(button, null, reason || null, ...(reason ? [offMark(), " "] : []), ...content);
  switchOff(button, reason);
}

function renderCard() {
  const now = Date.now();
  const link = agent.view().state;
  // Thinking while the newest cue waits for the agent's turn (an answer to an older cue does not end it), at most a minute.
  const busy = link === "on" && agent.asking() && isThinking(asking.since, now);
  if (!busy) asking.since = 0;
  const { main, alts, first, counts } = questions.view();

  // The question, a few words why and where it came from; text is replaced only when it changes (a screen reader
  // hears each new question once).
  const said = main ? main.text : counts.asked + counts.skipped > 0 && !counts.left ? "No questions left" : "No question yet";
  if (qMain.textContent !== said) qMain.textContent = said;
  qMain.toggleAttribute("data-empty", !main);
  const why = main?.why ?? (main?.from === "list" && main.n === first ? "Next on your list." : "");
  qWhy.textContent = why;
  qWhy.hidden = !why;
  qSrc.parentElement.hidden = !main;
  if (main) {
    qSrc.textContent = main.n ? `Q${main.n} · your list` : "New";
    qSrc.className = main.n ? "chip chip--accent" : "chip";
  }
  const none = main ? "" : "No question on the card.";
  offable(askedBtn, none, "Asked");
  offable(skipBtn, none, "Skip");

  // The two to swap in, rebuilt only when they change, so a focused one keeps the keyboard.
  const altsKey = JSON.stringify(alts);
  if (altsKey !== asking.alts) {
    const focused = [...altsBox.children].indexOf(document.activeElement);
    asking.alts = altsKey;
    altsBox.replaceChildren(...alts.map((q, i) => {
      const b = make("button", "alt");
      b.type = "button";
      b.dataset.i = String(i);
      b.append(Object.assign(make("span", "alt__q", q.text), { dir: "auto" }), make("span", q.n ? "chip chip--accent" : "chip", q.n ? `Q${q.n} · your list` : "New"));
      if (q.why) b.append(Object.assign(make("span", "alt__why", q.why), { dir: "auto" }));
      return b;
    }));
    if (focused >= 0) (altsBox.children[focused] ?? altsBox.lastElementChild ?? askedBtn).focus();
  }

  // Suggest now and the light: no agent, thinking, the seconds until the next press counts, or ready.
  const { slow, cues: turns, suggestInMs } = cues.view();
  const button = suggestButton({ agent: link, thinking: busy, waitMs: suggestInMs, slow });
  label(suggestBtn, button.state, button.off || null, ...(button.off && !busy ? [offMark(), " "] : []), button.text);
  switchOff(suggestBtn, button.off);
  suggestBtn.toggleAttribute("aria-busy", busy);
  const light = thinkLight({ agent: link, thinking: busy });
  thinkDot.className = light.kind ? `dot dot--${light.kind}` : "dot";
  thinkDot.setAttribute("aria-label", light.label);
  if (thinkDot.dataset.tip !== light.tip) {
    thinkDot.dataset.tip = light.tip;
    if (thinkDot.getAttribute("aria-describedby") === "tip") tooltip.show(thinkDot);
  }
  turnChip.textContent = turnsText(turns);
  turnChip.dataset.tip = `Agent turns this show. At most one ${slow ? "in 2 minutes" : "a minute"} on its own.`;

  // The next change on its own: the light going back after a minute, or the next second of the wait.
  clearTimeout(asking.timer);
  const wait = busy ? asking.since + THINK_MS - now : suggestInMs > 0 ? suggestInMs % 1000 || 1000 : 0;
  if (wait > 0 && !$("live").hidden) asking.timer = setTimeout(renderCard, wait + 10);
}

/** A cue went (a pause, or Suggest now): the light breathes until the agent's turn on it ends (answered, passed, or a minute). */
function cueWent() {
  asking.since = Date.now();
  renderCard();
}

agent.onSuggestions((answer) => {
  questions.suggest(answer);
  renderCard();
});
agent.onSettled(renderCard);

const pressable = (button) => button.getAttribute("aria-disabled") !== "true" && button.dataset.state !== "busy";
askedBtn.addEventListener("click", () => { if (pressable(askedBtn)) { questions.asked(); renderCard(); } });
skipBtn.addEventListener("click", () => { if (pressable(skipBtn)) { questions.skip(); renderCard(); } });
altsBox.addEventListener("click", (e) => {
  const alt = e.target.closest(".alt");
  if (alt && questions.swap(Number(alt.dataset.i))) renderCard();
});
suggestBtn.addEventListener("click", () => {
  if (!pressable(suggestBtn)) return;
  if (cues.suggestNow().ok) cueWent(); else renderCard();
});
slowBtn.addEventListener("click", () => {
  const on = slowBtn.getAttribute("aria-checked") !== "true";
  slowBtn.setAttribute("aria-checked", String(on));
  cues.slowDown(on);
  renderCard();
});
renderCard();

runsMore.addEventListener("click", () => {
  const open = !runs.hasAttribute("data-open");
  runs.toggleAttribute("data-open", open);
  runsMore.textContent = open ? "Less" : "All";
  runsMore.setAttribute("aria-expanded", String(open));
});

// ---- Sound: two sources, each with its own live level meter: the host's microphone and the guest's shared tab ----
// While listening, each source's sound goes to the speech worker under its own label ("host", "guest"); the two are
// never mixed. The page never plays a sound: each source runs into a silent end (a stream destination, not the
// speakers) only so the browser keeps handing it over. It never leaves the computer.
let mic = null;
let tab = null;

/** A level meter: a bar that fills from the left. */
function levelMeter(el) {
  const bar = el.firstElementChild;
  const set = (fill) => {
    bar.style.transform = `scaleX(${fill.toFixed(3)})`;
    el.setAttribute("aria-valuenow", String(Math.round(fill * 100)));
  };
  return { set, show(on) { el.hidden = !on; if (!on) set(0); } };
}
const hostMeter = levelMeter($("micMeter"));
const guestMeter = levelMeter($("tabMeter"));

/** Opens one source: its meter moves with the sound and, while listening, the worker gets it under `source`. */
function openTap(stream, source, meter) {
  let context;
  let tap;
  try {
    context = new AudioContext();
    // A browser may start the sound paused; asking it to resume (not waiting on it) keeps the meter and the speech fed.
    // Not awaited, and a refusal is left alone on purpose: the sound then stays paused, which the still meter shows.
    context.resume().catch(() => {});
    const input = context.createMediaStreamSource(stream);
    tap = context.createScriptProcessor(4096, 1, 1);
    input.connect(tap);
    tap.connect(context.createMediaStreamDestination());
  } catch (error) {
    // The sound was granted but could not be set up: let it go, so the browser's microphone or sharing light goes out.
    for (const track of stream.getTracks()) track.stop();
    context?.close();
    throw error;
  }
  tap.onaudioprocess = (e) => {
    const samples = e.inputBuffer.getChannelData(0);
    meter.set(meterFill(loudness(samples)));
    if (state.listening && state.engine === "local" && speech) {
      const copy = samples.slice();
      speech.postMessage({ type: "audio", source, samples: copy, rate: context.sampleRate }, [copy.buffer]);
    }
  };
  return { stream, context };
}

function closeTap({ stream, context }) {
  for (const track of stream.getTracks()) track.stop();
  context.close();
}

async function micOn() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  mic = openTap(stream, "host", hostMeter);
  // The microphone can also end on its own (unplugged, or the permission taken back): the page shows it at once.
  for (const track of stream.getAudioTracks()) track.addEventListener("ended", () => { if (mic?.stream === stream) micOff(); });
}

function micOff() {
  if (!mic) return;
  closeTap(mic);
  mic = null;
  speech?.postMessage({ type: "stop", source: "host" });
  web.stop();
  state.mic = false;
  // Without the host's microphone nothing is listened to: the sign stops and the guest tab goes with it. Listen asks
  // for both again (the browser asks the host to pick the tab again each time).
  if (state.listening) {
    state.listening = false;
    tabWanted = tabWanted || state.tab;
    tabOff();
  }
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

/** The Sound step is done once the microphone is on and the tab sound is shared, or switched off for a reason. */
function showSound() {
  done("sSound", state.mic && (state.tab || tabUi().off));
}

function showMic(error = "") {
  hostMeter.show(state.mic);
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
  showSound();
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

// The guest's tab: the host picks the studio's browser tab and ticks "Also share tab audio". Only the tab's sound is
// used, kept apart from the microphone. A browser that cannot do it shows the button switched off with the reason.
const tabBtn = $("tabBtn");
const tabTxt = $("tabTxt");
const tabIcon = tabBtn.querySelector("svg");
let tabPhase = "idle";
let tabFailure = "";
// Numbers each ask for a tab: an answer that comes after Stop, No or a newer ask is let go, not kept.
let shareRun = 0;
// Set when the tab was shared and listening ended (Stop, or the tab itself ended): Listen then asks for the tab again.
let tabWanted = false;

const tabUi = () => tabButton({ feature: browser.features.tabSound, guest: state.guest, phase: tabPhase, problem: tabFailure, stream: streamName(), engine: state.engine });

function showTab() {
  const ui = tabUi();
  switchOff(tabBtn, ui.off ? ui.tip : "");
  tabTxt.textContent = ui.text;
  label(tabBtn, ui.state, ui.tip, ui.off ? offMark() : tabIcon, tabTxt);
  guestMeter.show(state.tab);
  showSound();
}

async function tabOn() {
  // A tiny, slow picture: only the sound is wanted, and a small picture keeps the work on the studio's own tab low.
  // Only a browser tab is offered (not a window or a screen, whose sound can be the whole computer's), and no echo
  // processing, which is made for a microphone.
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 2 }, width: { ideal: 320 }, height: { ideal: 180 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: "exclude",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
    monitorTypeSurfaces: "exclude",
  });
  const fail = (name) => {
    for (const track of stream.getTracks()) track.stop();
    throw Object.assign(new Error(name), { name });
  };
  const surface = stream.getVideoTracks()[0]?.getSettings?.().displaySurface;
  if (surface && surface !== "browser") fail("NotATab");
  if (!stream.getAudioTracks().length) fail("NoTabSound");
  const opened = openTap(stream, "guest", guestMeter);
  // Sharing can end from the browser's own bar or when the tab closes: the page shows it at once. If it ends while
  // listening, Listen asks again.
  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      if (tab?.stream !== stream) return;
      const was = state.listening;
      tabOff();
      tabWanted = was;
    });
  }
  return opened;
}

/** Asks the browser for the tab and shows the outcome on the button; it never throws. */
async function shareTab() {
  const run = ++shareRun;
  tabPhase = "busy";
  showTab();
  try {
    const opened = await tabOn();
    if (run !== shareRun || tabUi().off) {
      // Stop, "No", "Solo show" or a newer ask came while the browser was asking: what it hands over is let go.
      closeTap(opened);
      if (run === shareRun) tabPhase = "idle";
    } else {
      tab = opened;
      state.tab = true;
      tabWanted = false;
      tabPhase = "on";
    }
  } catch (error) {
    if (run !== shareRun) return;
    state.tab = false;
    tabPhase = "error";
    tabFailure = error?.name || "";
  }
  showTab();
  showSign();
  refresh();
}

function tabOff() {
  shareRun++;
  if (tab) {
    closeTap(tab);
    tab = null;
    speech?.postMessage({ type: "stop", source: "guest" });
  }
  state.tab = false;
  tabPhase = "idle";
  tabFailure = "";
  showTab();
  showSign();
  refresh();
}

tabBtn.addEventListener("click", () => {
  if (tabBtn.getAttribute("aria-disabled") === "true" || tabPhase === "busy") return;
  if (state.tab) tabOff(); else shareTab();
});
showTab();

// ---- Speech to text: the model runs in a worker of this site and is downloaded once ----
let speech = null;
let localReady = false; // the model on this computer has loaded
const speechBtn = $("speechBtn");
const speechTxt = $("speechTxt");
const speechIdle = speechTxt.textContent;
const SPEECH_TIP = speechBtn.dataset.tip;

/** What was heard, in this page's memory only and gone when the tab closes: the final lines and each source's newest draft. */
const heard = { lines: [], drafts: {}, pauses: {} };

/** A piece of text from either engine (the model's worker or the browser's service): the same lines either way, each
 * labelled with the source it was heard on ("host" or "guest"; the browser's service hears the host's microphone only). */
function hear(data) {
  if (data.final) {
    // The show time it was heard at (once the clock runs): for the end report's transcript and the agent's clip moments.
    // After End & report (the speech worker's last piece can come a moment later) the show time stays where it stopped.
    const view = ending.at ? ending.run : show.run?.view(Date.now());
    const at = view?.started ? clockText(view.clock) : "";
    heard.lines.push({ source: data.source, text: data.text, start: data.start, end: data.end, at });
    cues.heard({ source: data.source, text: data.text, start: data.start, end: data.end, at });
    if (ending.at) renderReport();
    if (heard.drafts[data.source]?.piece === data.piece) delete heard.drafts[data.source];
  } else {
    heard.drafts[data.source] = { piece: data.piece, text: data.text };
    cues.talking(data.source);
  }
}

function onSpeech({ data }) {
  if (data.type === "progress") {
    speechTxt.textContent = `Loading ${Math.floor((data.loaded / data.total) * 100)}%`;
  } else if (data.type === "ready") {
    localReady = true;
    state.speech = true;
    speechBtn.dataset.state = "ok";
    speechTxt.textContent = "Speech ready";
    speechBtn.dataset.tip = `Kept in this browser (${speechIdle.split("· ")[1]}): next time the model loads without downloading.`;
    done("sSpeech", state.speech);
    refresh();
  } else if (data.type === "error") {
    // The model failed to load, or failed on the producer screen: the microphone stops and the setup comes back, so
    // the sign never shows listening in vain and the failed button (with its reason) offers to load it again.
    if (state.engine === "local" && !$("live").hidden) {
      micOff();
      showScreen(false);
    }
    speech?.terminate();
    speech = null;
    localReady = false;
    state.speech = state.engine === "browser";
    speechBtn.dataset.state = "error";
    speechTxt.textContent = "Speech model failed · try again";
    speechBtn.dataset.tip = `${data.reason[0].toUpperCase()}${data.reason.slice(1)}.`;
    done("sSpeech", state.speech);
    refresh();
  } else if (data.type === "text") {
    hear(data);
  } else if (data.type === "pause") {
    paused(data.source, data.at);
  }
}

/** A pause of one source (from the model's worker or the browser's service): the agent's cue may go, and the light shows it. */
function paused(source, at) {
  heard.pauses[source] = at;
  if (cues.pause(source)) cueWent();
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

// The engine choice: the model on this computer (the default) or the browser's own speech service, which is opt-in
// and warned on its own label. A browser without the service shows the choice switched off with its reason. The text
// of the browser's service feeds the same lines as the model's (hear), and nothing is kept past this page.
const engineSeg = $("engineSeg");
const browserChoice = $("browserChoice");
const speechOf = browser.features.webSpeech;
const service = browserService(speechOf.company);
let browserFailure = ""; // why the service last failed, shown on its choice until it is picked again

const web = createBrowserSpeech({
  Recognition: window.SpeechRecognition || window.webkitSpeechRecognition,
  onText: (piece) => hear({ ...piece, source: "host" }),
  // About 1.5 s after the last words, as the model's worker reports one: the agent's cues go at pauses.
  onPause: (at) => paused("host", at),
  onFail: (reason) => {
    // The service failed on the producer screen: the microphone stops and the setup comes back with the reason on the
    // choice, back on the model on this computer, so the sign never shows listening while nothing becomes text.
    browserFailure = `${reason[0].toUpperCase()}${reason.slice(1)}.`;
    if (!$("live").hidden) {
      micOff();
      showScreen(false);
    }
    pickEngine("local");
    // The Stop button that had focus is gone with the producer screen: focus goes to the failed choice and its reason
    // opens, so a keyboard or screen-reader host hears why the setup came back.
    // The scroll to the choice comes first and is let settle (a scroll closes a tooltip), then focus and the reason.
    browserChoice.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => {
      browserChoice.focus({ preventScroll: true });
      tooltip.show(browserChoice);
    });
  },
});

/** Show the engine picked: the choice row, the model's button (only for the model), the step's done mark. */
function pickEngine(engine) {
  if (engine === "browser" && !speechOf.on) engine = "local";
  if (engine === "browser") browserFailure = "";
  state.engine = engine;
  if (engine === "local") web.stop();
  // The service hears only the host's microphone, so a shared guest tab is let go and the tab button says why.
  if (engine === "browser") { tabWanted = false; if (state.tab || tabPhase !== "idle") tabOff(); }
  showTab();
  for (const b of engineSeg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === engine));
  state.speech = engine === "browser" || localReady;
  speechBtn.hidden = engine === "browser";
  done("sSpeech", state.speech);
  showBrowserChoice();
  refresh();
}

/** The browser service's choice: its warning line while it can be used (also after a failure, since pressing it is the opt-in), its reason when it cannot. */
function showBrowserChoice() {
  const open = browserChoice.getAttribute("aria-describedby") === "tip";
  browserChoice.classList.toggle("seg__long", speechOf.on);
  if (!speechOf.on) {
    browserChoice.replaceChildren(offMark(), ` ${service.label}`);
    switchOff(browserChoice, speechOf.reason);
  } else {
    // The warning stays in one piece, so a narrow phone breaks the label at the dot and never inside "goes to Google".
    const warning = Object.assign(document.createElement("span"), { className: "nowrap", textContent: service.warning });
    // One flowing piece inside the button (its own children would be separate items of the choice's flex row).
    const words = document.createElement("span");
    words.append(`${service.label}${browserFailure ? " failed" : ""} · `, warning);
    browserChoice.replaceChildren(words);
    browserChoice.dataset.tip = browserFailure || (state.guest === "yes" || state.guest === "no" ? service.guestTip : service.tip);
    if (browserFailure) browserChoice.dataset.state = "error"; else browserChoice.removeAttribute("data-state");
  }
  if (open) tooltip.show(browserChoice);
}

choices(engineSeg, pickEngine);
showBrowserChoice();

// ---- Open producer screen: needs the guest's answer, the microphone, the tab sound (or its reason) and the speech model ----
const goBtn = $("goBtn");
function refresh() {
  switchOff(goBtn, openBlocked({ ...state, tabReady: state.tab || tabUi().off }));
}
refresh();

/** The setup or the producer screen (with the listening sign in the top bar). */
function showScreen(live) {
  tooltip.hide();
  $("setup").hidden = live;
  $("live").hidden = !live;
  $("topLive").hidden = !live;
  if (live) { renderRun(); renderCard(); }
}

goBtn.addEventListener("click", () => {
  if (goBtn.getAttribute("aria-disabled") === "true") return;
  // A Listen that failed earlier must not leave its words on Stop now that the page listens afresh.
  stopBtn.removeAttribute("data-state");
  stopBtn.removeAttribute("data-tip");
  showScreen(true);
  startListening();
});

// ---- The listening sign: shows while the page listens; Stop ends the microphone at once; Listen starts it again ----
const stopBtn = $("stopBtn");
function showSign() {
  const sign = listeningSign({ ...state, company: speechOf.company, noTab: !browser.features.tabSound.on ? "browser" : streamName() === "obs" ? "obs" : "", tabBusy: tabPhase === "busy" });
  $("listen").dataset.on = String(sign.on);
  $("listenDot").className = sign.on ? "dot dot--live" : "dot";
  $("listenOn").hidden = !sign.on;
  $("listenOff").hidden = sign.on;
  $("listenSrc").textContent = sign.source;
  $("listenEngine").textContent = sign.engine ? ` · ${sign.engine}` : "";
  $("listenTxt").dataset.tip = sign.tip;
  const chip = $("guestChip");
  chip.hidden = !sign.chip;
  if (sign.chip) {
    chip.textContent = sign.chip.text;
    chip.className = sign.chip.ok ? "chip chip--ok" : "chip";
    chip.dataset.tip = sign.chip.tip;
  }
  // A failed or waiting Listen keeps its words until it is settled (a tab picked meanwhile must not wipe them).
  if (stopBtn.dataset.state === "error" || stopBtn.dataset.state === "busy") return;
  stopBtn.textContent = sign.button;
  stopBtn.className = sign.on ? "tb" : "tb tb--primary";
  stopBtn.removeAttribute("data-state");
}

/** Listening needs the microphone and the picked engine (the model on this computer, or the browser's service); without either the sign stays "Not listening". With the model the tab joins whenever it is shared. */
function startListening() {
  state.listening = Boolean(mic && state.speech && (state.engine === "browser" || speech));
  if (state.listening && state.engine === "browser") web.start(mic.stream.getAudioTracks()[0]);
  showSign();
}

let listenPress = 0;
stopBtn.addEventListener("click", async () => {
  if (stopBtn.dataset.state === "busy") return;
  if (state.listening) { micOff(); return; }
  const press = ++listenPress;
  stopBtn.dataset.state = "busy";
  stopBtn.removeAttribute("data-tip");
  // The browser lets the tab picker open only straight from a click, so it starts here, beside the microphone; the
  // microphone does not wait for it, and the tab joins the sign once the host has picked it.
  const sharing = tabWanted && tabPhase !== "busy" && !tabUi().off ? shareTab() : null;
  try {
    await micOn();
    // End & report came while the browser asked for the microphone: it is let go at once.
    if (ending.at) { micOff(); return; }
    state.mic = true;
    stopBtn.removeAttribute("data-state");
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
    // No microphone, nothing is listened to: a tab picked meanwhile is let go again.
    // Only this press's own tab: a later press may be waiting for the same picker.
    sharing?.then(() => { if (press === listenPress && !state.listening) { tabOff(); tabWanted = true; } });
  }
});

// ---- End & report (card 12, src/report.mjs): listening stops, the run order is frozen where it is, the agent is asked
// for its report (the end_report cue) and the report screen shows at once with what the page knows itself. The agent's
// topics and clip moments join when its post_report comes; with no agent, or after REPORT_WAIT_MS, they are switched
// off with the reason. Copy and Save report give the same Markdown the screen shows. The report lives in this page's
// memory only; the one copy that outlives the tab is the file the host saves. ----
const endBtn = $("endBtn");
const copyBtn = $("copyBtn");
const saveBtn = $("saveBtn");
const SAVE_TIP = saveBtn.dataset.tip;
/** at: when the show ended (null before); run: the run order's view then; agent: { phase, name, reason?, report? };
 * asked: the end cue reached the agent; md: the report as last shown. */
const ending = { at: null, run: null, agent: { phase: "off", name: "", reason: "" }, asked: false, timer: 0, md: "", copyTimer: 0 };

endBtn.addEventListener("click", () => {
  if (ending.at) return;
  const now = Date.now();
  ending.at = new Date(now);
  ending.run = show.run ? show.run.view(now) : null;
  clearInterval(ticker);
  ticker = null;
  tabWanted = false;
  micOff();
  tabOff();
  const name = AGENT_WAYS[agentKey()].name;
  const link = agent.view().state;
  ending.asked = cues.end();
  if (ending.asked) {
    ending.agent = { phase: "waiting", name };
    ending.timer = setTimeout(() => agentGone(`No report came back from ${name} in ${REPORT_WAIT_MS / 60_000} minutes.`), REPORT_WAIT_MS);
  } else {
    ending.agent = { phase: "off", name, reason: link === "elsewhere" ? "Your agent is connected in another tab." : "No agent was connected when the show ended." };
  }
  tooltip.hide();
  $("setup").hidden = true;
  $("live").hidden = true;
  $("topLive").hidden = true;
  $("report").hidden = false;
  renderReport();
  $("reportTitle").focus();
});

/** The agent's parts switch off with the reason, unless its report is already in. */
function agentGone(reason) {
  if (ending.agent.phase !== "waiting") return;
  clearTimeout(ending.timer);
  ending.agent = { phase: "off", name: ending.agent.name, reason };
  renderReport();
}

/** The agent went (Disconnect, or another tab took it) while the report screen waits for it. A quiet loop waits on. */
function renderEnding(link) {
  if (link === "off") agentGone(`${ending.agent.name} disconnected before its report came.`);
  else if (link === "elsewhere") agentGone("Your agent moved to another tab before its report came.");
}

/** The agent's post_report: checked again here (the Worker checked it first), taken only after End & report asked for it. */
function reportFromAgent(args) {
  if (!ending.asked) return { error: "There is no show to report on yet." };
  const read = readReport(args);
  if (!read.ok) return { error: read.reason };
  clearTimeout(ending.timer);
  ending.agent = { phase: "in", name: ending.agent.name, report: read.report };
  renderReport();
  return { result: { shown: true } };
}

const reportRow = (...cells) => {
  const li = document.createElement("li");
  li.append(...cells);
  return li;
};
const userText = (className, text) => Object.assign(make("span", className, text), { dir: "auto" });
const oneRow = (text) => Object.assign(reportRow(make("span", "rows__x", text)), { className: "rows__one" });

/** An agent's part: its rows, or one row that says it waits (a breathing dot) or why it is switched off (the round "i"). */
function agentRows(part, rows, empty) {
  if (part.state === "in") return rows.length ? rows : [oneRow(empty)];
  const row = reportRow(part.state === "waiting" ? dot("think") : offMark(), make("span", "rows__x", part.reason));
  row.className = "rows__state";
  return [row];
}

function renderReport() {
  const model = buildReport({ plan: show.plan, run: ending.run, marks: questions.marked(), agent: ending.agent, heard: heard.lines, date: ending.at });
  const md = reportMarkdown(model);
  if (md === ending.md) return;
  // A saved or copied file no longer holds what the screen shows: the buttons go back to offering it again.
  if (ending.md) { if (saveBtn.dataset.state !== "busy") resetSave(); resetCopy(); }
  ending.md = md;

  // Each part in its own direction, so a name in a right-to-left script never moves the date around it.
  $("reportChip").replaceChildren(...model.chipParts.flatMap((part, i) => [...(i ? [" · "] : []), Object.assign(document.createElement("bdi"), { textContent: part })]));
  $("reportStats").replaceChildren(...model.stats.map((stat) => {
    const words = make("span", "", stat.label);
    if (stat.note) {
      const note = make("span", "", stat.note);
      setTone(note, stat.tone);
      words.append(" · ", note);
    }
    return Object.assign(reportRow(make("b", "num", stat.value), words), { className: "stat" });
  }));
  $("clipList").replaceChildren(...agentRows(model.clips, model.clips.rows.map((c) => reportRow(userText("rows__t", c.at), userText("rows__x", c.text))), REPORT_EMPTY.clips));
  $("realList").replaceChildren(...(model.runs.length ? model.runs.map((r) => {
    // A time against the plan in the mono figures; "not reached" and "not run" in plain words.
    const real = make("span", /\d/.test(r.real) ? "rows__r num" : "rows__r rows__r--words", r.real);
    setTone(real, r.tone);
    return reportRow(make("span", "rows__t num", r.planned), userText("rows__x", r.name), real);
  }) : [oneRow(REPORT_EMPTY.runs)]));
  $("topicList").replaceChildren(...agentRows(model.topics, model.topics.rows.map((t) => Object.assign(reportRow(userText("rows__x", t)), { className: "rows__one" })), REPORT_EMPTY.topics));
  $("notAskedList").replaceChildren(...(model.notAsked.length ? model.notAsked.map((q) => reportRow(make("span", "rows__t", q.n), userText("rows__x", q.text), make("span", "chip", q.why))) : [oneRow(model.noQuestions ? REPORT_EMPTY.noQuestions : REPORT_EMPTY.notAsked)]));
  $("heardCount").textContent = `${model.heard.length} ${model.heard.length === 1 ? "line" : "lines"}`;
  $("heardList").replaceChildren(...(model.heard.length ? model.heard.map((l) => {
    const words = userText("rows__x", "");
    words.append(make("span", "rows__who", l.who), `: ${l.text}`);
    if (l.at) return reportRow(make("span", "rows__t num", l.at), words);
    return Object.assign(reportRow(words), { className: "rows__one" });
  }) : [oneRow(REPORT_EMPTY.heard)]));
}

function resetCopy() {
  clearTimeout(ending.copyTimer);
  label(copyBtn, null, null, "Copy");
}
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(ending.md);
    label(copyBtn, "ok", null, "Copied ✓");
    clearTimeout(ending.copyTimer);
    ending.copyTimer = setTimeout(resetCopy, 1600);
  } catch {
    label(copyBtn, "error", "The browser blocked the clipboard. Save report holds the same text.", "Copy failed");
  }
});

function resetSave() {
  label(saveBtn, null, SAVE_TIP, "Save report");
  saveBtn.className = "tb tb--big tb--primary";
}
/** Saved, unless the report changed while the file was being written (the agent's report came meanwhile). */
function saved(file, text) {
  if (text !== ending.md) return resetSave();
  label(saveBtn, "ok", "Saved on your computer. Nothing is kept anywhere else.", `Saved ✓ · ${file}`);
  saveBtn.className = "tb tb--big";
}
/** The browser's own download: the file goes where the browser puts downloads (or asks, if the host set it to). */
function download(file, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
  Object.assign(document.createElement("a"), { href: url, download: file }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Save report: where the browser lets the host pick the place and name (Chrome, Edge), it asks; elsewhere the file is
// a download. Either way it holds exactly what the screen shows at the press.
saveBtn.addEventListener("click", async () => {
  if (saveBtn.dataset.state === "busy") return;
  const file = reportFileName(ending.at);
  const text = ending.md;
  if (typeof window.showSaveFilePicker !== "function") { download(file, text); saved(file, text); return; }
  // Busy from the press on, so a second press while the picker is open does nothing.
  label(saveBtn, "busy", null, dot("think"), "Saving…");
  let handle;
  try {
    handle = await window.showSaveFilePicker({ suggestedName: file, types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }] });
  } catch (error) {
    if (error?.name === "AbortError") { resetSave(); return; } // the host closed the picker: nothing saved, nothing to say
    download(file, text); // a browser that refuses the picker here still downloads
    saved(file, text);
    return;
  }
  try {
    const out = await handle.createWritable();
    await out.write(text);
    await out.close();
    saved(handle.name, text);
  } catch {
    label(saveBtn, "error", "The file could not be written. Press again to pick another place.", "Not saved · try again");
  }
});
