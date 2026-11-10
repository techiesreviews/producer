# The ways to connect each agent (card 09)

Written 2026-11-09, updated 2026-11-10 (card 186). Step 2 "AI agent" offers up to two ways per agent. This is what each one is, what was measured in TOOLS-154 and what the page shows for it.

## The two ways

- **Copy connect message**: the host pastes a message into the agent. The agent runs one ready-made foreground curl loop (see [the relay](agent-relay.md)). Nothing in the agent's settings changes. It is the slower way for every agent, so its button says "slower" where Connect with MCP sits beside it (Claude Code and Codex); T3 Code's chip says it instead (card 186).
- **Connect with MCP**: the host pastes one line into a terminal. It is the recommended way for Claude Code and Codex, so its button says "recommended" (card 186). It adds a `producer` entry to the agent's own MCP settings and opens a fresh chat that is told to start. The agent then calls the producer's tools directly, without curl. The server's own instructions (`initialize`) carry the standing rules.

## Per agent

Middle and slowest are the seconds from a cue handed over to the suggestion on the page, from the TOOLS-154 test (10 pieces, one machine; the slowest is just the worst of 10), except where a cell says it comes from a later real run over 10 cues (card 186). They leave out speech to text and the internet.

| Agent | Way | Middle | Slowest | What the page shows |
|---|---|---|---|---|
| Claude Code | Connect with MCP | 2.2 s | 5.9 s | label "recommended" on the button |
| Claude Code | Copy connect message | 4.3 s (TOOLS-154: 2.5 s) | 6.5 s (TOOLS-154: 3.9 s) | label "slower" on the button. The shortened message in a real run over 10 cues (card 186, [the cues](cues.md)); the first long message gave 5.3 s and 11.0 s in the same kind of run, and MCP 2.5 s in the card 10 run |
| Codex | Connect with MCP | 3.3 s | 4.5 s | label "recommended" on the button |
| Codex | Copy connect message | 7.8 s | 9.7 s | label "slower" on the button; the chip and the button tooltips say "Codex blocks the network in safe mode: allow network or use the MCP line" |
| T3 Code | Copy connect message | 6.1 s (background run) | 7.8 s | the chip says "slower" (the button does not say it twice; there is no MCP way to recommend); its tooltip says T3 Code cannot take a private MCP line |
| T3 Code | Connect with MCP | not possible | | switched off, with the reason |

The T3 Code figure comes from a background run (T3 Code wakes the agent when the command ends); the message the page gives it asks for the foreground loop, which was not measured for T3 Code. The tooltip's "about 6 seconds" is therefore an estimate.

Codex's default safe mode blocks `curl` ("Operation not permitted"): the message tells it to say so in one line and stop. The Connect with MCP way does not need the network from inside the agent. The API key choice stays switched off ("Comes later").

## The line

For a bash or zsh terminal (macOS, Linux, WSL, Git Bash). A Windows PowerShell version is not built: `export` and `/dev/null` do not exist there. The tooltip says "bash or zsh terminal".

The page builds it from this site's address and the connection's token (`src/agent-ways.mjs`). The token is exported in that one terminal: the agent's entry holds a reference to it, never the token. The line itself, token included, stays in the shell's history file on that computer until the host clears it; it is useless after Disconnect, after leaving the page and after eight hours.

```
Claude Code: export PRODUCER_TOKEN='<token>'; claude mcp remove producer >/dev/null 2>&1; claude mcp add --transport http producer '<address>/mcp' --header 'Authorization: Bearer ${PRODUCER_TOKEN:-ended}' && claude '<start words>' --allowedTools mcp__producer
Codex:       export PRODUCER_TOKEN='<token>'; codex mcp remove producer >/dev/null 2>&1; codex mcp add producer --url '<address>/mcp' --bearer-token-env-var PRODUCER_TOKEN && codex -c 'mcp_servers.producer.default_tools_approval_mode="approve"' '<start words>'
```

- The first command removes an entry from an earlier show; a failing add stops the line, so no chat opens without the entry.
- `--allowedTools mcp__producer` (Claude Code) and `default_tools_approval_mode="approve"` (Codex) let the chat use the producer's tools without asking at every call.
- Checked with the real programs (2026-11-09, throwaway config folders, the real Worker code with a fake relay object):
  - Claude Code: the setup part of the line, then `claude mcp list` reports the producer connected, with the header filled from the environment. `claude '<text>' --allowedTools mcp__producer -p` takes the prompt first and the flag after it. A real run with `--allowedTools mcp__producer` called `get_context` through the relay with no permission stop (the page showed the agent connected).
  - Codex: `codex mcp add --url … --bearer-token-env-var PRODUCER_TOKEN` stores only the variable's name, and a real `codex exec` sent `Authorization: Bearer <token>` from it. `codex -c 'mcp_servers.producer.default_tools_approval_mode="approve"'` merges into the stored entry (`codex mcp get` shows `approve`); TOOLS-154 ran Codex with the same setting and no approval stop.
  - A later chat without the variable: Claude Code warns about a missing variable in every chat when the header has no default, so the header carries `:-ended` (the entry then only gets a refusal). Codex starts normally; its producer server just fails to authorise.
  - `test/agent-ways.test.mjs` runs both lines in bash with stand-in programs and checks every argument.

## Who removes the entry

The host. The entry stays in the agent's settings until it is removed (`claude mcp remove producer`, run in the same folder the line was run in, because Claude Code's entry is made for that folder; `codex mcp remove producer`). The token ends after eight hours or at Disconnect, so an old entry is useless, but not tidy. The tooltip of Connect with MCP says so while idle and while connected. T3 Code has no entry to remove.

## What the page does

- One connection at a time. While an agent is connected, the other agents are switched off with the reason "Disconnect first to pick another agent." and the way not used steps aside; Disconnect brings both back.
- While the page only waits (a message or a line was copied, nothing came back yet), nothing is locked: picking another agent or pressing the other way gives that wait up and revokes its token (the Codex case: curl is blocked in safe mode, so the host switches to Connect with MCP). A token that arrives after the wait was given up is let go.
- A connected agent that goes quiet for a minute puts the page back to waiting, so the agents are open again.
- Test, Disconnect, the eight-hour token and the relay work the same for both ways. A copied line or message holds the same kind of token and is revoked the same way.
- Without a clipboard the text shows below the buttons, selected, to copy by hand.
- A tip for quicker answers (a fast model setting, a fresh small chat) is in the Test button's tooltip only.
