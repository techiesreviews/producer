// The page script. scripts/build.mjs inlines the page modules (its INLINED list) above this file in one scope and
// drops these import lines: they say where each name comes from.
import { detectBrowser } from "./browser.mjs";
import { browserService, listeningSign, openBlocked } from "./listen.mjs";
import { createTapOpener } from "./audio-tap.mjs";
import { createListening } from "./listening.mjs";
import { clockText, PLAN_EXAMPLE, planButton, runPosition, showLine } from "./runorder.mjs";
import { CUE, readReport } from "./protocol.mjs";
import { createCues } from "./cues.mjs";
import { createQuestions, isThinking, suggestButton, THINK_MS, thinkLight, turnsText } from "./questions.mjs";
import { buildReport, REPORT_EMPTY, REPORT_WAIT_MS, reportFileName, reportMarkdown } from "./report.mjs";
import { installTooltip } from "./ui/tooltip.mjs";
import { AGENT_WAYS, LOCK_TIP, mcpLine, NO_MCP_TIP, TEST_TIP } from "./agent-ways.mjs";
import { connectMessage } from "./agent-message.mjs";
import { createShowPlan } from "./showplan.mjs";
import { AGENT_TEST_MS, createAgentLink } from "./agent-link.mjs";

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

// Step 1 is done from the start: one choice is always picked. The studio's name is on the tab-sound button once shared.
const streamName = () => document.querySelector('#streamSeg [aria-pressed="true"]').dataset.v;
// OBS has no studio tab: a tab that was shared stops, and Listen will not ask for it again (src/listening.mjs).
choices(document.getElementById("streamSeg"), () => session.streamChanged());

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
  onChange: (view) => { show.agentLink(view.state); renderAgent(view); renderLoad(); renderCard(); renderEnding(view.state); },
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
// listened to: a tab that was already shared stops, and Listen will not ask for it again (src/listening.mjs).
choices($("guestSeg"), (answer) => session.answerGuest(answer));

// ---- Step 3, the show plan (src/showplan.mjs owns it; the format is src/runorder.mjs's). A show arrives pasted by hand,
// from the demo button, or from the agent's load_show; this part of the page passes each one on and draws what the plan
// says. It lives in this page's memory only: never stored, never sent. Each change is read at once; the button says what
// was read, or which line is unclear. ----
const planBtn = $("planBtn");
const planBox = $("planBox");
const planIn = $("planIn");
const demoBtn = $("demoBtn");
const loadBtn = $("loadBtn");
/** The plan box's text, the plan as last read clearly (null before), its run order with the show clock, the agent's notes, and how it got there. */
const show = createShowPlan({ onChange: () => { renderDemo(); renderLoad(); } });
// The example's lines, a space apart in the text (a screen reader and a copy keep them apart; the layout ignores it).
for (const line of PLAN_EXAMPLE) $("planEg").append(" ", Object.assign(document.createElement("code"), { textContent: line }));

/** The run order the rows were built for, so they are built again only for a new one. */
let drawnRun = null;
/** What the text in the box was read as: the plan button, the run order, the show line and the question card. */
function renderPlan() {
  const said = planButton(show.read);
  label(planBtn, said.state, said.tip, said.text);
  planIn.setAttribute("aria-invalid", String(said.state === "error"));
  if (said.state === "error") planIn.setAttribute("aria-describedby", "planBtn"); else planIn.removeAttribute("aria-describedby");
  if (show.run !== drawnRun) {
    drawnRun = show.run;
    buildRuns(show.plan?.parts ?? []);
  }
  $("showLine").textContent = showLine(show.plan);
  done("sPlan", Boolean(show.plan));
  questions.setPlan(show.plan?.questions ?? []);
  renderCard();
}
planIn.addEventListener("input", () => {
  show.edit(planIn.value);
  if (!show.locked) renderPlan(); // fixed once the show clock runs (lockPlan)
  renderDemo();
  renderLoad();
});
planBtn.addEventListener("click", () => {
  const open = planBox.hidden;
  planBox.hidden = !open;
  planBtn.setAttribute("aria-expanded", String(open));
  if (open) planIn.focus();
});

