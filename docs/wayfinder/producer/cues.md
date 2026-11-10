# The cues (card 10)

Written 2026-11-09. A cue is the page asking the host's connected agent for the next question. This is when the page sends one, what it carries, what comes back and how fast it is. The question card (card 11, see below) shows the answer and puts Suggest now and Slow down on screen.

## When a cue goes

- **At a pause.** The speech worker notices about 1.5 s of silence after speech. With the browser's own speech service the pause counts 1.5 s from its last text instead, so it comes late by the service's own delay; that delay is not measured, and the speed target below was proven with the model on this computer only. The 30 s of new speech is counted from each line's start to its end; a line the service sends with no draft before it counts the time it takes to say it (about 2.5 words a second, at most the time since the previous words). A cue goes then, but only when at least 30 s of new speech was heard since the last cue, and at most once a minute.
- **Suggest now.** A cue goes at once, with whatever was heard, at least 10 s after the last cue. It gives back how long to wait when pressed too soon, and says so when no agent is connected (the question card shows both on the button).
- **Slow down.** Doubles both spacings: a pause cue at most every 2 minutes, Suggest now at least 20 s apart. The 30 s of new speech stays the same.
- With the studio tab shared, the host and the guest are heard apart: a pause of one is no pause while the other is still talking (a side counts as talking for 12 s after its last text, until its own pause).
- Both kinds share one clock: Suggest now restarts the minute, and a pause cue blocks Suggest now for 10 s.
- With no agent connected (or its loop gone quiet), nothing is used up: the text waits for the next cue (the newest 20,000 characters) and the spacing does not start.

The rules are in `src/cues.mjs` and never name how the agent is reached (a check makes sure), so a later paid API key mode can take the same cues.

## What a cue carries

- Only the lines heard since the last cue that went (the cursor), each labelled: the host's microphone is `HOST`, the shared studio tab is `GUEST`.
- The run position when the show clock runs: the part on now, its name and the minutes left in it.
- The guest's name when the plan names one.
- The agent asks for the show itself once (its first question, `get_context`): the show name, the guest, the prepared questions (numbered) and the run order with the part on now.
- The speech worker sends the pause only after the text heard before it, so a cue never misses the last words of a point.

## What comes back

- The agent's answer (one to three suggestions) is kept in the page's memory as the latest suggestion, with the seconds since its cue went. An older answer never replaces a newer one; the Test's sample answer stays on the Test button.
- The curl loop sends the same answer again on every idle round: the page takes each answer once.
- Cues sent while the agent is still busy wait for its next call and go together, with the newest reason; a Test cue always goes alone, so its made-up talk never mixes with the show's. Asking again with the same cue number (`seq`) gives the same material, so a lost answer loses nothing, unless more than 20,000 characters pile up unconfirmed: then the oldest show cues are let go first.
- Disconnect forgets the cues and the latest suggestion.

## On the question card (card 11)

- From the start, and whenever the agent is slow or quiet, the card shows the next prepared question from the plan (the first one not asked or skipped), with the next two below to swap in. With no plan and no answer it reads "No question yet"; once every prepared question is asked or skipped, "No questions left".
- An answer from the agent takes the card once: its first suggestion on the card (a prepared question by its number, or a new one), with its few words why and where it came from ("Q3 · your list" or "New"); its next suggestion and the question it replaced go below to swap in (a third suggestion gives way). A suggestion pointing at a question already asked or skipped is left out; when none is left, the card stays as it is.
- Asked and Skip move to the first alternative and mark a prepared question as asked or skipped, in the page's memory (for the end report to come); a new question the host asked or skipped is left out of later answers too. An alternative pressed swaps with the question on the card.
- While the newest cue waits for the agent's turn, Suggest now reads "Thinking…" and the small light in the card's corner breathes orange. The turn ends with the answer to that cue (an answer to an older cue leaves the light on), when the agent comes back past it with no answer, or after a minute. After a cue, Suggest now shows the seconds until it takes the next press. With no agent (or its loop gone quiet) it reads "Suggest now · no agent", switched off, and the light is grey; with the agent connected in another tab, "Suggest now · other tab". The card keeps its question.
- The turn chip counts the cues that went to the agent this show.
- Speed: from the agent's answer arriving to the new question on screen takes 1 to 2 ms (the questions suite, `kit specs questions`, 2026-11-09, checked under 0.3 s), so the real-run seconds above stand for the card too. Not run yet: a real Claude Code rehearsal timed to the card itself (Lex's checkpoint for this card).

## The speed target

On the fast way, a suggestion is on the page within 5 s in the middle case (half the suggestions come faster) and 10 s in the slowest one in ten, after the speech ends.

