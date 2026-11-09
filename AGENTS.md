# producer

A live host's private "producer" screen: a static page plus one Cloudflare Worker, no accounts, nothing stored, an agent relay like the Prompter's Wait for MCP. Public repo: https://github.com/techiesreviews/producer. Owner: Lex (non-technical; explain in plain words). Status: the page shell and the first-run setup screen (step 1 "I stream with", browser detection, the switched-off pattern) on `dev`, nothing deployed; the plan is in `docs/wayfinder/producer/`.

## Rules

- Agent Kit (the shared kit, `scripts/agents/kit`) for all coding: `kit doctor` first, then the commands that fit the work. Delegated work must carry this requirement.
- This repo is public. Never commit a key, token, password, private note or the Restream app secret (it lives only in Cloudflare). `test/repo-guard.test.mjs` checks the obvious cases; it does not replace care.
- Nothing is stored: no server-side storage of talk, chat or questions, and no logging of request bodies. `test/deploy-config.test.mjs`, `test/build.test.mjs` and `test/worker.test.mjs` guard this and the page policy: never weaken them.
- Build only what is asked. No feature and no screen until the mock-up has Lex's approval.
- Cloudflare free plan only. Do not deploy or change Cloudflare resources unless the lead says so. `wrangler.jsonc` and `.github/workflows/deploy-preview.yml` are written, not run: the Cloudflare token waits for TOOLS-144.
- Layout and checks: README, section "How it is built".
- Orbit board: follow the card standard (`orbit-card-standard.md` in the fleet repo) when you create or change a card. Only lead models write to the board.
- Design: the kit's house style (`docs/house-style.md` in the folder `scripts/agents/kit --home` prints). Anything a person sees shows its state on the control itself: no toasts, no explainers.
- Public status and plans stay plain English in `docs/wayfinder/producer/`.

Kitchen rulebook: `scripts/agents/kit rulebook` (stations, who decides, builder and reviewer pins).
Agent commands: `scripts/agents/kit --help`; `scripts/agents/kit <command> --help` for one.

Review loop: `scripts/agents/kit rulebook`, section "Review loop" (3 fix rounds, 5 only for risk; stop when only nits are left; one reviewer; a findings ledger in the PR).

## Messages to Lex
<!-- messages-to-lex:start v1 -->
- Only what matters to him. Start with the question, or what he must do (test, do or answer).
- Add a recommendation when it fits.
- Caveman style, short bullets, plain words (he is not technical). He asks if he wants more context.
- Leave out internal process (review rounds, waivers, SHAs, file paths) unless he must act on it.
- Example: "Keep the old export button or remove it?" / "Both do the same." / "Recommend: remove it."
<!-- messages-to-lex:end -->
