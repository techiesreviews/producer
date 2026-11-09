# Producer

A private screen for a live host: a helper beside a live stream or podcast that suggests the next question, keeps the run order on time and shows viewer questions.

- Public and free to use. Each host brings their own setup (their own stream, their own AI assistant).
- It runs in the browser, with one small Cloudflare Worker behind it. No accounts.
- Nothing is stored. Not the talk, not the chat, not the questions.
- It is a private screen for the host. It is never shown on stream.
- The host's own AI assistant connects through MCP, the same way the Prompter's "Wait for MCP" works.
- Sister project: the [Prompter](https://github.com/techiesreviews/prompter).
- Status: on `dev`: the top bar (name, Private chip), the shared tooltip and the first-run setup screen with its first step ("I stream with") and the browser it detects, in the Techies light and dark theme, the Worker's agent relay (`/mcp`, `/api/agent-token`, `/api/relay`; see [the relay](docs/wayfinder/producer/agent-relay.md)), and step 2 "AI agent": a pick of Claude Code, Codex or T3 Code (T3 Code is labelled slower; the API key stays off), two ways to connect (Copy connect message, a message with one ready-made curl loop for the agent, and Connect with MCP, one line for Claude Code or Codex; T3 Code has no MCP line; see [the ways](docs/wayfinder/producer/agent-ways.md)), the button's waiting and connected states, Test (the seconds of one sample answer) and Disconnect; then "Guest agreed", the microphone with a level meter and the speech model, speech to text inside the browser, and the live screen frame with the listening sign and Stop; step 3 "Show, questions & plan" (the plan pasted by hand, see below) and, on the producer screen, the run order with the show clock (Start, Next part, time left, ahead or behind plan). No guest tab sound yet, and no text goes to the agent yet. Nothing is deployed.
- The design and the research are in [docs/wayfinder/producer](docs/wayfinder/producer/README.md).
- This repo is public: it never holds keys, tokens or private notes.

## Privacy: what is kept, and where

- The sound never leaves the computer. The microphone is on from the Sound step, for the level meter only; it is turned into text (inside the browser) only after "Open producer screen", and the listening sign shows while that happens. It is never recorded or sent. Stop ends the microphone at once. The page never plays a sound.
- What was heard stays in the page's memory as text, and is gone when the tab closes.
- The browser keeps the speech model (Moonshine base and its engine, about 81 MB) in this site's storage, so it downloads once from this site; the engine's small scripts (about 0.7 MB) load like any page script. Clearing the site's data in the browser removes it. Nothing else is stored in the browser.
- The show plan (show name, guest, questions, run order) stays in the page's memory only. It is never stored and, for now, never sent anywhere; it is gone when the tab closes.
- The guest step ("Guest agreed") is the host's own click. With "No" or "Solo show" the sign says "mic only".

## The show plan, pasted by hand

Setup step 3, "Paste it myself", opens a box. Paste plain text, one thing per line; blank lines are fine:

```
Show: Techies Live
Guest: Jane Doe
3 Intro
10 Her story
15 min Pricing & growth
1. How did it start?
Who was your first customer?
```

- `Show:` and `Guest:` name the show and the guest (both optional).
- A part of the run order is its planned minutes, then its name: `10 Intro` (also `10 min Intro` or `10m Intro`). A plan needs at least one part.
- A question is numbered (`1.` or `1)`) or ends with a question mark. A line starting with `-` or `*` counts the same without it.
- The button shows what it read ("12 questions · 5 parts ✓"), or the first line it cannot read ("Line 4 not clear", with the rule in its tooltip).

On the producer screen, Start starts the show clock with the first part. Next part ends the current part at that moment (its real time is kept) and starts the next; on the last part it ends the plan. The current part shows its time left (or how far over); the clock shows how far ahead (green, minus) or behind (orange, plus) the plan is: done parts against their minutes, plus the time the current part runs over. A narrow window shows only the current and the next part, with All for the rest.

## How it is built

- One Cloudflare Worker (`src/worker.mjs`) serves one static page and the agent relay: `src/mcp.mjs` (the MCP tools), `src/relay.mjs` (one Durable Object per hashed token, a short note only), `src/token.mjs` (eight-hour tokens, own prefix and salt) and `src/limiter.mjs` (60 a minute, 10 per 10 seconds, in memory). `node scripts/build.mjs` writes it to `dist/`: a single `index.html` with the styles and script inlined, a `_headers` file (page policy) and `robots.txt`. The page asks for no outside file.
- The policy allows the microphone and screen capture for this site only, calls to this site only, a worker of this site only, and nothing else from outside. Observability is off; there is no KV, D1, R2 or any other store. The only Durable Objects are the relay (a short note per token, erased by an alarm) and the request limit (memory only).
- `wrangler.jsonc` describes two Workers: `producer` (planned address `producer.techies.tools`) and `producer-preview` (planned address `preview-producer.techies.tools`). Nothing is deployed yet. `.github/workflows/deploy-preview.yml` puts a build of `dev` on the preview Worker, and only runs once the Cloudflare secrets exist.
- Theme tokens: `src/theme.css`. Page shell and setup screen: `src/page.html`, `src/app.css`, `src/app.js`. The shared tooltip: `src/ui/tooltip.mjs`. Browser detection (what this browser can do, with the reason for each switched-off feature): `src/browser.mjs`. The agent connection on the page: `src/agent-ways.mjs` (each agent's ways, notes and the MCP line), `src/agent-message.mjs` (the message the host pastes) and `src/agent-link.mjs` (the token, the relay socket, the answers to the agent and Test). The page calls only this site: `/api/agent-token` and `/api/relay`; it stores nothing, so a reload starts the connection over. What the guest step, the open button and the listening sign say: `src/listen.mjs`. The show plan's format and the run order's clock: `src/runorder.mjs`.
- Speech to text: the page hands the microphone's sound to a worker of this site (`src/speech/worker.mjs`, served as `/speech/worker.mjs` with its own policy: scripts and files of this site only). It cuts the sound at pauses (`segmenter.mjs`: pieces end after 0.6 s of silence, drafts about every second, a pause at about 1.5 s), resamples it to 16 kHz (`resample.mjs`), runs Moonshine base on the processor and stops a looping phrase (`repeat.mjs`). The model and its engine are pinned by size and SHA-256 in `scripts/speech-files.mjs`; `node scripts/build.mjs` fetches them once into a cache outside the repo (`~/.cache/producer-speech`, or `PRODUCER_SPEECH_CACHE`) and copies them into `dist/speech/`. A Worker static asset is at most 25 MiB, so the 42 MB decoder is served in two parts that the worker joins and checks.
- Checks: `scripts/agents/kit unit` (all of `test/*.test.mjs`), `scripts/agents/kit specs` (the page in a real browser, desktop and phone, light and dark, and in Firefox; the speech suite plays a recorded two-person clip, `test/fixtures/two-voices.wav`, as the microphone and checks the delay, the word errors, Stop and what is stored) and `scripts/agents/kit size`.

Licence: MIT, see [LICENSE](LICENSE).
