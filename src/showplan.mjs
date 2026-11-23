import { createRunOrder, readPlan } from "./runorder.mjs";
import { LOAD_WAIT_MS, loadButton, planText, readLoad } from "./agent-load.mjs";
import { DEMO_SHOW, demoButton } from "./demo.mjs";
import { TOOL } from "./protocol.mjs";

/** How long the first press of "Load demo show" over a plan of the host's own waits for the second press. */
export const DEMO_CONFIRM_MS = 8000;

/**
 * createShowPlan({ loadWaitMs, demo, readBack, onChange }): loadWaitMs is how long the agent has to load the show
 * (LOAD_WAIT_MS of src/agent-load.mjs), demo the demo show (DEMO_SHOW of src/demo.mjs), readBack the reader that reads
 * the agent's show back from its text before it lands (readPlan; a test passes one that drops a part of it). onChange is
 * called when a timer changes the state on its own (the demo's question runs out, the agent's wait runs out).
 *
 * The ways in: edit(text) the host's own text; pressDemo() gives "loaded", "asked" (the first press over the host's
 * plan) or "off" (the show has started); agentLoad(args, name) the agent's load_show, giving { result } or { error }
 * in plain words; askAgent(name, send) the host's press on "Let my agent load it" (send() sends the cue and says if it
 * went); agentLink(state) the agent link's state, so a wait ends when the agent goes; lock(now) Start.
 * What it holds: text, read (the last read, for the plan button), plan (null unless clear), run, notes, locked, byAgent.
 * The views: demoView() and loadView(link, name, solo) for the two buttons, name being the agent picked now (solo: the
 * list is the host's own points).
 */
