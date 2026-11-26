# TOOLS-149: can the producer page hear a guest through a shared tab?

Researched 2026-11-09 by a worker for the producer map (`../README.md`). Plain words first, details after. Anything I could not check is marked UNVERIFIED.

## (a) The answer

Yes in Chrome and Edge on a desktop computer, no in Firefox and Safari. A web page can ask the browser to share another tab and its sound; Chrome and Edge show a tick box "Also share tab audio", and if Lex ticks it, the page receives that tab's sound as a normal audio stream, next to the microphone. If the guest's voice plays in the Wave.video tab (or another guest's voice plays in the Restream Studio tab), the page can hear it. Firefox and Safari let a page share a screen or window but never hand over any sound, so there the page can hear only the microphone. Nobody can force the sound: the person must pick a browser tab and tick the box each time, and the browser may hand over no sound at all. Two things I could not prove from documents: whether the Wave.video and Restream Studio tabs play guest voices in a way the browser can capture (very likely, but only a real session shows it), and how well the browser keeps Lex's own mic clear of the guest's voice when speakers are used (headphones solve this). The test page in `TOOLS-149-tab-audio-test/` exists to prove both. I ran it in a scripted Chrome only, not against Wave.video or Restream (see section d and e).

Because the tab carries the guest and the microphone carries Lex, the tool should keep the two as separate streams. That gives a free "who is speaking" label and avoids needing to mix at all.

## (b) Browser by capability

Desktop only. "Both" means tab sound and microphone running together, each as its own stream.

| Browser (desktop) | Tab sound | Microphone | Both | Reason for the gap (tooltip wording) |
| --- | --- | --- | --- | --- |
| Chrome (version 74 and later) | Works. Lex must pick a browser tab and tick "Also share tab audio". | Works. | Works. | Gap, if any: "Tab sound only arrives if you share a browser tab and tick 'Also share tab audio'." |
| Edge (version 79 and later, same engine as Chrome) | Works, same steps as Chrome. | Works. | Works. | Same as Chrome. Edge-specific behaviour was not tested: UNVERIFIED beyond the compatibility table. |
| Firefox | Does not work. | Works. | Not possible. | "Firefox does not let web pages receive the sound of a shared tab, so the guest cannot be heard here. Use Chrome or Edge." |
| Safari (macOS) | Does not work. | Works. | Not possible. | "Safari does not give web pages any sound from a shared tab or screen, so the guest cannot be heard here. Use Chrome or Edge." |
| Any browser on a phone or tablet | Not offered by most phone browsers. | Works. | Not possible. | "Phone and tablet browsers generally cannot share a tab with sound. Use Chrome or Edge on a computer." (Chrome for Android: compatibility data says sharing is not available; Safari on iPhone and iPad: listed from version 27, with no audio support listed. Not tested.) |

What the sources say, per cell:

- Chrome and Edge: the compatibility data lists audio capture from version 74 (Chrome) and 79 (Edge). On Windows and ChromeOS the whole computer's sound can also be shared when a whole screen is picked. On macOS and Linux only a tab's sound can be shared. A `systemAudio: "exclude"` hint makes Chrome offer sound only for tabs and windows. Chrome 141 added a `windowAudio` hint, but it only supports "exclude" and "system" (not "window"), so a window share can carry the whole computer's sound, not just that window's. For our purpose: always ask the host to share a tab, not a window or screen.
- Firefox: the compatibility data lists audio capture in `getDisplayMedia` as not supported in any version. Mozilla's open bug 1541425 ("Implement audio capture for getDisplayMedia") is still open, unassigned, low priority; a Mozilla engineer wrote that tab sound should come first, which depends on a tab-sharing bug (1651145) that is also still open. So Firefox does not even offer to share a tab, in my reading of those bugs (that last point is inferred: UNVERIFIED by hand in a release Firefox). In a Playwright build of Firefox 155 the page loaded, `getDisplayMedia` existed, and `suppressLocalAudioPlayback` was not in the supported list.
- Safari: the compatibility data lists audio capture as not supported in any Safari version up to 27.3. A WebKit bug explains the historic reason: no system way to capture app or system sound. I could not run Safari (the WebKit build here would not start), so the table cell relies on documents only.
- The rule behind all of this is in the W3C draft: the browser "MAY" return only video even if audio is requested, "MUST" refuse audio-only requests, and "MUST NOT" share sound without the person's active consent. So the tool must always check that an audio track really arrived, and say so when it did not.

## (c) Echo and feedback advice

1. **Headphones for Lex are the one real fix.** If the guest's voice comes out of speakers, Lex's microphone hears it too. The tool would then hear the guest twice (once from the tab, once leaking into the mic) and label some of it as Lex. Restream's own help pages say the same for their Studio: headphones for everyone, or lower the speaker volume. Browser echo cancellation is a helper, not a cure; how well Chrome's echo cancellation removes sound that comes from another tab is UNVERIFIED.
2. **The producer page must never play any sound.** In the test page the tab and mic are connected only to level meters, never to the speakers. The real tool should do the same. A page that plays what it hears would create a loop with the microphone.
3. **Do not use "silence the tab on my speakers" (`suppressLocalAudioPlayback`).** It exists (Chrome and Edge 109 and later), and the W3C draft says the captured sound keeps flowing. But it would also stop Lex hearing the guest in the shared tab, which is the one thing he needs. It is only useful if the guest is heard some other way. The test page has a checkbox so we can see it behave, nothing more.
4. **Producer tab and stream tab must be different tabs.** The page asks Chrome to leave its own tab out of the list so the tab cannot be captured by itself. Better still, put the producer in its own window on a second screen, which also keeps it private.
5. **Stream playback.** Restream says playback of the stream on the same device causes echo and heavy load. Lex should not watch his own live stream with sound on the same computer while using the tool.
6. **Muting the tab.** If Lex mutes the Wave.video or Restream tab in the browser, the captured sound may go silent too. UNVERIFIED. Tell the host to turn their headphone volume down instead. The test page warns after 6 seconds of silence from a shared tab.
7. **Mixing, if ever needed.** The Web Audio way: one source per stream, joined in a gain node, and either a level meter (as in the test page) or a single combined track. Keep them separate if we want to know who spoke. The two streams may run at different sample rates (the test run showed 44.1 and 48 kHz); Web Audio handles that.

### Pitfalls with "capturing a tab that is also streaming"

- The page only listens; it does not touch the stream. But capture adds some computer work to the streaming tab. The test page asks for a tiny, slow picture (320 by 180, 2 frames a second) to keep that work low; Chrome 157 accepted it in my run. Whether this measurably helps a Wave.video or Restream session is UNVERIFIED.
- Chrome shows "sharing" markers (a bar or border). Whether any of that is visible in a screen share Lex might send to viewers is UNVERIFIED. Rule for Lex: never share the producer tab or a whole screen on stream.
- Tab sound is only what that tab plays. Studios normally play the remote people and not the host's own voice back, so Lex's voice comes from the microphone. UNVERIFIED for these two products.
- Opening the microphone a second time (once by Wave.video or Restream, once by our page) usually works in the same browser, but some sound cards and operating systems refuse a second user. UNVERIFIED for Lex's set-up.
- Sharing must be started again each time the page is opened; the browser does not remember it, and each share needs a click. This is by design (the MDN page: permission cannot be persisted).
- The page needs https (or localhost) to share a tab; inside an embedded frame the host page must allow `display-capture`.

### People who only use OBS (no browser studio)

There is no tab to share, so tab sound does not apply. The choice for them is to send OBS's sound into a virtual audio device and pick that device as the "microphone" in our page's input list (after microphone permission, the browser lists every input device by name, and the page can ask for one by its id).

- Mac: BlackHole is a free virtual audio device that shows up as an input and output device in the sound settings (GPL-3.0 licence; read on its project page).
- Windows: a virtual cable such as VB-Cable; Linux: a PipeWire or PulseAudio virtual sink. Both UNVERIFIED (I did not open those pages).
- OBS side: set the OBS monitoring device to the virtual device and set the sources to "Monitor and Output". This comes from forum posts, not official OBS pages, and some forum users report it not working: UNVERIFIED. An alternative some people use is an NDI plugin: UNVERIFIED.
- The same echo rule applies: the virtual device's output must not also play through speakers that the microphone hears.
- Tooltip text for the tool: "No tab sound with OBS. Pick your virtual audio device as the microphone instead." This should be a version 1 setting in the screen design (TOOLS-155), picked from a list, so no extra browser features are needed.

## (d) Steps for Lex to run the real test

Needs: a desktop Chrome (and ideally Edge, Firefox and Safari for the "cannot do it" messages), headphones, and a second person. The guest must agree before their voice is used; the page records and sends nothing, but tell him it is a sound test.

**Open the test page**

1. Open the file `docs/wayfinder/producer/research/TOOLS-149-tab-audio-test/index.html` in the producer folder (`~/Projects/producer`) in Chrome (drag it into a Chrome window).
2. If Chrome refuses to share or listen, ask the fleet to serve the folder at a local address (for example `python3 -m http.server 8765` in that folder, then open `http://localhost:8765/`). The box "What this browser reported" tells you if the address counts as secure.

**Wave.video session with a guest**

3. Put on headphones. Open Wave.video Live Studio in one Chrome tab. Invite the guest with their link. Do not press go live.
4. Open the test page in a second tab, better a new window.
5. In the test page press "Use microphone", allow it, say something: the Microphone meter moves.
6. Press "Share a tab with sound". In the Chrome window pick the Chrome Tab pane, choose the Wave.video tab, tick "Also share tab audio", press Share.
7. Ask the guest to talk. Result 1: the Tab sound meter moves. Say yes or no.
8. Talk yourself, the guest quiet. Result 2: does the Tab sound meter also move (your voice inside the studio tab)? And the Microphone meter moves for sure.
9. Take the headphones off for 20 seconds and let the guest talk through your speakers. Result 3: does the Microphone meter move when only the guest talks? That is the echo problem. Put the headphones back on.
10. Lower your headphone volume to near zero and let the guest talk. Result 4: does the Tab sound meter keep moving? It should, the tab sound is taken before the volume knob (UNVERIFIED, this step proves it).
11. Right-click the Wave.video tab and choose "Mute site", let the guest talk. Result 5: does the Tab sound meter go silent? (Remember to unmute.)
12. Look at "What this browser reported": copy its text and keep it with the results. Check that the displaySurface line says `browser`.

**Restream Studio (solo)**

13. Repeat steps 3 to 12 with Restream Studio in the shared tab. A solo Studio has no guest voice, so you need a sound in the tab: invite a second person or open a Studio guest link on a phone or another computer and talk into it. If that is not possible, mark the Restream run "needs a second person". Do not press Go Live. Whether Studio can be opened without starting a stream: UNVERIFIED, so stop if the Studio asks to start.

**Other browsers (2 minutes each, no guest needed)**

14. Open the test page in Edge: expect the same as Chrome. Open it in Firefox and Safari: press "Share a tab with sound", pick anything. Expect a red box saying no sound arrived. Copy the "What this browser reported" box from each.

**What to send back to the fleet:** answers to results 1 to 5, the Edge, Firefox and Safari outcomes (works, red box, or error text), and the copied boxes. That closes the "unproven" line in the map's decisions.

## (e) UNVERIFIED

- Everything about real Wave.video and Restream Studio audio: whether guest voices are playing inside a normal tab the browser can capture, whether Wave.video can be used without going live, whether it works for a guest joining from Chrome only. Neither help page I read says how the Studio plays remote audio, or which browsers other than Chrome work for Wave.video; Restream names Chrome as the recommended browser and says nothing I found about Edge, desktop Firefox or desktop Safari.
- Edge in practice, Safari in practice (could not start the WebKit build), a release build of Firefox (only a Playwright Firefox 155 build loaded the page).
- The tab-sound meter with real sound. In my scripted Chrome 157 run (fake microphone and fake sharing prompt) the page ran with no errors, the microphone and "both mixed" meters moved, the browser produced one audio track and one video track, and the preview settings (320 by 180, 2 frames a second) were accepted. The tab sound meter stayed at "silent", because the scripted run swaps in a fake audio device for the shared tab's sound. So this run proves the page works, not that a real tab's sound arrives. Only Lex's run in section (d) proves that.
- Echo cancellation across tabs, muted-tab behaviour, volume-knob behaviour, sharing markers visible on stream, second microphone opening, CPU effect of the small picture.
- Virtual audio routes for Windows and Linux; OBS monitoring steps (forum-sourced only).
- Phone and tablet browsers (read from compatibility data only).
- Current status of Mozilla and WebKit work after the dates on the pages I read (bug 1541425 last updated "26 days ago" when fetched on 2026-11-09).

## (f) Sources

- MDN, getDisplayMedia: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- MDN, Using the Screen Capture API: https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture
- MDN, suppressLocalAudioPlayback: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSupportedConstraints/suppressLocalAudioPlayback
- MDN browser compatibility data (package `@mdn/browser-compat-data` 8.1.8, read directly): https://unpkg.com/@mdn/browser-compat-data/data.json
- Can I use, audio capture in getDisplayMedia: https://caniuse.com/mdn-api_mediadevices_getdisplaymedia_audio_capture_support
- W3C Screen Capture (working draft): https://www.w3.org/TR/screen-capture/
- Chrome, screen sharing controls: https://developer.chrome.com/docs/web-platform/screen-sharing-controls
- Chromium intent to ship, windowAudio: https://groups.google.com/a/chromium.org/g/blink-dev/c/66dDyQoX3RI
- Mozilla bug 1541425, audio capture for getDisplayMedia: https://bugzilla.mozilla.org/show_bug.cgi?id=1541425
- WebKit bug 186294 (screen capture audio reason; read through a search summary only): https://bugs.webkit.org/show_bug.cgi?id=186294
- Wave.video, live stream guest guide: https://wave.video/help/articles/3345985
- Wave.video, inviting guests: https://wave.video/help/articles/3346113
- Restream, recommendations for Studio guests: https://support.restream.io/en/articles/4200670-recommendations-for-restream-studio-guests
- Restream, "I hear an echo in Studio": https://support.restream.io/en/articles/9220380-i-hear-an-echo-in-studio
- BlackHole (macOS virtual audio): https://github.com/ExistentialAudio/BlackHole
- OBS monitoring to a virtual cable, forum thread (not official): https://obsproject.com/forum/threads/obs-as-an-audio-input-virtualcam-but-for-audio.116802/
