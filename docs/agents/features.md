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
- Try: In step 2 press Copy connect message, paste the message into Claude Code; watch the button; press Test; press the connected button to disconnect. Hover or tap Codex and T3 Code.
- Good: As the mock-up: Claude Code picked, Codex and T3 Code switched off with a reason; the button reads Waiting for Claude Code (breathing dot), then Claude Code connected (green) with Test beside it; Test reads Testing, then "Test ✓ · 4.2 s" with the sample answer in its tooltip, and step 2 turns green; a press on the connected button disconnects. No explainer text.
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
- Good: The button counts up "Loading N%" and then says "Speech ready" in green; the second time it loads without downloading. A failure says so on the button, with the reason in its tooltip.
- Files: `src/page.html`, `src/app.js`, `src/speech/*.mjs`, `scripts/speech-files.mjs`, `scripts/build.mjs`
- Phone: yes
- Spec: `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)

## Live

### F-live-01 The listening sign, Stop and Listen
- Try: With every step done, press "Open producer screen"; then Stop, then Listen.
- Good: The setup makes way for the producer screen (a frame; its panels come later). The top bar shows a breathing red dot, "Listening · mic only" (on a phone "mic only"), the guest's answer ("Guest ✓", "Guest: no", none on a solo show) and Stop. Stop ends the microphone at once and the sign reads "Not listening" with an orange Listen; a Listen that fails says so on itself ("Microphone blocked · Listen"). A microphone that ends by itself stops the sign; a model that fails brings back the setup with its reason. The page never plays a sound.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/listen.mjs`
- Phone: yes
- Spec: `test/browser/speech.mjs`
- Steps: none yet (no kit shots command)