### The page's own share (checked on every change)

`test/speed.test.mjs` runs this site's real server code on the computer, with the same go-between the agent's calls pass through, and a stand-in agent that answers each cue after a set delay. From the pause to the answer kept on the page, minus the agent's own delay, must stay under 0.3 s on each of 10 cues. Measured (2026-11-09, this computer): 4 ms middle and 7 ms slowest one tool call per turn; 16 ms middle and 23 ms slowest with the curl loop run in bash (it starts bash and curl for each answer). The browser suite `kit specs cues` checks the same in Chromium: the cue reaches the agent's wait in a few milliseconds after the pause.

### Real runs with Claude Code (2026-11-09)

A temporary copy of the site running only on this computer (Cloudflare's own local tool, nothing deployed), the page's own modules driving the connection, Claude Code (Opus 5.5) started from a script with no window, 10 real transcript pieces of about 45 to 70 words, a cue every 30 s (the rule says a minute; halved to keep the run short), one Test first. Times are from the pause to the answer on the page; add the 1.5 s pause for "after the speech ends". One machine, 10 cues: the slowest is just the worst of 10.

| Way | Test (warm-up) | Middle | Slowest | From speech end: middle / slowest | Target |
|---|---|---|---|---|---|
| Connect with MCP | 2.4 s | 2.5 s | 3.2 s | 4.0 s / 4.7 s | met |
| Copy connect message (curl loop) | 4.6 s | 5.5 s | 10.4 s | 7.0 s / 11.9 s | missed |

- Every cue was answered, with three one-line suggestions, most of them pointing to the prepared questions by number.
- Why the message way is slower than in TOOLS-154 (2.5 s middle): each turn the agent types the whole command again (the key, the address, its answer with three suggestions and the loop, about 750 characters), which costs about 3 s of writing per turn; the MCP way sends about 190 characters. The first cue after the Test was the slowest (10.4 s).
- Cost seen: about 0.49 dollars (MCP) and 0.63 dollars (message) for the Test plus 10 cues on Opus.
- Not run: Codex with MCP (the third fast way; TOOLS-154 measured 3.3 s middle, 4.5 s slowest), the slow ways (T3 Code and Codex with the message stay labelled "slower"), a whole hour, a deployed Worker.
- Speech to text is not in these numbers: the pause comes 1.5 s after the last word, and the last piece is turned into text in that time in the middle case (TOOLS-150: 0.8 s middle, 2.1 s slowest), so the slowest case can add up to about 0.6 s.

### The shortened message (card 186, TOOLS-186, 2026-11-10)

The card-10 run showed that the copied message missed the target because the agent typed a long command after every cue. The message now gives a short command (two lines, about 240 characters with the token instead of about 450, before the answer) and the Worker answers plain text on a short route (`agent-relay.md`). The example answer points to a prepared question by its number.

Measured again with real Claude Code (Opus 5.5), the page's own modules, a local copy of the real Worker (`wrangler dev`, nothing deployed), 10 real transcript pieces, one Test first, a cue about every 25 s, the 10 prepared questions loaded. The old message was run the same way, the same hour, for the comparison. Seconds from the pause to the answer on the page; add the 1.5 s pause for "after the speech ends". One machine, 10 cues: the slowest is just the worst of 10.

| Message | Test | Middle | Slowest | From speech end: middle / slowest |
|---|---|---|---|---|
| Old (long command) | 4.6 s | 5.3 s | 11.0 s | 6.8 s / 12.5 s |
| New (short command) | 4.0 s | 4.3 s | 6.5 s | 5.8 s / 8.0 s |

- Against the target (5 s middle, 10 s slowest, after the speech ends) the copied message now meets the slowest figure and misses the middle one by about 0.8 s. Connect with MCP stays the faster way (4.0 s / 4.7 s in card 10), which is why it is the recommended one and the message is labelled "slower".
- Where the saving comes from: a first pair of runs with no prepared questions loaded gave 5.2 s (new) against 5.2 s (old) in the middle, so the shorter command alone saved almost nothing there (new: 5.2 s middle, 10.3 s slowest; old: 5.2 s middle, 6.3 s slowest: each run had one slow cue, the worst of 10, and these two happened to differ): the answer itself is most of what is typed. With the prepared questions loaded the agent answers with their numbers (the new example and rule ask for it), which is short. Both runs use the same harness; the old message's first cue was the slow one (11.0 s). A change of about a second between two runs of 10 is within what one run can vary.
- Every cue was answered in both runs, with one to three suggestions, and the agent never wrote a file or a loop script.
