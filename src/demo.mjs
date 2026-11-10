// The built-in demo show (a card after 14, TOOLS-193): one click on step 3's "Load demo show" fills the plan box with a
// short made-up show, so anyone can try the whole screen (the Next question card, the run order, End & report) without
// writing a plan. It is a constant in the page: nothing is fetched, stored or sent, and the guest and everything else in
// it is invented (this repository is public). The host can edit it like any plan. Plain facts in, words out.
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** The demo in the shape the agent's load_show takes (src/agent-load.mjs): show, guest, questions, parts, notes. */
export const DEMO_SHOW = {
  show: "Demo show: A small app's first year",
  guest: "Demo Guest",
  questions: [
    "What made you start building the app?",
    "What did the very first version do?",
    "Who was your first real user?",
    "What went wrong in the first month?",
    "How did you decide on the price?",
    "What did you try that nobody wanted?",
    "What would you do differently today?",
    "What is the next big step?",
  ],
  parts: [
    { name: "Intro", minutes: 3 },
    { name: "The first year", minutes: 8 },
    { name: "Wrap-up", minutes: 4 },
  ],
  notes: "Demo notes, made up for trying the screen: the guest is a placeholder. Ask about the early days, the price, and the one thing that went wrong.",
};

/**
 * Step 3's "Load demo show" for the state it is in. loaded: the demo is in the plan box and has not been edited;
 * locked: the show clock runs, so the plan stays as it is. Gives { state, text, tip, off }: off is the reason the
 * button is switched off ("" when it is ready).
 */
export function demoButton({ loaded, locked }) {
  const off = locked ? "The show has started, so the plan stays as it is." : "";
  if (loaded) return { state: "ok", text: "Demo loaded ✓", tip: "A sample show, not a real one. Change it in the box, or load your own.", off };
  return { state: null, text: "Load demo show", tip: "Fills in a sample show to try the whole screen. Nothing is stored. You can still change it.", off };
}
