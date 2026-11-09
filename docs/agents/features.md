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
- Good: As the mock-up: one panel of numbered steps, step 1 green as done, one choice filled at a time; wide puts the label beside the choices, a phone puts them under it; no explainer text. A switched-off choice is greyed with a round "i" and shows its reason on hover, focus or a press.
- Files: `src/page.html`, `src/app.css`, `src/app.js`, `src/browser.mjs`, `src/ui/tooltip.mjs`
- Phone: yes
- Spec: `test/browser/page.mjs`
- Steps: none yet (no kit shots command)
