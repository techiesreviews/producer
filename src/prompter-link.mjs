// One click sets up the Prompter too (TOOLS-464, option a): with "Show questions on my Prompter too" on, the connect
// click also gets a token from the Prompter's own /api/agent-token (it answers CORS for this site's two addresses only),
// puts it in the copied line or message for the agent, and opens the Prompter linked (`#producer`). The token never
// travels in an address: the Prompter tab says ready to the page that opened it, and only that tab, at the Prompter's
// address, gets the token by message, once. The tab tells its link state back (never the token); Disconnect here tells
// it to disconnect too, so its token gets 401 from then on. Nothing is stored: a reload starts over.
// The message names and the address match the Prompter's src/wire.mjs (PRODUCER_MESSAGES, PRODUCER_ORIGINS).
// The inlined page script keeps this file's code as it is (the build drops only `export`).

/** The Prompter's address: the one outside address this page calls (its CSP connect-src names it, nothing wider). */
export const PROMPTER_ORIGIN = "https://prompter.techies.tools";
/** The messages between this page and the Prompter tab it opened. */
export const PROMPTER_MESSAGES = { ready: "prompter:ready", token: "prompter:token", link: "prompter:link", disconnect: "prompter:disconnect" };

/** A Prompter token, or null: it goes inside single quotes in a shell line, so nothing but its own shape is taken. */
export function prompterToken(value) {
  return typeof value === "string" && /^tp1-[0-9a-z]{4,12}-[A-Za-z0-9_-]{20,64}$/.test(value) ? value : null;
}

/**
 * How long the connect click waits for the Prompter's token: past it, the producer's own line or message goes without
 * the Prompter (a Prompter that hangs must not hold it back, nor use up the click's time for the copy and the new tab).
 */
export const PROMPTER_TOKEN_MS = 3000;

/** The link states the Prompter tab reports. Its "off" after the link began reads "ended" here. */
const TAB_STATES = ["waiting", "on", "elsewhere", "off"];
/** The states of a tab that is open and holds this round's token. */
const LIVE = ["opened", "waiting", "on", "elsewhere"];
/** The states with a token in hand that no tab holds yet: the next click uses it again (the Prompter has no route to revoke one). */
const UNOPENED = ["ready", "blocked", "held"];

/**
 * The Prompter half of one connection. `net.token()` asks the Prompter's token route (its HTTP Response), `net.open(url,
 * name)` opens the tab (window.open: a window, or null when the browser blocks it); `onChange(view)` after each change.
 * States: off, fetching (the token is on its way), ready (token in hand, no tab yet), failed (no token), blocked (the
 * browser stopped the new tab; open() again from a fresh click), held (the copy failed: the tab waits for a click on the
 * switch), opened (the tab is loading), then the tab's own: waiting (for the agent), on (the agent is linked there),
 * elsewhere (a newer Prompter tab took it), ended.
 * Use: `prepare()` in the connect click (resolves to the token or null, null too after PROMPTER_TOKEN_MS), `open()` once
 * the click's copy is done (`hold()` when it failed),
 * `heard(event)` for each window message, `disconnect()` for Disconnect, leaving the page or a failed connection.
 */
export function createPrompterLink({ net, onChange }) {
  const link = { state: "off", token: null, tab: null, sent: false, round: 0 };
  const set = (state) => { if (link.state !== state) { link.state = state; onChange(view()); } };
  const view = () => ({ state: link.state });

  async function prepare() {
    // A second click while the tab is open and linking: it already holds this token, so both stay.
    if (link.token && link.tab && !link.tab.closed && LIVE.includes(link.state)) return link.token;
    // A token no tab took yet (the tab was blocked, held back or not opened): the same one again, never a second left working.
    if (link.token && !link.tab && UNOPENED.includes(link.state)) { set("ready"); return link.token; }
    const round = ++link.round;
    link.token = null;
    link.tab = null;
    link.sent = false;
    set("fetching");
    let token = null;
    let timer;
    try {
      const ask = (async () => {
        const res = await net.token();
        return res.ok ? prompterToken((await res.json())?.token) : null;
      })();
      const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), PROMPTER_TOKEN_MS); });
      token = await Promise.race([ask, late]);
    } catch { /* the network or the Prompter is down: failed below */ } finally { clearTimeout(timer); }
    if (round !== link.round) return null; // Disconnect came first: the late token is dropped
    link.token = token;
    set(token ? "ready" : "failed");
    return token;
  }

  function open() {
    if (!link.token || link.tab) return;
    // Always a new tab: an older Prompter tab reused by name would only change its hash, so it would never load again
    // and say ready.
    const tab = net.open(`${PROMPTER_ORIGIN}/#producer`, "_blank");
    if (!tab) { set("blocked"); return; }
    link.tab = tab;
    link.sent = false;
    set("opened");
  }

  // The copy failed and the message box holds the text to copy by hand: a new tab now would take its focus, so the
  // switch opens it from a click instead.
  function hold() {
    if (link.token && !link.tab) set("held");
  }

  function heard(e) {
    if (!link.tab || e.origin !== PROMPTER_ORIGIN || !e.source || e.source !== link.tab) return;
    const type = e.data?.type;
    if (type === PROMPTER_MESSAGES.ready && link.token && !link.sent) {
      link.sent = true;
      link.tab.postMessage({ type: PROMPTER_MESSAGES.token, token: link.token }, PROMPTER_ORIGIN);
    } else if (type === PROMPTER_MESSAGES.link && TAB_STATES.includes(e.data.state)) {
      set(e.data.state === "off" ? "ended" : e.data.state);
    }
  }

  function disconnect() {
    link.round += 1;
    if (link.tab) {
      try { link.tab.postMessage({ type: PROMPTER_MESSAGES.disconnect }, PROMPTER_ORIGIN); } catch { /* the tab is closed */ }
    }
    link.token = null;
    link.tab = null;
    link.sent = false;
    set("off");
  }

  return { prepare, open, hold, heard, disconnect, view };
}
