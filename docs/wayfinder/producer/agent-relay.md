# The agent relay (card 06)

Written 2026-11-09. This is what exists on the Worker: the line between the host's own AI agent and the open producer page. The page's side of it is step 2 "AI agent" (card 08, below); the cues the page sends during the show are in [the cues](cues.md) (card 10).

## In plain words

- The page asks the Worker for a private token (`POST /api/agent-token`). It looks like `pr1-<time>-<random>` and works for eight hours.
- The page keeps a WebSocket open to `/api/relay` (the token travels as a subprotocol, never in the address).
- The host's agent talks to `/mcp` with `Authorization: Bearer <token>`. Every request needs the token. A Prompter token never works here.
- An agent that runs curl can use the short route `/mcp/<tool>` instead (card 186, below): same token, same limits, same relay, but the body is only the tool's arguments and the answer is plain text.
- The agent can never be pushed to. It sits inside one tool, `wait_for_cue`, and the page answers when something happens (or says "idle" after about 25 seconds).
- The Worker only passes calls on. The page keeps the transcript, the questions and the run order, and answers each call with only what is new.

## What is kept, and what is not

- The relay keeps one short note per token: when it was made, when it ends, whether it was revoked, and the agent's name and version. An alarm erases it just after the eight hours.
- The talk, the questions, the run order, the suggestions and the report pass through memory and are gone. No database, no KV, no R2. No request is logged and the Worker's observability is off.
- The request limit (60 a minute, 10 per 10 seconds, per client) counts in memory in one object per hashed client address. It never sees the address and never writes to storage.

## The tools (all answered by the page)

| Tool | Agent sends | Page answers |
|---|---|---|
| `get_context` | nothing | `{ showTitle, guestName?, questions: [{ n, text }], segments: [{ title, plannedMinutes, live }], notes, seq }` |
| `wait_for_cue` | `{ seq, suggestions?, asked? }` | At once if there is something after `seq`, else it holds and answers idle. See below. |
| `post_suggestions` | `{ suggestions }` (1 to 6) | `{ shown }` |
| `get_new_transcript` | `{ seq }` | `{ seq, transcript: [{ speaker, text, at? }] }` |
| `post_report` | `{ topics, asked?, skipped?, clips? }` | `{ ok: true }` |
| `load_show` | `{ show?, guest?, script?, questions?: [text \| { text, part }], parts?: [{ name, minutes }], notes? }` (the script, or the parts) | `{ loaded: true, questions, parts }`, or a plain refusal |
| `post_chat` | `{ messages?: [{ author, text, platform?, time?, question?, pick? }], waiting?, problem? }` | `{ shown }`, or a plain refusal |

A suggestion is `{ question }` (a prepared question number), `{ text }` (a short new question, 160 characters at most) or both, and optionally `{ why }` (120 characters at most). The Worker checks every call from the agent before the page hears it and passes on only these fields. An answer holds up to six suggestions (TOOLS-346): the prepared questions on the topic just talked about, closest first; the first goes on the card and the others make the page's Relevant now list.

`load_show` (card 14, TOOLS-174) is the reverse of `get_context`: it pushes the show into the page. The host presses "Let my agent load it" in step 3, which sends the cue `load_show`; the agent calls the tool with the show from the outline the host gave it (it may also call it when the host asks in the chat). The Worker and the page both check it with the same rules (`src/agent-load.mjs`) and refuse the whole plan with a plain reason when it is over 200 KB, has no parts with whole minutes (1 to 999), has more than 100 questions (300 characters each) or 50 parts, or has any field other than the six above. The tool has no field for "Guest agreed", the microphone or the studio tab, and every unknown field is refused, so the agent cannot set them. The page puts the show in the plan box in the host's own format (the host can still edit it), keeps the notes in memory and gives them back in `get_context`; it refuses while the show clock runs, and it does not overwrite a plan the host typed unless the host pressed the button. The Worker keeps nothing of it.

TOOLS-345: instead of the questions and parts, the agent may send the show's prompter script as it is (`script`, up to 50,000 characters and 96 KB written as JSON with each apostrophe as `\u0027`, so the show written into the curl command's `B` stays under the 128 KB a shell takes for one argument). The Worker reads the run order and the questions out of it (`src/script-reader.mjs`) and hands the page the plan with each question's part: a heading `### **1 · INTRO · 00:00**` is a part that starts at that time (a name in capitals reads as Title Case; it lasts until the next part starts, the last one 5 minutes); a heading with no time (PREP) is off air and left out, and so is every whole line in square brackets (reminders and links); the spoken lines are joined and split again into sentences, so a question over several short lines becomes one sentence ending in "?" (a one-word question after a sentence on the same line, like "Right?", is left out; a question is never shortened, and one over 300 characters is refused with its first words). An agent sending its own list may give each question its part's number (`{ text, part }`, for every question or none, in show order). The plan box then writes each question under its part, so the search groups by part. The connect message and the tool's description ask the agent to load the script right after it connects when the host gave it one, and the plan step's line reads "Questions loaded by your agent · 72 questions · 10 parts ✓" (press it to load again); "Paste it myself" stays a small quiet button. A real show's script stays out of this public repo: `test/script-reader.test.mjs` reads a made-up stand-in, and checks a real one only when `PRODUCER_REAL_SCRIPT_DIR` points at its folder (its `prompter.md` against its hand-made `producer-plan.txt`).

