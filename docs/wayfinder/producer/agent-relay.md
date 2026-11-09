# The agent relay (card 06)

Written 2026-11-09. This is what exists on the Worker: the line between the host's own AI agent and the open producer page. The page itself (cards 03, 08 and 10) is not built yet; this file is what it must answer.

## In plain words

- The page asks the Worker for a private token (`POST /api/agent-token`). It looks like `pr1-<time>-<random>` and works for eight hours.
- The page keeps a WebSocket open to `/api/relay` (the token travels as a subprotocol, never in the address).
- The host's agent talks to `/mcp` with `Authorization: Bearer <token>`. Every request needs the token. A Prompter token never works here.
- The agent can never be pushed to. It sits inside one tool, `wait_for_cue`, and the page answers when something happens (or says "idle" after about 25 seconds).
- The Worker only passes calls on. The page keeps the transcript, the questions and the run order, and answers each call with only what is new.

## What is kept, and what is not

- The relay keeps one short note per token: when it was made, when it ends, whether it was revoked, and the agent's name and version. An alarm erases it just after the eight hours.
- The talk, the questions, the run order, the suggestions and the report pass through memory and are gone. No database, no KV, no R2. No request is logged and the Worker's observability is off.
- The request limit (60 a minute, 10 per 10 seconds, per client) counts in memory in one object per hashed client address. It never sees the address and never writes to storage.

## The tools (all answered by the page)

| Tool | Agent sends | Page answers |
|---|---|---|
| `get_context` | nothing | `{ showTitle, questions: [{ n, text }], segments: [{ title, plannedMinutes, live }], notes, seq }` |
| `wait_for_cue` | `{ seq, suggestions? }` | At once if there is something after `seq`, else it holds and answers idle. See below. |
| `post_suggestions` | `{ suggestions }` (1 to 3) | `{ shown }` |
| `get_new_transcript` | `{ seq }` | `{ seq, transcript: [{ speaker, text }] }` |
| `post_report` | `{ topics, asked?, skipped?, clips? }` | `{ saved: true }` |

A suggestion is `{ question }` (a prepared question number), `{ text }` (a short new question, 160 characters at most) or both, and optionally `{ why }` (120 characters at most). The Worker checks every call from the agent before the page hears it and passes on only these fields.

## One command per turn

`wait_for_cue` takes the agent's previous answer in `suggestions`, so one call posts the answer and waits for the next cue. The page gets `{ seq, suggestions?, holdMs: 25000 }`, shows the suggestions first, then waits.

- The page answers within `holdMs` (25 seconds): either a cue or idle. A cue is `{ idle: false, cue, seq, transcript, chat, position }`; idle is `{ idle: true, seq }`.
- `cue` is `suggest_now`, `pause`, `chat` or `end_report`. Anything else reaches the agent as `cue`.
- Each entry in `transcript` is `{ speaker: "host" | "guest", text }`. The agent sees the labels `HOST:` and `GUEST:` with the text. Chat is `[{ text }]`. Text is capped (20,000 characters of transcript, 500 per chat question) and always marked as data, not instructions.
- `seq` is the page's own counter. The agent sends back the last `seq` it saw and the page returns everything after it. Asking again with the same `seq` returns the same material, so a repeat after a lost answer loses nothing. The page must not treat a cue as delivered until the agent comes back with a higher `seq`.
- A loop sends the same body again after each idle answer, so the same answer can reach the page several times: the page shows an answer to a cue once (the same `seq` with the same suggestions changes nothing).
- A call that was sent to a page that has since closed or been replaced (a reload, "Use this tab") ends at once as an ordinary idle answer, so the agent's next wait reaches the new page.
- A batch of requests counts as one request for the limits, so it may hold only one `tools/call`.
- The Worker waits at most 30 seconds for the page (the relay never holds a call past 35). A page that is too slow, or a newer `wait_for_cue` that replaces an older one, ends as an ordinary idle answer with the agent's own `seq`.
- The page answers the call by id in `{ type: "result", id, result }` or `{ type: "result", id, error }`. A page error reaches the agent as a short tool error.

## The ready-made loop (no sleep, no helper file)

An agent whose tool allows a long foreground command can run one curl loop that repeats on idle and ends on the first real answer or any error. Idle answers contain `"idle":true`; no other answer does (a cue says `"idle":false`, and quotes inside text are escaped). Errors (no page open, 401, 429) end the loop at once, so it never spins against the limit. `test/loop.test.mjs` runs this loop for real against the Worker:

```
while out=$(curl -sS -m 40 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d "$BODY" "$URL/mcp"); do case $out in *'"idle":true'*) ;; *) printf '%s' "$out"; break;; esac; done
```

The wording of the message that gives this to the agent belongs to card 08.

## Not verified yet

- The 30 second hold on a real Cloudflare deploy. The tests run the relay object and the Worker locally with a fake page and fake timers. The first deploy of the preview (TOOLS-144, the lead's step) must be checked with a real wait of 25 to 30 seconds, and with the Durable Object limit of the free plan in mind.
- Nothing here is deployed, and no Cloudflare setting was changed.
