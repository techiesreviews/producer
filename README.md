# Producer

A private screen for a live host: a helper beside a live stream or podcast that suggests the next question, keeps the run order on time and shows viewer questions.

- Public and free to use. Each host brings their own setup (their own stream, their own AI assistant).
- It runs in the browser, with one small Cloudflare Worker behind it. No accounts.
- Nothing is stored. Not the talk, not the chat, not the questions. By default nothing is sent either; one warned opt-in sends the microphone's sound to the browser maker (see Privacy).
- It is a private screen for the host. It is never shown on stream.
- The host's own AI assistant connects through MCP, the same way the Prompter's "Wait for MCP" works.
- Sister project: the [Prompter](https://github.com/techiesreviews/prompter).
- Status: on `dev`: the top bar (name, Private chip), the shared tooltip and the first-run setup screen with its first step ("I stream with") and the browser it detects, in the Techies light and dark theme, the Worker's agent relay (`/mcp`, its short route `/mcp/<tool>`, `/api/agent-token`, `/api/relay`; see [the relay](docs/wayfinder/producer/agent-relay.md)), and step 2 "AI agent": a pick of Claude Code, Codex or T3 Code (T3 Code is labelled slower; the API key stays off), two ways to connect (Copy connect message, a message with one short ready-made curl command for the agent, labelled slower, and Connect with MCP, one line for Claude Code or Codex, labelled recommended; T3 Code has no MCP line; see [the ways](docs/wayfinder/producer/agent-ways.md)), the button's waiting and connected states, Test (the seconds of one sample answer) and Disconnect; then "Guest agreed", the microphone with a level meter and the speech model, speech to text inside the browser (or, as an opt-in warned that the audio goes to Google, the browser's own speech service), and the live screen frame with the listening sign and Stop; step 3 "Show, questions & plan" (the plan pasted by hand, see below) and, on the producer screen, the run order with the show clock (Start, Next part, time left, ahead or behind plan). The Sound step also shares the studio's browser tab with sound (Chrome and Edge on a computer; elsewhere and with OBS the button is switched off with the reason), kept apart from the microphone and labelled host and guest. And the cues: at a pause the page hands the connected agent what was heard since the last cue and keeps the agent's answer in memory (see [the cues](docs/wayfinder/producer/cues.md); measured with Claude Code: Connect with MCP meets the speed target, the copied message misses it). And on the producer screen, the Next question card: the next prepared question from the start, the agent's answer with a few words why and two to swap in, Asked and Skip, Suggest now with its state on the button, Slow down and a quiet thinking light. Nothing is deployed; a temporary https link for testing comes from `npm run qa:tunnel` (see below).
- The design and the research are in [docs/wayfinder/producer](docs/wayfinder/producer/README.md).
- This repo is public: it never holds keys, tokens or private notes.

## Privacy: what is kept, and where

- By default the sound never leaves the computer. The microphone, and the studio tab's sound if the host shares it, are on from the Sound step, for the level meters only; they are turned into text (inside the browser) only after "Open producer screen", and the listening sign shows while that happens. It is never recorded or sent. Stop ends the microphone and the shared tab at once. The page never plays a sound.
- One exception, and only if the host picks it: the speech step's second way, "Browser service · audio goes to Google". It is the browser's own speech service (the Web Speech API), and the browser sends the microphone's sound to the company behind it to turn it into text.
- The choice carries that warning on itself, and the listening sign reads "browser service" while it is used. This page sends nothing itself and stores nothing of it; what the company keeps is its own policy, not ours.
- On a computer Chrome sends the sound to Google, Edge to Microsoft and Safari to Apple, and the choice names the right one; on a phone or tablet the choice is switched off (the service is offered on computers only; a tablet that asks for the desktop site can look like a computer, so there it may still be offered). Where the company is not known it says "audio leaves this computer". A browser that calls itself Chrome, such as Brave, is named Google even if its own service cannot be reached; it then says so on the choice.
- The browser service hears only the host's microphone. The guest's tab sound is never sent to it, because the guest agreed to being turned into text on this computer, so the tab-sound button is switched off while it is picked.
- Without headphones the host's microphone also picks up the guest from the speakers, and then the guest's voice goes to the company too. The choice's tooltip says so for a guest who said yes or no. Wear headphones, or ask the guest first.
- Picking "On this computer" again, or pressing Stop, ends it at once. Firefox has no such service, so there the choice is switched off too.
- What was heard stays in the page's memory as text, and is gone when the tab closes. While an agent is connected, the page hands it the text heard since the last cue, at a pause or when asked (see [the cues](docs/wayfinder/producer/cues.md)); it goes through this site's relay to the host's own agent and is not kept on the way.
- The browser keeps the speech model (Moonshine base and its engine, about 81 MB) in this site's storage, so it downloads once from this site; the engine's small scripts (about 0.7 MB) load like any page script. Clearing the site's data in the browser removes it. Nothing else is stored in the browser.
- The show plan (show name, guest, questions, run order) stays in the page's memory only. It is never stored; it goes only to the host's connected agent when the agent asks for it (and the guest's name and the current part with each cue). It is gone when the tab closes.
- The guest step ("Guest agreed") is the host's own click. With "No" or "Solo show" only the microphone is listened to and the sign says "host mic"; with a shared tab it says "host mic + guest tab".

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
- A part of the run order is its planned minutes, then its name: `10 Intro` (also `10 min Intro` or `10m Intro`). A line that starts with minutes is a part, even when it ends with a question mark (`10 Any questions?`). A plan needs at least one part.
- A question is numbered (`1.` or `1)`) or is any other line ending with a question mark. Number a question that starts with a number (`1. 3 things you'd change?`), or it reads as a part. A line starting with `-` or `*` counts the same without it.
- The button shows what it read ("12 questions · 5 parts ✓"), or the first line it cannot read ("Line 4 not clear", with the rule in its tooltip).

On the producer screen, Start starts the show clock with the first part. Next part ends the current part at that moment (its real time is kept) and starts the next; on the last part it ends the plan. The current part shows its time left (or how far over); the clock shows how far ahead (green, minus) or behind (orange, plus) the plan is: done parts against their minutes, plus the time the current part runs over; after the last part, every minute the show goes on counts as behind. Once the clock runs, the plan is fixed: back in setup the box reads but takes no edits. A narrow window shows only the current and the next part, with All for the rest.

## A temporary link for testing

Nothing is deployed yet, and the microphone and screen capture only work on https. To try the page with another person before there is a preview, one command makes a temporary https link:

```
npm run qa:tunnel
```

(or `scripts/qa-tunnel.sh`). It runs the Worker on your own computer, in wrangler's local mode, and puts a free Cloudflare quick tunnel in front of it. There is no Cloudflare account, no login, no deploy and nothing is uploaded. It serves the latest `origin/dev` in a temporary copy, checks the link through the tunnel (the page loads, `/mcp` answers 401 with no token, and a call from an agent goes through the relay to a stand-in page and back), then prints one line:

```
Link for the test: https://<three or four words>.trycloudflare.com
```

Send that link to the other person. It works until you press Ctrl+C or the time limit (8 hours, the life of an agent connection) passes; then both programs stop and the temporary copy is removed, and the link no longer works.

- Anyone who has the link can open the page while it runs. The page stores nothing. The address is random and the page asks search engines to stay away (`X-Robots-Tag: noindex`; the tunnel adds its own robots.txt lines).
- Other sources: `scripts/qa-tunnel.sh <branch, tag or commit>` serves that instead of `dev` (for a branch name, its copy on GitHub when there is one, else the local one; a tag or commit as it is, fetched from GitHub if this computer lacks it); `--here` serves this checkout as it is, with changes not yet committed (wrangler's build leaves a preview build in the ignored `dist/` folder there); `--hours N` and `--port N` change the limit and the local port.
- It refuses to start if the folder it would serve holds a secret file (`.env*`, `*.key`, `*.pem`, `.dev.vars*`), also one that git ignores, because wrangler reads those.
- Needs `cloudflared` (one file from Cloudflare, no account), `curl` and Node 24.2 or newer. The first run also downloads the speech model into the build cache; later runs start in a few seconds.
- The self-check is `scripts/qa-tunnel-check.mjs`. The tests (`test/qa-tunnel.test.mjs`, `test/qa-tunnel-check.test.mjs`) use stand-ins for wrangler and cloudflared.

## How it is built

- One Cloudflare Worker (`src/worker.mjs`) serves one static page and the agent relay: `src/mcp.mjs` (the MCP tools), `src/relay.mjs` (one Durable Object per hashed token, a short note only), `src/token.mjs` (eight-hour tokens, own prefix and salt) and `src/limiter.mjs` (60 a minute, 10 per 10 seconds, in memory). `node scripts/build.mjs` writes it to `dist/`: a single `index.html` with the styles and script inlined, a `_headers` file (page policy) and `robots.txt`. The page asks for no outside file.
- The policy allows the microphone and screen capture for this site only, calls to this site only, a worker of this site only, and nothing else from outside. Observability is off; there is no KV, D1, R2 or any other store. The only Durable Objects are the relay (a short note per token, erased by an alarm) and the request limit (memory only).
- `wrangler.jsonc` describes two Workers: `producer` (planned address `producer.techies.tools`) and `producer-preview` (planned address `preview-producer.techies.tools`). Nothing is deployed yet. `.github/workflows/deploy-preview.yml` puts a build of `dev` on the preview Worker, and only runs once the Cloudflare secrets exist.
- Theme tokens: `src/theme.css`. Page shell and setup screen: `src/page.html`, `src/app.css`, `src/app.js`. The shared tooltip: `src/ui/tooltip.mjs`. Browser detection (what this browser can do, with the reason for each switched-off feature): `src/browser.mjs`. The browser's own speech service, the opt-in second way to turn speech into text (it sends the sound to the browser maker, see Privacy; offered on computers only): `src/web-speech.mjs`. The agent connection on the page: `src/agent-ways.mjs` (each agent's ways, notes and the MCP line), `src/agent-message.mjs` (the message the host pastes) and `src/agent-link.mjs` (the token, the relay socket, the answers to the agent and Test). The page calls only this site: `/api/agent-token` and `/api/relay`; it stores nothing, so a reload starts the connection over. What the guest step, the open button and the listening sign say: `src/listen.mjs`. The show plan's format and the run order's clock: `src/runorder.mjs`. The cue rules (when the agent is asked, and what it gets): `src/cues.mjs`, which never names how the agent is reached; `src/agent-link.mjs` is the agent's part (the relay, the cues it has not confirmed yet, the latest answer, whether the newest cue still waits for the agent's turn). The Next question card's rules (which question shows, what Suggest now and the thinking light say): `src/questions.mjs`.
- Speech to text: the page hands the microphone's sound to a worker of this site (`src/speech/worker.mjs`, served as `/speech/worker.mjs` with its own policy: scripts and files of this site only). It cuts the sound at pauses (`segmenter.mjs`: pieces end after 0.6 s of silence, drafts about every second, a pause at about 1.5 s), resamples it to 16 kHz (`resample.mjs`), runs Moonshine base on the processor and stops a looping phrase (`repeat.mjs`). The model and its engine are pinned by size and SHA-256 in `scripts/speech-files.mjs`; `node scripts/build.mjs` fetches them once into a cache outside the repo (`~/.cache/producer-speech`, or `PRODUCER_SPEECH_CACHE`) and copies them into `dist/speech/`. A Worker static asset is at most 25 MiB, so the 42 MB decoder is served in two parts that the worker joins and checks. With the opt-in browser service picked, the model is not used: the page asks the browser's own speech service to use the host's microphone track (`src/web-speech.mjs`; whether stable Chrome and Edge honour that is still unverified, and a browser that ignores it opens its own microphone), its text goes through the same lines, cues and pauses, and the browser sends that sound to its maker (see Privacy).
- The temporary test link (not part of any deploy, run by hand): `scripts/qa-tunnel.sh` (started by `npm run qa:tunnel`) and its self-check `scripts/qa-tunnel-check.mjs`; their tests run in `scripts/agents/kit unit`, with stand-ins for wrangler, cloudflared and the Worker. See "A temporary link for testing".
- Checks: `scripts/agents/kit unit` (all of `test/*.test.mjs`; `test/speed.test.mjs` times the page's own share of a cue with a stand-in agent), `scripts/agents/kit specs` (the page in a real browser, desktop and phone, light and dark, and in Firefox; the cues suite hands the page lines and a pause and plays the agent; the questions suite plays the agent's answers on the Next question card; the speech suite plays a recorded two-person clip, `test/fixtures/two-voices.wav`, as the microphone and checks the delay, the word errors, Stop and what is stored; the service suite puts a stand-in for the browser's speech service in place and checks the opt-in, the sign, Stop, failures and that nothing is requested or stored) and `scripts/agents/kit size`.

Licence: MIT, see [LICENSE](LICENSE).
