// The show phase: which screen the show is on. "setup" (the first-run steps), "live" (the producer screen, after Open
// producer screen) or "ended" (the end report, after End & report). The page reads the phase from here, never from
// which element is hidden. The moves: open() setup to live; back() live to setup (an engine failed mid-show); end()
// live to ended, once. The show clock's ticker (a redraw every TICK_MS) runs only while the show is live and the
// clock has started: never on the setup screen, never after the end. What End & report says about the agent is
// decided by endingAgent(), so it is tested without a browser.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** The show clock is redrawn this often while it runs on the producer screen. */
export const TICK_MS = 250;

/**
 * createShowPhase({ onTick, onChange, timers }): onTick redraws the clock; onChange(phase) is told each move once.
 * view() gives the phase, live() whether it is "live"; clockStarted() says Start was pressed (the ticker may run);
 * ticking() whether the ticker runs now.
 */
export function createShowPhase({ onTick = () => {}, onChange = () => {}, timers = globalThis, tickMs = TICK_MS } = {}) {
  let phase = "setup";
  let started = false;
  let ticker = null;

  function sync() {
    const run = phase === "live" && started;
    if (run && ticker === null) ticker = timers.setInterval(onTick, tickMs);
    else if (!run && ticker !== null) {
      timers.clearInterval(ticker);
      ticker = null;
    }
  }
  function move(from, to) {
    if (phase !== from) return false;
    phase = to;
    sync();
    onChange(phase);
    return true;
  }

  return {
    view: () => phase,
    live: () => phase === "live",
    open: () => move("setup", "live"),
    back: () => move("live", "setup"),
    end: () => move("live", "ended"),
    clockStarted() {
      started = true;
      sync();
    },
    ticking: () => ticker !== null,
  };
}

/**
 * What End & report shows for the agent: { phase: "waiting", name } when the end cue reached it (asked; a quiet loop
 * takes it too and hears it when it comes back), else { phase: "off", name, reason } with why it was not asked.
 */
export function endingAgent({ asked, link, name }) {
  if (asked) return { phase: "waiting", name };
  return { phase: "off", name, reason: link === "elsewhere" ? "Your agent is connected in another tab." : "No agent was connected when the show ended." };
}
