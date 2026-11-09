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

### F-setup-01 First-run setup: browser chip and step 1 "I stream with"
- Try: Open the page; read the browser chip beside "Set up"; pick Restream Studio, Wave.video, OBS or Other by mouse, tap and keyboard.
- Good: As the mock-up: one panel of numbered steps, step 1 green as done, one choice filled at a time; wide puts the label beside the choices, a phone puts them under it; no explainer text.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/browser.mjs`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

### F-setup-02 Step 2 "AI agent": connect Claude Code with the paste message
- Try: In step 2 press Copy connect message, paste the message into Claude Code; watch the button; press Test; press the connected button to disconnect.
- Good: As the mock-up: Claude Code picked; the button reads Waiting for Claude Code (breathing dot), then Claude Code connected (green) with Test beside it; Test reads Testing, then "Test ✓ · 4.2 s" with the sample answer in its tooltip, and step 2 turns green; a press on the connected button disconnects. No explainer text.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/agent-message.mjs`, `src/agent-link.mjs`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

### F-setup-03 Guest agreed
- Try: Pick Yes, No · my mic only or Solo show by mouse, tap and keyboard; hover the step's label and the answers.
- Good: Nothing is picked on arrival; one answer at a time; the step turns green once answered. Only the host picks it. "Open producer screen" stays switched off until it is answered, its tooltip saying so.
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

### F-setup-06 Step 2 "AI agent": Codex, T3 Code and Connect with MCP
- Try: In step 2 hover, tap or Tab to Codex, T3 Code and API key and read their notes; pick Codex and read the notes on its buttons; with Claude Code or Codex picked press Connect with MCP and watch the button; press Test; hover or tap the connected button; try to pick another agent while connected, and while it only waits; press the connected button to disconnect. Pick T3 Code and press its switched-off Connect with MCP.
- Good: Claude Code carries no note; Codex's tooltip is "Codex blocks the network in safe mode: allow network or use the MCP line" and its Copy connect message carries a small "slower" label; T3 Code carries the label "slower" on its chip (not repeated on its button) with a tooltip that says it cannot take a private MCP line, and its Connect with MCP is switched off with that reason; the API key stays off ("Comes later"). Connect with MCP looks like the message button (waiting with the breathing dot, then connected in green, a press disconnects) and its tooltip says the entry stays in the agent's settings until the host removes it, with the command. While an agent is connected the other agents are switched off with a reason and the way not used steps aside; while the page only waits, picking another agent or pressing the other way gives the wait up. No explainer text; every note is a tooltip.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/agent-ways.mjs`, `src/agent-message.mjs`, `src/agent-link.mjs`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)

### F-setup-07 Step 3 "Show, questions & plan": paste the plan by hand
- Try: Press Paste it myself; paste a plan (Show:, Guest:, parts like "10 Intro", numbered questions); then paste a line the page cannot read; press the button again.
- Good: The box opens under the button with the example's lines under it (the only words beyond the labels: no other explainer); the button reads "12 questions · 5 parts ✓" in green and the step turns green; the top bar names the show and the guest. A bad line reads "Line 4 not clear" on the button (orange, the rule in its tooltip) and the box gets an orange edge. No toast. The plan is never stored.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/runorder.mjs`
- Phone: yes
- Spec: `test/browser/runorder.mjs`
- Steps: none yet (no kit shots command)

