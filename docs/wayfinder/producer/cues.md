# The cues (card 10)

Written 2026-11-09. A cue is the page asking the host's connected agent for the next question. This is when the page sends one, what it carries, what comes back and how fast it is. Nothing here shows on screen yet: the question card (card 11) shows the answer and puts Suggest now and Slow down on screen.

## When a cue goes

- **At a pause.** The speech worker notices about 1.5 s of silence after speech. A cue goes then, but only when at least 30 s of new speech was heard since the last cue, and at most once a minute.
- **Suggest now.** A cue goes at once, with whatever was heard, at least 10 s after the last cue. It gives back how long to wait when pressed too soon, and says so when no agent is connected (card 11 shows that on the button).
- **Slow down.** Doubles both spacings: a pause cue at most every 2 minutes, Suggest now at least 20 s apart. The 30 s of new speech stays the same.
- With the studio tab shared, the host and the guest are heard apart: a pause of one is no pause while the other is still talking (a side counts as talking for 12 s after its last text, until its own pause).
- Both kinds share one clock: Suggest now restarts the minute, and a pause cue blocks Suggest now for 10 s.
- With no agent connected (or its loop gone quiet), nothing is used up: the text waits for the next cue (the newest 20,000 characters) and the spacing does not start.

The rules are in `src/cues.mjs` and never name how the agent is reached (a check makes sure), so a later paid API key mode can take the same cues.

## What a cue carries

- Only the lines heard since the last cue that went (the cursor), each labelled: the host's microphone is `HOST`, the shared studio tab is `GUEST`.
- The run position when the show clock runs: the part on now, its name and the minutes left in it.
- The guest's name when the plan names one.
- The agent asks for the show itself once (`get_context`): the show name, the guest, the prepared questions (numbered) and the run order with the part on now.
- The speech worker sends the pause only after the text heard before it, so a cue never misses the last words of a point.

## What comes back

- The agent's answer (one to three suggestions) is kept in the page's memory as the latest suggestion, with the seconds since its cue went. An older answer never replaces a newer one; the Test's sample answer stays on the Test button.
- The curl loop sends the same answer again on every idle round: the page takes each answer once.
- Cues sent while the agent is still busy wait for its next call and go together, with the newest reason; a Test cue always goes alone, so its made-up talk never mixes with the show's. Asking again with the same `seq` gives the same material, so a lost answer loses nothing, unless more than 20,000 characters pile up unconfirmed: then the oldest show cues are let go first.
- Disconnect forgets the cues and the latest suggestion.

## The speed target

On the fast way, a suggestion is on the page within 5 s (middle) and 10 s (slowest 1 in 10) after the speech ends.

### The page's own share (checked on every change)

`test/speed.test.mjs` runs the real Worker over HTTP with the relay object and a stand-in agent that answers each cue after a set delay. From the pause to the answer kept on the page, minus the agent's own delay, must stay under 0.3 s on each of 10 cues. Measured (2026-11-09, this computer): 4 ms middle and 7 ms slowest one tool call per turn; 16 ms middle and 23 ms slowest with the curl loop run in bash (it starts bash and curl for each answer). The browser suite `kit specs cues` checks the same in Chromium: the cue reaches the agent's wait in a few milliseconds after the pause.

### Real runs with Claude Code (2026-11-09)

A temporary local Worker (`wrangler dev`, nothing deployed), the page's own modules driving the connection, Claude Code (Opus 5.5) in print mode, 10 real transcript pieces of about 45 to 70 words, a cue every 30 s (the rule says a minute; halved to keep the run short), one Test first. Times are from the pause to the answer on the page; add the 1.5 s pause for "after the speech ends". One machine, 10 cues: the slowest is just the worst of 10.

| Way | Test (warm-up) | Middle | Slowest | From speech end: middle / slowest | Target |
|---|---|---|---|---|---|
| Connect with MCP | 2.4 s | 2.5 s | 3.2 s | 4.0 s / 4.7 s | met |
| Copy connect message (curl loop) | 4.6 s | 5.5 s | 10.4 s | 7.0 s / 11.9 s | missed |

- Every cue was answered, with three one-line suggestions, most of them pointing to the prepared questions by number.
- Why the message way is slower than in TOOLS-154 (2.5 s middle): each turn the agent types the whole command again (token, address, `BODY` with three suggestions and the loop, about 750 characters), which costs about 3 s of writing per turn; the MCP way sends about 190 characters. The first cue after the Test was the slowest (10.4 s).
- Cost seen: about 0.49 dollars (MCP) and 0.63 dollars (message) for the Test plus 10 cues on Opus.
- Not run: Codex with MCP (the third fast way; TOOLS-154 measured 3.3 s middle, 4.5 s slowest), the slow ways (T3 Code and Codex with the message stay labelled "slower"), a whole hour, a deployed Worker.
- Speech to text is not in these numbers: the pause comes 1.5 s after the last word, and the last piece is turned into text in that time in the middle case (TOOLS-150: 0.8 s middle, 2.1 s slowest), so the slowest case can add up to about 0.6 s.