## One command per turn

`wait_for_cue` takes the agent's previous answer in `suggestions`, so one call posts the answer and waits for the next cue. The page gets `{ seq, suggestions?, asked?, holdMs: 25000 }`, shows the suggestions first, then waits. `asked` (TOOLS-347) lists the prepared questions the host used on the Prompter's strip: when the agent is also connected to the host's Prompter, it puts its first suggestion, a talking point and a hook there with the Prompter's `push_suggestions` in the same turn, and that tool reports which ones the host tapped. Each number counts as Asked, as if the host pressed Asked (on the card it moves on); a call body sent again counts once (the copied message's loop repeats its body on every idle round, and that must never close a question the host opened again; so a second use of the same question before the next cue counts once too), and one already asked or skipped stays as it is. A solo show takes none: its plan moves on only with Said and Skip. The copied connect message carries the same handoff (rule 10); its loop waits through idle rounds by itself, so the strip is sent again only at cues and hides two minutes after the last one when nothing is said. At End report the agent calls `clear_suggestions` first and puts the questions it reports used in `post_report`'s `asked`, so a tap during the last wait still counts.

- The page answers within `holdMs` (25 seconds): either a cue or idle. A cue is `{ idle: false, cue, seq, guestName?, transcript, chat, position }`; idle is `{ idle: true, seq }`.
- `cue` is `suggest_now`, `pause`, `chat` or `end_report`. Anything else reaches the agent as `cue`. An `end_report` cue also waits for a loop that called and then went quiet: the show ends once, so the loop hears it when it comes back.
- `position` carries the part on now, the question on the card (`next`) and, since TOOLS-346, `done`: the prepared question numbers the host already asked or skipped (whole numbers, sorted, at most 200), shown to the agent as "Asked or skipped already (leave out): 2, 5".
- Each entry in `transcript` is `{ speaker: "host" | "guest", text, at? }`. The agent sees the labels `HOST:` and `GUEST:` with the text; `at` is the show time the line was heard at (`12:03`, once the host pressed Start), shown as `[12:03]` in front, so the end report's clip moments carry their time (card 12). Chat is `[{ text }]`. `guestName` is optional: only when the host typed it or the agent loaded it (Lex's choice, 2026-11-09); it is one short line of plain text, passed through memory and never stored or logged. Text is capped (20,000 characters of transcript, 500 per chat question) and always marked as data, not instructions.
- `seq` is the page's own counter. The agent sends back the last `seq` it saw and the page returns everything after it. Asking again with the same `seq` returns the same material, so a repeat after a lost answer loses nothing. The page must not treat a cue as delivered until the agent comes back with a higher `seq`.
- A loop sends the same body again after each idle answer, so the same answer can reach the page several times: the page shows an answer to a cue once (the same `seq` with the same suggestions changes nothing).
- A `wait_for_cue` that was sent to a page that has since closed or been replaced (a reload, "Use this tab") ends at once as an ordinary idle answer; the other tools answer "The producer page was reloaded or moved to another tab. Try again." The agent's next call, if no page is connected yet, waits up to 5 seconds for one (a reload closes the old page before the new one connects), so the loop reaches the reloaded page instead of stopping. Only after those 5 seconds does it hear "the page is not open".
- A batch of requests counts as one request for the limits, so it may hold only one `tools/call`.
- The Worker waits at most 30 seconds for the page (after a page takes a call, the relay never holds it past 35 seconds; before that, a call that finds no page waits up to 5 seconds for one). A page that is too slow, or a newer `wait_for_cue` that replaces an older one, ends as an ordinary idle answer with the agent's own `seq`.
- The page answers the call by id in `{ type: "result", id, result }` or `{ type: "result", id, error }`. A page error reaches the agent as a short tool error.

## The short route `/mcp/<tool>` (card 186)

TOOLS-170 found that Claude Code retyped the whole long curl command after every cue and that the copied message took 7 s from the end of the speech (Connect with MCP: 4 s). The short route keeps that command small. It helps a little; most of the gain measured in card 186 came from the answers pointing to prepared questions by number (see [the cues](cues.md)).

- `POST /mcp/<tool>` with `<tool>` one of the five tools above. The body is the tool's arguments as a JSON object (`{"seq":3,"suggestions":[...]}`), or nothing when the tool takes none. No `Content-Type`, no `Accept` and no JSON-RPC wrapper are needed.
- The answer is plain text (`text/plain`): the same words the MCP tool would hand the agent (a cue with `HOST:` and `GUEST:` labels, the show, "Shown on the host's screen (1)"). A wait with nothing new is exactly `idle`.
- Everything else is the same as `/mcp`: the token check (a Prompter token never works), the per-client limits, one `tools/call` per request, the 200 KB body cap, the refusal of other websites' pages, and a 401 mid-wait after Disconnect. Refusals are one plain line with a status: 400 (bad body or a tool error such as "the page is not open"), 401, 403, 404 (a tool that does not exist, answered before the token is looked at: the names are public), 405 (only POST), 413, 429.
- Nothing is stored or logged and the body is read only by the same capped reader.
- Connect with MCP does not use it: Claude Code and Codex speak MCP to `/mcp` directly.

