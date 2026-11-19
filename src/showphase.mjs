// The show phase: which screen the show is on. "setup" (the first-run steps), "live" (the producer screen, after Open
// producer screen) or "ended" (the end report, after End & report). The page reads the phase from here, never from
// which element is hidden. The moves: open() setup to live; away() live to setup while the show keeps running (the
// top bar's Setup, TOOLS-348: the clock and the listening go on, and open() comes back); back() live, or the setup
// while the show runs, to the setup with the show no longer running (an engine failed mid-show); end() live, or the
// setup while the show runs, to ended, once. The show clock's ticker (a redraw every TICK_MS) runs while the show runs
// (on the producer screen, or on the setup after Setup) and the clock has started: never before the show opens, never
// after the end. What End & report says about the agent is
// decided by endingAgent(), so it is tested without a browser.
// The inlined page script keeps this file's code as it is (the build drops only `export` and the import lines).

/** The show clock is redrawn this often while it runs on the producer screen. */
export const TICK_MS = 250;

/**
 * createShowPhase({ onTick, onChange, timers }): onTick redraws the clock; onChange(phase) is told each move once.
 * view() gives the phase, live() whether it is "live", running() whether the show runs (live, or the setup after
 * Setup), visiting() whether the setup shows while the show runs; clockStarted() says Start was pressed (the ticker
 * may run); ticking() whether the ticker runs now.
 */
export function createShowPhase({ onTick = () => {}, onChange = () => {}, timers = globalThis, tickMs = TICK_MS } = {}) {
  let phase = "setup";
  let running = false; // the show runs: opened, not ended, and not stopped by a failed engine
  let started = false;
  let ticker = null;

  function sync() {
    const run = running && started;
    if (run && ticker === null) ticker = timers.setInterval(onTick, tickMs);
    else if (!run && ticker !== null) {
      timers.clearInterval(ticker);
      ticker = null;
    }
  }
  function move(from, to, run = running) {
    if (phase !== from) return false;
    phase = to;
    running = run;
    sync();
    onChange(phase);
    return true;
  }

  return {
    view: () => phase,
    live: () => phase === "live",
    running: () => running,
    visiting: () => phase === "setup" && running,
    open: () => move("setup", "live", true),
    away: () => move("live", "setup", true),
    back() {
      if (phase === "setup" && running) {
        running = false;
        sync();
        onChange(phase);
        return true;
      }
      return move("live", "setup", false);
    },
    end: () => (running ? move(phase, "ended", false) : false),
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