// Load demo show (src/demo.mjs): one click puts the built-in made-up show in the plan box, as the host's own text, with
// its notes. The host can still edit it; the button says Demo loaded until they do. Over a plan of the host's own, the
// first press only asks (on the button).
function renderDemo() {
  const said = show.demoView();
  label(demoBtn, said.state, said.off || said.tip, ...(said.off ? [offMark(), " "] : []), said.text);
  switchOff(demoBtn, said.off);
}

demoBtn.addEventListener("click", () => {
  if (demoBtn.getAttribute("aria-disabled") === "true") return;
  if (show.pressDemo() === "loaded") {
    planIn.value = show.text;
    renderPlan();
  }
  renderDemo();
  renderLoad();
});

// Let my agent load it (src/agent-load.mjs): the button asks the agent with a cue; the agent answers with its load_show
// tool, and the show lands in the plan box above, where the host can still change it. The tool carries the show only:
// nothing here reads or sets "Guest agreed", the microphone or the tab sharing.
function renderLoad() {
  const said = show.loadView(agent.view().state, AGENT_WAYS[agentKey()].name);
  label(loadBtn, said.state, said.off || said.tip || null, ...(said.off ? [offMark(), " "] : []), ...(said.state === "busy" ? [dot("think")] : []), said.text);
  switchOff(loadBtn, said.off);
  loadBtn.className = said.primary ? "tb tb--primary" : "tb";
}

/** The agent's load_show (src/showplan.mjs checks it and gives the answer the agent hears). */
function loadFromAgent(args) {
  const answer = show.agentLoad(args, AGENT_WAYS[agentKey()].name);
  if (answer.result) {
    planIn.value = show.text;
    renderPlan();
  }
  renderDemo();
  renderLoad();
  return answer;
}

loadBtn.addEventListener("click", () => {
  if (loadBtn.getAttribute("aria-disabled") === "true" || loadBtn.dataset.state === "busy") return;
  show.askAgent(AGENT_WAYS[agentKey()].name, () => agent.send({ cue: CUE.load, transcript: [] }));
  renderLoad();
});
renderDemo();
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
  show.lock(now);
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
// The listening session (src/listening.mjs) owns them, the speech engine and the rules between them; this part of the
// page passes on the presses, draws its view and hands what was heard to the cues and the report. While listening,
// each source's sound goes to the speech worker under its own label ("host", "guest"); the two are never mixed. The
// sound is gathered off the page's main thread (src/audio-tap.mjs). The page never plays a sound, and the sound never
// leaves the computer.

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
const micBtn = $("micBtn");
const micTxt = $("micTxt");
const tabBtn = $("tabBtn");
const tabTxt = $("tabTxt");
const tabIcon = tabBtn.querySelector("svg");
const speechBtn = $("speechBtn");
const speechTxt = $("speechTxt");
const speechIdle = speechTxt.textContent;
const SPEECH_TIP = speechBtn.dataset.tip;
const engineSeg = $("engineSeg");
const browserChoice = $("browserChoice");
const speechOf = browser.features.webSpeech;
const service = browserService(speechOf.company);
const goBtn = $("goBtn");
const stopBtn = $("stopBtn");

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

/** A pause of one source (from the model's worker or the browser's service): the agent's cue may go, and the light shows it. */
function paused(source, at) {
  heard.pauses[source] = at;
  if (cues.pause(source)) cueWent();
}

/** An engine failed. On the producer screen the microphone stops and the setup comes back, so the sign never shows
 * listening in vain; the failed control says why (the model's button, or the service's choice, which the session puts
 * back on the model). */
function engineFailed(engine) {
  const live = !$("live").hidden;
  if (engine === "local") {
    if (live && session.view().engine === "local") { session.stop(); showScreen(false); }
    return;
  }
  if (live) { session.stop(); showScreen(false); }
  // The Stop button that had focus is gone with the producer screen: focus goes to the failed choice and its reason
  // opens, so a keyboard or screen-reader host hears why the setup came back. Once the session has put the choice back
  // on the model and the page has drawn it, the scroll to the choice comes first and is let settle (a scroll closes a
  // tooltip), then focus and the reason.
  queueMicrotask(() => {
    browserChoice.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => {
      browserChoice.focus({ preventScroll: true });
      tooltip.show(browserChoice);
    });
  });
}