export function createShowPlan({ loadWaitMs = LOAD_WAIT_MS, demo = DEMO_SHOW, readBack = readPlan, onChange = () => {} } = {}) {
  // grouped: the run order (as JSON) of the agent's show that gave each question its part. While the run order stays
  // the same, questions all under one part keep it through the host's edits, where a pasted plan would give them none
  // (src/runorder.mjs); a new run order is read as pasted.
  const plan = { text: "", read: null, plan: null, run: null, parts: "", notes: "", notesFor: null, locked: false, grouped: "" };
  /** loaded: the demo is in the box and has not been edited since; confirm: the first press over the host's plan asked. */
  const demoState = { loaded: false, confirm: false, timer: 0 };
  /** phase: idle, asking (the cue went), loaded (the agent's show is in the box) or failed; byAgent: the box holds the agent's show;
   * hostAsked: the host pressed the button and has not edited the box since, so the agent may load over a plan they typed
   * (also after a refused try or a slow one: the agent's next try still counts); gaveUp: the demo replaced a request on its way. */
  const load = { phase: "idle", name: "", plan: null, reason: "", byAgent: false, hostAsked: false, gaveUp: false, timer: 0 };

  function read(text) {
    plan.text = text;
    const got = readPlan(text);
    plan.read = got;
    plan.plan = got.ok ? got : null;
    const parts = got.ok ? JSON.stringify(got.parts) : "";
    if (parts !== plan.parts) {
      plan.parts = parts;
      plan.run = got.ok ? createRunOrder(got.parts) : null;
    }
  }

  function endDemo() {
    clearTimeout(demoState.timer);
    Object.assign(demoState, { loaded: false, confirm: false });
  }

  function loadFailed(reason) {
    clearTimeout(load.timer);
    Object.assign(load, { phase: "failed", reason });
  }

  return {
    get text() { return plan.text; },
    get read() { return plan.read; },
    get plan() { return plan.plan; },
    get run() { return plan.run; },
    get notes() { return plan.notes; },
    get locked() { return plan.locked; },
    /** The box holds the agent's show as it loaded it (the host has not edited it since). */
    get byAgent() { return load.byAgent; },

    edit(text) {
      // The host's own edit: what the agent loaded is no longer what is there, and the host's go-ahead for the agent is used up.
      if (load.phase === "loaded") load.phase = "idle";
      Object.assign(load, { byAgent: false, hostAsked: false, gaveUp: false });
      if (!plan.locked) read(text);
      const now = plan.plan;
      const under = now?.questionUnder ?? [];
      if (plan.grouped && now && plan.grouped === JSON.stringify(now.parts) && now.questionParts.every((p) => p === null)
        && under.length && under.every((p) => p !== null)) now.questionParts = [...under];
      // The agent's notes belong to the show it loaded: another show (or none) in the box takes them away, a small edit keeps them.
      if (plan.notes && (now ? now.show !== plan.notesFor?.show || now.guest !== plan.notesFor?.guest : !plan.text.trim())) plan.notes = "";
      endDemo();
    },

    pressDemo() {
      if (plan.locked) return "off";
      clearTimeout(demoState.timer);
      // A plan in the box that is not the untouched demo is the host's (or the agent's): the button asks before it replaces it.
      if (plan.text.trim() && !demoState.loaded && !demoState.confirm) {
        demoState.confirm = true;
        demoState.timer = setTimeout(() => { demoState.confirm = false; onChange(); }, DEMO_CONFIRM_MS);
        return "asked";
      }
      demoState.confirm = false;
      // What the agent loaded is no longer what is in the box; the host's own go-ahead for the agent is used up. A request
      // still on its way is given up too (its answer is refused with that reason), so nothing is left waiting.
      if (load.phase === "asking") load.gaveUp = true;
      if (load.phase !== "idle") { clearTimeout(load.timer); load.phase = "idle"; }
      Object.assign(load, { byAgent: false, hostAsked: false });
      read(planText(demo));
      plan.grouped = "";
      plan.notes = demo.notes;
      plan.notesFor = demo;
      demoState.loaded = true;
      return "loaded";
    },

    /** The agent's load_show: checked again here (the Worker checked it first), then the show goes into the box as the host's own format. */
    agentLoad(args, name) {
      const refuse = (reason) => {
        if (load.phase === "asking") loadFailed(`${load.name} could not load the show: ${reason[0].toLowerCase()}${reason.slice(1)}`);
        return { error: reason };
      };
      const got = readLoad(args);
      if (!got.ok) return refuse(got.reason);
      if (plan.locked) return refuse("The show has started, so the plan stays as it is.");
      if (load.gaveUp && !load.hostAsked) { load.gaveUp = false; return refuse("The host loaded the demo show instead. Nothing to do."); }
      // A plan the host typed is theirs: the agent loads over it only when the host pressed the button.
      if (!load.hostAsked && plan.text.trim() && !load.byAgent) return refuse(`The host already has a plan in the page. Ask the host to press Let my agent load it, then call ${TOOL.load} again.`);
      const text = planText(got.plan);
      const back = readBack(text);
      // Questions all under one part read back with no part (a pasted plan's rule, src/runorder.mjs): the agent's own parts then stand.
      const single = back.ok && back.questionParts.every((p) => p === null) && new Set(got.plan.questionParts).size === 1;
      const same = back.ok && back.show === got.plan.show && back.guest === got.plan.guest
        && JSON.stringify(back.parts) === JSON.stringify(got.plan.parts) && JSON.stringify(back.questions) === JSON.stringify(got.plan.questions)
        && (single || JSON.stringify(back.questionParts) === JSON.stringify(got.plan.questionParts));
      if (!same) return refuse("That show could not be read back clearly. Use plain names and questions.");
      read(text);
      // Each question's part as the agent gave it, while the box holds its show unedited (the host's edit reads the text again).
      plan.plan.questionParts = got.plan.questionParts;
      plan.grouped = got.plan.questionParts.some((p) => p !== null) ? JSON.stringify(got.plan.parts) : "";
      plan.notes = got.plan.notes;
      plan.notesFor = got.plan;
      endDemo();
      clearTimeout(load.timer);
      Object.assign(load, { phase: "loaded", name: load.name || name, plan: got.plan, byAgent: true, hostAsked: false, gaveUp: false });
      return { result: { loaded: true, questions: got.plan.questions.length, parts: got.plan.parts.length } };
    },

    askAgent(name, send) {
      if (plan.locked || !send()) return false;
      clearTimeout(load.timer);
      Object.assign(load, { phase: "asking", name, hostAsked: true, gaveUp: false });
      load.timer = setTimeout(() => {
        if (load.phase !== "asking") return;
        loadFailed(`No show came back from ${name} in ${loadWaitMs / 60_000} minutes. Check ${name}, then press again.`);
        onChange();
      }, loadWaitMs);
      return true;
    },

    agentLink(state) {
      // The agent went (Disconnect, or another tab took it) while the page waited for the show, or after a failed try: nothing is
      // on its way any more. A quiet link ("waiting") is an agent busy with the host's outline, so the wait goes on.
      if ((state === "off" || state === "elsewhere") && (load.phase === "asking" || load.phase === "failed")) {
        clearTimeout(load.timer);
        Object.assign(load, { phase: "idle", hostAsked: false });
      }
    },

    lock(now) {
      plan.run.start(now);
      plan.locked = true;
    },

    demoView: () => demoButton({ loaded: demoState.loaded, locked: plan.locked, confirm: demoState.confirm }),
    loadView: (link, name, solo = false) => loadButton({ agent: link, locked: plan.locked, solo, load: { ...load, name: load.name || name } }),
  };
}