### F-setup-08 Tab sound: hear the guest through the studio's tab
- Try: In Chrome or Edge on a computer, pick Yes at Guest agreed, turn on the Microphone, then press "Share the studio tab with sound", pick the studio's browser tab and tick "Also share tab audio". Press the button again to stop sharing. Pick No or Solo show while it is shared. Open the page in Firefox, Safari or a phone browser and hover or tap the button. Share a window instead of a tab, or leave out the sound.
- Good: A second button beside Microphone, with its own small level meter that moves with the tab's sound and not the microphone's. Once shared it turns green and reads "Restream Studio tab" (or "Wave.video tab", else "Studio tab"). Its tooltip asks the host to wear headphones. A browser that cannot do it (Firefox, Safari, a phone) shows it switched off with the round "i" and the plain reason; so do OBS (it has no studio tab), No and Solo show, which also stop a share that is already running. A closed picker, a tab without sound or a window says so on the button itself ("Tab not shared", "No tab sound", "Share a browser tab", each "· try again"), with the way out in the tooltip. The Sound step turns green only when the microphone is on and the tab is shared or switched off, and "Open producer screen" waits for it ("Share the studio tab with sound first."). The page never plays the tab's sound.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`, `src/browser.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`, `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)

## Live

### F-live-01 The listening sign, Stop and Listen
- Try: With every step done, press "Open producer screen"; then Stop, then Listen.
- Good: The setup makes way for the producer screen (a frame; its panels come later). The top bar shows a breathing red dot and what is heard: "Listening · host mic + guest tab" while the studio tab is shared, "Listening · host mic" otherwise (on a phone only the source words), the guest's answer ("Guest ✓", "Guest: no", none on a solo show) and Stop. Stop ends the microphone and the shared tab at once and the sign reads "Not listening" with an orange Listen; Listen starts the microphone again and asks the browser for the tab again (the browser never remembers a share). A Listen that fails says so on itself ("Microphone blocked · Listen"). A microphone that ends by itself stops the sign; a tab that ends by itself leaves "host mic" in the sign while listening goes on; a model that fails brings back the setup with its reason. The host's words and the guest's are kept apart and labelled host and guest, never mixed. The page never plays a sound.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`, `src/speech/lanes.mjs`, `src/speech/worker.mjs`
- Phone: yes
- Spec: `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)

### F-live-02 The run order and the show clock
- Try: With a plan pasted, open the producer screen; press Start; let a part run over; press Next part a few times; on a phone press All.
- Good: As the mock-up: a Run order panel (right column wide, full width on a phone) and a clock in the top bar. Before Start the clock reads 0:00 and Start is orange. After Start the current part is tinted with its time left and a bar ("0:20 over" in orange when over); done parts show their real time against the plan (+1:40 orange, −0:20 green); the clock shows how far ahead (green, minus) or behind (orange, plus) the plan the show is. A double click on Start does not skip a part. After the last part Next part goes and the clock goes on. A phone shows now and next, with All for the rest.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/runorder.mjs`
- Phone: yes
- Spec: `test/browser/runorder.mjs`
- Steps: none yet (no kit shots command)

### F-live-03 The Next question card: Suggest now, Slow down and the thinking light
- Try: With a plan pasted and Claude Code connected, open the producer screen and talk for a while; press Suggest now and wait for the answer; press it again at once; switch Slow down on; press an alternative under the question; press Asked, then Skip (also with Tab and Enter); disconnect the agent (or open the producer screen with no agent).
- Good: As the mock-up: the card is the wide left column (on top on a phone). From the start it shows the first prepared question ("Next on your list.", chip "Q1 · your list") with the next two to swap in; it is never empty while the plan has a question left. Suggest now reads "Thinking…" while the agent works and the small light in the card's corner breathes orange, quietly, without moving the card; the card keeps its question until the answer is in. The answer takes the card once: the question large, a few words why, its source chip ("Q3 · your list" or "New"), the agent's next suggestion and the old question below to swap in. After a cue Suggest now shows the seconds to wait ("Suggest now · 7 s", 20 s with Slow down). The turn chip counts the agent's turns. With no agent, Suggest now reads "Suggest now · no agent" (switched off with the round "i"), the light is grey and the list question stays. No toast, no sound, no explainer text; nothing is stored.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/questions.mjs`, `src/cues.mjs`, `src/agent-link.mjs`
- Phone: yes
- Spec: `test/browser/questions.mjs`
- Steps: none yet (no kit shots command)