const session = createListening({
  media: navigator.mediaDevices,
  openTap: createTapOpener({ AudioContext: window.AudioContext, AudioWorkletNode: window.AudioWorkletNode }),
  newWorker: () => new Worker("/speech/worker.mjs", { type: "module", name: "speech" }),
  Recognition: window.SpeechRecognition || window.webkitSpeechRecognition,
  features: browser.features,
  stream: streamName,
  onChange: renderListening,
  onLevel: (source, fill) => (source === "host" ? hostMeter : guestMeter).set(fill),
  onText: hear,
  onPause: paused,
  onFail: engineFailed,
});

/** What a failed microphone says on the control that asked for it, with the way out in its tooltip. */
function micProblem(error) {
  return error === "NotFoundError"
    ? { text: "No microphone found", tip: "This computer has no microphone the browser can use. Plug one in, then press again." }
    : { text: "Microphone blocked", tip: "The browser blocked the microphone. Allow it for this site (the icon beside the address), then press again." };
}

/** Everything the session decides, drawn: the Sound step, the speech step, the Open button and the listening sign. */
function renderListening(v) {
  showMic(v);
  showTab(v);
  // The Sound step is done once the microphone is on and the tab sound is shared, or switched off for a reason.
  done("sSound", v.mic && (v.tab || session.tabView().off));
  done("sGuest", v.guest !== null);
  showSpeech(v);
  showSign(v);
  switchOff(goBtn, openBlocked({ ...v, tabReady: v.tab || session.tabView().off }));
}

function showMic(v) {
  hostMeter.show(v.mic);
  if (v.mic) {
    micBtn.dataset.state = "ok";
    micTxt.textContent = "Microphone";
    micBtn.dataset.tip = "Your microphone is on. Press to turn it off.";
  } else if (v.micBusy) {
    micBtn.dataset.state = "busy";
  } else if (v.micError) {
    const problem = micProblem(v.micError);
    micBtn.dataset.state = "error";
    micTxt.textContent = problem.text;
    micBtn.dataset.tip = problem.tip;
  } else {
    micBtn.removeAttribute("data-state");
    micTxt.textContent = "Microphone";
    // A switched-off microphone keeps its reason.
    if (micBtn.getAttribute("aria-disabled") !== "true") micBtn.removeAttribute("data-tip");
  }
}

// The guest's tab: the host picks the studio's browser tab and ticks "Also share tab audio". Only the tab's sound is
// used, kept apart from the microphone. A browser that cannot do it shows the button switched off with the reason.
function showTab(v) {
  const ui = session.tabView();
  switchOff(tabBtn, ui.off ? ui.tip : "");
  tabTxt.textContent = ui.text;
  label(tabBtn, ui.state, ui.tip, ui.off ? offMark() : tabIcon, tabTxt);
  guestMeter.show(v.tab);
}

// Speech to text: the model runs in a worker of this site and is downloaded once. The engine choice: the model on this
// computer (the default) or the browser's own speech service, which is opt-in and warned on its own label. A browser
// without the service shows the choice switched off with its reason. Both feed the same lines (hear), and nothing is
// kept past this page.
function showSpeech(v) {
  const { model } = v;
  speechBtn.hidden = v.engine === "browser";
  if (model.phase === "loading") {
    speechBtn.dataset.state = "busy";
    speechBtn.dataset.tip = SPEECH_TIP;
    speechTxt.textContent = `Loading ${model.percent}%`;
  } else if (model.phase === "ready") {
    speechBtn.dataset.state = "ok";
    speechTxt.textContent = "Speech ready";
    speechBtn.dataset.tip = `Kept in this browser (${speechIdle.split("· ")[1]}): next time the model loads without downloading.`;
  } else if (model.phase === "error") {
    speechBtn.dataset.state = "error";
    speechTxt.textContent = "Speech model failed · try again";
    speechBtn.dataset.tip = `${model.reason[0].toUpperCase()}${model.reason.slice(1)}.`;
  }
  for (const b of engineSeg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === v.engine));
  showBrowserChoice(v);
  done("sSpeech", v.speech);
}

