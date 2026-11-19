# Feature list

Every producer feature a user can notice, in plain words: how to try it and what good looks like. `kit ux` reads
this file: it picks the entries whose Files a change touches and has a reviewer judge them against the kit's house
style and the approved Producer mock-up. Only what is built is listed; a feature joins when its card lands.

Screenshots come from `kit specs` (`test/browser/page.mjs`, desktop and phone, light and dark, plus Firefox). This
repo has no `kit shots` command yet, so no entry has a scripted try (Steps).

Each entry:

```
### F-<area>-<nn> <feature name>
- Try: <steps a user takes, in plain words>
- Good: <what a user should see and feel>
- Files: <globs of the source files that make it>
- Phone: yes | no
- Spec: <path of the browser spec that pins it, or "none">
- Steps: <path of the scripted try, or "none yet (<why>)">
```

## Shell

### F-shell-01 Top bar with the Private chip
- Try: Open the page; hover, tap or Tab to the Private chip.
- Good: The name and the Private chip sit in one bar; the chip's tooltip says only you see this window. On a phone the chip keeps its icon and the words move to the tooltip.
- Files: `src/page.html`, `src/app.css`, `src/theme.css`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

## Setup

### F-setup-01 First-run setup: browser chip and "I stream with"
- Try: Open the page; read the browser chip beside "Set up"; pick Restream Studio, Wave.video, OBS or Other by mouse, tap and keyboard.
- Good: As the mock-up: one panel of numbered steps, "I stream with" green as done, one choice filled at a time; wide puts the label beside the choices, a phone puts them under it; no explainer text.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/browser.mjs`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

### F-setup-02 "AI agent": connect Claude Code with the paste message
- Try: In the AI agent step press Copy connect message, paste the message into Claude Code; watch the button; press Test; press the connected button to disconnect.
- Good: As the mock-up: Claude Code picked, its Copy connect message carries a small "slower" label and Connect with MCP beside it a small "recommended" label; the button reads Waiting for Claude Code (breathing dot), then Claude Code connected (green) with Test beside it; Test reads Testing, then "Test ✓ · 4.2 s" with the sample answer in its tooltip, and the AI agent step turns green; a press on the connected button disconnects. No explainer text.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/agent-message.mjs`, `src/agent-link.mjs`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

### F-setup-12 Show type: a solo show first
- Try: Open the page; read step 1 "Show type"; pick With a guest, then Solo show again, by mouse, tap and keyboard; press Start on the producer screen and come back to the setup.
- Good: As the solo prototype (TOOLS-338): Solo show is picked on arrival and the step is green. A solo show has no Guest agreed step and no "Share the studio tab with sound" button, the plan step reads "Show, points & plan" and its button counts points ("3 points · 2 parts ✓"), the top bar says "· <show> · solo", and the steps number in order. With a guest brings the guest step and the tab button back (numbered again) and the list reads as questions. Once the show clock runs the other choice is switched off with the round "i" and its reason. No explainer text.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/runorder.mjs`, `src/agent-load.mjs`, `src/showplan.mjs`, `src/listen.mjs`
- Phone: yes
- Spec: `test/browser/solo.mjs`, `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

### F-setup-13 Viewer chat: Connect Restream chat through your own agent
- Try: Before any agent is connected, hover or tap Connect Restream chat; pick OBS; pick Restream Studio, connect Claude Code (the AI agent step, 3) and press Connect Restream chat; let the agent answer "waiting" (no stream live), then send messages; press the connected button; let the agent say it cannot read the chat.
- Good: Switched off with the round "i" and "Connect your agent first (step 3)." until an agent is connected, and "Viewer chat works with Restream streams only." with another stream (the step is then green: not needed). Ready, its tooltip says the agent reads the chat with its own Restream connection and nothing is stored. A press reads "Connecting chat…" (breathing dot); the agent's waiting line reads "Chat · waiting for your live stream" (the step turns green); messages make it "Restream chat connected ✓" in green; a press disconnects. A problem or no answer in 2 minutes reads "Chat not connected · try again" in orange with the reason in its tooltip. No toast, no explainer.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/chat.mjs`, `src/agent-link.mjs`, `src/mcp.mjs`, `src/agent-message.mjs`
- Phone: yes
- Spec: `test/browser/solo.mjs`, `test/chat.test.mjs`
- Steps: none yet (no kit shots command)

