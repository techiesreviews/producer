# Kitchen extras: producer

`scripts/agents/kit rulebook` prints the shared rulebook, then this file. Where they differ, this
file wins.

## Branches, checks and the shared file

- **Landing branch `dev`, release branch `main`** (`branches` in `scripts/agents/kit.json`). Every
  change lands on `dev` through `scripts/agents/kit pr`; `main` only takes `dev`, through
  `scripts/agents/kit pr --release --base main`. The repo is public, so there is no direct push to
  `main` after the first commit.
- **Checks:** `kit unit` (all of `test/*.test.mjs`, under a second) on every change; it is the one
  entry in `checks` (`test`). GitHub runs the same files in `.github/workflows/checks.yml` on every
  pull request and every push to `dev` or `main` (Node 24, no secrets, no deploy).
  `test/repo-guard.test.mjs` is the public-repo guard: no `.env`, `*.key`, `*.pem` or `.dev.vars*` file, no
  obvious token or private key in any file, and README and LICENSE must exist.
- **Own check commands** (`scripts/agents/project.d/`, run by `scripts/agents/producer-kit.mjs`):
  - `kit specs [suite]`, the browser checks, for any change to the page, the Worker or the build;
    `kit pr` runs the suites a change reaches (`--affected`). Each file in `test/browser/` is one suite:
    `page.mjs` is the whole page at desktop 1366x900 and phone 390x844, light and dark, served through the
    real Worker with the page's own headers, then the setup screen in Playwright's Firefox (light and dark). What it checks lives in its file, not here. Screenshots land in
    the evidence folder (`.scratch/producer/specs-<time>/`). Playwright stays outside the repo: set
    `KIT_PLAYWRIGHT_MODULE` (the path of its `index.mjs`), else `~/Projects/native-site-editor-dev/node_modules` is used.
  - `kit size`: bytes of the built page, its headers and the Worker source. Report only.
- **Shared file:** none.
- **Docs the shared rulebook names:** no runner guide, issue tracker guide, UX rulebook or routines
  yet. The plan and research: `docs/wayfinder/producer/`.

## Visible changes

- **Feature list:** none. **Screenshots:** `kit specs` (the page suite at desktop and phone, light and
  dark, with the tooltip open). No screen beyond the shell is built before Lex approves its mock-up; the
  approved look is the Producer mock-up.
- Colours: `test/contrast.test.mjs` checks every text colour of the page on its background, light and dark.

## After a merge

- None yet. Nothing is deployed from this repo.

## Release

- Not deployed. The Worker config (`wrangler.jsonc`: `producer` and `producer-preview`) and the preview
  step (`.github/workflows/deploy-preview.yml`, built from `dev`, only when both Cloudflare secrets exist)
  are written. They wait for the Cloudflare token (TOOLS-144). The lead runs the first deploys; the live
  address `producer.techies.tools` and the preview `preview-producer.techies.tools` are planned, not set up.

## Other

- This repo is public. No key, token or private note goes in, and the Restream app secret lives only
  in Cloudflare.
- `docs/wayfinder/producer/` is a copy of the planning map first written in the chat project's
  folder; it is kept here as the plan of record. The research test pages in it are throwaway tools
  for Lex's tests, not product code.