/** The browser service's choice: its warning line while it can be used (also after a failure, since pressing it is the opt-in), its reason when it cannot. */
function showBrowserChoice(v) {
  const open = browserChoice.getAttribute("aria-describedby") === "tip";
  const failure = v.serviceFailure ? `${v.serviceFailure[0].toUpperCase()}${v.serviceFailure.slice(1)}.` : "";
  browserChoice.classList.toggle("seg__long", speechOf.on);
  if (!speechOf.on) {
    browserChoice.replaceChildren(offMark(), ` ${service.label}`);
    switchOff(browserChoice, speechOf.reason);
  } else {
    // The warning stays in one piece, so a narrow phone breaks the label at the dot and never inside "goes to Google".
    const warning = Object.assign(document.createElement("span"), { className: "nowrap", textContent: service.warning });
    // One flowing piece inside the button (its own children would be separate items of the choice's flex row).
    const words = document.createElement("span");
    words.append(`${service.label}${failure ? " failed" : ""} · `, warning);
    browserChoice.replaceChildren(words);
    browserChoice.dataset.tip = failure || (v.guest === "yes" || v.guest === "no" ? service.guestTip : service.tip);
    if (failure) browserChoice.dataset.state = "error"; else browserChoice.removeAttribute("data-state");
  }
  if (open) tooltip.show(browserChoice);
}

/** The listening sign in the top bar, and its Stop or Listen button. */
function showSign(v) {
  const sign = listeningSign({ ...v, company: speechOf.company, noTab: !browser.features.tabSound.on ? "browser" : streamName() === "obs" ? "obs" : "", tabBusy: v.tabPhase === "busy" });
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
  // A waiting Listen keeps its words until it is settled (a tab picked meanwhile must not wipe them).
  if (v.listen.phase === "busy") {
    stopBtn.dataset.state = "busy";
    stopBtn.removeAttribute("data-tip");
    return;
  }
  // A failed Listen says why on itself, as the setup's microphone button does; pressing it again tries again.
  if (v.listen.phase === "error") {
    const problem = micProblem(v.listen.error);
    stopBtn.className = "tb";
    stopBtn.dataset.state = "error";
    stopBtn.textContent = `${problem.text} · Listen`;
    stopBtn.dataset.tip = problem.tip;
    return;
  }
  stopBtn.textContent = sign.button;
  stopBtn.className = sign.on ? "tb" : "tb tb--primary";
  stopBtn.removeAttribute("data-state");
  stopBtn.removeAttribute("data-tip");
}

const pressed = (button) => button.getAttribute("aria-disabled") !== "true";
switchOff(micBtn, browser.features.microphone.on ? "" : browser.features.microphone.reason);
micBtn.addEventListener("click", () => { if (pressed(micBtn)) session.pressMic(); });
tabBtn.addEventListener("click", () => { if (pressed(tabBtn)) session.pressTab(); });
switchOff(speechBtn, browser.features.wasm.on ? "" : browser.features.wasm.reason);
speechBtn.addEventListener("click", () => { if (pressed(speechBtn)) session.loadModel(); });
choices(engineSeg, (engine) => session.pickEngine(engine));

// ---- Open producer screen: needs the guest's answer, the microphone, the tab sound (or its reason) and the speech model ----
/** The setup or the producer screen (with the listening sign in the top bar). */
function showScreen(live) {
  tooltip.hide();
  $("setup").hidden = live;
  $("live").hidden = !live;
  $("topLive").hidden = !live;
  if (live) { renderRun(); renderCard(); }
}

goBtn.addEventListener("click", () => {
  if (!pressed(goBtn)) return;
  showScreen(true);
  session.open();
});

// The listening sign shows while the page listens; Stop ends the microphone at once; Listen starts it again.
stopBtn.addEventListener("click", () => session.pressListen());
renderListening(session.view());

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
  session.end();
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