### F-setup-03 Guest agreed
- Try: Pick With a guest at Show type; pick Yes or No · my mic only by mouse, tap and keyboard; hover the step's label and the answers.
- Good: Shown only for a show with a guest. Nothing is picked on arrival; one answer at a time; the step turns green once answered. Only the host picks it. "Open producer screen" stays switched off until it is answered, its tooltip saying so.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`, `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)

### F-setup-04 Microphone with a level meter
- Try: Press Microphone (allow it when the browser asks); speak; press it again to turn it off.
- Good: The button turns green and a small meter beside it moves with your voice; turned off, the meter goes. A blocked or missing microphone says so on the button, with the way out in its tooltip. A browser without a microphone shows the button switched off with its reason.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`
- Phone: yes
- Spec: `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)

### F-setup-05 Load the speech model
- Try: Press "Load speech model · 82 MB"; reload the page and press it again.
- Good: The button counts up "Loading N%" and then says "Speech ready" in green; the second time the model loads without downloading. A failure says so on the button, with the reason in its tooltip.
- Files: `src/page.html`, `src/app.js`, `src/speech/*.mjs`, `scripts/speech-files.mjs`, `scripts/build.mjs`
- Phone: yes
- Spec: `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)

### F-setup-06 "AI agent": Codex, T3 Code and Connect with MCP
- Try: In the AI agent step hover, tap or Tab to Codex, T3 Code and API key and read their notes; pick Codex and read the notes on its buttons; with Claude Code or Codex picked press Connect with MCP and watch the button; press Test; hover or tap the connected button; try to pick another agent while connected, and while it only waits; press the connected button to disconnect. Pick T3 Code and press its switched-off Connect with MCP.
- Good: Claude Code carries no note; Codex's tooltip is "Codex blocks the network in safe mode: allow network or use the MCP line" and its Copy connect message carries a small "slower" label; Connect with MCP carries a small "recommended" label for Claude Code and for Codex; T3 Code carries the label "slower" on its chip (not repeated on its button) with a tooltip that says it cannot take a private MCP line, and its Connect with MCP is switched off with that reason; the API key stays off ("Comes later"). Connect with MCP looks like the message button (waiting with the breathing dot, then connected in green, a press disconnects) and its tooltip says the entry stays in the agent's settings until the host removes it, with the command. While an agent is connected the other agents are switched off with a reason and the way not used steps aside; while the page only waits, picking another agent or pressing the other way gives the wait up. No explainer text; every note is a tooltip.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/agent-ways.mjs`, `src/agent-message.mjs`, `src/agent-link.mjs`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

### F-setup-07 The plan step ("Show, points & plan", or questions with a guest): paste the plan by hand
- Try: Press Paste it myself; paste a plan (Show:, Guest:, parts like "10 Intro", numbered questions); then paste a line the page cannot read; press the button again.
- Good: The box opens under the button with the example's lines under it (the only words beyond the labels: no other explainer); the button reads "12 questions · 5 parts ✓" in green and the step turns green; the top bar names the show and the guest. A bad line reads "Line 4 not clear" on the button (orange, the rule in its tooltip) and the box gets an orange edge. No toast. The plan is never stored.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/runorder.mjs`, `src/showplan.mjs`
- Phone: yes
- Spec: `test/browser/runorder.mjs`
- Steps: none yet (no kit shots command)

### F-setup-10 The plan step's "Let my agent load it": the agent loads the show
- Try: Connect an agent in the AI agent step; in the plan step press Let my agent load it and give the agent an outline in its chat; watch the button, the top bar and the plan box; press Paste it myself and change a line; try the button before any agent is connected.
- Good: As the mock-up: the button is switched off with the round "i" and its reason ("Connect your agent first (step 3).") until an agent is connected, then orange and ready (the tooltip says the agent sends the show name, guest, questions and run order and that the host can still change them). A press makes it read "Agent is loading…" with the breathing dot; when the agent's load_show lands it reads "Questions loaded by your agent · 12 questions · 5 parts ✓" in green, as the approved questions prototype (TOOLS-343), with "Your agent loads the show by itself when it connects. Press to load it again." in its tooltip, and "Paste it myself" stays a small quiet button with its box closed; the top bar names the show and the guest, and the plan box holds the show in the host's own format, so the host can still change it (the button then goes back to ready and Paste it myself counts the plan again). A show the agent sends as its prompter script (TOOLS-345) lands with every question, joined over its short lines into one sentence ending in "?", under its part in the plan box, so the search groups the matches by part. With no answer in 90 seconds it reads "Not loaded · try again" in orange with the reason, and a press tries again. The agent can never tick Guest agreed or start the microphone or tab sharing: those stay the host's own clicks; a too big (over 200 KB) or unclear plan is refused with a plain reason and the page stays as it was; a plan the host typed is not overwritten unless the host pressed the button. No toast, no explainer text; nothing is stored.
- Files: `src/page.html`, `src/app.js`, `src/agent-load.mjs`, `src/script-reader.mjs`, `src/showplan.mjs`, `src/agent-link.mjs`, `src/agent-message.mjs`, `src/agent-ways.mjs`, `src/mcp.mjs`
- Phone: yes
- Spec: `test/browser/load.mjs`
- Steps: none yet (no kit shots command)

