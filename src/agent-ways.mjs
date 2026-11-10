// The ways to connect each agent (card 09, from TOOLS-154): what its chip in step 2 says, and the one line that
// "Connect with MCP" copies. The host pastes that line into a terminal; it sets up Claude Code's or Codex's own MCP
// entry for this producer and opens a chat that is told to start. The token is exported for that one terminal only:
// the entry holds a reference to it (Claude Code's "${PRODUCER_TOKEN}", Codex's --bearer-token-env-var), never the
// token itself, so what stays in the agent's settings is useless once the token ends. Claude Code's entry is made for
// the folder the line is run in (its default), so a leftover touches that one folder. The lines are for bash or zsh
// (macOS, Linux, WSL, Git Bash); a Windows PowerShell version is not built.
// The line, token included, stays in the shell's history file on that computer until the host clears it; it is useless
// after Disconnect, after leaving the page and after eight hours. A later Claude Code chat without the variable reads
// the default "ended", so the leftover entry only gets a refusal and Claude Code raises no warning; a later Codex chat
// without it starts normally and the producer server there simply fails to authorise (TOOLS-169 review, tried).
// The inlined page script keeps this file's code as it is (the build only drops `export`).

/** The words that open the chat. Plain: it sits inside single quotes in the line. */
export const START = "Be my live-show producer. Use the producer MCP tools, and load_show when a cue asks you to load my show. Keep going until I end the show.";

// `where` is a note on the remove command: Claude Code's entry belongs to the folder the line was run in.
const mcpTips = (agent, remove, where = "") => ({
  remove,
  idleTip: `Copies one line for a bash or zsh terminal. It adds a producer entry to ${agent}'s settings. The token ends after eight hours; then remove the entry: ${remove}${where}`,
  onTip: `Click to disconnect. ${agent} keeps the producer entry until you remove it: ${remove}${where}`,
});

const CODEX_NOTE = "Codex blocks the network in safe mode: allow network or use the MCP line";

/**
 * Per agent: its name, the note on its chip (null: none), a label on the chip (T3 Code has no fast way at all), whether
 * its paste way is the slow one (Claude Code, real runs over 10 cues: card 186 gave 4.3 s a cue with the shortened
 * message, 5.3 s with the first long one (TOOLS-170: 7.0 s from the end of the speech), MCP 2.5 s; Codex 7.8 s against
 * 3.3 s; T3 Code 6.1 s), a note on its paste way's tooltip (null: none) and its MCP way (null: none).
 * The page labels the paste button "slower" and the MCP button "recommended" wherever an agent has both ways (Claude
 * Code and Codex, card 186); T3 Code's chip already says slower and it has no MCP way.
 */
export const AGENT_WAYS = {
  claude: { name: "Claude Code", chipTip: null, tag: null, pasteSlow: true, pasteNote: null, mcp: mcpTips("Claude Code", "claude mcp remove producer", " (in the same folder)") },
  codex: { name: "Codex", chipTip: CODEX_NOTE, tag: null, pasteSlow: true, pasteNote: CODEX_NOTE, mcp: mcpTips("Codex", "codex mcp remove producer") },
  t3: { name: "T3 Code", chipTip: "Slower: about 6 seconds an answer. T3 Code cannot take a private MCP line, so it uses the connect message.", tag: "slower", pasteSlow: true, pasteNote: null, mcp: null },
};

/** Why T3 Code's Connect with MCP is switched off. */
export const NO_MCP_TIP = "T3 Code cannot take a private MCP line. Use the connect message.";
/** Why the other agents are switched off while one is connecting or connected. */
export const LOCK_TIP = "Disconnect first to pick another agent.";
/** On the idle Test button: the two ways to get quicker answers (TOOLS-154), a tip and nothing more. */
export const TEST_TIP = "Warm-up before you go live. For quicker answers, pick a fast model setting and use a fresh small chat.";

/**
 * The line for an agent, for this page's address and this connection's token; null when the agent has no MCP way.
 * The first step removes an entry left from an earlier show (a failure there is ignored); a failing add stops the line,
 * so no chat opens without the entry. The chat is allowed to use the producer's tools without asking each time.
 */
export function mcpLine({ agent, origin, token }) {
  const start = `export PRODUCER_TOKEN='${token}'; `;
  if (agent === "claude") {
    return `${start}claude mcp remove producer >/dev/null 2>&1; claude mcp add --transport http producer '${origin}/mcp' --header 'Authorization: Bearer \${PRODUCER_TOKEN:-ended}' && claude '${START}' --allowedTools mcp__producer`;
  }
  if (agent === "codex") {
    return `${start}codex mcp remove producer >/dev/null 2>&1; codex mcp add producer --url '${origin}/mcp' --bearer-token-env-var PRODUCER_TOKEN && codex -c 'mcp_servers.producer.default_tools_approval_mode="approve"' '${START}'`;
  }
  return null;
}
