# Producer

A private screen for a live host: a helper beside a live stream or podcast that suggests the next question, keeps the run order on time and shows viewer questions.

- Public and free to use. Each host brings their own setup (their own stream, their own AI assistant).
- It runs in the browser, with one small Cloudflare Worker behind it. No accounts.
- Nothing is stored. Not the talk, not the chat, not the questions.
- It is a private screen for the host. It is never shown on stream.
- The host's own AI assistant connects through MCP, the same way the Prompter's "Wait for MCP" works.
- Sister project: the [Prompter](https://github.com/techiesreviews/prompter).
- Status: the shell exists on `dev`: an empty page with the top bar (name, Private chip) and the shared tooltip, in the Techies light and dark theme. No screen, no setup and no agent connection yet. Nothing is deployed.
- The design and the research are in [docs/wayfinder/producer](docs/wayfinder/producer/README.md).
- This repo is public: it never holds keys, tokens or private notes.

## How it is built

- One Cloudflare Worker (`src/worker.mjs`) serves one static page. `node scripts/build.mjs` writes it to `dist/`: a single `index.html` with the styles and script inlined, a `_headers` file (page policy) and `robots.txt`. The page asks for no outside file.
- The policy allows the microphone and screen capture for this site only, and nothing else from outside. Observability is off; there is no KV, D1, R2 or any other store.
- `wrangler.jsonc` describes two Workers: `producer` (planned address `producer.techies.tools`) and `producer-preview` (planned address `preview-producer.techies.tools`). Nothing is deployed yet. `.github/workflows/deploy-preview.yml` puts a build of `dev` on the preview Worker, and only runs once the Cloudflare secrets exist.
- Theme tokens: `src/theme.css`. Page shell: `src/page.html`, `src/app.css`, `src/app.js`. The shared tooltip: `src/ui/tooltip.mjs`.
- Checks: `scripts/agents/kit unit` (all of `test/*.test.mjs`), `scripts/agents/kit specs` (the page in a real browser, desktop and phone, light and dark) and `scripts/agents/kit size`.

Licence: MIT, see [LICENSE](LICENSE).
