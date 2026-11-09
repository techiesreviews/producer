// The page script. build.mjs inlines src/browser.mjs, src/ui/tooltip.mjs, src/agent-message.mjs and
// src/agent-link.mjs above this file.
const tooltip = installTooltip();

/** This browser and what it can do. Later steps read browser.features to switch a control off with its reason. */
const browser = detectBrowser(window);
document.getElementById("browserChip").textContent = browser.label;

/** A row of choices: one is pressed at a time; a switched-off choice is never picked (the tooltip shows why). */
function choices(group) {
  group.addEventListener("click", (e) => {
    const picked = e.target.closest("button");
    if (!picked || picked.getAttribute("aria-disabled") === "true") return;
    for (const b of group.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === picked));
  });
}

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
