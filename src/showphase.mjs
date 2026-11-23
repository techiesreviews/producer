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