### F-setup-11 The plan step's "Load demo show": a made-up show to try the whole screen
- Try: In the plan step press Load demo show; look at the plan box, the plan button and the top bar; change a line in the box; press Load demo show again; then fill the other steps, open the producer screen, press Start, Asked, Skip and Next part, and press End & report.
- Good: One click fills the plan box with a short made-up show ("Demo – A small app's first year", the guest "Demo Guest", 8 questions, 3 parts of 3, 8 and 4 minutes, and notes the agent gets with get_context), in the host's own format. The button reads "Demo loaded ✓" in green; the plan button reads "8 questions · 3 parts ✓" and the top bar names the demo show and its guest, so it is marked as a demo. It needs no agent and sends and stores nothing. Over a plan of the host's own (or the agent's) the first press only asks, on the button ("Replace your plan? · press again", in the warning look, for 8 seconds); the second press replaces it. The host can still edit the box: the button then goes back to "Load demo show" (a small edit keeps the notes, another show takes them away). It is switched off with its reason once the show clock runs. The Next question card, the run order and the end report fill from it like from any plan. No toast, no explainer text. The demo names nobody real (the repository is public).
- Files: `src/page.html`, `src/app.js`, `src/demo.mjs`, `src/showplan.mjs`
- Phone: yes
- Spec: `test/browser/demo.mjs`, `test/demo.test.mjs`
- Steps: none yet (no kit shots command)

### F-setup-08 Tab sound: hear the guest through the studio's tab
- Try: In Chrome or Edge on a computer, pick Yes at Guest agreed, turn on the Microphone, then press "Share the studio tab with sound", pick the studio's browser tab and tick "Also share tab audio". Press the button again to stop sharing. Pick No or Solo show while it is shared. Open the page in Firefox, Safari or a phone browser and hover or tap the button. Share a window instead of a tab, or leave out the sound.
- Good: A second button beside Microphone, with its own small level meter that moves with the tab's sound and not the microphone's. Once shared it turns green and reads "Restream Studio tab" (or "Wave.video tab", else "Studio tab"). Its tooltip asks the host to wear headphones. A browser that cannot do it (Firefox, Safari, a phone) shows it switched off with the round "i" and the plain reason; so do OBS (it has no studio tab), No and Solo show, which also stop a share that is already running. A closed picker, a tab without sound or a window says so on the button itself ("Tab not shared", "No tab sound", "Share a browser tab", each "· try again"), with the way out in the tooltip. The Sound step turns green only when the microphone is on and the tab is shared or switched off, and "Open producer screen" waits for it ("Share the studio tab with sound first."). The page never plays the tab's sound.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`, `src/browser.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`, `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)

### F-setup-09 Speech to text: the browser's own speech service as a warned option
- Try: In the speech to text step read the two choices; pick "Browser service · audio goes to Google" and read its tooltip, and the tab-sound button's; pick "On this computer" again; open the page in Firefox.
- Good: The model on this computer is picked on arrival. The browser service is the second choice and carries its one warning line on itself ("audio goes to Google"; Microsoft in Edge, Apple in Safari); picking it is the opt-in, the model's load button steps aside, the step turns green and the tab-sound button is switched off with its reason (the service hears only the microphone). Picking "On this computer" brings the button back. In a browser without the service (Firefox), and on a phone or tablet (it is offered on computers only), the choice is greyed with the round "i" and says why. No toast, no explainer text.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`, `src/web-speech.mjs`, `src/browser.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`, `test/browser/service.mjs`
- Steps: none yet (no kit shots command)

## Live

### F-live-01 The listening sign, Stop and Listen
- Try: With every step done, press "Open producer screen"; then Stop, then Listen.
- Good: The setup makes way for the producer screen (a frame; its panels come later). The top bar shows a breathing red dot and what is heard: "Listening · host mic + guest tab" while the studio tab is shared, "Listening · host mic" otherwise (on a phone only the source words), the guest's answer ("Guest ✓", "Guest: no", none on a solo show) and Stop. Stop ends the microphone and the shared tab at once and the sign reads "Not listening" with an orange Listen; Listen starts the microphone again and asks the browser for the tab again (the browser never remembers a share). A Listen that fails says so on itself ("Microphone blocked · Listen"). A microphone that ends by itself stops the sign; a tab that ends by itself leaves "host mic" in the sign while listening goes on; a model that fails brings back the setup with its reason. The host's words and the guest's are kept apart and labelled host and guest, never mixed. The page never plays a sound. With the browser's speech service the sign reads "Listening · host mic · browser service" (never "guest tab") and its tooltip says the voice goes to Google; a service that fails brings back the setup with its reason on its choice.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`, `src/web-speech.mjs`, `src/speech/lanes.mjs`, `src/speech/worker.mjs`
- Phone: yes
- Spec: `test/browser/speech.mjs`, `test/browser/service.mjs`
- Steps: none yet (no kit shots command)

### F-live-02 The run order and the show clock
- Try: With a plan pasted, open the producer screen; press Start; let a part run over; press Next part a few times; on a phone press All.
- Good: As the mock-up: a Run order panel (right column wide, full width on a phone) and a clock in the top bar. Before Start the clock reads 0:00 and Start is orange. After Start the current part is tinted with its time left and a bar ("0:20 over" in orange when over); done parts show their real time against the plan (+1:40 orange, −0:20 green); the clock shows how far ahead (green, minus) or behind (orange, plus) the plan the show is. A double click on Start does not skip a part. After the last part Next part goes and the clock goes on. A phone shows now and next, with All for the rest.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/runorder.mjs`, `src/showphase.mjs`
- Phone: yes
- Spec: `test/browser/runorder.mjs`
- Steps: none yet (no kit shots command)

### F-live-05 Solo show: Your next point, the viewer chat and the agent's pick
- Try: On a solo show with a plan and the chat connected, open the producer screen; let the agent send chat (hellos, questions, one with a pick); press Use on the card's pick, then Back to your point; press Use in the chat, then Answered; press Skip on another question; switch Questions only on and off; press Said and Skip on the card; search for a point, press Enter to pick it, then double-click Said; on a phone scroll to the chat.
- Good: As the solo prototype (TOOLS-338): the card reads "Your next point" with the point large, "Next in your plan.", the chip "Point 1 of 3 · your plan", Said and Skip, and the next two points to swap in; no Suggest now or thinking light. A double-click on Said finishes only the point shown when the gesture began; the next unspoken point stays on the card and the report counts only one point said. The viewer chat sits under the run order (under the card on a phone): each message with who, where and the show time; plain chat quiet, a question bold with Use, Answered and Skip; "N open" counts the questions waiting; Questions only hides the rest. The agent's pick waits on top of the rows under the card with a small orange Use and "AI pick: <why> · <viewer>"; it never takes the card by itself. Use puts the viewer question on the card ("Viewer question", the viewer and the time it was asked, "From the chat", Answered and Skip, and "Back to your point" below); in the chat its Use reads "On card". Answered reads "Answered ✓ · 1:05" on the chat's button, Skip "Skipped"; each press again reopens it. A viewer's words never become markup. Under the list the panel keeps its own chat button, the setup button's twin, because the setup is out of sight during the show: "Connect Restream chat", "Connecting chat…", "Chat · waiting for your live stream", "Restream chat connected ✓" (a press disconnects without ending the show) or "Chat not connected · try again" with the reason; with no agent connected the button is switched off with the round "i" and "Your agent is not connected. The chat comes through your agent." (with OBS the line reads "Restream streams only"). Nothing on the producer screen points to the setup, which is out of sight there. Questions only with no question yet says "No questions yet". A screen reader hears new viewer questions in one short polite line ("2 new viewer questions · 3 open"), at most one every 10 seconds; nothing visible changes. A press in a long chat (2,000 questions) changes only its own row. No toast, no sound, no explainer; nothing is stored.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/chat.mjs`, `src/questions.mjs`, `src/mcp.mjs`
- Phone: yes
- Spec: `test/browser/solo.mjs`
- Steps: none yet (no kit shots command)

### F-live-04 End & report and Save report
- Try: With a plan pasted and Claude Code connected, open the producer screen, press Start, talk a little, press Asked and Skip once each, then press End & report in the top bar ("End" on a phone). Wait for the agent's report; press Copy, then Save report. Open What was heard. Try again with no agent connected, once where the agent never answers (two minutes), and once where the agent stays connected but its loop has gone quiet for a minute (the agent button reads "Waiting for Claude Code…").
- Good: As the mock-up's screen 4: listening stops at once (the browser's microphone and sharing lights go out) and the End report shows at once with the show, guest and date; four numbers (show time with how far over or under the plan, list questions asked, new questions from the agent asked, viewer questions "—" with "no viewer chat yet", or the number answered once the chat was connected); Clip moments with their show time; Run order plan against real (−0:20 green, +1:40 orange, "not reached"); Topics covered; Questions not asked ("skipped" or "no time"); What was heard (folded, each line with its show time and who said it). While the agent works, Clip moments and Topics read "Waiting for Claude Code…" with a breathing dot; its report fills them in. A connected agent whose loop went quiet is waited for the same way (it hears End when its loop comes back); only with no agent connected do they read "No agent was connected when the show ended." With no agent, or after two minutes, they are switched off with the round "i" and the reason; a late report still fills them. Copy reads "Copied ✓" for a moment; Save report asks where to save (Chrome, Edge) or downloads producer-report-DATE.md, then reads "Saved ✓ · producer-report-DATE.md"; the file holds exactly what the screen shows. Nothing of the show is left in the browser after the tab closes; no toast, no explainer.
- Solo show (TOOLS-336, the solo prototype's screen 3): the chip reads "<show> · solo · <date>"; the four numbers are show time, "1 of 3 points said", viewer questions answered, and viewer questions not answered with how many were skipped; then Viewer questions answered (the time it was answered, the question with the viewer under it, "answered" in green), Viewer questions not answered (the time it came, "skipped" or "no time"), Run order · plan vs real and Points not said ("Point 2", "no time" or "skipped"), and What was heard (folded). No clip moments or topics on a solo report. The saved file holds the same. After End the chat stops: the agent hears the chat is off.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/report.mjs`, `src/cues.mjs`, `src/questions.mjs`, `src/agent-link.mjs`, `src/mcp.mjs`, `src/showphase.mjs`, `src/chat.mjs`
- Phone: yes
- Spec: `test/browser/report.mjs`, `test/browser/solo.mjs`
- Steps: none yet (no kit shots command)

### F-live-03 The Next question card: Suggest now, Slow down and the thinking light
- Try: With a plan pasted and Claude Code connected, open the producer screen and talk for a while; press Suggest now and wait for the answer; press it again at once; switch Slow down on; press an alternative under the question; press Asked, then Skip (also with Tab and Enter); disconnect the agent (or open the producer screen with no agent). With the agent also connected to the Prompter, tap Use on the question in the Prompter's strip.
- Good: As the mock-up: the card is the wide left column (on top on a phone). From the start it shows the first prepared question ("Next on your list.", chip "Q1 · your list") with the next two to swap in; it is never empty while the plan has a question left. Suggest now reads "Thinking…" while the agent works and the small light in the card's corner breathes orange, quietly, without moving the card; the card keeps its question until the answer is in. The answer takes the card once: the question large, a few words why, its source chip ("Q3 · your list" or "New"); its other prepared questions go to the Relevant now list (F-live-08), a new question it adds waits below to swap in. After a cue Suggest now shows the seconds to wait ("Suggest now · 7 s", 20 s with Slow down). The turn chip counts the cues sent to the agent. With no agent, Suggest now reads "Suggest now · no agent" (switched off with the round "i"), the light is grey and the list question stays; with the agent in another tab it reads "Suggest now · other tab". Once every prepared question is done the card reads "No questions left". No toast, no sound, no explainer text; nothing is stored. With the agent also connected to the Prompter, a question the host taps Use on in the Prompter's strip counts as Asked here within a turn or two of the agent: the card moves on as with the Asked button (TOOLS-347). Not on a solo show: its plan moves on only with Said and Skip.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/questions.mjs`, `src/cues.mjs`, `src/agent-link.mjs`
- Phone: yes
- Spec: `test/browser/questions.mjs`
- Steps: none yet (no kit shots command)

### F-live-07 Setup from the producer screen: the show keeps running
- Try: Open the producer screen, press Start, then press Setup in the top bar (a phone shows its arrow only); change something in the setup; watch the clock; press Back to producer screen; press Setup again and press End & report there.
- Good: As the approved prototype (TOOLS-343, with TOOLS-348): a quiet Setup button with a back arrow sits first in the producer screen's top bar; its tooltip says "Back to setup. The clock and the listening keep running." A press shows the setup with the top bar still there: the clock keeps counting, the listening sign stays on (Stop and End & report work), the Setup button goes and the keyboard lands on the setup's title. While the show runs the other speech choice is switched off with the round "i" and "The show is running, so speech to text stays as it is.", and the Sound step's Microphone with "The show is running: use Stop or Listen in the top bar." (the studio tab stays the host's to share, for a guest who says yes during the show). The setup's main button reads "Back to producer screen" and brings the producer screen back as it was, the keyboard on Setup; it needs no microphone or model (the top bar's Listen does that), only the guest's answer when the show type changed to With a guest before Start ("Answer Guest agreed first."). Before the show opens it reads "Open producer screen". On a phone Setup keeps a 44 px tap target and End stays on the second row of the top bar. No toast, no explainer.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/showphase.mjs`
- Phone: yes
- Spec: `test/browser/back.mjs`, `test/showphase.test.mjs`
- Steps: none yet (no kit shots command)

### F-live-06 Search all questions: one box over the whole list
- Try: With a plan of many questions (each part's questions under its part line), open the producer screen; type a word such as "cookie" in the box under Asked and Skip; click (tap) a match; type again and press Enter; press Asked (or Said), then Skip; type a word with no match; press Escape and the clear button; press Start and search again. Try a plan that lists every part first and the questions after them, and a solo show.
- Good: As the approved prototype (TOOLS-343): the box reads "Search all 72 questions" ("points" on a solo show). A word shows the matches at once, under a second, in place of the rows to swap in: "Matches for “cookie”" with "4 of 72" beside it, grouped under "Part 2 · <name>" headings in show order, the typed words marked. A click puts a match on the card ("Picked by you. Stays here until Asked or Skip.", its row reads "On card" on a light orange row); the agent's answer then waits below and does not take the card. The question already on the card can be picked the same way, to keep it there. Enter takes the first match. A screen reader hears the count ("4 matches") once typing stops. On a phone the clear button is a full 44 px tap target. Asked, Said and Skip clear the search and the rows to swap in come back; a question already asked reads "Asked ✓" (skipped: "Skipped") in a later search and a click opens it again. No match reads "No question with “zebra”.". Escape and the clear button empty the box. Once the clock runs, the part on now carries an "on now" chip. A plan that lists every part first says no part, so its matches show without headings. No AI, nothing sent, nothing stored; no toast, no explainer.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/find.mjs`, `src/questions.mjs`, `src/runorder.mjs`
- Phone: yes
- Spec: `test/browser/search.mjs`, `test/find.test.mjs`
- Steps: none yet (no kit shots command)

### F-live-08 Relevant now: the agent's best matches at each pause
- Try: With a plan of many questions (each part's questions under its part line) and Claude Code connected, open the producer screen and talk until a pause (or press Suggest now); wait for the answer; click (tap) a question in the Relevant now list; talk to the next pause; press Asked, then Skip; type a word in the search box, then clear it; press Start and talk to a pause.
- Good: As the approved prototype (TOOLS-343): before the agent's first answer the two questions to swap in show as before. At each answer, within the cue speed target after the pause (about 4 to 5 s with Connect with MCP), the agent's best match takes the card (with its few words why) and its other matches show under the search box as "Relevant now" with their count, up to five, grouped under "Part 2 · <name>" headings in the order of their best match, a new row fading in. A click puts a match on the card ("Picked by you. Stays here until Asked or Skip."); later answers then change only the list. Asked and Skip move to the best match still open (else the next on the list); an asked or skipped question never shows in the list, and the next cue tells the agent which ones are done. With none left (or an answer naming only questions already done) it reads "No other matches right now.", and a screen reader hears each changed list ("3 relevant questions"), and again when the list comes back after a search. While the search box holds words the list gives way to the matches; clearing brings it back. Once the clock runs, the part on now carries an "on now" chip. On a phone each row is a 44 px tap target. No toast, no explainer; nothing is stored.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/questions.mjs`, `src/mcp.mjs`, `src/agent-message.mjs`
- Phone: yes
- Spec: `test/browser/relevant.mjs`, `test/questions.test.mjs`, `test/replay.test.mjs`
- Steps: none yet (no kit shots command)
