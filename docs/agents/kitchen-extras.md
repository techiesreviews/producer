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
- **Own check commands** (`scripts/agents/project.d/`): none yet.
- **Shared file:** none.
- **Docs the shared rulebook names:** no runner guide, issue tracker guide, UX rulebook or routines
  yet. The plan and research: `docs/wayfinder/producer/`.

## Visible changes

- **Feature list:** none. **Screenshots:** none: there is no page yet, and no screen is built before
  Lex approves the mock-up.

## After a merge

- None. Nothing is deployed from this repo yet.

## Release

- None yet: no Worker and no deploy. The deploy and preview setup (GitHub checks, a fixed preview
  link, QA before live) is the fleet's to add; when it exists it goes here.

## Other

- This repo is public. No key, token or private note goes in, and the Restream app secret lives only
  in Cloudflare.
- `docs/wayfinder/producer/` is a copy of the planning map first written in the chat project's
  folder; it is kept here as the plan of record. The research test pages in it are throwaway tools
  for Lex's tests, not product code.
