# Producer

A private screen for a live host: a helper beside a live stream or podcast that suggests the next question, keeps the run order on time and shows viewer questions.

- Public and free to use. Each host brings their own setup (their own stream, their own AI assistant).
- It runs in the browser, with one small Cloudflare Worker behind it. No accounts.
- Nothing is stored. Not the talk, not the chat, not the questions.
- It is a private screen for the host. It is never shown on stream.
- The host's own AI assistant connects through MCP, the same way the Prompter's "Wait for MCP" works.
- Sister project: the [Prompter](https://github.com/techiesreviews/prompter).
- Status: on `dev`: the top bar (name, Private chip), the shared tooltip and the first-run setup screen with its first step ("I stream with") and the browser it detects, in the Techies light and dark theme, and the Worker's agent relay (`/mcp`, `/api/agent-token`, `/api/relay`; see [the relay](docs/wayfinder/producer/agent-relay.md)). No sound, speech or page side of the agent connection yet. Nothing is deployed.
- The design and the research are in [docs/wayfinder/producer](docs/wayfinder/producer/README.md).
- This repo is public: it never holds keys, tokens or private notes.

## How it is built

- One Cloudflare Worker (`src/worker.mjs`) serves one static page and the agent relay: `src/mcp.mjs` (the MCP tools), `src/relay.mjs` (one Durable Object per hashed token, a short note only), `src/token.mjs` (eight-hour tokens, own prefix and salt) and `src/limiter.mjs` (60 a minute, 10 per 10 seconds, in memory). `node scripts/build.mjs` writes it to `dist/`: a single `index.html` with the styles and script inlined, a `_headers` file (page policy) and `robots.txt`. The page asks for no outside file.
- The policy allows the microphone and screen capture for this site only, calls to this site only, and nothing else from outside. Observability is off; there is no KV, D1, R2 or any other store. The only Durable Objects are the relay (a short note per token, erased by an alarm) and the request limit (memory only).
- `wrangler.jsonc` describes two Workers: `producer` (planned address `producer.techies.tools`) and `producer-preview` (planned address `preview-producer.techies.tools`). Nothing is deployed yet. `.github/workflows/deploy-preview.yml` puts a build of `dev` on the preview Worker, and only runs once the Cloudflare secrets exist.
- Theme tokens: `src/theme.css`. Page shell and setup screen: `src/page.html`, `src/app.css`, `src/app.js`. The shared tooltip: `src/ui/tooltip.mjs`. Browser detection (what this browser can do, with the reason for each switched-off feature): `src/browser.mjs`.
- Checks: `scripts/agents/kit unit` (all of `test/*.test.mjs`), `scripts/agents/kit specs` (the page in a real browser, desktop and phone, light and dark, and in Firefox) and `scripts/agents/kit size`.

Licence: MIT, see [LICENSE](LICENSE).
