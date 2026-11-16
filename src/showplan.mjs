// The show plan: the one owner of step 3's plan box. A show arrives one of three ways: the host's own text (pasted or
// typed), the built-in demo show (src/demo.mjs), or the agent's load_show (src/agent-load.mjs). Each way goes through
// here and leaves the same things in a clear state: the text, the plan as last read clearly, its run order, the
// agent's notes, who wrote it, the lock at Start, and the exchange with the agent for "Let my agent load it". The page
// only draws the views. It lives in this page's memory only: never stored, never sent.
// The build pastes the page files into one scope with no import lines, so the readers it uses are passed in.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** How long the first press of "Load demo show" over a plan of the host's own waits for the second press. */
export const DEMO_CONFIRM_MS = 8000;

/**
 * createShowPlan({ readPlan, createRunOrder, readLoad, planText, loadButton, loadWaitMs, demo, demoButton, onChange }):
 * readPlan and createRunOrder from src/runorder.mjs; readLoad, planText, loadButton and LOAD_WAIT_MS from
 * src/agent-load.mjs; DEMO_SHOW and demoButton from src/demo.mjs. onChange is called when a timer changes the state
 * on its own (the demo's question runs out, the agent's wait runs out).
 *
 * The ways in: edit(text) the host's own text; pressDemo() gives "loaded", "asked" (the first press over the host's
 * plan) or "off" (the show has started); agentLoad(args, name) the agent's load_show, giving { result } or { error }
 * in plain words; askAgent(name, send) the host's press on "Let my agent load it" (send() sends the cue and says if it
 * went); agentLink(state) the agent link's state, so a wait ends when the agent goes; lock(now) Start.
 * What it holds: text, read (the last read, for the plan button), plan (null unless clear), run, notes, locked.
 * The views: demoView() and loadView(link, name) for the two buttons, name being the agent picked now.
 */
export function createShowPlan({ readPlan, createRunOrder, readLoad, planText, loadButton, loadWaitMs, demo, demoButton, onChange = () => {} }) {
  const plan = { text: "", read: null, plan: null, run: null, parts: "", notes: "", notesFor: null, locked: false };
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
    // A new run order only when the parts change.
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

    edit(text) {
      // The host's own edit: what the agent loaded is no longer what is there, and the host's go-ahead for the agent is used up.
      if (load.phase === "loaded") load.phase = "idle";
      Object.assign(load, { byAgent: false, hostAsked: false, gaveUp: false });
      if (!plan.locked) read(text);
      // The agent's notes belong to the show it loaded: another show (or none) in the box takes them away, a small edit keeps them.
      const now = plan.plan;
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
      if (!load.hostAsked && plan.text.trim() && !load.byAgent) return refuse("The host already has a plan in the page. Ask the host to press Let my agent load it, then call load_show again.");
      const text = planText(got.plan);
      const back = readPlan(text);
      const same = back.ok && back.show === got.plan.show && back.guest === got.plan.guest
        && JSON.stringify(back.parts) === JSON.stringify(got.plan.parts) && JSON.stringify(back.questions) === JSON.stringify(got.plan.questions);
      if (!same) return refuse("That show could not be read back clearly. Use plain names and questions.");
      read(text);
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

    // Start: the clock runs, and the plan stays as it is from then on (back in setup the box reads, but takes no edits),
    // so step 3's buttons always describe the run order on the producer screen.
    lock(now) {
      plan.run.start(now);
      plan.locked = true;
    },

    demoView: () => demoButton({ loaded: demoState.loaded, locked: plan.locked, confirm: demoState.confirm }),
    loadView: (link, name) => loadButton({ agent: link, locked: plan.locked, load: { ...load, name: load.name || name } }),
  };
}
