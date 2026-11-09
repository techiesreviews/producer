# Map: live producer (producer.techies.tools)

Charted 2026-11-09 with Lex. Cards live on the Orbit board, project TOOLS, under [TOOLS-148](https://board.techies.review/tasks/01a1c01c-2968-71bb-9893-682b4495335a?workspace=01a1b0d3-5786-7701-98e9-ddb7285afe5a): "Plan the live producer tool (producer.techies.tools)". Inspiration: Matt Medeiros' "Sensei" live producer (video bnfctA_YK38, 1:00:00).

## Destination

A plan the fleet can build: a public tool at producer.techies.tools that gives a host a private producer screen during a live stream or podcast. It runs in the browser on a Cloudflare Worker, like the Prompter, and each user brings their own setup. The map is done when every card below is closed and version 1 build cards exist.

## Notes

- First users: Lex on a solo Restream stream (the trial), then a first guest stream on Wave.video (date not confirmed). The guest must agree before their voice is used.
- This map is the plan; build cards come out of the screen design card and go to the fleet.
- Build status (2026-11-09): on `dev` (not deployed), the first-run setup screen with step 1 "I stream with" and the browser it detects (TOOLS-162), the Worker's agent relay (card 06), and step 2 "AI agent" with the paste message, the Test warm-up and Disconnect (card 08, TOOLS-168), the ways per agent (Connect with MCP for Claude Code and Codex, the Codex tooltip, T3 Code labelled slower; card 09, TOOLS-169, see `agent-ways.md`), and card 03 (TOOLS-163): the "Guest agreed" step, the microphone with a level meter, speech to text in the browser (Moonshine base on the processor, served from this site in parts under 25 MiB and kept in the browser), and the live screen frame with the listening sign, Stop and Listen; card 07 (TOOLS-167): setup step 3 "Show, questions & plan" with the plan pasted by hand (format in the repo README: `Show:`, `Guest:`, parts as `10 Intro`, numbered questions), kept in page memory only, and the run order with the show clock on the producer screen (Start, Next part, time left, ahead or behind plan; now and next with All on a narrow window); and card 05 (TOOLS-165): the Sound step's second source, "Share the studio tab with sound" (Chrome and Edge on a computer; Firefox, Safari and phones show it switched off with the reason), kept apart from the microphone so the speech worker runs one stream per source and every line is labelled host or guest, with a level meter for the tab and the sign naming what is heard ("host mic", "guest tab"). The real-world sign-off waits for Lex's tab-sound test on 2026-11-10 (TOOLS-149): the code is proven against a stand-in tab and Chromium's own picker, not against Wave.video or Restream Studio. Card 10 (TOOLS-170): the cues to the agent at pauses, with the speed measured (`cues.md`): Claude Code with Connect with MCP meets the target (4.0 s middle, 4.7 s slowest after the speech ends); Claude Code with the copied message misses it (7.0 s, 11.9 s).
- Same shape as the Prompter (`~/Projects/techies-prompter`): one Worker, static page, no accounts, nothing stored, an agent relay like Wait for MCP. The tool has its own repo: https://github.com/techiesreviews/producer (public, empty on 2026-11-09). Public means no keys, tokens or private notes in it; the Restream app secret lives only in Cloudflare.
- Lex speaks plain English, not technical: cards and docs say it in plain words. House style: `scripts/agents/kit --home`/docs/house-style.md.

## Decisions so far (Lex, 2026-11-09)

- Public tool, everyone brings their own setup; Lex is the first user.
- Private screen, never shown on stream.
- Version 1 jobs: next-question suggestions (from the prepared question list), a run-order timer, viewer chat questions (Restream streams only), an end report. The live fact-check is dropped.
- All browsers can open it. A feature a browser cannot do is switched off and shows a tooltip with the reason (for example no tab sound in Firefox and Safari).
- Speech to text: the free model inside the browser. Later test and improve it; the Prompter can reuse it.
- The AI connection: the host's own agent over MCP first (copying Wait for MCP). The paid API key comes later; version 1 is built so it can be added.
- Speed: as fast as possible, as live conversation needs. A card tunes it (delay budget in seconds per step).
- The guest's voice is heard through a shared browser tab with sound plus the microphone. Unproven until the sound test card runs.
- Restream chat: Lex registers a Restream developer app after the core works.
- Home: the repo above (Lex, 2026-11-09).
- Budget: a small paid API cap per stream, about 5 euros, when the API key mode comes.

## Cards

Frontier (can start now): TOOLS-149 sound test, TOOLS-150 speech-to-text test, TOOLS-151 agent connection, TOOLS-152 consent and privacy, TOOLS-153 Restream chat login.
Blocked: TOOLS-154 speed target (after 150, 151), TOOLS-155 screen and setup design (after 149, 150, 151).

## Research results (2026-11-09, files in `research/`)

- TOOLS-149 tab sound: Chrome and Edge on desktop can hear a shared tab plus the microphone; Firefox and Safari cannot. Real Wave.video and Restream tests wait for Lex (next step on the card).
- TOOLS-151 agent connection: copy the Prompter relay; the agent waits in one tool and answers with one-line suggestions. Expected delay 4 to 10 s (guess). Four choices wait for Lex.
- TOOLS-153 Restream chat: the Worker holds the app secret and has two endpoints; the page then reads the chat directly. Card closed; Lex registers the app later.
- TOOLS-150 speech to text: provisional pick Moonshine in the browser (runner-up Whisper base.en); only a smoke test; Lex runs the real test (`research/TOOLS-150-speech-to-text.md`).
- TOOLS-152 privacy rules and a draft message to the guest: written, not sent. Kept on the Orbit card, not in this public repo (it names a person and an unconfirmed date).

## Not yet specified

- The paid API key mode and its per-stream cap.
- A paid speech service as an option.
- Sharing the speech engine with the Prompter.
- Reading chat for streams not sent through Restream (for example YouTube directly).
- The end report format and clip list.
- How it deploys to producer.techies.tools: Lex has talked with the fleet about a CI/CD workflow (2026-11-09). The fleet owns that setup, in line with TOOLS-135 (GitHub checks, a fixed preview link, QA before live) and TOOLS-144 (deploy secrets). No card for it here until the fleet names theirs.

## Out of scope

- Live fact-checking (Lex dropped it from version 1, 2026-11-09).
- Anything shown on stream, or any automatic posting or moderation.
