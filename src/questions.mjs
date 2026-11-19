// The question card's rules (card 11): what the Next question card shows and what its controls say. The card is never
// empty while the plan has a question left: the next prepared question shows from the start and stays while the agent
// is slow or quiet. Until the agent's first answer the next two prepared questions wait below to swap in. The agent's
// answer (src/agent-link.mjs, up to six suggestions, best first) takes the card once with its first suggestion; the
// prepared questions it names are the "Relevant now" list (TOOLS-346), the best matches for what was just said, and a new
// question it adds waits below to swap in. Asked and Skip move on to the best match still open and count a prepared
// question by its number. The host's own pick (from the search, TOOLS-344, or the Relevant now list) takes the card and
// stays until Asked or Skip: the agent's answer then only changes the list. All in this page's memory; nothing is stored.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** No answer this long after a cue: the thinking light goes back to ready (the card keeps its question). */
export const THINK_MS = 60_000;
const ALTS = 2;
/** The most matches the agent's answer can name (the Relevant now list shows them, less the one on the card). */
export const MATCHES = 6;

/**
 * createQuestions(): setPlan(texts) takes the prepared questions (numbered from 1); suggest({ seq, suggestions }) the
 * agent's answer (true when it changed the card, its rows to swap in or the Relevant now list); asked(), skip() and
 * swap(i) are the card's controls; pick(n) puts prepared question n on the card (a click in the search or the Relevant
 * now list, or Enter; an asked or skipped one opens again); view() gives { main, alts, relevant, first, counts: { asked,
 * skipped, left } }: relevant is null until the agent's first answer, then the prepared questions of its newest answer
 * still open, best first, less the one on the card; first is the number of the first prepared question still open;
 * marked() gives the host's own presses for the end report: { asked, skipped }
 * (prepared question numbers) and newAsked (new questions asked).
 * A question is { n?, text, why?, from: "list" | "agent" | "picked" }.
 */