## The ready-made loop (no sleep, no helper file)

An agent whose tool allows a long foreground command can run one curl loop that repeats on idle and ends on the first real answer or any error. It compares the whole answer with the word `idle`, so a cue that happens to mention idle is never mistaken for one. Errors (no page open, 401, 429) are plain lines, so they end the loop at once and it never spins against the limit. `test/loop.test.mjs` runs this loop for real against the Worker:

```
while o=$(curl -sS -m 40 -H "Authorization: Bearer $T" -d "$B" "$U/$P") && [ "$o" = idle ]; do :; done; printf %s "$o"
```

`T` is the token, `U` is this site's address with `/mcp`, `P` the tool and `B` its arguments.

## The connect message and the page (card 08)

- Copy connect message (`src/agent-message.mjs`) copies one message: a two-line block (`T`, `U`, `P` and `B`, then the loop above) and nine rules (rule 4 names `load_show` and its prompter script). The agent runs the block in the foreground with a 10-minute limit and changes only `P` and `B`: first `get_context`, then `wait_for_cue`, and each answer goes in the next wait. What it types again after every cue is about 240 characters with the token, plus its answer (about 450 before card 186). The example answer points to a prepared question by its number, the shortest answer to type; the rules say to prefer it. No sleep, no helper file, no settings change: TOOLS-154 found that an agent told "no helper files" still wrote a loop script when the command was not given whole, and that a sleep loop is blocked by some hooks. The address is the page's own, so the same message works on the preview.
- The page (`src/agent-link.mjs`) holds each wait for 25 seconds, then answers idle; the loop asks again at once. The button reads Waiting for Claude Code until the first call, then Claude Code connected while calls keep coming; after a minute with no call and no wait held it waits again. An answer is shown once (the same `seq` with the same suggestions changes nothing).
- Test is the warm-up (TOOLS-154: the first answer after pasting took 7 to 25 s): it hands one made-up host and guest exchange to the waiting agent and shows the seconds until the answer arrives, with the answer in its tooltip. 90 seconds without an answer reads "no answer".
- Disconnect revokes the token, so the agent's next call (and the wait in progress) gets 401. A reload forgets the token (nothing is stored): the host copies a new message.
- `test/connect-message.test.mjs` runs the copied block in bash against the Worker: connect, Test, answer, Disconnect.
- With the Prompter switch on (TOOLS-464, [the ways](agent-ways.md)), the message adds a second block: one curl line with the Prompter's token that calls its `push_suggestions` with 1 to 3 items (`kind`: question with its number, next, steer, point or audience). Rule 10 says to run it after each cue, talking points only from the show plan or what was said, to add the question numbers it prints to the next wait as `asked`, and to clear the Prompter at End report. Without the Prompter, rule 10 is the old one.

## The other ways (card 09)

The same relay serves Connect with MCP (Claude Code, Codex) and the message for Claude Code, Codex and T3 Code; see [the ways](agent-ways.md). The page's token, Test and Disconnect work the same for every way.

`post_chat` (TOOLS-336) carries the viewer chat. There is no Restream app and no Restream login on this site: test links change their address (a quick tunnel's name is new each time), so a Restream login that must return to a fixed address cannot work yet. Instead the host's own agent reads the live chat through its own Restream connection (for Claude Code, the Restream connector: the live event, then its chat messages) and hands the messages to the page. The host presses "Connect Restream chat" in the setup, which sends the cue `read_chat`; from then on the agent sends what is new once after each `wait_for_cue`. It marks the one viewer question that fits what comes next with `pick` and a few words why (each cue names the next point on the card, `position.next`), so the page can offer it on the card with Use; the host presses Use. While no stream is live it sends `waiting`; when it cannot read the chat it sends `problem` with the reason. The Worker and the page check it with the same rules (`src/chat.mjs`: at most 50 messages a call, 500 characters a message, only these fields), the page refuses it until the host connected the chat and after the host switched it off or ended the show, and nothing is kept: the messages live in the page's memory and leave it only in a saved report. The chat reaches the page about as fast as the agent's loop turns: up to half a minute when nothing else happens.

## Not verified yet

- The chat through the agent's Restream connection in a real live stream: the connector's chat list was read for a finished stream (anonymous viewer names such as "Person 1", the platform and the time), not yet while a stream is live. The rehearsal checks it.

- The 30 second hold on a real Cloudflare deploy. The tests run the relay object and the Worker locally with a fake page and fake timers. The first deploy of the preview (TOOLS-144, the lead's step) must be checked with a real wait of 25 to 30 seconds, and with the Durable Object limit of the free plan in mind.
- Nothing here is deployed, and no Cloudflare setting was changed.
