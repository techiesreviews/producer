// The question card's rules (card 11): what the Next question card shows and what its controls say. The card is never
// empty while the plan has a question left: the next prepared question shows from the start and stays while the agent
// is slow or quiet. The agent's answer (src/agent-link.mjs, one to three suggestions) takes the card once: its first
// suggestion on the card, its next one and the question it replaced as the two to swap in (a third gives way). Asked
// and Skip move on and count a prepared question by its number. All in this page's memory; nothing is stored.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** No answer this long after a cue: the thinking light goes back to ready (the card keeps its question). */
export const THINK_MS = 60_000;
const ALTS = 2;

/**
 * createQuestions(): setPlan(texts) takes the prepared questions (numbered from 1); suggest({ seq, suggestions }) the
 * agent's answer (true when it changed the card); asked(), skip() and swap(i) are the card's controls; view() gives
 * { main, alts, counts: { asked, skipped, left } }. A question is { n?, text, why?, from: "list" | "agent" }.
 */
export function createQuestions() {
  let plan = [];
  const done = new Map(); // prepared question number -> "asked" | "skipped"
  let main = null;
  let alts = [];
  let seen = 0; // the newest answer's seq: each answer is shown once

  const key = (q) => (q.n ? `#${q.n}` : `t:${q.text.toLowerCase()}`);
  const open = (q) => !(q.n && done.has(q.n));
  const prepared = (n, extra = {}) => (Number.isInteger(n) && n >= 1 && n <= plan.length ? { n, text: plan[n - 1], ...extra } : null);

  // The card from what is left: an asked question leaves, the first alternative moves up, prepared questions fill in.
  function fill() {
    const on = new Set();
    const keep = (q) => q && open(q) && !on.has(key(q)) && on.add(key(q));
    alts = alts.filter(keep);
    if (!main || !open(main)) main = alts.shift() ?? null; else on.add(key(main));
    for (let n = 1; n <= plan.length && (!main || alts.length < ALTS); n++) {
      const q = prepared(n, { from: "list" });
      if (!keep(q)) continue;
      if (!main) main = q; else alts.push(q);
    }
    alts = alts.slice(0, ALTS);
  }

  function move(kind) {
    if (!main) return false;
    if (main.n) done.set(main.n, kind);
    main = null;
    fill();
    return true;
  }

  return {
    setPlan(texts) {
      // What was asked stays known by number, also while a plan being edited is shorter for a moment.
      plan = [...texts];
      const again = (q) => (q && q.n ? prepared(q.n, q.why ? { why: q.why, from: q.from } : { from: q.from }) : q);
      main = again(main);
      alts = alts.map(again).filter(Boolean);
      fill();
    },

    suggest({ seq, suggestions }) {
      if (!(seq > seen) || !Array.isArray(suggestions)) return false;
      seen = seq;
      const fresh = suggestions.map((s) => {
        const why = typeof s?.why === "string" && s.why.trim() ? { why: s.why.trim() } : {};
        if (s?.question !== undefined) return prepared(s.question, { ...why, from: "agent" });
        const text = typeof s?.text === "string" ? s.text.trim() : "";
        return text ? { text, ...why, from: "agent" } : null;
      }).filter((q) => q && open(q));
      if (!fresh.length) return false;
      const before = main;
      main = fresh[0];
      // The question it replaced stays to swap back, second after the agent's next pick (a third suggestion gives way).
      alts = [fresh[1], before, ...fresh.slice(2)].filter(Boolean);
      fill();
      return true;
    },

    asked: () => move("asked"),
    skip: () => move("skipped"),

    swap(i) {
      if (!main || !alts[i]) return false;
      [main, alts[i]] = [alts[i], main];
      return true;
    },

    view() {
      const values = [...done].filter(([n]) => n <= plan.length).map(([, kind]) => kind);
      const asked = values.filter((v) => v === "asked").length;
      return { main, alts: [...alts], counts: { asked, skipped: values.length - asked, left: plan.length - values.length } };
    },
  };
}

/** True while a cue that went at `since` waits for its answer, at most THINK_MS. */
export const isThinking = (since, now) => since > 0 && now - since < THINK_MS;

/**
 * What Suggest now says: agent is the link's state ("on" while the agent's loop is alive), thinking while a cue waits
 * for its answer, waitMs until the cue rules take the next press, slow when Slow down is on. off is the reason it is
 * switched off ("" when it runs).
 */
export function suggestButton({ agent, thinking: busy, waitMs, slow = false }) {
  if (agent !== "on") {
    const off = agent === "elsewhere" ? "Your agent is connected in another tab." : "No agent connected. The next question comes from your list.";
    return { text: "Suggest now · no agent", state: null, off };
  }
  if (busy) return { text: "Thinking…", state: "busy", off: "" };
  if (waitMs > 0) return { text: `Suggest now · ${Math.ceil(waitMs / 1000)} s`, state: null, off: slow ? "One every 20 s with Slow down." : "One every 10 s." };
  return { text: "Suggest now", state: null, off: "" };
}

/** The quiet light in the card's corner: grey with no agent, green when ready, a slow orange breath while it thinks. */
export function thinkLight({ agent, thinking: busy }) {
  if (agent !== "on") return { kind: "", label: "No agent", tip: "No agent: the next question comes from your list." };
  if (busy) return { kind: "think", label: "Agent is thinking", tip: "Agent is thinking. The card stays until it is ready." };
  return { kind: "ok", label: "Agent ready", tip: "Agent ready." };
}

export const turnsText = (n) => `${n} ${n === 1 ? "turn" : "turns"}`;