export function createQuestions() {
  let plan = [];
  const done = new Map(); // prepared question number -> "asked" | "skipped"
  const gone = new Set(); // new questions (by their words) the host asked or skipped: they never come back
  let main = null;
  let alts = [];
  let seen = 0; // the newest answer's seq: each answer is shown once
  let newAsked = 0; // new questions (not on the list) the host pressed Asked on
  let replaced = null; // the question the host's pick took the card from: it stays to swap back while the pick is on the card
  let relevant = null; // the prepared questions of the agent's newest answer, best first (null until its first answer)

  const key = (q) => (q.n ? `#${q.n}` : `t:${q.text.toLowerCase()}`);
  const open = (q) => (q.n ? !done.has(q.n) : !gone.has(key(q)));
  // A pick that leaves the card is an ordinary list question below it.
  const unpicked = (q) => (q?.from === "picked" ? { ...q, from: "list" } : q);
  const prepared = (n, extra = {}) => (Number.isInteger(n) && n >= 1 && n <= plan.length ? { n, text: plan[n - 1], ...extra } : null);

  // The card from what is left: an asked question leaves, the best match still open moves up (else the first
  // alternative), prepared questions fill in. Once the agent has answered, the rows to swap in hold only its new
  // questions: the prepared ones it named are the Relevant now list.
  function fill() {
    const on = new Set();
    const keep = (q) => q && open(q) && !on.has(key(q)) && on.add(key(q));
    if (main && !keep(main)) main = null; // the card's own question first, so it never shows again below
    if (!main) {
      main = relevant?.find((q) => open(q)) ?? null;
      if (main) keep(main); // before the alternatives, so a match swapped below never shows twice
    }
    alts = alts.filter(keep);
    main ??= alts.shift() ?? null;
    for (let n = 1; n <= plan.length && (!main || (!relevant && alts.length < ALTS)); n++) {
      const q = prepared(n, { from: "list" });
      if (!keep(q)) continue;
      if (!main) main = q; else alts.push(q);
    }
    alts = alts.slice(0, ALTS);
  }

  // The Relevant now list as shown: the newest answer's matches still open, less the card and the rows to swap in.
  function shown() {
    if (!relevant) return null;
    const below = new Set([main, ...alts].filter(Boolean).map(key));
    return relevant.filter((q) => open(q) && !below.has(key(q)));
  }

  function move(kind) {
    if (!main) return false;
    if (main.n) done.set(main.n, kind); else gone.add(key(main));
    if (!main.n && kind === "asked") newAsked += 1;
    main = null;
    replaced = null;
    fill();
    return true;
  }

  return {
    setPlan(texts) {
      // What was asked stays known by number, also while a plan being edited is shorter for a moment.
      plan = [...texts];
      const again = (q) => (q && q.n ? prepared(q.n, q.why ? { why: q.why, from: q.from } : { from: q.from }) : q);
      main = again(main);
      replaced = main?.from === "picked" ? again(replaced) : null; // a pick a shorter plan dropped leaves nothing behind
      alts = alts.map(again).filter(Boolean);
      relevant &&= relevant.map(again).filter(Boolean);
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
      }).filter((q, i, all) => q && open(q) && all.findIndex((o) => o && key(o) === key(q)) === i).slice(0, MATCHES); // a repeat counts once
      if (!fresh.length) {
        // Nothing usable (all asked, skipped or not in the plan): the card stays and the list says no other matches, in
        // place of the prepared rows to swap in when this is the agent's first answer.
        const first = relevant === null;
        const had = first || shown().length > 0;
        relevant = [];
        if (first) alts = alts.filter((q) => !q.n);
        return had;
      }
      // The prepared questions it names are the Relevant now list; a new question waits below to swap in (with the new
      // question it replaced on the card, so that one is not lost).
      relevant = fresh.filter((q) => q.n);
      const isNew = (q) => q && !q.n;
      // The host's pick stays on the card: only the list and the new questions below it change.
      if (main?.from === "picked") {
        alts = [...fresh.filter(isNew), isNew(replaced) ? replaced : null, ...alts.filter(isNew)].filter(Boolean);
        fill();
        return true;
      }
      const before = main;
      main = fresh[0];
      alts = [...fresh.slice(1).filter(isNew), isNew(before) ? before : null].filter(Boolean);
      fill();
      return true;
    },

    asked: () => move("asked"),
    skip: () => move("skipped"),

    swap(i) {
      if (!main || !alts[i]) return false;
      [main, alts[i]] = [alts[i], unpicked(main)];
      replaced = null;
      return true;
    },

    pick(n) {
      const q = prepared(n, { from: "picked" });
      if (!q || (main?.n === n && main.from === "picked")) return false;
      if (main?.n === n) {
        // The card's own question (under a viewer question, say) becomes the host's pick; it replaced nothing.
        main = q;
        replaced = null;
        return true;
      }
      done.delete(n);
      // The question it replaced comes first to swap back, and stays while the pick is on the card. Once the agent has
      // answered, a prepared one goes back to the list instead (it shows in Relevant now while it is a match).
      replaced = relevant && main?.n ? null : unpicked(main);
      alts = [replaced, ...alts].filter(Boolean);
      main = q;
      fill();
      return true;
    },

    marked() {
      const of = (kind) => [...done].filter(([n, k]) => k === kind && n <= plan.length).map(([n]) => n).sort((a, b) => a - b);
      return { asked: of("asked"), skipped: of("skipped"), newAsked };
    },

    view() {
      const values = [...done].filter(([n]) => n <= plan.length).map(([, kind]) => kind);
      const asked = values.filter((v) => v === "asked").length;
      const first = plan.findIndex((_, i) => !done.has(i + 1)) + 1 || null; // the first prepared question still open
      return { main, alts: [...alts], relevant: shown(), first, counts: { asked, skipped: values.length - asked, left: plan.length - values.length } };
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
  if (agent === "elsewhere") return { text: "Suggest now · other tab", state: null, off: "Your agent is connected in another tab." };
  if (agent !== "on") return { text: "Suggest now · no agent", state: null, off: "No agent connected. The next question comes from your list." };
  if (busy) return { text: "Thinking…", state: "busy", off: "Your agent is thinking." };
  if (waitMs > 0) return { text: `Suggest now · ${Math.ceil(waitMs / 1000)} s`, state: null, off: slow ? "One every 20 s with Slow down." : "One every 10 s." };
  return { text: "Suggest now", state: null, off: "" };
}

/** The quiet light in the card's corner: grey with no agent, green when ready, a slow orange breath while it thinks. */
export function thinkLight({ agent, thinking: busy }) {
  if (agent === "elsewhere") return { kind: "", label: "Agent in another tab", tip: "Your agent is connected in another tab." };
  if (agent !== "on") return { kind: "", label: "No agent", tip: "No agent: the next question comes from your list." };
  if (busy) return { kind: "think", label: "Agent is thinking", tip: "Agent is thinking. The card stays until it is ready." };
  return { kind: "ok", label: "Agent ready", tip: "Agent ready." };
}

export const turnsText = (n) => `${n} ${n === 1 ? "turn" : "turns"}`;
